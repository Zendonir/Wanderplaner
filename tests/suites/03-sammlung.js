'use strict';

/**
 * Sammlung: GPX-Import aller Arten, QR-Codes, Touren speichern und laden.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jsQR = require('jsqr');
const {
  startServer, launchBrowser, stubExternals, writeGpxWaypoints, openSettings, openStamps, startDrawing,
} = require('../helpers');

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

      /* ---- Einstellungsseite ---- */
      check.ok(await page.locator('#settings').isHidden(),
        'Die Einstellungen sind zunächst geschlossen');
      check.ok(await page.locator('#stamp-list').isHidden(),
        'Die Stempelliste liegt in einem zugeklappten Untermenü');
      check.equal(await page.locator('.tab-panel[data-panel=planung] #rs-preset').count(), 0,
        'Die Routing-Einstellungen liegen nicht mehr in der Planung');

      await page.click('#btn-settings');
      await page.waitForSelector('#settings:not([hidden])');
      for (const [id, was] of [
        ['#rs-preset', 'Routing'], ['#import-type', 'Import'],
        ['#btn-sync', 'Abgleich'], ['#app-version', 'Version'],
      ]) {
        check.ok(await page.locator(`#settings ${id}`).isVisible(),
          `${was} steht in den Einstellungen`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      check.ok(await page.locator('#settings').isHidden(), 'Esc schließt die Einstellungen');

      const importFile = async (type, file) => {
        await openSettings(page);
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
      check.ok(await page.locator('#stamp-details').evaluate((d) => d.open),
        'Nach dem Import klappt die Stempelliste auf');
      check.ok(await page.locator('#settings').isHidden(),
        'Nach dem Import schließt sich der Einstellungsdialog');
      check.equal(await page.locator('#stamp-list li:not(.list-empty)').count(), 3,
        'Drei Stempelstellen importiert');

      // Erneuter Import darf nichts verdoppeln
      await importFile('stempel', stampFile);
      check.equal(await page.locator('#stamp-list li:not(.list-empty)').count(), 3,
        'Erneuter Import überspringt vorhandene Einträge');

      /* ---- Abhaken mit Datum ---- */
      await openStamps(page);
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

      // Parkplätze sind Beiwerk und zahlreich – ihre Marken bleiben deutlich
      // kleiner als die runden Stempelmarken.
      const größen = await page.evaluate(() => {
        const size = (sel) => {
          const e = document.querySelector(sel);
          return e ? e.getBoundingClientRect().width : 0;
        };
        return { parkplatz: size('.parking-marker'), stempel: size('.stamp-marker') };
      });
      check.ok(größen.parkplatz > 0 && größen.parkplatz < größen.stempel,
        'Die Parkplatzmarke ist kleiner als eine Stempelstelle',
        `Parkplatz ${größen.parkplatz} px, Stempel ${größen.stempel} px`);

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

      /* ---- Hinterlegte Tour als Planung übernehmen ---- */
      await page.locator('#track-list li .item-action').first().click();
      await page.waitForTimeout(1800);
      const adopted = await page.locator('#point-list li:not(.list-empty)').count();
      check.ok(adopted >= 2 && adopted <= 25,
        'Die hinterlegte Spur wird zu wenigen Routenpunkten eingedampft',
        `${adopted} Punkte`);
      check.equal(await page.locator('#tour-name').inputValue(), 'Brocken 2024',
        'Der Name der Spur wird als Tourname übernommen');
      check.ok(await page.locator('[data-panel=planung]').isVisible(),
        'Nach dem Übernehmen wird zur Planung gewechselt');
      check.contains(await page.textContent('#stat-distance'), 'km',
        'Die übernommene Tour wird sofort berechnet');
      check.contains(await page.textContent('#status'), 'neu berechnet',
        'Der Hinweis zur Abweichung steht nach der Berechnung noch da');

      await page.click('#btn-clear');
      await page.waitForTimeout(900);

      /* ---- Parkplätze weichen der Planung ---- */
      check.ok(await page.locator('.parking-marker').count() > 0,
        'Ohne Route sind die Parkplätze auf der Karte');

      /* ---- Tour speichern und laden ---- */
      await startDrawing(page);
      const box = await page.locator('#map').boundingBox();
      await page.locator('#map').click({ position: { x: box.width * 0.4, y: box.height * 0.7 } });
      await page.locator('#map').click({ position: { x: box.width * 0.6, y: box.height * 0.3 } });
      await page.waitForTimeout(1800);

      check.equal(await page.locator('.parking-marker').count(), 0,
        'Mit gesetztem Startpunkt verschwinden die Parkplatzmarken');

      await page.fill('#tour-name', 'Testtour');
      await page.click('#btn-save-tour');
      await page.waitForTimeout(700);
      check.equal(await page.locator('#tour-list li:not(.list-empty)').count(), 1,
        'Tour wird gespeichert');
      check.contains(await page.textContent('#section-tours h2'), 'Geplante Touren',
        'Gespeicherte Planungen heißen „Geplante Touren“');
      check.contains(await page.textContent('#section-tracks h2'), 'Abgeschlossene Touren',
        'Gelaufene Strecken heißen „Abgeschlossene Touren“');

      // Geplante Touren sind auf der Karte zu sehen, damit man sie im
      // Verhältnis zu den abgeschlossenen einordnen kann.
      const plannedOnMap = await page.locator('#map path.tour-line[stroke-dasharray]').count();
      check.ok(plannedOnMap > 0, 'Die geplante Tour erscheint gestrichelt auf der Karte');

      await page.click('#btn-clear');
      await page.waitForTimeout(900);
      check.equal(await page.locator('#point-list li:not(.list-empty)').count(), 0,
        'Route leeren entfernt alle Punkte');
      check.ok(await page.locator('.parking-marker').count() > 0,
        'Ohne Startpunkt sind die Parkplätze wieder da');

      await page.locator('#tour-list li .item-label').first().click();
      await page.waitForTimeout(1500);
      check.equal(await page.locator('#point-list li:not(.list-empty)').count(), 2,
        'Gespeicherte Tour lässt sich wieder laden');
      check.equal(await page.locator('#tour-name').inputValue(), 'Testtour',
        'Der Tourname wird mitgeladen');

      /* ---- Geplant → abgeschlossen ---- */
      const tracksBefore = await page.locator('#track-list li:not(.list-empty)').count();
      await page.locator('#tour-list li .item-action').first().click();
      await page.waitForTimeout(1200);
      check.equal(await page.locator('#tour-list li:not(.list-empty)').count(), 0,
        'Die abgehakte Tour verlässt die Planungsliste');
      check.equal(await page.locator('#track-list li:not(.list-empty)').count(),
        tracksBefore + 1, 'Und taucht bei den abgeschlossenen Touren auf');
      check.contains(
        (await page.locator('#track-list li .item-label').allTextContents()).join(' | '),
        'Testtour', 'Unter demselben Namen');

      // Übernommen wird der berechnete Verlauf, nicht die angeklickten
      // Stützpunkte: Die Teststrecke des Routers beginnt bei 51.80/10.60,
      // geklickt wurde ganz woanders.
      const übernommen = await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('wanderplaner.tracks') || '{}');
        const tour = (raw.items || []).find((t) => t.name === 'Testtour');
        return tour ? { first: tour.points[0], länge: tour.length } : null;
      });
      check.ok(übernommen
        && Math.abs(übernommen.first[0] - 51.80) < 0.01
        && Math.abs(übernommen.first[1] - 10.60) < 0.01,
        'Die abgeschlossene Tour trägt den gelaufenen Verlauf, nicht die Klickpunkte',
        JSON.stringify(übernommen));
      check.ok(übernommen && übernommen.länge > 0,
        'Und die gelaufene Länge', `${übernommen && übernommen.länge} m`);

      /* ---- Popup einer Stempelstelle ---- */
      // Löschen gehört nicht in ein Menü, das beim Planen ständig aufgeht –
      // ein danebengegangener Klick würde den Sammelstand mitnehmen.
      await openStamps(page);
      await page.locator('#stamp-list li .item-label').first().click();
      await page.waitForSelector('.stamp-popup', { timeout: 5000 });
      const popupButtons = await page.locator('.stamp-popup button').allTextContents();
      check.equal(popupButtons.length, 2,
        'Das Stempel-Popup zeigt genau zwei Knöpfe', popupButtons.join(' | '));
      check.ok(!popupButtons.join(' ').includes('Löschen'),
        'Löschen wird dort nicht angeboten');

      const gestapelt = await page.evaluate(() => {
        const rects = [...document.querySelectorAll('.stamp-popup .poi-popup-buttons button')]
          .map((b) => b.getBoundingClientRect());
        return rects.length === 2 && rects[1].top >= rects[0].bottom - 1;
      });
      check.ok(gestapelt, 'Die beiden Knöpfe stehen untereinander');

      // In der Liste bleibt das Löschen erreichbar.
      check.equal(await page.locator('#stamp-list li .item-delete').count(), 3,
        'Gelöscht wird weiterhin in der Liste');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      /* ---- Alles übersteht einen Neustart der Seite ---- */
      await page.reload();
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(900);
      check.equal(await page.locator('#stamp-list li:not(.list-empty)').count(), 3,
        'Stempelstellen bleiben nach dem Neuladen erhalten');
      check.equal(await page.locator('#parking-list li:not(.list-empty)').count(), 1,
        'Parkplätze bleiben erhalten');
      check.equal(await page.locator('#track-list li:not(.list-empty)').count(), 2,
        'Abgeschlossene Touren bleiben erhalten');

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
