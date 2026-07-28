'use strict';

/**
 * Reiter, Sammelfortschritt mit Stufen und die Tourenvorschläge aus
 * Stempel-Nestern.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  startServer, launchBrowser, stubExternals, writeGpxWaypoints, openSettings, openStamps,
} = require('../helpers');

module.exports = {
  name: 'Fortschritt und Vorschläge',

  async run(check) {
    const server = await startServer(9105);
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await stubExternals(page);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-progress-'));

    try {
      await page.goto(server.url);
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(600);

      /* ---- Reiter ---- */
      check.equal(await page.locator('.tab').count(), 3, 'Drei Reiter stehen bereit');
      check.ok(await page.locator('[data-panel=planung]').isVisible(),
        'Der Reiter „Planung“ ist anfangs offen');
      check.ok(await page.locator('[data-panel=analyse]').isHidden(),
        'Die anderen Reiter sind zunächst zu');

      await page.click('.tab[data-tab=unterwegs]');
      await page.waitForTimeout(300);
      check.ok(await page.locator('[data-panel=unterwegs]').isVisible(),
        'Ein Klick wechselt den Reiter');
      check.ok(await page.locator('[data-panel=planung]').isHidden(),
        'Der vorige Reiter wird geschlossen');

      await page.reload();
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(700);
      check.ok(await page.locator('[data-panel=unterwegs]').isVisible(),
        'Der gewählte Reiter bleibt nach dem Neuladen offen');

      /* ---- Stempel für Fortschritt und Nester ---- */
      // Nest 1: sechs Stempel dicht beieinander, Nest 2: vier weiter weg.
      const waypoints = [];
      for (let i = 0; i < 6; i++) {
        waypoints.push({ lat: 51.80 + i * 0.005, lng: 10.60 + (i % 2) * 0.005, name: `Nest A ${i + 1}` });
      }
      for (let i = 0; i < 4; i++) {
        waypoints.push({ lat: 52.20 + i * 0.005, lng: 10.95, name: `Nest B ${i + 1}` });
      }
      const gpx = writeGpxWaypoints(tmp, 'nester.gpx', waypoints);
      const park = writeGpxWaypoints(tmp, 'park.gpx', [
        { lat: 51.812, lng: 10.602, name: 'Parkplatz Nest A' },
      ]);

      const importFile = async (type, file) => {
        await openSettings(page, 'daten');
        await page.selectOption('#import-type', type);
        const [chooser] = await Promise.all([
          page.waitForEvent('filechooser'),
          page.click('#btn-import'),
        ]);
        await chooser.setFiles(file);
        await page.waitForTimeout(800);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      };
      await importFile('stempel', gpx);
      await importFile('parkplatz', park);

      /* ---- Fortschritt ---- */
      await page.click('.tab[data-tab=unterwegs]');
      await page.waitForTimeout(300);
      check.contains(await page.textContent('#progress-box'), '0 von 10',
        'Der Fortschritt zeigt den Sammelstand');
      check.contains(await page.textContent('#progress-box'), 'Bronze',
        'Die nächste Stufe wird genannt');

      // Elf Stempel gibt es nicht – wir haken alle zehn ab und prüfen die Zählung.
      await openStamps(page);
      const boxes = page.locator('#stamp-list li input[type=checkbox]');
      const count = await boxes.count();
      for (let i = 0; i < count; i++) {
        await boxes.nth(i).check();
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(700);
      const progressText = await page.textContent('#progress-box');
      check.contains(progressText, '10 von 10', 'Alle abgehakten Stempel werden gezählt');
      check.contains(progressText, `${new Date().getFullYear()}: 10`,
        'Die Jahresstatistik nutzt das Abhak-Datum');

      /* ---- Vorschläge aus Nestern ---- */
      // Zum Testen der Gruppierung die Stempel wieder öffnen.
      for (let i = 0; i < count; i++) {
        await boxes.nth(i).uncheck();
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(700);

      // Die Stempelliste liegt im Einstellungsdialog – der verdeckt die
      // rechte Leiste, in der es gleich weitergeht.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await page.selectOption('#cluster-length', '12');
      await page.click('#btn-clusters');
      await page.waitForTimeout(900);

      const clusters = page.locator('#cluster-list li:not(.list-empty)');
      const clusterCount = await clusters.count();
      check.ok(clusterCount >= 2, 'Beide Stempel-Nester werden gefunden',
        `${clusterCount} Vorschläge`);

      const firstLabel = await clusters.first().locator('.item-label').textContent();
      check.contains(firstLabel, 'Stempel', 'Ein Vorschlag nennt die Anzahl');
      check.contains(firstLabel, 'km', 'Ein Vorschlag nennt die geschätzte Länge');

      const startText = await clusters.first().locator('.cluster-start').textContent();
      check.contains(startText, 'Parkplatz', 'Der nächstgelegene Parkplatz wird vorgeschlagen');

      /* ---- Vorschlag übernehmen ---- */
      await clusters.first().locator('.item-action').click();
      await page.waitForTimeout(1600);
      check.ok(await page.locator('[data-panel=planung]').isVisible(),
        'Nach dem Übernehmen wird zur Planung gewechselt');
      const points = await page.locator('#point-list li:not(.list-empty)').count();
      check.ok(points >= 6, 'Die Stempel des Nests werden als Route übernommen',
        `${points} Punkte`);
      check.contains(await page.locator('#tour-name').inputValue(), 'Stempelrunde',
        'Ein Tourname wird vorgeschlagen');

      /* ---- Versionsanzeige ---- */
      await openSettings(page, 'ueber');
      const versionText = await page.textContent('#app-version');
      check.contains(versionText, 'Version', 'Die laufende Version wird angezeigt');
      check.ok(/\d+\.\d+\.\d+/.test(versionText),
        'Die Anzeige nennt eine Versionsnummer', versionText);

      const api = await page.evaluate(async () => {
        const res = await fetch('api/version');
        return res.ok ? await res.json() : null;
      });
      check.ok(api && api.version, 'Der Server meldet seine Version über /api/version');

      // Update-Prüfung bei nicht erreichbarem GitHub: verständliche Meldung
      // statt stiller Fehler.
      await page.route('**/api.github.com/**', (route) => route.abort());
      await page.click('#btn-check-update');
      await page.waitForTimeout(1200);
      check.ok(!(await page.locator('#update-note').isHidden()),
        'Die Update-Prüfung meldet ein Ergebnis');
      check.contains(await page.textContent('#update-note'), 'GitHub',
        'Bei fehlendem Zugang wird das erklärt');

      // Und mit Antwort: neuere Version wird als solche erkannt.
      await page.unroute('**/api.github.com/**');
      await page.route('**/api.github.com/**', (route) =>
        route.fulfill({ json: { tag_name: 'v99.0.0' } }));
      await page.click('#btn-check-update');
      await page.waitForTimeout(1200);
      check.contains(await page.textContent('#update-note'), '99.0.0',
        'Eine neuere Version wird gemeldet');
      check.contains(await page.locator('#update-note').getAttribute('class'), 'update',
        'Der Hinweis wird hervorgehoben');

      /* ---- Aktualisieren aus der Oberfläche ---- */
      // Ohne Freigabe fehlt der Knopf – dann muss wenigstens dastehen,
      // dass es ihn gibt und wie man ihn bekommt.
      check.ok(await page.locator('#btn-run-update').isHidden(),
        'Ohne Freigabe erscheint kein Aktualisieren-Knopf');
      check.ok(await page.locator('#update-setup').isVisible(),
        'Stattdessen steht dort, wie man die Aktualisierung einschaltet');
      check.contains(await page.textContent('#update-reason'), 'ALLOW_SELF_UPDATE',
        'Der Grund nennt den fehlenden Schalter');
      await page.click('#update-setup summary');
      await page.waitForTimeout(200);
      const setup = await page.textContent('#update-setup');
      check.contains(setup, 'docker.sock', 'Die Anleitung nennt den Docker-Socket');
      check.contains(setup, 'CONTAINER_NAME', 'Und den Namen des Containers');
      check.contains(setup, 'Heimnetz', 'Die Abwägung wird dazugesagt');

      check.equal(errors.length, 0, 'Keine Skriptfehler', errors.join(' | '));
    } finally {
      await browser.close();
      server.stop();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
};
