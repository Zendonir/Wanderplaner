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
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

/** Startet den Server mit einem bestimmten Datenverzeichnis. */
async function startWith(port, dataDir) {
  const proc = spawn('node', [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, PUBLIC_DIR: ROOT },
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

    fs.rmSync(tmp, { recursive: true, force: true });
  },
};
