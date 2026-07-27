'use strict';

/**
 * Betrieb im Container: der Sync-Dienst selbst, ohne Browser.
 *
 * Wichtigster Fall: Wenn der Server sein Datenverzeichnis nicht beschreiben
 * kann – in der Praxis ein Volume, das dem falschen Nutzer gehört –, darf der
 * Abgleich nicht so tun, als hätte er funktioniert. Genau das hat den
 * geräteübergreifenden Abgleich lange still scheitern lassen.
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

/** Startet den Server mit einem bestimmten Datenverzeichnis. */
async function startWith(port, dataDir, extraEnv = {}) {
  const proc = spawn('node', [path.join(ROOT, 'server', 'server.js')], {
    env: {
      ...process.env, PORT: String(port), DATA_DIR: dataDir, PUBLIC_DIR: ROOT, ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  proc.stderr.on('data', (d) => log.push(d.toString()));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startet nicht')), 15000);
    proc.stdout.on('data', (d) => {
      if (d.toString().includes('läuft auf Port')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return { proc, log, stop: () => proc.kill() };
}

async function api(port, pathname, options) {
  const response = await fetch(`http://localhost:${port}${pathname}`, options);
  return { status: response.status, body: await response.json().catch(() => null) };
}

const post = (payload) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

/**
 * Nachgebaute Docker-Engine auf einem Unix-Socket. Sie merkt sich, was
 * angefragt wurde – so lässt sich prüfen, dass die Aktualisierung wirklich
 * einen Helfer startet und nicht etwa versucht, sich selbst zu ersetzen.
 */
function fakeDocker(socketPath, options = {}) {
  // Bei Compose heißt der Container nicht wie der Dienst – dann muss die
  // Suche über die Liste gehen. `composeStyle` stellt genau das nach.
  const { composeStyle = false, service = 'wanderplaner' } = options;
  const containerName = composeStyle ? `ix-${service}-${service}-1` : service;
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      calls.push({ method: req.method, url: req.url, body });

      const reply = (status, payload) => {
        const text = JSON.stringify(payload || {});
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(text);
      };

      if (req.method === 'GET' && req.url.startsWith('/containers/json')) {
        return reply(200, [{
          Id: 'abc123def456',
          Names: [`/${containerName}`],
          Labels: { 'com.docker.compose.service': service },
        }]);
      }

      if (req.method === 'GET' && /^\/containers\/[^/]+\/json$/.test(req.url)) {
        const wanted = decodeURIComponent(req.url.split('/')[2]);
        // Compose-Aufbau: Der Dienstname allein findet den Container nicht.
        if (composeStyle && wanted !== containerName && wanted !== 'abc123def456') {
          return reply(404, { message: 'No such container' });
        }
        return reply(200, {
          Id: 'abc123def456',
          Name: `/${containerName}`,
          Config: { Image: 'ghcr.io/zendonir/wanderplaner:latest' },
        });
      }
      if (req.method === 'POST' && req.url.startsWith('/images/create')) return reply(200, {});
      if (req.method === 'POST' && req.url.startsWith('/containers/create')) {
        return reply(201, { Id: 'helfer1' });
      }
      if (req.method === 'POST' && /\/start$/.test(req.url)) return reply(204, {});
      return reply(404, { message: 'unbekannt' });
    });
  });

  return new Promise((resolve) => {
    server.listen(socketPath, () => resolve({
      calls,
      stop: () => new Promise((done) => server.close(done)),
    }));
  });
}

module.exports = {
  name: 'Sync-Dienst im Container',

  async run(check) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-betrieb-'));

    /* ---- Normalfall: beschreibbares Verzeichnis ---- */
    const goodDir = path.join(tmp, 'daten');
    const good = await startWith(9106, goodDir);
    try {
      const health = await api(9106, '/api/health');
      check.equal(health.body.status, 'ok', 'Ein beschreibbares Verzeichnis meldet „ok“');
      check.equal(health.body.storage.writable, true,
        'Die Statusabfrage nennt das Datenverzeichnis als beschreibbar');
      check.contains(health.body.storage.path, 'daten',
        'Der geprüfte Pfad wird mitgeteilt');

      const stamp = { id: 'a1', name: 'HWN 1', lat: 51.8, lng: 10.6, updatedAt: Date.now() };
      const written = await api(9106, '/api/data', post({ stamps: [stamp] }));
      check.equal(written.status, 200, 'Der Abgleich wird angenommen');
      check.equal(written.body.stamps.length, 1, 'Der Eintrag kommt zurück');
      check.ok(fs.existsSync(path.join(goodDir, 'wanderplaner.json')),
        'Die Sammlung landet wirklich auf der Platte');

      // Das ist der eigentliche Sinn: ein zweites Gerät sieht denselben Stand.
      const second = await api(9106, '/api/data');
      check.equal(second.body.stamps.length, 1,
        'Ein zweites Gerät bekommt den Eintrag ohne eigenen Import');
    } finally {
      good.stop();
    }

    /* ---- Störfall: Verzeichnis nicht beschreibbar ---- */
    // Nachgestellt über einen Pfad, der gar kein Verzeichnis sein kann –
    // das greift auch als root, anders als ein entzogenes Schreibrecht.
    // Für den Server sieht es aus wie ein Volume, in das er nicht darf.
    const blocker = path.join(tmp, 'kein-verzeichnis');
    fs.writeFileSync(blocker, 'ich bin eine Datei');
    const brokenDir = path.join(blocker, 'daten');

    const broken = await startWith(9107, brokenDir);
    try {
      const health = await api(9107, '/api/health');
      check.equal(health.body.status, 'readonly',
        'Ein nicht beschreibbares Verzeichnis wird als solches gemeldet');
      check.equal(health.body.storage.writable, false,
        'Die Statusabfrage sagt, dass nicht geschrieben werden kann');
      check.ok(health.body.storage.reason,
        'Der Grund wird genannt', String(health.body.storage.reason));

      const attempt = await api(9107, '/api/data',
        post({ stamps: [{ id: 'b1', name: 'HWN 2', updatedAt: Date.now() }] }));
      check.equal(attempt.status, 500,
        'Ein misslungener Abgleich wird nicht als Erfolg gemeldet');
      check.contains(attempt.body.error, 'nicht speichern',
        'Die Antwort erklärt, was schiefgeht');

      // Der Server muss danach weiterlaufen und den nächsten Versuch wieder
      // sauber beantworten – nicht an einer alten, abgelehnten Zusage hängen.
      const again = await api(9107, '/api/data',
        post({ stamps: [{ id: 'b2', name: 'HWN 3', updatedAt: Date.now() }] }));
      check.equal(again.status, 500, 'Auch der zweite Versuch meldet denselben Fehler');
      check.contains(again.body.error, 'nicht speichern',
        'Und erklärt es genauso verständlich');
      const stillAlive = await api(9107, '/api/health');
      check.equal(stillAlive.status, 200, 'Der Dienst läuft trotz Schreibfehler weiter');
    } finally {
      broken.stop();
    }

    /* ---- Erholung: sobald geschrieben werden kann, läuft es weiter ---- */
    const recovered = await startWith(9108, path.join(tmp, 'wieder-gut'));
    try {
      const written = await api(9108, '/api/data',
        post({ stamps: [{ id: 'c1', name: 'HWN 4', updatedAt: Date.now() }] }));
      check.equal(written.status, 200,
        'Mit beschreibbarem Verzeichnis gelingt der Abgleich wieder');
    } finally {
      recovered.stop();
    }

    /* ---- Aktualisierung: standardmäßig zu ---- */
    const closed = await startWith(9109, path.join(tmp, 'zu'));
    try {
      const state = await api(9109, '/api/update');
      check.equal(state.body.available, false,
        'Ohne Freigabe bietet der Server keine Aktualisierung an');
      check.contains(state.body.reason, 'ALLOW_SELF_UPDATE',
        'Er nennt den Schalter, mit dem man sie einschaltet');

      const attempt = await api(9109, '/api/update', { method: 'POST' });
      check.equal(attempt.status, 409,
        'Ein Versuch ohne Freigabe wird abgewiesen');
    } finally {
      closed.stop();
    }

    /* ---- Freigabe gesetzt, aber kein Socket ---- */
    const noSocket = await startWith(9110, path.join(tmp, 'ohne-socket'), {
      ALLOW_SELF_UPDATE: '1',
      DOCKER_SOCKET: path.join(tmp, 'gibt-es-nicht.sock'),
    });
    try {
      const state = await api(9110, '/api/update');
      check.equal(state.body.available, false,
        'Ohne eingehängten Socket bleibt die Aktualisierung zu');
      check.contains(state.body.reason, 'Socket', 'Der fehlende Socket wird benannt');
    } finally {
      noSocket.stop();
    }

    /* ---- Freigabe und Socket vorhanden ---- */
    const socketPath = path.join(tmp, 'docker.sock');
    const docker = await fakeDocker(socketPath);
    const enabled = await startWith(9111, path.join(tmp, 'mit-socket'), {
      ALLOW_SELF_UPDATE: '1',
      DOCKER_SOCKET: socketPath,
      CONTAINER_NAME: 'wanderplaner',
    });
    try {
      const state = await api(9111, '/api/update');
      check.equal(state.body.available, true,
        'Mit Freigabe und Socket wird die Aktualisierung angeboten');
      check.equal(state.body.container, 'wanderplaner',
        'Der eigene Container wird richtig erkannt');

      const started = await api(9111, '/api/update', { method: 'POST' });
      check.equal(started.status, 200, 'Die Aktualisierung lässt sich anstoßen');

      const create = docker.calls.find((c) => c.url.startsWith('/containers/create'));
      check.ok(create, 'Es wird ein eigener Helfer-Container angelegt');
      check.contains(create.body.Cmd.join(' '), '--run-once',
        'Der Helfer läuft nur einmal und bleibt nicht als Wächter zurück');
      check.contains(create.body.Cmd.join(' '), 'wanderplaner',
        'Er bekommt gesagt, welchen Container er ersetzen soll');
      check.ok(create.body.HostConfig.Binds.some((b) => b.includes('docker.sock')),
        'Nur der Helfer bekommt den Docker-Socket');
      check.equal(create.body.HostConfig.AutoRemove, true,
        'Der Helfer räumt sich selbst weg');
      check.ok(docker.calls.some((c) => c.url.startsWith('/images/create')),
        'Das Helfer-Image wird vorher geladen');
      check.ok(docker.calls.some((c) => /\/start$/.test(c.url)),
        'Der Helfer wird gestartet');
    } finally {
      enabled.stop();
      await docker.stop();
    }

    /* ---- Compose-Aufbau: Hostname ist der Dienst, nicht der Container ---- */
    // Genau der Fall auf TrueNAS: Der Container heißt ix-wanderplaner-…-1,
    // der Hostname im Container aber nur „wanderplaner“. Ohne die Suche über
    // die Containerliste fände sich die App selbst nicht.
    const composeSocket = path.join(tmp, 'compose.sock');
    const composeDocker = await fakeDocker(composeSocket, { composeStyle: true });
    const compose = await startWith(9112, path.join(tmp, 'compose'), {
      ALLOW_SELF_UPDATE: '1',
      DOCKER_SOCKET: composeSocket,
      // Kein CONTAINER_NAME – der Hostname ist der Dienstname aus der YAML.
      HOSTNAME: 'wanderplaner',
    });
    try {
      const state = await api(9112, '/api/update');
      check.equal(state.body.available, true,
        'Auch bei Compose-Namen findet sich der eigene Container');
      check.equal(state.body.container, 'ix-wanderplaner-wanderplaner-1',
        'Und zwar unter seinem tatsächlichen Namen');

      await api(9112, '/api/update', { method: 'POST' });
      const create = composeDocker.calls.find((c) => c.url.startsWith('/containers/create'));
      check.contains(create.body.Cmd.join(' '), 'ix-wanderplaner-wanderplaner-1',
        'Der Helfer bekommt den echten Containernamen genannt');
    } finally {
      compose.stop();
      await composeDocker.stop();
    }

    fs.rmSync(tmp, { recursive: true, force: true });
  },
};
