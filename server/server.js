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
const Update = require('./update');

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

/**
 * Liest die Fassung der Oberfläche aus dem Service Worker. Der Browser meldet
 * dieselbe Angabe aus seinem Zwischenspeicher – stimmen beide nicht überein,
 * zeigt er noch die alte Oberfläche und die App kann das sagen.
 */
function readShellVersion() {
  try {
    const source = fs.readFileSync(path.join(PUBLIC_DIR, 'sw.js'), 'utf8');
    const match = source.match(/const VERSION = '([^']+)'/);
    return match ? match[1] : null;
  } catch (err) {
    return null;
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
  const done = writeChain.then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(store), 'utf8');
    await fsp.rename(tmp, DATA_FILE); // atomar, damit die Datei nie halb geschrieben ist
  });
  // Die Kette darf nie mit einer abgelehnten Zusage weiterlaufen, sonst
  // scheitern alle folgenden Schreibvorgänge mit demselben alten Fehler.
  writeChain = done.catch(() => {});
  // Der Fehler geht dagegen an den Aufrufer: Ein stillschweigend verworfener
  // Schreibfehler sähe für die App wie ein erfolgreicher Abgleich aus,
  // während in Wirklichkeit nichts ankommt.
  return done;
}

/**
 * Prüft, ob das Datenverzeichnis wirklich beschreibbar ist. Der häufigste
 * Fall in der Praxis: Das Volume gehört root, der Dienst läuft aber als
 * `node` – dann schlägt jeder Abgleich still fehl.
 */
async function storageStatus() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.access(DATA_DIR, fs.constants.W_OK);
    return { path: DATA_DIR, writable: true };
  } catch (err) {
    return { path: DATA_DIR, writable: false, reason: err.code || err.message };
  }
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
    const storage = await storageStatus();
    return sendJson(res, 200, {
      status: storage.writable ? 'ok' : 'readonly',
      version: APP_VERSION,
      storage,
    });
  }

  if (url.pathname === '/api/version') {
    return sendJson(res, 200, {
      version: APP_VERSION,
      // Beim Update wird die Datei ausgetauscht, darum jedes Mal frisch lesen.
      shell: readShellVersion(),
      node: process.version,
      startedAt: startedAt.toISOString(),
    });
  }

  if (url.pathname === '/api/update') {
    if (req.method === 'GET') {
      return sendJson(res, 200, await Update.status());
    }
    if (req.method === 'POST') {
      try {
        return sendJson(res, 200, await Update.run());
      } catch (err) {
        return sendJson(res, err.status || 500, { error: err.message });
      }
    }
    res.writeHead(405, { Allow: 'GET, POST' });
    return res.end();
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

    try {
      await writeStore(merged);
    } catch (err) {
      console.error('Speichern fehlgeschlagen:', err.message);
      return sendJson(res, 500, {
        error: `Der Server kann nicht speichern (${DATA_FILE}: ${err.code || err.message}). ` +
          'Meist gehört das Datenverzeichnis dem falschen Nutzer.',
        storage: await storageStatus(),
      });
    }
    return sendJson(res, 200, merged);
  }

  res.writeHead(405, { Allow: 'GET, POST' });
  res.end();
}

/**
 * Kennung für eine Datei aus Größe und Änderungszeit. Ändert sich die Datei
 * beim Update, ändert sich die Kennung – und der Browser holt sie neu.
 */
function etagFor(stat) {
  return `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
}

async function serveStatic(req, res, url) {
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, relative);

  // Ausbruch aus dem öffentlichen Verzeichnis verhindern.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('Kein reguläres Ziel.');
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Nicht gefunden');
  }

  const ext = path.extname(filePath);
  const etag = etagFor(stat);

  // Kein Zwischenspeichern ohne Rückfrage: Ein „max-age“ auf den
  // Programmdateien führte dazu, dass der Browser nach einem Update
  // stundenlang die alte Oberfläche aus seinem eigenen Speicher nahm –
  // der Server wurde dabei gar nicht erst gefragt. Mit „no-cache“ fragt er
  // jedes Mal nach und bekommt bei unveränderter Datei ein knappes 304
  // zurück, das kostet im Heimnetz nichts.
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
  };

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nicht gefunden');
    }
    res.writeHead(200, { ...headers, 'Content-Length': data.length });
    if (req.method === 'HEAD') return res.end();
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
  serveStatic(req, res, url).catch((err) => {
    console.error('Fehler beim Ausliefern von', url.pathname, err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Interner Fehler');
  });
});

const startedAt = new Date();

server.listen(PORT, () => {
  console.log(`Wanderplaner ${APP_VERSION} läuft auf Port ${PORT}`);
  console.log(`  Dateien: ${PUBLIC_DIR}`);
  console.log(`  Daten:   ${DATA_FILE}`);
});
