'use strict';

/**
 * Geräteübergreifender Abgleich: zwei getrennte Browser-Kontexte stehen für
 * zwei Geräte. Wichtigster Fall: ein gelöschter Eintrag darf nicht vom
 * anderen Gerät zurückkommen.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  startServer, launchBrowser, stubExternals, writeGpxWaypoints, openSettings, openStamps,
} = require('../helpers');

module.exports = {
  name: 'Abgleich zwischen Geräten',

  async run(check) {
    const server = await startServer(9103);
    const browser = await launchBrowser();
    const errors = [];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-sync-'));

    const openDevice = async (label) => {
      const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
      await stubExternals(page);
      await page.goto(server.url);
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(1300);
      return page;
    };

    const sync = async (page) => {
      await openSettings(page);
      await page.click('#btn-sync');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1100);
    };
    const stampCount = (page) => page.locator('#stamp-list li:not(.list-empty)').count();

    try {
      const gpx = writeGpxWaypoints(tmp, 'stempel.gpx', [
        { lat: 51.80, lng: 10.60, name: 'HWN 1' },
        { lat: 51.79, lng: 10.62, name: 'HWN 2' },
        { lat: 51.81, lng: 10.58, name: 'HWN 3' },
      ]);

      const a = await openDevice('A');
      check.contains(await a.textContent('#sync-badge'), 'synchron',
        'Gerät A erkennt den Abgleich-Dienst');

      await openSettings(a);
      const [chooser] = await Promise.all([
        a.waitForEvent('filechooser'),
        a.click('#btn-import'),
      ]);
      await chooser.setFiles(gpx);
      await a.waitForTimeout(2600);

      const b = await openDevice('B');
      check.equal(await stampCount(b), 3,
        'Gerät B sieht die Stempelstellen ohne eigenen Import');

      /* ---- Abhaken auf B kommt bei A an ---- */
      await openStamps(b);
      await b.locator('#stamp-list li').first().locator('input[type=checkbox]').check();
      await b.waitForTimeout(2300);
      await sync(a);
      check.contains(await a.textContent('#stamp-counter'), '1 von 3',
        'Auf B abgehakter Stempel erscheint auf A');

      /* ---- Löschen auf A darf auf B nicht zurückkehren ---- */
      await openStamps(a);
      await a.locator('#stamp-list li').last().locator('.item-delete').click();
      await a.waitForTimeout(2300);
      check.equal(await stampCount(a), 2, 'Löschen wirkt auf A');

      await sync(b);
      check.equal(await stampCount(b), 2, 'Die Löschung erreicht B');

      // Der eigentliche Prüfstein: B schickt seinen Stand zurück.
      await sync(b);
      await sync(a);
      check.equal(await stampCount(a), 2,
        'Der gelöschte Eintrag kommt nach dem Rückabgleich nicht zurück');
      check.equal(await stampCount(b), 2, 'Auch auf B bleibt er gelöscht');

      /* ---- Tour auf A speichern, auf B laden ---- */
      const box = await a.locator('#map').boundingBox();
      await a.locator('#map').click({ position: { x: box.width * 0.4, y: box.height * 0.7 } });
      await a.locator('#map').click({ position: { x: box.width * 0.6, y: box.height * 0.3 } });
      await a.waitForTimeout(1600);
      await a.fill('#tour-name', 'Gemeinsame Tour');
      await a.click('#btn-save-tour');
      await a.waitForTimeout(2300);

      await sync(b);
      check.equal(await b.locator('#tour-list li:not(.list-empty)').count(), 1,
        'Die gespeicherte Tour erscheint auf dem anderen Gerät');

      /* ---- Sicherung als Datei ---- */
      await openSettings(a);
      const [download] = await Promise.all([
        a.waitForEvent('download'),
        a.click('#btn-backup'),
      ]);
      const backupPath = path.join(tmp, 'sicherung.json');
      await download.saveAs(backupPath);
      const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      check.equal(backup.format, 'wanderplaner-backup', 'Sicherungsdatei hat das richtige Format');
      check.ok(Array.isArray(backup.stamps) && backup.stamps.length >= 2,
        'Die Sicherung enthält die Stempelstellen');
      check.ok(Array.isArray(backup.tours) && backup.tours.length === 1,
        'Die Sicherung enthält die gespeicherte Tour');

      /* ---- Daten überstehen einen Neustart des Servers ---- */
      const stored = JSON.parse(
        fs.readFileSync(path.join(server.dataDir, 'wanderplaner.json'), 'utf8')
      );
      check.ok(stored.stamps.length === 3, 'Der Server hält alle Einträge vor');
      check.equal(stored.stamps.filter((s) => s.deletedAt).length, 1,
        'Der gelöschte Eintrag bleibt als Markierung erhalten');

      check.equal(errors.length, 0, 'Keine Skriptfehler', errors.join(' | '));
    } finally {
      await browser.close();
      server.stop();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
};
