'use strict';

/**
 * Gemeinsame Hilfen für die Browsertests: Server starten, Browser öffnen,
 * externe Dienste abfangen.
 *
 * Alle Tests laufen gegen den echten Sync-Dienst, aber mit nachgebauten
 * Antworten für Routing, Höhen, Umgebungssuche und Wetter – so sind sie
 * schnell, reproduzierbar und belasten keine öffentlichen Dienste.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Startet den Wanderplaner-Server auf einem freien Port. */
async function startServer(port) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wanderplaner-test-'));
  const proc = spawn('node', [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, PUBLIC_DIR: ROOT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => console.error('  [server]', d.toString().trim()));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startet nicht')), 15000);
    proc.stdout.on('data', (d) => {
      if (d.toString().includes('läuft auf Port')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  return {
    proc,
    dataDir,
    url: `http://localhost:${port}`,
    stop() {
      proc.kill();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function launchBrowser() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
}

/**
 * Fängt alle externen Dienste ab. `options` erlaubt es, einzelne Antworten
 * zu ersetzen oder Aufrufe mitzuzählen.
 */
async function stubExternals(page, options = {}) {
  const {
    brouter,
    overpass,
    weather,
    onBrouterRequest = () => {},
    onOverpassRequest = () => {},
    onWeatherRequest = () => {},
  } = options;

  // Kartenkacheln nie laden – sie kosten nur Zeit.
  for (const pattern of [
    '**/tile.opentopomap.org/**',
    '**/tile.openstreetmap.org/**',
    '**/wanderreitkarte.de/**',
    '**/arcgisonline.com/**',
  ]) {
    await page.route(pattern, (route) => route.abort());
  }

  await page.route('**/brouter.de/brouter/profile', (route) =>
    route.fulfill({ json: { profileid: 'test-profile' } })
  );

  await page.route('**/brouter.de/brouter?**', (route, request) => {
    onBrouterRequest(request.url());
    const alt = Number((request.url().match(/alternativeidx=(\d+)/) || [, '0'])[1]);
    route.fulfill({ json: brouter ? brouter(request.url(), alt) : defaultRoute(alt) });
  });

  await page.route('**/overpass-api.de/**', (route) => {
    onOverpassRequest();
    route.fulfill({ json: overpass ? overpass() : { elements: [] } });
  });

  await page.route('**/api.open-meteo.com/**', (route) => {
    onWeatherRequest();
    route.fulfill({ json: weather ? weather() : defaultWeather() });
  });

  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ json: [] })
  );
}

/** Gerade Route von Süd nach Nord mit Höhen und Wegedaten. */
function defaultRoute(alt = 0, lengthM = 4000) {
  const coordinates = [];
  for (let i = 0; i <= 20; i++) {
    coordinates.push([10.60 + alt * 0.002, 51.80 + i * 0.0006, 600 + i * 6]);
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        'track-length': String(lengthM + alt * 900),
        messages: [
          ['Longitude', 'Latitude', 'Elevation', 'Distance', 'CostPerKm', 'ElevCost',
           'TurnCost', 'NodeCost', 'InitialCost', 'WayTags', 'NodeTags', 'Time', 'Energy'],
          ['10600000', '51801000', '600', '1600', '1000', '0', '0', '0', '0',
           'highway=path surface=ground route_hiking_rwn=yes', '', '0', '0'],
          ['10600000', '51804000', '620', '1200', '1500', '0', '0', '0', '0',
           'highway=track tracktype=grade2 surface=compacted', '', '0', '0'],
          ['10600000', '51807000', '650', '700', '3000', '0', '0', '0', '0',
           'highway=tertiary surface=asphalt', '', '0', '0'],
          ['10600000', '51809000', '700', '500', '2000', '0', '0', '0', '0',
           'highway=path sac_scale=alpine_hiking trail_visibility=bad', '', '0', '0'],
        ],
      },
      geometry: { type: 'LineString', coordinates },
    }],
  };
}

function defaultWeather() {
  const day = new Date(Date.now() + 2 * 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;

  const hourly = {
    time: [], temperature_2m: [], weathercode: [],
    precipitation_probability: [], windspeed_10m: [], precipitation: [],
  };
  for (let h = 0; h < 24; h++) {
    hourly.time.push(`${date}T${pad(h)}:00`);
    hourly.temperature_2m.push(14 + h * 0.3);
    hourly.weathercode.push(h >= 12 && h <= 15 ? 61 : 2);
    hourly.precipitation_probability.push(h >= 12 && h <= 15 ? 70 : 15);
    hourly.windspeed_10m.push(12 + h * 0.2);
    hourly.precipitation.push(h >= 12 && h <= 15 ? 1.2 : 0);
  }
  return { hourly };
}

/** Schreibt eine GPX-Datei mit Wegpunkten in ein temporäres Verzeichnis. */
function writeGpxWaypoints(dir, name, waypoints) {
  const body = waypoints
    .map((w) => `  <wpt lat="${w.lat}" lon="${w.lng}"><name>${w.name}</name>` +
      (w.note ? `<desc>${w.note}</desc>` : '') + '</wpt>')
    .join('\n');
  const file = path.join(dir, name);
  fs.writeFileSync(file,
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    `${body}\n</gpx>\n`);
  return file;
}

/** Wartet, bis die Route berechnet und die Länge angezeigt wird. */
async function waitForRoute(page, contains = 'km') {
  await page.waitForFunction(
    (needle) => {
      const text = document.getElementById('stat-distance').textContent;
      return text.includes(needle) && !text.startsWith('0,0');
    },
    contains,
    { timeout: 15000 }
  );
}

/** Zwei Punkte auf die Karte setzen und die Berechnung abwarten. */
async function drawRoute(page) {
  const box = await page.locator('#map').boundingBox();
  await page.locator('#map').click({ position: { x: box.width * 0.5, y: box.height * 0.75 } });
  await page.locator('#map').click({ position: { x: box.width * 0.55, y: box.height * 0.25 } });
  await waitForRoute(page);
}

module.exports = {
  ROOT,
  startServer,
  launchBrowser,
  stubExternals,
  defaultRoute,
  defaultWeather,
  writeGpxWaypoints,
  waitForRoute,
  drawRoute,
};
