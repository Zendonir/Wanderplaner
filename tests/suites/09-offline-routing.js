'use strict';

/**
 * Offline-Routing über einen eigenen BRouter-Container, benannte
 * Routenpunkte aus Stempelstellen und die durchsichtige Route.
 *
 * Der BRouter-Container wird durch einen kleinen Nachbau ersetzt: Er nimmt
 * Profile an, liefert die übliche Testroute und kann auf Wunsch so tun, als
 * fehlten ihm die Kartendaten. Ein zweiter Nachbau spielt brouter.de als
 * Quelle der .rd5-Kacheln.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, launchBrowser, stubExternals, defaultRoute, waitForRoute,
        openSettings } = require('../helpers');

function listen(handler, port) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(port, () => resolve(srv));
  });
}

module.exports = {
  name: 'Offline-Routing und Routenpunkte',

  async run(check) {
    const fake = { requests: [], profiles: 0, missingData: false };
    const brouter = await listen((req, res) => {
      if (req.method === 'POST' && req.url === '/brouter/profile') {
        req.resume();
        fake.profiles++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ profileid: 'custom_local' }));
      }
      if (req.url.startsWith('/brouter?')) {
        fake.requests.push(req.url);
        if (!/lonlats=\d/.test(req.url)) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          return res.end('lonlats parameter not set');
        }
        if (fake.missingData) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          return res.end('datafile E10_N50.rd5 not found');
        }
        const alt = Number((req.url.match(/alternativeidx=(\d+)/) || [, '0'])[1]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(defaultRoute(alt, 5000)));
      }
      res.writeHead(404);
      res.end();
    }, 9181);

    const tileBytes = Buffer.alloc(64 * 1024, 7);
    const source = await listen((req, res) => {
      if (req.url === '/E10_N50.rd5') {
        res.writeHead(200, { 'Content-Length': tileBytes.length });
        return res.end(tileBytes);
      }
      res.writeHead(404);
      res.end();
    }, 9182);

    const segments = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-segments-'));
    const server = await startServer(9109, {
      BROUTER_URL: 'http://localhost:9181',
      BROUTER_SEGMENTS_DIR: segments,
      BROUTER_SEGMENTS_SOURCE: 'http://localhost:9182',
    });
    const browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: 1500, height: 1000 }, locale: 'de-DE',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());

    const publicCalls = [];
    await stubExternals(page, { onBrouterRequest: (url) => publicCalls.push(url) });

    try {
      /* ---- Server: Status und Durchreichung ---- */
      const status = await (await fetch(`${server.url}/api/brouter`)).json();
      check.ok(status.configured && status.reachable,
        'Der Server meldet den BRouter-Container als eingerichtet und erreichbar');
      check.equal(status.tiles.length, 0, 'Anfangs liegen keine Kacheln vor');

      const health = await (await fetch(`${server.url}/api/health`)).json();
      check.equal(health.brouter, true, 'Auch /api/health nennt den Container');

      const upload = await fetch(`${server.url}/brouter/profile`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'assign x 1\n',
      });
      check.equal((await upload.json()).profileid, 'custom_local',
        'Profil-Upload wird an den Container durchgereicht');

      const bad = await fetch(`${server.url}/api/brouter/tiles/${encodeURIComponent('a/b')}`,
        { method: 'POST' });
      check.equal(bad.status, 400, 'Ungültige Kachelnamen werden abgelehnt');

      /* ---- Planung rechnet über den Container ---- */
      await page.goto(server.url);
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(900);
      await page.evaluate(() => MapView.setView(51.80, 10.60, 13));
      await page.waitForTimeout(400);

      await page.click('#mode-route');
      const box = await page.locator('#map').boundingBox();
      await page.locator('#map').click({ position: { x: box.width * 0.5, y: box.height * 0.7 } });
      await page.locator('#map').click({ position: { x: box.width * 0.55, y: box.height * 0.3 } });
      await waitForRoute(page);
      await page.waitForTimeout(600);

      const freeLabels = await page.locator('#point-list .item-label').allTextContents();
      check.ok(/^\d+\.\d+, \d+\.\d+$/.test(freeLabels[0]),
        'Frei gesetzte Punkte zeigen weiter ihre Koordinate', freeLabels[0]);
      check.ok(fake.requests.some((u) => u.includes('profile=custom_local')),
        'Die Route wird beim eigenen BRouter mit dem hochgeladenen Profil berechnet');
      check.equal(publicCalls.length, 0, 'brouter.de wird dabei nicht gefragt');
      await openSettings(page, 'routing');
      check.contains(await page.textContent('#engine-note'), 'eigenen BRouter',
        'Der Hinweis nennt den eigenen BRouter');

      /* ---- Kacheln laden ---- */
      await page.waitForFunction(() =>
        !document.getElementById('btn-offline-load').hidden
        && !document.getElementById('btn-offline-load').disabled, null, { timeout: 5000 });
      check.contains(await page.textContent('#btn-offline-load'), 'E10_N50',
        'Für den Harz wird die Kachel E10_N50 angeboten');
      await page.click('#btn-offline-load');
      await page.waitForFunction(() =>
        document.getElementById('offline-status').textContent.includes('1 Kachel'),
        null, { timeout: 10000 });
      check.ok(fs.existsSync(path.join(segments, 'E10_N50.rd5')),
        'Die Kachel liegt danach im gemeinsamen Verzeichnis');
      check.equal(fs.statSync(path.join(segments, 'E10_N50.rd5')).size, tileBytes.length,
        'Vollständig, nicht halb geschrieben');
      check.contains(await page.textContent('#offline-tiles'), 'E10_N50',
        'Die Liste zeigt die geladene Kachel');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      /* ---- Fehlende Daten: brouter.de springt ein ---- */
      fake.missingData = true;
      await page.click('#btn-reverse');
      await waitForRoute(page);
      await page.waitForFunction(() =>
        document.getElementById('status').textContent.includes('Kartendaten'),
        null, { timeout: 8000 });
      check.ok(publicCalls.length > 0,
        'Fehlen dem Container die Daten, rechnet brouter.de');
      check.contains(await page.textContent('#status'), 'keine Kartendaten',
        'Und die App sagt, warum');
      fake.missingData = false;

      /* ---- Durchsichtige Route ---- */
      const opacityOf = () => page.evaluate(() =>
        getComputedStyle(document.querySelector('.route-line')).opacity);
      check.equal(await opacityOf(), '1', 'Normal ist die Route deckend');
      await page.check('#opt-route-transparent');
      await page.waitForTimeout(200);
      check.ok(Number(await opacityOf()) < 0.5, 'Mit Haken wird sie durchsichtig');

      /* ---- Stempel gezielt hinzufügen: Name statt Koordinate ---- */
      await page.evaluate(() => {
        localStorage.setItem('wanderplaner.stempelstellen', JSON.stringify({
          items: [{ id: 'st-9', name: 'Brockenhaus', lat: 51.8010, lng: 10.6150,
                    collected: false, updatedAt: Date.now() }],
        }));
      });
      await page.reload();
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(900);
      check.ok(await page.isChecked('#opt-route-transparent'),
        'Die Durchsichtigkeit bleibt nach dem Neuladen eingeschaltet');

      await page.evaluate(() => MapView.openStampPopup('st-9'));
      await page.waitForSelector('.stamp-popup');
      await page.locator('.stamp-popup button', { hasText: 'Zur Route' }).click();
      await page.waitForTimeout(500);

      const labels = await page.locator('#point-list .item-label').allTextContents();
      check.equal(labels[labels.length - 1], 'Brockenhaus',
        'In der Punktliste steht der Name des Stempels');

      // Speichern und wieder laden: der Name bleibt.
      await page.fill('#tour-name', 'Namenstest');
      await page.click('#btn-save-tour');
      await page.waitForTimeout(400);
      await page.click('#btn-clear');
      await page.waitForTimeout(300);
      await page.locator('#tour-list .item-label', { hasText: 'Namenstest' }).click();
      await page.waitForTimeout(600);
      const reloaded = await page.locator('#point-list .item-label').allTextContents();
      check.ok(reloaded.includes('Brockenhaus'),
        'Nach dem Laden der Tour steht der Name weiterhin da', reloaded.join(' | '));

      check.equal(errors.length, 0, 'Keine Skriptfehler', errors.join(' | '));
    } finally {
      await browser.close();
      server.stop();
      brouter.close();
      source.close();
      fs.rmSync(segments, { recursive: true, force: true });
    }
  },
};
