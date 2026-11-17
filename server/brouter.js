'use strict';

/**
 * Offline-Routing: Anbindung an einen BRouter im selben Docker-Verbund.
 *
 * Der Wanderplaner reicht Anfragen an `/brouter…` an den BRouter-Container
 * weiter. Damit gibt es weder CORS- noch HTTPS-Mischinhalt-Probleme: Für den
 * Browser kommt die Route vom selben Server wie die App.
 *
 * Außerdem verwaltet er die Datendateien (`*.rd5`) im gemeinsamen Volume:
 * Welche Kacheln liegen vor, und auf Wunsch eine Kachel von brouter.de
 * herunterladen. BRouter selbst rechnet danach ohne Internet.
 *
 * Konfiguration über Umgebungsvariablen:
 *   BROUTER_URL           z. B. http://brouter:17777 – leer: abgeschaltet
 *   BROUTER_SEGMENTS_DIR  gemeinsames Volume mit den .rd5-Dateien
 *   BROUTER_SEGMENTS_SOURCE  Herkunft der Kacheln (Standard: brouter.de)
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const BROUTER_URL = (process.env.BROUTER_URL || '').replace(/\/+$/, '');
const SEGMENTS_DIR = process.env.BROUTER_SEGMENTS_DIR || '';
const SEGMENTS_SOURCE = (process.env.BROUTER_SEGMENTS_SOURCE
  || 'https://brouter.de/brouter/segments4').replace(/\/+$/, '');

// Kachelnamen wie E10_N50: Längengrad und Breitengrad der Südwestecke einer
// 5°-Kachel. Alles andere wird abgelehnt – der Name landet in einem Dateipfad.
const TILE_RE = /^[EW]\d{1,3}_[NS]\d{1,2}$/;

/** Laufende Downloads: Kachel → { received, total, error, done } */
const downloads = new Map();

function configured() {
  return Boolean(BROUTER_URL);
}

async function listTiles() {
  if (!SEGMENTS_DIR) return [];
  try {
    const names = await fsp.readdir(SEGMENTS_DIR);
    const tiles = [];
    for (const name of names) {
      if (!name.endsWith('.rd5')) continue;
      const stat = await fsp.stat(path.join(SEGMENTS_DIR, name));
      tiles.push({ tile: name.slice(0, -4), bytes: stat.size, modified: stat.mtimeMs });
    }
    return tiles.sort((a, b) => a.tile.localeCompare(b.tile));
  } catch (err) {
    return [];
  }
}

/** Antwortet der BRouter? Eine unvollständige Anfrage genügt dafür. */
function ping() {
  return new Promise((resolve) => {
    if (!configured()) return resolve(false);
    const req = http.get(`${BROUTER_URL}/brouter?lonlats=&format=geojson`, (res) => {
      res.resume();
      resolve(true);
    });
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function status() {
  const tiles = await listTiles();
  return {
    configured: configured(),
    reachable: await ping(),
    manageable: Boolean(SEGMENTS_DIR),
    tiles,
    downloads: [...downloads.entries()].map(([tile, d]) => ({ tile, ...d })),
  };
}

/** Lädt eine Datei mit Weiterleitungen herunter. */
function fetchStream(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(fetchStream(new URL(res.headers.location, url).toString(), redirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      resolve(res);
    });
    req.setTimeout(60000, () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
  });
}

/**
 * Startet den Download einer Kachel im Hintergrund. Die Datei wird erst
 * unter einem Zwischennamen geschrieben und am Ende umbenannt – BRouter
 * sieht so nie eine halbe Datei.
 */
async function startDownload(tile) {
  if (!SEGMENTS_DIR) {
    throw Object.assign(new Error('Kein Kachelverzeichnis eingerichtet (BROUTER_SEGMENTS_DIR).'),
      { status: 400 });
  }
  if (!TILE_RE.test(tile)) {
    throw Object.assign(new Error('Ungültiger Kachelname.'), { status: 400 });
  }
  const running = downloads.get(tile);
  if (running && !running.done) return running;

  const entry = { received: 0, total: 0, done: false, error: null };
  downloads.set(tile, entry);

  (async () => {
    const target = path.join(SEGMENTS_DIR, `${tile}.rd5`);
    const tmp = `${target}.part`;
    try {
      await fsp.mkdir(SEGMENTS_DIR, { recursive: true });
      const res = await fetchStream(`${SEGMENTS_SOURCE}/${tile}.rd5`);
      entry.total = Number(res.headers['content-length']) || 0;
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        res.on('data', (chunk) => { entry.received += chunk.length; });
        res.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        res.pipe(out);
      });
      await fsp.rename(tmp, target);
      console.log(`BRouter-Kachel ${tile} geladen (${entry.received} Bytes)`);
    } catch (err) {
      entry.error = err.message;
      console.error(`BRouter-Kachel ${tile} fehlgeschlagen:`, err.message);
      fsp.unlink(tmp).catch(() => {});
    } finally {
      entry.done = true;
    }
  })();

  return entry;
}

async function deleteTile(tile) {
  if (!SEGMENTS_DIR || !TILE_RE.test(tile)) {
    throw Object.assign(new Error('Ungültiger Kachelname.'), { status: 400 });
  }
  await fsp.unlink(path.join(SEGMENTS_DIR, `${tile}.rd5`)).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });
  downloads.delete(tile);
}

/**
 * Reicht eine Anfrage an `/brouter…` an den BRouter-Container durch.
 * Methode, Abfrage und Körper (Profil-Upload) bleiben unverändert.
 */
function proxy(req, res, url) {
  if (!configured()) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Kein eigener BRouter eingerichtet (BROUTER_URL).');
  }
  const target = new URL(url.pathname + url.search, BROUTER_URL);
  const upstream = http.request(target, {
    method: req.method,
    headers: {
      'content-type': req.headers['content-type'] || 'text/plain',
      ...(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] } : {}),
    },
  }, (up) => {
    const headers = { 'Cache-Control': 'no-store' };
    if (up.headers['content-type']) headers['Content-Type'] = up.headers['content-type'];
    if (up.headers['content-length']) headers['Content-Length'] = up.headers['content-length'];
    res.writeHead(up.statusCode || 502, headers);
    up.pipe(res);
  });
  // Lange Routen über viele Kacheln brauchen ihre Zeit.
  upstream.setTimeout(120000, () => upstream.destroy(new Error('Zeitüberschreitung')));
  upstream.on('error', (err) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`BRouter-Container nicht erreichbar: ${err.message}`);
  });
  req.pipe(upstream);
}

module.exports = {
  configured, status, startDownload, deleteTile, proxy,
};
