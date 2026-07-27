'use strict';

/**
 * Service Worker: macht die App offline nutzbar.
 *
 * Drei Strategien:
 *  - Programmdateien samt Leaflet und Chart.js: aus dem Netz, bei Ausfall
 *    aus dem Zwischenspeicher
 *  - Kartenkacheln: aus dem Zwischenspeicher, sonst Netz (mit Obergrenze)
 *
 * Der Datenabgleich (/api/…) wird bewusst nie zwischengespeichert – dort
 * zählt immer der aktuelle Stand.
 */
const VERSION = 'v3';
const SHELL_CACHE = `wanderplaner-shell-${VERSION}`;
const TILE_CACHE = `wanderplaner-tiles-${VERSION}`;
const MAX_TILES = 1200;

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './vendor/chart.umd.js',
  './js/utils.js',
  './js/profiles.js',
  './js/routing.js',
  './js/elevation.js',
  './js/gpx.js',
  './js/qrcode.js',
  './js/maplinks.js',
  './js/sync.js',
  './js/places.js',
  './js/tracks.js',
  './js/tours.js',
  './js/daylight.js',
  './js/nearby.js',
  './js/geo.js',
  './js/mapview.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // Einzeln ablegen: eine fehlende Datei soll nicht die ganze
      // Installation scheitern lassen.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('wanderplaner-') && !key.endsWith(VERSION))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/** Hält den Kachelspeicher in Grenzen (älteste zuerst raus). */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (const key of keys.slice(0, keys.length - maxEntries)) {
    await cache.delete(key);
  }
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      await cache.put(request, response.clone());
      if (limit) trimCache(cacheName, limit);
    }
    return response;
  } catch (err) {
    // Ohne Netz und ohne Kopie bleibt nur ein Fehler – Leaflet zeigt dann
    // eine leere Kachel, die App läuft weiter.
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    // Für Seitenaufrufe die Startseite aus dem Speicher liefern.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Abgleich und Statusabfrage immer direkt ans Netz.
  if (url.pathname.startsWith('/api/')) return;

  // Routing- und Höhendienste nie zwischenspeichern.
  if (/brouter\.de|project-osrm\.org|open-elevation\.com|opentopodata\.org|nominatim/.test(url.hostname)) {
    return;
  }

  if (/tile\.opentopomap\.org|tile\.openstreetmap\.org/.test(url.hostname)) {
    event.respondWith(cacheFirst(request, TILE_CACHE, MAX_TILES));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});

// Erlaubt der App, den Kachelspeicher gezielt zu leeren.
self.addEventListener('message', (event) => {
  if (event.data === 'clear-tiles') {
    caches.delete(TILE_CACHE);
  }
});
