'use strict';

/**
 * Aktualisierung aus der Weboberfläche heraus – standardmäßig abgeschaltet.
 *
 * Freigeschaltet wird sie nur, wenn beides zutrifft:
 *   - ALLOW_SELF_UPDATE=1 ist gesetzt
 *   - der Docker-Socket ist in den Container eingehängt
 *
 * Warum diese Zurückhaltung: Wer den Docker-Socket erreicht, kann auf dem
 * Host praktisch alles tun. Eine Web-App, die aus dem Netz erreichbar ist,
 * sollte diese Macht nicht ungefragt bekommen.
 *
 * Warum ein Helfer statt Selbsthilfe: Ein Container kann sich nicht selbst
 * neu erstellen – beim Ersetzen stirbt genau der Prozess, der die Arbeit
 * machen müsste. Deshalb wird ein kurzlebiger Watchtower-Container
 * gestartet, der von außen zusieht: neues Image ziehen, uns ersetzen,
 * sich selbst aufräumen.
 */
const http = require('http');
const os = require('os');
const fs = require('fs');

const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const HELPER_IMAGE = process.env.UPDATE_HELPER_IMAGE || 'containrrr/watchtower:latest';
const ENABLED = /^(1|true|yes|ja)$/i.test(process.env.ALLOW_SELF_UPDATE || '');

/** Ein Aufruf an die Docker-Engine über den Unix-Socket. */
function dockerRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        socketPath: SOCKET,
        method,
        path,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
        timeout: 120000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (err) {
            json = null; // Manche Antworten sind Zeilen-JSON oder leer.
          }
          resolve({ status: res.statusCode, text, json });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Docker antwortet nicht.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Formt die Antwort der Docker-Engine in das um, was hier gebraucht wird. */
function describe(details) {
  return {
    id: details.Id,
    name: String(details.Name || '').replace(/^\//, ''),
    image: (details.Config && details.Config.Image) || '',
  };
}

/**
 * Sucht den eigenen Container.
 *
 * Der direkte Weg ist der Hostname: Docker setzt ihn auf die Container-ID.
 * Unter Compose – und damit auch bei einer TrueNAS-App – ist der Hostname
 * aber der Dienstname aus der YAML, während der Container
 * `projekt-dienst-1` heißt. Der Nachschlag über den Namen geht dann ins
 * Leere, deshalb wird anschließend die Containerliste durchsucht.
 */
async function findSelf() {
  // Docker setzt HOSTNAME im Container – das ist verlässlicher als
  // os.hostname(), das ausserhalb eines Containers den Rechnernamen liefert.
  const hostname = process.env.HOSTNAME || os.hostname();

  for (const candidate of [process.env.CONTAINER_NAME, hostname].filter(Boolean)) {
    const res = await dockerRequest('GET', `/containers/${encodeURIComponent(candidate)}/json`);
    if (res.status === 200 && res.json) return describe(res.json);
  }

  // Zweiter Anlauf über die Liste: Der Hostname taucht dort als Anfang der
  // Container-ID, als Teil des Namens oder als Compose-Dienstname auf.
  const list = await dockerRequest('GET', '/containers/json?limit=0');
  if (list.status !== 200 || !Array.isArray(list.json)) return null;

  const match = list.json.find((c) => {
    const labels = c.Labels || {};
    const names = (c.Names || []).map((n) => n.replace(/^\//, ''));
    return String(c.Id).startsWith(hostname)
      || names.includes(hostname)
      || labels['com.docker.compose.service'] === hostname
      || names.some((n) => n.includes(hostname));
  });
  if (!match) return null;

  const details = await dockerRequest('GET', `/containers/${match.Id}/json`);
  if (details.status === 200 && details.json) return describe(details.json);
  return null;
}

/**
 * Ob die Aktualisierung angeboten werden darf – und wenn nicht, warum.
 * @returns {Promise<{available:boolean, reason:?string, container:?string}>}
 */
async function status() {
  if (!ENABLED) {
    return {
      available: false,
      reason: 'Nicht freigeschaltet. Zum Aktivieren ALLOW_SELF_UPDATE=1 setzen und ' +
        '/var/run/docker.sock in den Container einhängen.',
      container: null,
    };
  }
  if (!fs.existsSync(SOCKET)) {
    return {
      available: false,
      reason: `Der Docker-Socket ${SOCKET} ist nicht eingehängt.`,
      container: null,
    };
  }
  try {
    const self = await findSelf();
    if (!self) {
      return {
        available: false,
        reason: 'Der eigene Container ließ sich nicht ermitteln. CONTAINER_NAME setzen.',
        container: null,
      };
    }
    return { available: true, reason: null, container: self.name, image: self.image };
  } catch (err) {
    // EACCES heißt: Der Socket ist da, aber der Dienst darf nicht ran. Er
    // gehört auf dem Host einer Gruppe, deren Nummer je Rechner verschieden
    // ist; das Startskript nimmt den Dienstnutzer dort auf – das geht aber
    // nur, wenn der Container als root starten darf.
    const reason = /EACCES/.test(err.message)
      ? `Der Docker-Socket ${SOCKET} ist eingehängt, aber nicht lesbar (EACCES). ` +
        'Der Container muss als root starten dürfen, damit er sich beim Start ' +
        'der Socket-Gruppe zuordnen kann – in der App-Konfiguration also keine ' +
        'feste Nutzer-ID vorgeben.'
      : `Docker nicht erreichbar: ${err.message}`;
    return { available: false, reason, container: null };
  }
}

/** Zieht das Helfer-Image; ohne es kann der Container nicht starten. */
async function pullHelper() {
  const [image, tag = 'latest'] = HELPER_IMAGE.split(':');
  const res = await dockerRequest(
    'POST',
    `/images/create?fromImage=${encodeURIComponent(image)}&tag=${encodeURIComponent(tag)}`
  );
  if (res.status >= 400) {
    throw new Error(`Helfer-Image ${HELPER_IMAGE} nicht ladbar (HTTP ${res.status}).`);
  }
}

/**
 * Stößt die Aktualisierung an. Der Aufruf kehrt zurück, sobald der Helfer
 * läuft – kurz danach wird dieser Prozess selbst ersetzt.
 */
async function run() {
  const state = await status();
  if (!state.available) {
    throw Object.assign(new Error(state.reason), { status: 409 });
  }

  await pullHelper();

  const name = `wanderplaner-update-${Date.now()}`;
  const created = await dockerRequest('POST', `/containers/create?name=${name}`, {
    Image: HELPER_IMAGE,
    // --run-once: einmal aktualisieren und beenden, nicht dauerhaft wachen.
    Cmd: ['--run-once', '--cleanup', state.container],
    HostConfig: {
      Binds: [`${SOCKET}:/var/run/docker.sock`],
      AutoRemove: true,
    },
  });
  if (created.status >= 400 || !created.json || !created.json.Id) {
    throw new Error(`Der Helfer ließ sich nicht anlegen (HTTP ${created.status}).`);
  }

  const started = await dockerRequest('POST', `/containers/${created.json.Id}/start`);
  if (started.status >= 400) {
    throw new Error(`Der Helfer ließ sich nicht starten (HTTP ${started.status}).`);
  }

  return { started: true, container: state.container, helper: name };
}

module.exports = { status, run, ENABLED, SOCKET };
