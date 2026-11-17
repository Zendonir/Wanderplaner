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

      /* ---- Tourenliste und Blende schließen sich gegenseitig aus ---- */
      check.ok(await page.locator('#library-scrim').isVisible(),
        'Neben der Tourenliste wird die Karte abgedunkelt');
      const layoutHas = (cls) => page.evaluate(
        (c) => document.getElementById('layout').classList.contains(c), cls);
      await page.tap('.sheet-handle');
      await page.waitForTimeout(400);
      check.ok(await layoutHas('sheet-open') && await layoutHas('library-collapsed'),
        'Die Blende hochziehen schließt die Tourenliste');

      // Zwischen Griff und Zahlenreihe darf beim Scrollen nichts durchscheinen.
      await page.evaluate(() => { document.getElementById('sidebar').scrollTop = 300; });
      await page.waitForTimeout(200);
      const luecke = await page.evaluate(() => {
        const griff = document.querySelector('.sheet-handle').getBoundingClientRect();
        const zahlen = document.querySelector('.stats').getBoundingClientRect();
        return zahlen.top - griff.bottom;
      });
      check.ok(Math.abs(luecke) <= 1,
        'Die Zahlenreihe schließt beim Scrollen direkt an den Griff an',
        `${luecke.toFixed(1)} px Abstand`);

      await page.tap('#btn-library');
      await page.waitForTimeout(400);
      check.ok(!await layoutHas('sheet-open') && !await layoutHas('library-collapsed'),
        'Die Tourenliste öffnen klappt die Blende zu');
      await page.tap('#library-scrim', { position: { x: 360, y: 300 } });
      await page.waitForTimeout(400);
      check.ok(await layoutHas('library-collapsed'),
        'Ein Tipp auf die abgedunkelte Karte schließt die Tourenliste');

      /* ---- Viele POIs: am Handy ausgedünnt ---- */
      await page.evaluate(() => {
        const pois = [];
        for (let i = 0; i < 2000; i++) {
          pois.push({ id: `dicht-${i}`, name: `Gipfel ${i}`, note: 'natural=peak',
            lat: 51.70 + (i % 50) * 0.002, lng: 10.55 + Math.floor(i / 50) * 0.002,
            updatedAt: Date.now() });
        }
        localStorage.setItem('wanderplaner.pois', JSON.stringify({ items: pois }));
      });
      await page.reload();
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(800);
      await page.evaluate(() => MapView.setView(51.74, 10.59, 13));
      await page.waitForTimeout(800);
      const marken = await page.evaluate(() => {
        const pts = [...document.querySelectorAll('.poi-marker')]
          .map((m) => m.getBoundingClientRect());
        let eng = 0;
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            if (Math.abs(pts[i].x - pts[j].x) < 20 && Math.abs(pts[i].y - pts[j].y) < 20) eng++;
          }
        }
        return { anzahl: pts.length, eng };
      });
      check.ok(marken.anzahl > 0 && marken.anzahl < 400,
        'Dichte POIs werden am Handy ausgedünnt', `${marken.anzahl} Marken`);
      check.equal(marken.eng, 0, 'Keine zwei Marken liegen aufeinander');

      // Ein eben gesetzter POI darf dem Ausdünnen nicht zum Opfer fallen –
      // sonst öffnet sich sein Popup zum Benennen nicht.
      // Eine Kartenstelle mit Abstand zu allen sichtbaren Marken – ein
      // Fingertipp direkt daneben landet sonst auf der Marke. Weil die
      // Testdaten jedes Rasterfeld füllen, liegt die Stelle trotzdem in einem
      // Feld, das schon von einem importierten POI belegt ist.
      const ziel = await page.evaluate(() => {
        const box = document.getElementById('map').getBoundingClientRect();
        const rects = [...document.querySelectorAll('.leaflet-marker-icon')]
          .map((m) => m.getBoundingClientRect());
        for (let y = box.y + 80; y < box.bottom - 80; y += 4) {
          for (let x = box.x + 60; x < box.right - 60; x += 4) {
            const frei = rects.every((r) => x < r.left - 14 || x > r.right + 14
              || y < r.top - 14 || y > r.bottom + 14);
            const hit = document.elementFromPoint(x, y);
            if (frei && hit && hit.closest('#map') && !hit.closest('.leaflet-control')) {
              return { x, y };
            }
          }
        }
        return null;
      });
      check.ok(ziel, 'Mitten im POI-Gebiet findet sich eine freie Kartenstelle');
      // Der Moduswechsel liegt in der zugeklappten Blende – direkt auslösen.
      await page.evaluate(() => document.getElementById('mode-poi').click());
      await page.waitForTimeout(200);
      await page.touchscreen.tap(ziel.x, ziel.y);
      await page.waitForTimeout(700);
      // Das Formular mit Namensfeld gehört zum neuen POI; importierte zeigen
      // eine reine Ansicht (.poi-view) ohne Eingabefeld.
      check.ok(await page.locator('.leaflet-popup .poi-popup:not(.poi-view) input').isVisible(),
        'Ein neuer POI neben einem vorhandenen öffnet sein Popup zum Benennen');
      await page.evaluate(() => document.getElementById('mode-menu').click());
      await page.waitForTimeout(200);

      /* ---- Route „nach Steigung“ bei zugeklappter Blende ---- */
      // Das Höhenprofil hat in der zugeklappten Blende keine Breite. Der
      // Farbverlauf darunter rechnete dann mit 0/0, Safari brach mit „The
      // provided value is non-finite“ ab – und Anstieg/Abstieg fehlten.
      await page.evaluate(() => {
        localStorage.setItem('wanderplaner.routestyle', 'slope');
        localStorage.setItem('wanderplaner.mode', 'route');
        localStorage.setItem('wanderplaner.sheet', 'closed');
        localStorage.removeItem('wanderplaner.pois');
      });
      await page.reload();
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(800);
      await page.click('#btn-clear').catch(() => {});
      const flaeche = await page.locator('#map').boundingBox();
      await page.touchscreen.tap(flaeche.x + flaeche.width * 0.5, flaeche.y + flaeche.height * 0.7);
      await page.waitForTimeout(300);
      await page.touchscreen.tap(flaeche.x + flaeche.width * 0.55, flaeche.y + flaeche.height * 0.3);
      await page.waitForFunction(() =>
        document.getElementById('stat-ascent').textContent.includes('Hm')
        || /non-finite/.test(document.getElementById('status').textContent),
      null, { timeout: 15000 }).catch(() => {});
      check.ok(!/non-finite/.test(await page.textContent('#status')),
        'Nach Steigung eingefärbt bricht die Berechnung am Handy nicht ab',
        await page.textContent('#status'));
      check.contains(await page.textContent('#stat-ascent'), 'Hm',
        'Anstieg und Abstieg werden dabei berechnet');

      /* ---- Einstellungsdialog passt auf den Bildschirm ---- */
      // Der YAML-Block in der Update-Anleitung hatte den Dialog über den
      // rechten Rand hinausgeschoben; Text war dann abgeschnitten.
      await page.tap('#btn-settings');
      await page.waitForSelector('#settings:not([hidden])');
      await page.tap('.settings-tab[data-stab=ueber]');
      await page.waitForTimeout(200);
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

      await page.tap('.settings-tab[data-stab=abgleich]');
      await page.waitForTimeout(200);
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
