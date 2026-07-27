'use strict';

/**
 * Unterwegs-Funktionen: Stempel an der Route, Standort, Tageslicht, Wetter,
 * Umgebungssuche sowie der Offline-Betrieb über den Service Worker.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, launchBrowser, stubExternals, writeGpxWaypoints,
        drawRoute } = require('../helpers');

module.exports = {
  name: 'Unterwegs und Offline',

  async run(check) {
    const server = await startServer(9104);
    const browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: 1500, height: 1000 },
      permissions: ['geolocation'],
      geolocation: { latitude: 51.8021, longitude: 10.6012, accuracy: 15 },
      locale: 'de-DE',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    let overpassCalls = 0;
    await stubExternals(page, {
      onOverpassRequest: () => { overpassCalls++; },
      overpass: () => ({ elements: [
        { type: 'node', id: 1, lat: 51.8025, lon: 10.6008,
          tags: { tourism: 'alpine_hut', name: 'Brockenhaus', opening_hours: 'Mo-Su 09:00-17:00' } },
        { type: 'node', id: 2, lat: 51.8060, lon: 10.6015, tags: { amenity: 'drinking_water' } },
        { type: 'node', id: 3, lat: 51.8100, lon: 10.6030,
          tags: { highway: 'bus_stop', name: 'Schierke Bahnhof' } },
      ] }),
    });

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-unterwegs-'));

    try {
      await page.goto(server.url);
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(700);

      const gpx = writeGpxWaypoints(tmp, 'stempel.gpx', [
        { lat: 51.8020, lng: 10.6010, name: 'Direkt am Weg' },
        { lat: 51.8050, lng: 10.6045, name: '300 m ab' },
        { lat: 51.8080, lng: 10.6120, name: '800 m ab' },
        { lat: 52.5000, lng: 13.4000, name: 'Weit weg' },
      ]);
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('#btn-import'),
      ]);
      await chooser.setFiles(gpx);
      await page.waitForTimeout(800);

      await drawRoute(page);
      await page.click('.tab[data-tab=unterwegs]');
      await page.waitForTimeout(400);

      /* ---- Stempel an der Route ---- */
      await page.waitForSelector('#section-along:not([hidden])', { timeout: 8000 });
      const alongRows = () => page.locator('#along-list li:not(.list-empty)');
      check.equal(await alongRows().count(), 2,
        'Zwei Stempelstellen liegen im 500-m-Umkreis der Route');
      const names = (await alongRows().locator('.item-label').allTextContents()).join(', ');
      check.ok(!names.includes('Weit weg'), 'Entfernte Stempelstellen bleiben außen vor');
      check.ok(await page.locator('.stamp-marker.along').count() === 2,
        'Die Treffer sind auf der Karte hervorgehoben');

      await page.selectOption('#along-radius', '200');
      await page.waitForTimeout(400);
      check.equal(await alongRows().count(), 1, 'Kleinerer Umkreis findet weniger');
      await page.selectOption('#along-radius', '500');
      await page.waitForTimeout(400);

      /* ---- Standort und Abhaken vor Ort ---- */
      await page.click('#btn-locate');
      await page.waitForTimeout(1400);
      check.ok(await page.locator('.position-marker').count() > 0,
        'Der eigene Standort erscheint auf der Karte');
      check.ok(await page.locator('.nearby-panel').count() > 0,
        'Stempelstellen in Reichweite werden eingeblendet');

      await page.locator('.nearby-row button').first().click();
      await page.waitForTimeout(800);
      check.contains(await page.textContent('#stamp-counter'), '1 von 4',
        'Abhaken vor Ort wirkt sofort');
      await page.click('#btn-locate');
      await page.waitForTimeout(400);

      /* ---- Tageslicht ---- */
      const setStart = async (iso) => {
        await page.fill('#start-time', iso);
        await page.dispatchEvent('#start-time', 'change');
        await page.waitForTimeout(400);
      };
      await setStart('2025-12-15T14:00');
      const darkNote = await page.locator('#daylight-note');
      check.contains(await darkNote.getAttribute('class'), 'dark',
        'Späte Winterwanderung wird als kritisch markiert');
      check.contains(await darkNote.textContent(), 'Sonnenuntergang',
        'Der Sonnenuntergang wird genannt');

      await setStart('2025-07-15T09:00');
      check.contains(await darkNote.getAttribute('class'), 'ok',
        'Sommerwanderung am Vormittag ist unkritisch');

      /* ---- Wetter ---- */
      const soon = new Date(Date.now() + 2 * 86400000);
      const pad = (n) => String(n).padStart(2, '0');
      await setStart(`${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T09:00`);
      await page.waitForTimeout(1800);
      check.ok(!(await page.locator('#weather-note').isHidden()),
        'Für einen nahen Termin erscheint die Vorhersage');
      check.contains(await page.textContent('#weather-note'), '°C',
        'Die Vorhersage nennt die Temperatur');

      /* ---- Umgebungssuche ---- */
      await page.locator('.place-filter input[value=transit]').check();
      await page.click('#btn-places');
      await page.waitForTimeout(1500);
      check.equal(overpassCalls, 1, 'Die Umgebungssuche stellt genau eine Anfrage');
      check.equal(await page.locator('#place-list li').count(), 3,
        'Alle gefundenen Orte werden aufgelistet');
      check.equal(await page.locator('.place-marker').count(), 3,
        'Die Orte erscheinen als Marker auf der Karte');

      /* ---- Offline ---- */
      const swReady = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return false;
        await navigator.serviceWorker.ready;
        return Boolean(reg.active);
      });
      check.ok(swReady, 'Der Service Worker ist aktiv');

      const apiCached = await page.evaluate(async () => {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const req of await cache.keys()) {
            if (req.url.includes('/api/')) return req.url;
          }
        }
        return null;
      });
      check.equal(apiCached, null, 'Der Datenabgleich wird nicht zwischengespeichert');

      server.proc.kill();
      await new Promise((r) => setTimeout(r, 700));
      await context.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
      await page.waitForTimeout(700);

      check.ok(await page.locator('#map.leaflet-container').count() > 0,
        'Die App startet ohne Netz');
      check.equal(await page.locator('#stamp-list li:not(.list-empty)').count(), 4,
        'Die Stempelstellen sind offline verfügbar');
      check.contains(await page.textContent('#sync-badge'), 'nur dieses Gerät',
        'Der Abgleich-Zustand wird offline richtig angezeigt');

      check.equal(errors.length, 0, 'Keine Skriptfehler', errors.join(' | '));
    } finally {
      await browser.close();
      server.stop();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
};
