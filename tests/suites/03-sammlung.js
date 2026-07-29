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
      check.equal(await page.locator('#library #stamp-list').count(), 0,
        'Die Stempelliste steht nicht mehr in der linken Leiste');
      check.equal(await page.locator('#library #parking-list').count(), 0,
        'Die Parkplätze ebenso wenig');
      check.equal(await page.locator('#library .list-section').count(), 2,
        'Links stehen nur noch die beiden Tourenlisten');
      check.equal(await page.locator('.tab-panel[data-panel=planung] #rs-preset').count(), 0,
        'Die Routing-Einstellungen liegen nicht mehr in der Planung');

      await page.click('#btn-settings');
      await page.waitForSelector('#settings:not([hidden])');
      // Jeder Bereich in seinem Reiter.
      for (const [tab, id, was] of [
        ['daten', '#import-type', 'Der Import'],
        ['daten', '#stamp-list', 'Die Stempelstellen'],
        ['daten', '#parking-list', 'Die Parkplätze'],
        ['routing', '#rs-preset', 'Die Routing-Einstellungen'],
        ['abgleich', '#btn-sync', 'Der Abgleich'],
        ['ueber', '#app-version', 'Die Version'],
      ]) {
        await page.click(`.settings-tab[data-stab=${tab}]`);
        await page.waitForTimeout(120);
        check.ok(await page.locator(`#settings ${id}`).isVisible(),
          `${was} steht im Reiter „${tab}“`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      check.ok(await page.locator('#settings').isHidden(), 'Esc schließt die Einstellungen');

      const importFile = async (type, file) => {
        await openSettings(page, 'daten');
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
      check.ok(await page.locator('#stamp-list').isVisible(),
        'Nach dem Import steht die Liste gleich darunter');
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
        // So kommt es aus vielen GPX-Ausgaben: die rohen OSM-Merkmale als
        // Beschreibung. Im Popup hat das nichts verloren.
        { lat: 51.7760, lng: 10.5990, name: 'Parkplatz Auerhahn',
          note: 'amenity=parking goods=no hgv=no motorcar=yes '
            + 'name=Parkplatz Auerhahn parking=surface surface=gravel' },
      ]);
      await importFile('parkplatz', parkFile);
      check.equal(await page.locator('#parking-list li:not(.list-empty)').count(), 2,
        'Parkplätze importiert');

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

      await openSettings(page, 'daten');

      // Der Parkplatz mit der Merkmalsliste: Name ja, Merkmale nein.
      await page.locator('#parking-list li').filter({ hasText: 'Auerhahn' })
        .locator('.item-label').click();
      await page.waitForSelector('.qr-popup', { timeout: 5000 });
      const popupText = await page.textContent('.qr-popup');
      check.contains(popupText, 'Parkplatz Auerhahn', 'Der Name steht im Popup');
      check.ok(!popupText.includes('amenity='),
        'Die OSM-Merkmale stehen nicht mehr darunter', popupText.slice(0, 90));
      check.ok(!popupText.includes('surface=gravel'),
        'Auch nicht einzelne davon');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);

      await openSettings(page, 'daten');
      await page.locator('#parking-list li').filter({ hasText: 'Schierke' })
        .locator('.item-label').click();
      await page.waitForSelector('.qr-box svg', { timeout: 5000 });
      await page.waitForTimeout(400);
      check.contains(await page.textContent('.qr-popup'), '3 EUR/Tag',
        'Eine echte Notiz bleibt sichtbar');

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
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

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

      // Zweizeilig: oben nur der Name, darunter das Datum und die Knöpfe.
      check.equal(
        await page.locator('#track-list li .item-label').first().textContent(),
        'Brocken 2024', 'In der ersten Zeile steht nur der Name');
      const trackDate = await page.locator('#track-list li .tour-date').first().textContent();
      check.contains(trackDate, 'Abgeschlossen',
        'Die zweite Zeile nennt das Datum der abgeschlossenen Tour');
      check.ok(/\d{2}\.\d{2}\.\d{4}/.test(trackDate),
        'Und zwar als lesbares Datum', trackDate);
      check.equal(
        await page.locator('#track-list li .tour-meta .item-action').count(), 2,
        'Die Knöpfe stehen in derselben zweiten Zeile');

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

      check.equal(await page.locator('#tour-list li .item-label').first().textContent(),
        'Testtour', 'Auch geplante Touren zeigen oben nur den Namen');
      check.contains(await page.locator('#tour-list li .tour-date').first().textContent(),
        'Erstellt', 'Bei geplanten Touren steht darunter das Erstelldatum');

      // Die Liste der abgeschlossenen Touren darf mehr zeigen als die
      // übrigen Listen – dort sammelt sich mit der Zeit am meisten an.
      const heights = await page.evaluate(() => ({
        tracks: document.getElementById('track-list').getBoundingClientRect().height,
        maxTracks: parseFloat(getComputedStyle(document.getElementById('track-list')).maxHeight),
        maxTours: parseFloat(getComputedStyle(document.getElementById('tour-list')).maxHeight),
      }));
      check.ok(heights.maxTracks > 220,
        'Die abgeschlossenen Touren bekommen mehr Platz als zuvor',
        `${heights.maxTracks}px`);
      check.ok(heights.maxTracks > heights.maxTours,
        'Und mehr als die geplanten Touren',
        `${heights.maxTracks}px gegen ${heights.maxTours}px`);

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

      /* ---- Stempel-Tour steht in der Planung ---- */
      // Auswählen in den Einstellungen, den Knopf gibt es aber rechts bei
      // der Planung – dort wird die Route ja auch gebaut.
      check.equal(await page.locator('#settings #btn-suggest').count(), 0,
        'Der Vorschlagsknopf steht nicht mehr in den Einstellungen');
      check.ok(await page.locator('#section-stamp-tour').isHidden(),
        'Ohne Auswahl bleibt der Abschnitt verborgen');

      await openStamps(page);
      const auswahl = page.locator('#stamp-list .stamp-tour');
      await auswahl.nth(0).click();
      await auswahl.nth(1).click();
      await page.waitForTimeout(400);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      check.ok(await page.locator('#section-stamp-tour').isVisible(),
        'Mit Auswahl erscheint die Stempel-Tour in der Planung');
      check.contains(await page.textContent('#tour-count'), '2',
        'Die Zahl der ausgewählten Stempel steht dabei');
      check.ok(!(await page.locator('#btn-suggest').isDisabled()),
        'Ab zwei Stempeln lässt sich die Route vorschlagen');

      await page.click('#btn-tour-clear');
      await page.waitForTimeout(300);
      check.ok(await page.locator('#section-stamp-tour').isHidden(),
        'Nach dem Leeren verschwindet der Abschnitt wieder');

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

      /* ---- Doppelte auf Knopfdruck zusammenführen ---- */
      // Nachgestellt: dieselben Stellen ein zweites Mal, mit anderen ids und
      // leicht abweichendem Namen – so wie es beim Import auf einem zweiten
      // Gerät entsteht.
      await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('wanderplaner.stempelstellen'));
        const kopien = raw.items.filter((s) => !s.deletedAt).map((s) => ({
          ...s,
          id: `zweitgeraet-${s.id}`,
          name: `HWN99 ${s.name}`,
          lat: s.lat + 0.0004,
          updatedAt: Date.now(),
          collected: false,
        }));
        raw.items = raw.items.concat(kopien);
        localStorage.setItem('wanderplaner.stempelstellen', JSON.stringify(raw));
      });
      await page.reload();
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(1200);

      // Schon beim Start räumt die App auf – niemand soll erst einen Knopf
      // suchen müssen. Geprüft wird das Ergebnis, nicht die Meldung: Die
      // Statuszeile ist flüchtig und für eine Zusicherung zu wackelig.
      await openStamps(page);
      check.equal(await page.locator('#stamp-list li:not(.list-empty)').count(), 3,
        'Beim Start werden Dubletten von selbst zusammengefasst');
      const gespeichert = await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('wanderplaner.stempelstellen'));
        return {
          sichtbar: raw.items.filter((s) => !s.deletedAt).length,
          gräber: raw.items.filter((s) => s.deletedAt).length,
        };
      });
      check.equal(gespeichert.sichtbar, 3, 'Auch im Speicher bleiben drei übrig');
      check.ok(gespeichert.gräber >= 3,
        'Die Dubletten bleiben als Grabsteine liegen',
        `${gespeichert.gräber} Grabsteine`);
      check.contains(await page.textContent('#stamp-counter'), '1 von 3',
        'Der Sammelstand übersteht das Zusammenführen');

      // Der Knopf sagt auch dann etwas, wenn nichts zu tun war – sonst
      // weiß niemand, ob überhaupt gesucht wurde.
      await openSettings(page, 'abgleich');
      await page.click('#btn-dedupe');
      await page.waitForTimeout(600);
      check.contains(await page.textContent('#status'), 'Keine Dubletten',
        'Ohne Fund sagt der Knopf das ausdrücklich');
      check.contains(await page.textContent('#status'), '3 Stempelstellen',
        'Und nennt, wie viel geprüft wurde');
      await page.keyboard.press('Escape');

      /* ---- POIs importieren: eigene Symbole, Ansicht statt Formular ---- */
      const poiFile = writeGpxWaypoints(tmp, 'pois.gpx', [
        { lat: 51.8300, lng: 10.6300, name: 'Einersberg',
          note: 'ele=591.7 name=Einersberg natural=peak wikipedia=de:Einersberg' },
        { lat: 51.8320, lng: 10.6340, name: 'Rabenklippe',
          note: 'tourism=viewpoint name=Rabenklippe ele=560' },
        { lat: 51.8340, lng: 10.6380, name: 'Molkenhaus',
          note: 'amenity=restaurant name=Molkenhaus website=molkenhaus.de '
            + 'opening_hours=Mo-Su 10:00-18:00' },
      ]);
      await importFile('poi', poiFile);
      await page.waitForTimeout(600);
      check.equal(await page.locator('#poi-list li:not(.list-empty)').count(), 3,
        'POIs werden importiert');

      // Jede Art bekommt ihr eigenes Zeichen – nicht mehr überall dieselbe Fahne.
      const poiIcons = await page.locator('#poi-list .poi-type').allTextContents();
      check.equal(new Set(poiIcons).size, 3,
        'Die drei Arten haben drei verschiedene Zeichen', poiIcons.join(' '));
      check.ok(poiIcons.includes('⛰'), 'Der Gipfel bekommt ein Gipfelzeichen');

      const poiLabels = (await page.locator('#poi-list .item-label').allTextContents()).join(' | ');
      check.ok(!poiLabels.includes('natural='),
        'In der Liste steht die Art, nicht die Merkmalszeile', poiLabels.slice(0, 80));
      check.contains(poiLabels, 'Aussichtspunkt', 'Und zwar in Worten');

      // Popup: Ansicht mit Angaben und Verweisen, kein Textfeld.
      await page.locator('#poi-list li').filter({ hasText: 'Molkenhaus' })
        .locator('.item-label').click();
      await page.waitForSelector('.poi-view', { timeout: 5000 });
      const view = page.locator('.poi-view');
      check.contains(await view.textContent(), 'Einkehr', 'Das Popup nennt die Art');
      check.contains(await view.textContent(), 'Öffnungszeiten',
        'Die Öffnungszeiten stehen als Angabe da');
      check.equal(await view.locator('textarea').count(), 0,
        'Ein importierter POI wird nicht mehr zum Bearbeiten geöffnet');
      const href = await view.locator('.poi-links a').first().getAttribute('href');
      check.equal(href, 'https://molkenhaus.de', 'Der hinterlegte Verweis ist anklickbar');
      check.contains(await view.locator('.poi-tags summary').textContent(), 'Merkmale',
        'Alle übrigen Merkmale bleiben ausklappbar erreichbar');

      // Wer doch ändern will, kommt über „Bearbeiten“ ans Formular.
      await view.locator('.poi-popup-buttons button').first().click();
      await page.waitForTimeout(300);
      check.equal(await page.locator('.poi-popup textarea').count(), 1,
        'Der Knopf „Bearbeiten“ öffnet das Formular doch noch');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);

      /* ---- POIs überstehen das Neuladen ---- */
      // Sie lagen früher nur im Arbeitsspeicher – bei einer importierten
      // Sammlung wäre nach jedem Neustart alles weg.
      await page.reload();
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(900);
      check.equal(await page.locator('#poi-list li:not(.list-empty)').count(), 3,
        'Importierte POIs sind nach dem Neuladen noch da');

      // Und ein erneuter Import verdoppelt sie nicht.
      await importFile('poi', poiFile);
      await page.waitForTimeout(600);
      check.equal(await page.locator('#poi-list li:not(.list-empty)').count(), 3,
        'Dieselbe Datei erneut einzulesen ändert nichts');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);

      /* ---- Große Sammlung: nur der Ausschnitt wird gezeichnet ---- */
      // Mit mehreren tausend Markern wird schon das Verschieben der Karte
      // zäh; gezeichnet wird deshalb nur, was im Bild liegt.
      const many = [];
      for (let i = 0; i < 500; i++) {
        many.push({
          lat: 51.5 + (i % 25) * 0.02,
          lng: 10.2 + Math.floor(i / 25) * 0.02,
          name: `Punkt ${i}`,
          note: 'tourism=viewpoint',
        });
      }
      await importFile('poi', writeGpxWaypoints(tmp, 'viele.gpx', many));
      await page.waitForTimeout(1200);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);

      // Die Liste zeigt nur die ersten 200 – tausende Zeilen aufzubauen
      // dauert länger als das Zeichnen der Karte und nützt niemandem.
      const listed = await page.locator('#poi-list li:not(.list-empty)').count();
      check.equal(listed, 200, 'Die Liste zeigt höchstens 200 Einträge');
      check.contains(await page.textContent('#poi-list'), 'weitere',
        'Und sagt, wie viele noch folgen');
      const drawn = await page.locator('.poi-marker').count();
      check.ok(drawn < 503, 'Auf der Karte wird nur ein Teil gezeichnet',
        `${drawn} Marken`);
      check.ok(!(await page.locator('#poi-note').isHidden()),
        'Dass nicht alle zu sehen sind, steht in der Leiste');
      check.contains(await page.textContent('#poi-note'), '503',
        'Der Hinweis nennt die Gesamtzahl');

      // Hineinzoomen bringt die Punkte hervor.
      await page.evaluate(() => {
        const el = document.getElementById('map');
        const key = Object.keys(el).find((k) => k.startsWith('_leaflet_id'));
        return key;
      });
      await page.locator('.leaflet-control-zoom-in').click();
      await page.waitForTimeout(500);
      await page.locator('.leaflet-control-zoom-in').click();
      await page.waitForTimeout(800);
      check.ok(await page.locator('.poi-marker').count() > 0,
        'Näher herangezoomt erscheinen die Marken');

      /* ---- POIs nach Art ausblenden ---- */
      const chips = page.locator('.poi-chip');
      check.ok(!(await page.locator('#poi-filter').isHidden()),
        'Bei mehreren Arten erscheint der Filter');
      const chipLabels = (await chips.allTextContents()).join(' | ');
      check.contains(chipLabels, 'Aussichtspunkt', 'Jede vorkommende Art bekommt einen Knopf');
      check.contains(chipLabels, 'Einkehr', 'Auch die selteneren');
      check.contains(await page.textContent('#poi-filter-count'), '503',
        'Der Filter nennt die Gesamtzahl');

      const viewChip = chips.filter({ hasText: 'Aussichtspunkt' });
      check.contains(await viewChip.textContent(), '501',
        'Und je Art deren Anzahl');

      // Aussichtspunkte ausblenden: Liste und Karte müssen folgen.
      await viewChip.click();
      await page.waitForTimeout(700);
      check.contains(await viewChip.getAttribute('class'), 'off',
        'Der Knopf zeigt den ausgeblendeten Zustand');
      check.contains(await page.textContent('#poi-filter-count'), '2 von 503',
        'Die Zählung folgt der Auswahl');
      const remaining = (await page.locator('#poi-list .item-label').allTextContents()).join(' | ');
      check.ok(!remaining.includes('Rabenklippe'),
        'Ausgeblendete Arten verschwinden aus der Liste', remaining.slice(0, 80));
      check.contains(remaining, 'Molkenhaus', 'Die übrigen bleiben');
      check.equal(await page.locator('.poi-marker').count(), 2,
        'Auf der Karte bleiben nur die eingeblendeten Arten');

      // Die Auswahl muss einen Neustart überstehen.
      await page.reload();
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(1000);
      check.contains(await page.textContent('#poi-filter-count'), '2 von 503',
        'Die Auswahl bleibt nach dem Neuladen erhalten');

      await page.click('#btn-poi-none');
      await page.waitForTimeout(600);
      check.equal(await page.locator('.poi-marker').count(), 0,
        '„Keine“ blendet alles aus');
      check.contains(await page.textContent('#poi-list'), 'ausgeblendet',
        'Die leere Liste erklärt sich');

      await page.click('#btn-poi-all');
      await page.waitForTimeout(700);
      check.contains(await page.textContent('#poi-filter-count'), '503 POIs',
        '„Alle“ holt alles zurück');
      check.ok(await page.locator('.poi-marker').count() > 0,
        'Und die Marken sind wieder da');

      /* ---- Alles übersteht einen Neustart der Seite ---- */
      await page.reload();
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(900);
      check.equal(await page.locator('#stamp-list li:not(.list-empty)').count(), 3,
        'Stempelstellen bleiben nach dem Neuladen erhalten');
      check.equal(await page.locator('#parking-list li:not(.list-empty)').count(), 2,
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
