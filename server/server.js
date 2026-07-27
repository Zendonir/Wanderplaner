'use strict';

/**
 * Schlanker Server für den Wanderplaner: liefert die statischen Dateien aus
 * und hält die Sammlung (Stempelstellen, Parkplätze, Touren …) in einer
 * JSON-Datei, damit alle Geräte denselben Stand sehen.
 *
 * Bewusst ohne Abhängigkeiten – nur Node-Bordmittel.
 */
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '..', 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'wanderplaner.json');
// Wird beim Bauen des Images gesetzt; sonst aus der package.json gelesen.
const APP_VERSION = process.env.APP_VERSION && process.env.APP_VERSION !== 'dev'
  ? process.env.APP_VERSION
  : readPackageVersion();
const MAX_BODY_BYTES = 8 * 1024 * 1024;

// Alle Sammlungen, die synchronisiert werden. Jeder Eintrag trägt eine id,
// updatedAt (ms) und optional deletedAt für Löschungen.
const COLLECTIONS = ['stamps', 'parking', 'tracks', 'tours'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/* ---------- Datenhaltung ---------- */

function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return `${pkg.version} (aus dem Quellcode)`;
  } catch (err) {
    return 'unbekannt';
  }
}

function emptyStore() {
  const store = { revision: 0, updatedAt: 0 };
  COLLECTIONS.forEach((name) => { store[name] = []; });
  return store;
}

async function readStore() {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    const store = emptyStore();
    store.revision = Number(data.revision) || 0;
    store.updatedAt = Number(data.updatedAt) || 0;
    COLLECTIONS.forEach((name) => {
      if (Array.isArray(data[name])) store[name] = data[name];
    });
    return store;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Datendatei nicht lesbar, starte mit leerem Stand:', err.message);
    }
    return emptyStore();
  }
}

// Schreibvorgänge werden serialisiert, damit zwei gleichzeitige Anfragen
// sich nicht gegenseitig überschreiben.
let writeChain = Promise.resolve();

function writeStore(store) {
  writeChain = writeChain.then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(store), 'utf8');
    await fsp.rename(tmp, DATA_FILE); // atomar, damit die Datei nie halb geschrieben ist
  }).catch((err) => {
    console.error('Speichern fehlgeschlagen:', err.message);
  });
  return writeChain;
}

/**
 * Führt zwei Stände eintragsweise zusammen: pro id gewinnt der neuere
 * Zeitstempel. Löschungen sind Einträge mit deletedAt und gewinnen auf
 * demselben Weg – sonst würde ein gelöschter Eintrag vom anderen Gerät
 * wieder auftauchen.
 */
function mergeCollections(mine, theirs) {
  const byId = new Map();
  const put = (item) => {
    if (!item || typeof item.id !== 'string') return;
    const stamp = Number(item.updatedAt) || 0;
    const existing = byId.get(item.id);
    if (!existing || stamp >= (Number(existing.updatedAt) || 0)) {
      byId.set(item.id, item);
    }
  };
  (Array.isArray(mine) ? mine : []).forEach(put);
  (Array.isArray(theirs) ? theirs : []).forEach(put);
  return [...byId.values()];
}

/** Tombstones nach 90 Tagen entfernen, damit die Datei nicht endlos wächst. */
function pruneTombstones(items) {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  return items.filter((item) => !item.deletedAt || item.deletedAt > cutoff);
}

/* ---------- HTTP ---------- */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Zu viele Daten.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(Object.assign(new Error('Ungültiges JSON.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { status: 'ok', version: APP_VERSION });
  }

  if (url.pathname === '/api/version') {
    return sendJson(res, 200, {
      version: APP_VERSION,
      node: process.version,
      startedAt: startedAt.toISOString(),
    });
  }

  if (url.pathname !== '/api/data') {
    return sendJson(res, 404, { error: 'Unbekannter Endpunkt.' });
  }

  if (req.method === 'GET') {
    const store = await readStore();
    return sendJson(res, 200, store);
  }

  // POST führt den mitgeschickten Stand mit dem gespeicherten zusammen und
  // gibt den vereinigten Stand zurück – so bekommt der Client sofort die
  // Änderungen der anderen Geräte.
  if (req.method === 'POST') {
    let incoming;
    try {
      incoming = await readBody(req);
    } catch (err) {
      return sendJson(res, err.status || 400, { error: err.message });
    }

    const current = await readStore();
    const merged = emptyStore();
    COLLECTIONS.forEach((name) => {
      merged[name] = pruneTombstones(mergeCollections(current[name], incoming[name]));
    });
    merged.revision = (Number(current.revision) || 0) + 1;
    merged.updatedAt = Date.now();

    await writeStore(merged);
    return sendJson(res, 200, merged);
  }

  res.writeHead(405, { Allow: 'GET, POST' });
  res.end();
}

function serveStatic(req, res, url) {
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, relative);

  // Ausbruch aus dem öffentlichen Verzeichnis verhindern.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nicht gefunden');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // index.html nie cachen, damit Updates sofort ankommen.
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      console.error('Fehler bei', url.pathname, err);
      sendJson(res, 500, { error: 'Interner Fehler.' });
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  serveStatic(req, res, url);
});

const startedAt = new Date();

server.listen(PORT, () => {
  console.log(`Wanderplaner ${APP_VERSION} läuft auf Port ${PORT}`);
  console.log(`  Dateien: ${PUBLIC_DIR}`);
  console.log(`  Daten:   ${DATA_FILE}`);
});
