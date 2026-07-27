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

/**
 * Sucht den eigenen Container. Docker setzt den Hostnamen standardmäßig auf
 * die Container-ID; wo das übergangen wurde, hilft CONTAINER_NAME weiter.
 */
async function findSelf() {
  const candidates = [process.env.CONTAINER_NAME, os.hostname()].filter(Boolean);
  for (const candidate of candidates) {
    const res = await dockerRequest('GET', `/containers/${encodeURIComponent(candidate)}/json`);
    if (res.status === 200 && res.json) {
      return {
        id: res.json.Id,
        name: String(res.json.Name || '').replace(/^\//, ''),
        image: (res.json.Config && res.json.Config.Image) || '',
      };
    }
  }
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
    return { available: false, reason: `Docker nicht erreichbar: ${err.message}`, container: null };
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
