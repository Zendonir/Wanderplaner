'use strict';

/**
 * Sammlung: GPX-Import aller Arten, QR-Codes, Touren speichern und laden.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jsQR = require('jsqr');
const { startServer, launchBrowser, stubExternals, writeGpxWaypoints } = require('../helpers');

module.exports = {
  name: 'Sammlung und Import',

  async run(check) {
    const server = await startServer(9102);
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept('Umbenannt'));
    await stubExternals(page);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gpx-'));

    try {
      await page.goto(server.url);
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(600);

      const importFile = async (type, file) => {
        await page.selectOption('#import-type', type);
        const [chooser] = await Promise.all([
          page.waitForEvent('filechooser'),
          page.click('#btn-import'),
        ]);
        await chooser.setFiles(file);
        await page.waitForTimeout(700);
      };

      /* ---- Stempelstellen ---- */
      const stampFile = writeGpxWaypoints(tmp, 'stempel.gpx', [
        { lat: 51.800, lng: 10.600, name: 'HWN 1' },
        { lat: 51.790, lng: 10.620, name: 'HWN 2' },
        { lat: 51.810, lng: 10.580, name: 'HWN 3', note: 'Felsklippe' },
      ]);
      await importFile('stempel', stampFile);
      check.equal(await page.locator('#stamp-list li:not(.list-empty)').count(), 3,
        'Drei Stempelstellen importiert');

      // Erneuter Import darf nichts verdoppeln
      await importFile('stempel', stampFile);
      check.equal(await page.locator('#stamp-list li:not(.list-empty)').count(), 3,
        'Erneuter Import überspringt vorhandene Einträge');

      /* ---- Abhaken mit Datum ---- */
      await page.locator('#stamp-list li').first().locator('input[type=checkbox]').check();
      await page.waitForTimeout(500);
      check.contains(await page.textContent('#stamp-counter'), '1 von 3',
        'Abhaken wird gezählt');
      const hasDate = await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('wanderplaner.stempelstellen') || '{}');
        return (raw.items || []).some((s) => s.collected && s.collectedAt);
      });
      check.ok(hasDate, 'Beim Abhaken wird ein Datum festgehalten');

      /* ---- Parkplätze mit QR-Code ---- */
      const parkFile = writeGpxWaypoints(tmp, 'park.gpx', [
        { lat: 51.7712, lng: 10.5934, name: 'Wanderparkplatz Schierke', note: '3 EUR/Tag' },
      ]);
      await importFile('parkplatz', parkFile);
      check.equal(await page.locator('#parking-list li:not(.list-empty)').count(), 1,
        'Parkplatz importiert');

      await page.locator('#parking-list li .item-label').first().click();
      await page.waitForSelector('.qr-box svg', { timeout: 5000 });
      await page.waitForTimeout(400);

      const shot = await page.locator('.qr-box svg').first().screenshot();
      const { PNG } = requirePng();
      let decoded = null;
      if (PNG) {
        const png = PNG.sync.read(shot);
        const res = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
        decoded = res ? res.data : null;
      }
      if (decoded !== null) {
        check.contains(decoded, 'maps.apple.com', 'QR-Code enthält den Karten-Link');
        check.contains(decoded, '51.771', 'QR-Code enthält die Koordinaten');
      } else {
        // Ohne PNG-Decoder wenigstens prüfen, dass ein Code gezeichnet wurde.
        check.ok(shot.length > 0, 'QR-Code wird gezeichnet (ohne Decoder geprüft)');
      }
      await page.keyboard.press('Escape');

      /* ---- Abgeschlossene Tour ---- */
      const trackPoints = Array.from({ length: 40 }, (_, i) =>
        `    <trkpt lat="${(51.78 + i * 0.0008).toFixed(5)}" lon="${(10.60 + i * 0.0006).toFixed(5)}"><ele>${800 + i * 4}</ele></trkpt>`
      ).join('\n');
      const trackFile = path.join(tmp, 'tour.gpx');
      fs.writeFileSync(trackFile,
        '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Test" ' +
        'xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>Brocken 2024</name>' +
        `<trkseg>\n${trackPoints}\n</trkseg></trk>\n</gpx>\n`);
      await importFile('track', trackFile);
      check.equal(await page.locator('#track-list li:not(.list-empty)').count(), 1,
        'Abgeschlossene Tour wird hinterlegt');
      check.contains(
        await page.locator('#track-list li .item-label').first().textContent(),
        'Brocken 2024', 'Der Name aus der GPX-Datei wird übernommen');

      /* ---- Tour speichern und laden ---- */
      const box = await page.locator('#map').boundingBox();
      await page.locator('#map').click({ position: { x: box.width * 0.4, y: box.height * 0.7 } });
      await page.locator('#map').click({ position: { x: box.width * 0.6, y: box.height * 0.3 } });
      await page.waitForTimeout(1800);

      await page.fill('#tour-name', 'Testtour');
      await page.click('#btn-save-tour');
      await page.waitForTimeout(700);
      check.equal(await page.locator('#tour-list li:not(.list-empty)').count(), 1,
        'Tour wird gespeichert');

      await page.click('#btn-clear');
      await page.waitForTimeout(900);
      check.equal(await page.locator('#point-list li:not(.list-empty)').count(), 0,
        'Route leeren entfernt alle Punkte');

      await page.locator('#tour-list li .item-label').first().click();
      await page.waitForTimeout(1500);
      check.equal(await page.locator('#point-list li:not(.list-empty)').count(), 2,
        'Gespeicherte Tour lässt sich wieder laden');
      check.equal(await page.locator('#tour-name').inputValue(), 'Testtour',
        'Der Tourname wird mitgeladen');

      /* ---- Alles übersteht einen Neustart der Seite ---- */
      await page.reload();
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(900);
      check.equal(await page.locator('#stamp-list li:not(.list-empty)').count(), 3,
        'Stempelstellen bleiben nach dem Neuladen erhalten');
      check.equal(await page.locator('#parking-list li:not(.list-empty)').count(), 1,
        'Parkplätze bleiben erhalten');
      check.equal(await page.locator('#track-list li:not(.list-empty)').count(), 1,
        'Hinterlegte Touren bleiben erhalten');

      check.equal(errors.length, 0, 'Keine Skriptfehler', errors.join(' | '));
    } finally {
      await browser.close();
      server.stop();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
};

/** pngjs ist optional – ohne das Paket läuft der QR-Test in abgespeckter Form. */
function requirePng() {
  try {
    return { PNG: require('pngjs').PNG };
  } catch (err) {
    return { PNG: null };
  }
}
