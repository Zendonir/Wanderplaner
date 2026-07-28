'use strict';

/**
 * Darstellung auf dem Handy und als Homescreen-App.
 *
 * Geprüft wird das, was auf einem kleinen Bildschirm tatsächlich schiefgehen
 * kann: eine scrollende Seite, eine Karte, die kaum noch zu sehen ist,
 * Eingabefelder unter 16 px (dann zoomt iOS beim Antippen hinein) und die
 * Blende, die die Planung vom unteren Rand hochzieht.
 */
const { devices } = require('playwright');
const { startServer, launchBrowser, stubExternals, waitForRoute } = require('../helpers');

module.exports = {
  name: 'Handy und Homescreen',

  async run(check) {
    const server = await startServer(9105);
    const browser = await launchBrowser();
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await stubExternals(page);

    try {
      await page.goto(server.url);
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(700);

      /* ---- Die Seite selbst darf nicht scrollen ---- */
      const frame = await page.evaluate(() => ({
        scrollt: document.documentElement.scrollHeight > window.innerHeight + 2,
        fenster: window.innerHeight,
        karte: document.getElementById('map').getBoundingClientRect().height,
        sammlungOffen: !document.getElementById('layout')
          .classList.contains('library-collapsed'),
      }));
      check.ok(!frame.scrollt,
        'Die Seite scrollt nicht als Ganzes – gescrollt wird nur in der Blende');
      check.ok(frame.karte > frame.fenster * 0.6,
        'Die Karte bekommt den größten Teil des Bildschirms',
        `${Math.round(frame.karte)} von ${frame.fenster} px`);
      check.ok(!frame.sammlungOffen,
        'Die Sammlung überlagert die Karte beim Start nicht');

      /* ---- Kein Hineinzoomen beim Antippen von Feldern ---- */
      const kleinste = await page.evaluate(() => Math.min(
        ...[...document.querySelectorAll('input, select, textarea')]
          .map((e) => parseFloat(getComputedStyle(e).fontSize))
      ));
      check.ok(kleinste >= 16,
        'Alle Eingabefelder sind mindestens 16 px groß', `kleinstes ${kleinste} px`);

      /* ---- Die Blende ---- */
      check.ok(await page.locator('#sheet-handle').isVisible(),
        'Die Blende hat einen sichtbaren Griff');
      const sheetTop = () => page.locator('#sidebar')
        .evaluate((e) => e.getBoundingClientRect().top);
      const zu = await sheetTop();
      check.ok(zu > frame.fenster * 0.7,
        'Zugeklappt gibt die Blende die Karte frei', `Oberkante bei ${Math.round(zu)} px`);

      // Die Zahlen sind das Wichtigste unterwegs – sie müssen auch
      // zugeklappt zu sehen sein.
      const statsBox = await page.locator('.stats').boundingBox();
      check.ok(statsBox.y + statsBox.height <= frame.fenster + 1,
        'Länge, Anstieg und Gehzeit stehen schon im zugeklappten Rand',
        `Unterkante bei ${Math.round(statsBox.y + statsBox.height)} px`);

      await page.tap('#sheet-handle');
      await page.waitForTimeout(500);
      const offen = await sheetTop();
      check.ok(offen < zu - 200, 'Der Griff zieht die Blende hoch',
        `${Math.round(zu)} → ${Math.round(offen)} px`);
      check.ok(await page.locator('#sidebar > .profile-panel').count() === 1,
        'Das Höhenprofil sitzt am Handy in der Blende');
      check.ok(await page.locator('.profile-panel').isHidden(),
        'Ohne Route bleibt das leere Diagramm ausgeblendet');

      /* ---- Route zeichnen: Blende weicht der Karte ---- */
      await page.tap('#mode-route');
      await page.waitForTimeout(300);
      await page.tap('#sheet-handle');
      await page.waitForTimeout(500);

      const box = await page.locator('#map').boundingBox();
      await page.tap('#map', { position: { x: box.width * 0.4, y: box.height * 0.25 } });
      await page.waitForTimeout(400);
      await page.tap('#map', { position: { x: box.width * 0.6, y: box.height * 0.55 } });
      await waitForRoute(page);
      check.contains(await page.textContent('#stat-distance'), 'km',
        'Punkte lassen sich per Fingertipp setzen');

      await page.tap('#sheet-handle');
      await page.waitForTimeout(500);
      check.ok(await page.locator('.profile-panel').isVisible(),
        'Mit Route erscheint das Höhenprofil in der Blende');

      // Ein Tipp auf die Karte schließt die Blende, statt einen Punkt zu
      // setzen – sonst würde man blind neben die verdeckte Karte tippen.
      const punkteVorher = await page.locator('#point-list li:not(.list-empty)').count();
      await page.tap('#map', { position: { x: box.width * 0.5, y: 40 } });
      await page.waitForTimeout(500);
      check.equal(await sheetTop() > zu - 5, true,
        'Ein Tipp auf die Karte klappt die Blende zu');
      check.equal(await page.locator('#point-list li:not(.list-empty)').count(),
        punkteVorher, 'Dabei entsteht kein neuer Punkt');

      /* ---- Kopfzeile: Suche klappt auf ---- */
      check.ok(await page.locator('#search-input').isHidden(),
        'Das Suchfeld belegt keine Kopfzeile, solange es nicht gebraucht wird');
      await page.tap('.search-form button');
      await page.waitForTimeout(300);
      check.ok(await page.locator('#search-input').isVisible(),
        'Die Lupe klappt das Suchfeld auf');

      /* ---- Sammlung überlagert die Karte ---- */
      await page.tap('#btn-library');
      await page.waitForTimeout(400);
      const lib = await page.locator('#library').boundingBox();
      check.ok(lib.width <= 340 && lib.x === 0,
        'Die Sammlung schiebt sich über die Karte statt sie zu quetschen',
        `${Math.round(lib.width)} px breit`);

      /* ---- Einstellungsdialog passt auf den Bildschirm ---- */
      // Der YAML-Block in der Update-Anleitung hatte den Dialog über den
      // rechten Rand hinausgeschoben; Text war dann abgeschnitten.
      await page.tap('#btn-settings');
      await page.waitForSelector('#settings:not([hidden])');
      await page.tap('#update-setup summary');
      await page.waitForTimeout(400);

      const dialog = await page.evaluate(() => {
        const sheet = document.querySelector('.settings-sheet');
        const box = sheet.getBoundingClientRect();
        return {
          rechts: box.right,
          fenster: window.innerWidth,
          scrollt: document.documentElement.scrollWidth > window.innerWidth + 2,
        };
      });
      check.ok(dialog.rechts <= dialog.fenster + 1,
        'Der Einstellungsdialog bleibt im Bildschirm',
        `Rand bei ${Math.round(dialog.rechts)} von ${dialog.fenster} px`);
      check.ok(!dialog.scrollt, 'Die Seite bekommt dadurch keinen Querbalken');

      const resetBreite = await page.locator('#btn-reset').boundingBox();
      check.ok(resetBreite.width > dialog.fenster * 0.6,
        'Der Zurücksetzen-Knopf ist fingerfreundlich breit',
        `${Math.round(resetBreite.width)} px`);

      check.equal(errors.length, 0, 'Keine Skriptfehler', errors.join(' | '));
    } finally {
      await browser.close();
      server.stop();
    }
  },
};
