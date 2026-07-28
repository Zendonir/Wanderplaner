'use strict';

/**
 * Routenplanung im Browser: Punkte setzen, Route ziehen, umkehren,
 * Varianten wählen, Wegebeschaffenheit und Hinweise.
 */
const { startServer, launchBrowser, stubExternals, drawRoute, defaultRoute,
        openSettings } = require('../helpers');

module.exports = {
  name: 'Routenplanung',

  async run(check) {
    const server = await startServer(9101);
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const brouterUrls = [];
    await stubExternals(page, { onBrouterRequest: (url) => brouterUrls.push(url) });

    try {
      await page.goto(server.url);
      await page.waitForSelector('#map.leaflet-container');

      /* ---- Klick auf die Karte setzt nicht mehr ungefragt ---- */
      const mapBox = await page.locator('#map').boundingBox();
      const clickMap = (fx, fy, options) => page.locator('#map').click({
        position: { x: mapBox.width * fx, y: mapBox.height * fy }, ...options,
      });

      check.ok(await page.locator('#mode-menu').evaluate((b) => b.classList.contains('active')),
        'Der Menümodus ist voreingestellt');

      // Ein einfacher Klick tut im Menümodus bewusst gar nichts.
      await clickMap(0.45, 0.5);
      await page.waitForTimeout(400);
      check.equal(await page.locator('.map-menu').count(), 0,
        'Ein einfacher Klick öffnet kein Menü');
      check.equal(await page.locator('#point-list li:not(.list-empty)').count(), 0,
        'Und setzt erst recht keinen Punkt');

      await clickMap(0.45, 0.5, { clickCount: 2, delay: 60 });
      await page.waitForSelector('.map-menu', { timeout: 4000 });
      check.equal(await page.locator('#point-list li:not(.list-empty)').count(), 0,
        'Der Doppelklick öffnet das Menü, ohne etwas zu setzen');
      const menuEntries = await page.locator('.map-menu-item').allTextContents();
      check.contains(menuEntries.join(' | '), 'Routenpunkt anhängen',
        'Das Menü bietet den Routenpunkt an');
      check.contains(menuEntries.join(' | '), 'POI',
        'Und den POI an derselben Stelle');
      check.contains(menuEntries.join(' | '), 'Parkplatz',
        'Ein Parkplatz lässt sich direkt anlegen');

      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      check.equal(await page.locator('.map-menu').count(), 0, 'Esc schließt das Menü');
      check.equal(await page.locator('#point-list li:not(.list-empty)').count(), 0,
        'Nach dem Abbrechen ist die Planung unverändert');

      await clickMap(0.45, 0.5, { clickCount: 2, delay: 60 });
      await page.waitForSelector('.map-menu', { timeout: 4000 });
      await page.locator('.map-menu-item').first().click();
      await page.waitForTimeout(500);
      check.equal(await page.locator('#point-list li:not(.list-empty)').count(), 1,
        'Erst die Auswahl im Menü setzt den Punkt');

      /* ---- Zweiter Punkt: Menü bietet jetzt auch den Startpunkt an ---- */
      // Diesmal per Rechtsklick – der geht in jedem Modus.
      await clickMap(0.55, 0.4, { button: 'right' });
      await page.waitForSelector('.map-menu', { timeout: 4000 });
      check.contains((await page.locator('.map-menu-item').allTextContents()).join(' | '),
        'Startpunkt', 'Bei bestehender Route lässt sich davor eingefügt werden');
      await page.keyboard.press('Escape');

      /* ---- Strg+Z macht rückgängig ---- */
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(600);
      check.equal(await page.locator('#point-list li:not(.list-empty)').count(), 0,
        'Strg+Z nimmt den Punkt zurück');

      await drawRoute(page);
      check.ok(await page.locator('#mode-route').evaluate((b) => b.classList.contains('active')),
        'Der Zeichenmodus lässt sich einschalten');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      check.ok(await page.locator('#mode-menu').evaluate((b) => b.classList.contains('active')),
        'Esc führt aus dem Zeichnen zurück ins Menü');

      const distance = await page.textContent('#stat-distance');
      check.contains(distance, '4,0', 'Route wird berechnet und Länge angezeigt');
      check.contains(await page.textContent('#stat-ascent'), 'Hm',
        'Höhenmeter kommen aus der Routengeometrie');

      /* ---- Wegebeschaffenheit ---- */
      await page.click('.tab[data-tab=analyse]');
      await page.waitForSelector('#section-waytypes:not([hidden])', { timeout: 8000 });
      const legend = (await page.locator('.waytype-legend li').allTextContents()).join(' | ');
      check.contains(legend, 'Markierter Wanderweg', 'Wegarten werden aufgeschlüsselt');
      check.contains(legend, 'Asphalt', 'Oberflächen werden aufgeschlüsselt');

      await page.check('#opt-show-paved');
      await page.waitForTimeout(400);
      check.ok(await page.locator('path[stroke="#2b2b2b"]').count() > 0,
        'Asphaltabschnitte erscheinen auf der Karte');

      /* ---- Hinweise ---- */
      await page.waitForSelector('#section-warnings:not([hidden])', { timeout: 5000 });
      const warnings = (await page.locator('#warning-list li').allTextContents()).join(' | ');
      check.contains(warnings, 'Gehweg', 'Straße ohne Gehweg wird gemeldet');
      check.contains(warnings, 'Gelände', 'Schwieriges Gelände wird gemeldet');

      /* ---- Varianten ---- */
      await page.waitForSelector('#section-alternatives:not([hidden])', { timeout: 10000 });
      const altCount = await page.locator('#alternative-list li').count();
      check.ok(altCount >= 2, 'Mehrere Varianten werden angeboten', `${altCount} gefunden`);

      await page.locator('#alternative-list li').nth(1).click();
      await page.waitForTimeout(900);
      const active = await page.locator('#alternative-list li.active').textContent();
      check.contains(active, 'Variante 1', 'Gewählte Variante wird markiert');
      check.contains(await page.textContent('#stat-distance'), '4,9',
        'Länge wechselt auf die gewählte Variante');

      /* ---- Route ziehen ---- */
      await page.click('.tab[data-tab=planung]');
      const before = await page.locator('#point-list li:not(.list-empty)').count();
      const grab = await page.evaluate(() => {
        const hit = document.querySelector('#map path.route-draggable');
        if (!hit) return null;
        const pt = hit.getPointAtLength(hit.getTotalLength() / 2);
        const screen = pt.matrixTransform(hit.getScreenCTM());
        return { x: screen.x, y: screen.y };
      });
      check.ok(grab !== null, 'Die Route hat eine greifbare Linie');

      if (grab) {
        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        await page.mouse.move(grab.x + 140, grab.y + 25, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(1600);

        const after = await page.locator('#point-list li:not(.list-empty)').count();
        check.equal(after, before + 1, 'Ziehen fügt genau einen Zwischenpunkt ein');
        const nums = await page.locator('#point-list .point-num').allTextContents();
        check.equal(nums.join(','), '1,2,3',
          'Der neue Punkt liegt in der Mitte, nicht am Ende');
      }

      /* ---- Menü am gesetzten Punkt ---- */
      // Löschen ging vorher nur per Rechtsklick – am Handy also gar nicht.
      // Leaflet ordnet die Marker im DOM nach Breitengrad, nicht nach
      // Reihenfolge – deshalb über die angezeigte Nummer auswählen.
      const total = await page.locator('#point-list li:not(.list-empty)').count();
      const marker = (number) => page.locator('#map .route-marker')
        .filter({ hasText: new RegExp(`^${number}$`) });

      // Leaflet blendet ein geschlossenes Popup langsam aus – erst warten,
      // bis wirklich nur noch ein Menü im Dokument steht.
      const openPointMenu = async (number) => {
        await marker(number).click({ force: true });
        await page.waitForFunction(
          () => document.querySelectorAll('.map-menu').length === 1,
          null, { timeout: 4000 }
        );
      };

      await openPointMenu(2);
      const pointMenu = (await page.locator('.map-menu-item').allTextContents()).join(' | ');
      check.contains(pointMenu, 'löschen', 'Ein Punkt lässt sich per Klick löschen');
      check.contains(pointMenu, 'Startpunkt', 'Er lässt sich an den Anfang holen');
      check.contains(pointMenu, 'abschneiden',
        'Die Route lässt sich an einem mittleren Punkt kürzen');
      await page.keyboard.press('Escape');

      // Am letzten Punkt wäre „abschneiden“ sinnlos und fehlt deshalb.
      await openPointMenu(total);
      const lastMenu = (await page.locator('.map-menu-item').allTextContents()).join(' | ');
      check.ok(!lastMenu.includes('abschneiden'),
        'Am letzten Punkt fehlt das Abschneiden', `Menü: ${lastMenu} (von ${total} Punkten)`);
      await page.keyboard.press('Escape');

      /* ---- Reihenfolge per Pfeil ändern ---- */
      const labelsBefore = await page.locator('#point-list .item-label').allTextContents();
      await page.locator('#point-list li').last().locator('.point-up').click();
      await page.waitForTimeout(900);
      const labelsAfter = await page.locator('#point-list .item-label').allTextContents();
      check.equal(labelsAfter[labelsAfter.length - 2], labelsBefore[labelsBefore.length - 1],
        'Der Pfeil ▲ schiebt einen Punkt nach oben');
      check.ok(await page.locator('#point-list li').first().locator('.point-up')
        .isDisabled(), 'Beim obersten Punkt ist ▲ abgeschaltet');

      /* ---- Umkehren ---- */
      const firstBefore = await page.locator('#point-list li .item-label').first().textContent();
      await page.click('#btn-reverse');
      await page.waitForTimeout(900);
      const firstAfter = await page.locator('#point-list li .item-label').first().textContent();
      check.ok(firstBefore !== firstAfter, 'Umkehren dreht die Reihenfolge');

      /* ---- Rundtour-Generator ---- */
      // Der Router antwortet hier mit einer Schleife, die einen Stichweg
      // enthält – so wie es passiert, wenn ein Stützpunkt des gedachten
      // Kreises am Ende einer Sackgasse landet. Sobald der Generator den
      // störenden Punkt weglässt, kommt die saubere Schleife zurück.
      // Führt die Strecke durch die angefragten Stützpunkte. Beim dritten
      // Punkt geht sie hin und auf demselben Weg zurück – der Stichweg.
      const buildLoop = (waypoints, spurAt) => {
        const coordinates = [];
        const leg = (from, to) => {
          for (let s = 1; s <= 12; s++) {
            coordinates.push([
              from[0] + ((to[0] - from[0]) * s) / 12,
              from[1] + ((to[1] - from[1]) * s) / 12,
              600,
            ]);
          }
        };

        coordinates.push([...waypoints[0], 600]);
        for (let i = 0; i < waypoints.length - 1; i++) {
          if (i + 1 === spurAt) {
            leg(waypoints[i], waypoints[i + 1]);
            leg(waypoints[i + 1], waypoints[i]); // denselben Weg zurück
          } else {
            leg(waypoints[i], waypoints[i + 1]);
          }
        }
        return {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: { 'track-length': '8000' },
            geometry: { type: 'LineString', coordinates },
          }],
        };
      };

      const spurHandler = (route, request) => {
        const raw = decodeURIComponent(request.url().match(/lonlats=([^&]+)/)[1]);
        const waypoints = raw.split('|').map((p) => p.split(',').map(Number));
        // Der erste Anlauf schickt alle sieben Stützpunkte und bekommt den
        // Stichweg; danach ist der störende Punkt weg und die Schleife sauber.
        route.fulfill({ json: buildLoop(waypoints, waypoints.length >= 7 ? 3 : -1) });
      };
      await page.route('**/brouter.de/brouter?**', spurHandler);

      await page.click('#generator-panel summary');
      await page.fill('#gen-length', '8');
      await page.click('#btn-generate');
      await page.waitForTimeout(3500);
      const note = await page.textContent('#generator-note');
      check.contains(note, 'Rundtour über', 'Rundtour wird erzeugt');
      check.contains(note, 'Stichweg', 'Entfernte Stichwege werden benannt');
      const roundPoints = await page.locator('#point-list li:not(.list-empty)').count();
      check.ok(roundPoints >= 4, 'Die Rundtour besteht aus mehreren Punkten',
        `${roundPoints} Punkte`);
      check.ok(roundPoints < 7,
        'Der Punkt am Ende der Sackgasse ist nicht mehr dabei',
        `${roundPoints} statt 7 Punkten`);

      await page.unroute('**/brouter.de/brouter?**', spurHandler);

      // Zurück auf die übliche Teststrecke: Die Rundtour oben hat weder
      // Wegedaten noch ein abwechslungsreiches Höhenprofil, und beides
      // brauchen die folgenden Prüfungen zur Einfärbung.
      await page.click('#btn-clear');
      await page.waitForTimeout(600);
      await drawRoute(page);

      /* ---- Farbliche Darstellung ---- */
      const lineColors = () => page.evaluate(() =>
        [...document.querySelectorAll('#map path')]
          .map((p) => p.getAttribute('stroke'))
          .filter((c) => c && c !== 'none'));

      // Wie viele deutlich verschiedene Farbtöne im Höhenprofil vorkommen.
      // Graue Achsen und Beschriftung werden dabei übersprungen.
      const profileTones = () => page.evaluate(() => {
        const canvas = document.getElementById('elevation-chart');
        const ctx = canvas.getContext('2d');
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const tones = new Set();
        for (let i = 0; i < pixels.length; i += 4) {
          const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
          if (a < 200) continue;
          if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue;
          tones.add(`${r >> 4},${g >> 4},${b >> 4}`);
        }
        return tones.size;
      });

      await page.selectOption('#route-style', 'plain');
      await page.waitForTimeout(700);
      const plainTones = await profileTones();
      const plainColors = new Set(await lineColors());
      check.ok(plainColors.has('#c0392b'), 'Einfarbig zeichnet die Route in einer Farbe');
      check.equal(await page.locator('.route-legend').count(), 0,
        'Einfarbig zeigt keine Legende');

      await page.selectOption('#route-style', 'slope');
      await page.waitForTimeout(600);
      const slopeColors = new Set(await lineColors());
      check.ok(slopeColors.size >= 2, 'Nach Steigung wird mehrfarbig gezeichnet',
        `${slopeColors.size} Farben`);
      check.equal(await page.locator('.route-legend').count(), 1,
        'Eine Legende erscheint auf der Karte');
      check.equal(await page.locator('.legend-gradient').count(), 1,
        'Die Steigung wird als Farbverlauf erklärt');
      const axis = await page.locator('.legend-axis span').allTextContents();
      check.ok(axis.length === 3 && axis.join(' ').includes('%'),
        'Der Verlauf ist mit Prozentwerten beschriftet', axis.join(' '));
      check.contains(await page.textContent('.legend-range'), 'Diese Route',
        'Die tatsächliche Spanne der Tour wird genannt');
      check.ok(slopeColors.size >= 4, 'Die Abstufung ist fein',
        `${slopeColors.size} Farben`);

      // Das Höhenprofil muss dieselbe Sprache sprechen wie die Karte.
      const slopeTones = await profileTones();
      check.ok(slopeTones > plainTones,
        'Das Höhenprofil übernimmt die Farben der Route',
        `einfarbig ${plainTones}, nach Steigung ${slopeTones} Farbtöne`);
      check.ok(slopeTones >= 4, 'Auch im Profil ist die Abstufung fein',
        `${slopeTones} Farbtöne`);

      /* ---- Kontrast: Kontur unter der Route ---- */
      const strokes = (selector) => page.evaluate((sel) =>
        [...document.querySelectorAll(sel)].map((p) => ({
          color: p.getAttribute('stroke'),
          width: Number(p.getAttribute('stroke-width')),
          opacity: Number(p.getAttribute('stroke-opacity') || 1),
        })), selector);

      const casings = await strokes('#map path.route-casing');
      const lines = await strokes('#map path.route-line');
      check.equal(casings.length, 1, 'Unter der Route liegt genau eine Kontur');
      check.ok(lines.length >= 2, 'Die farbigen Teilstücke liegen darüber',
        `${lines.length} Stücke`);

      const thinnest = Math.min(...lines.map((s) => s.width));
      check.ok(thinnest >= 6, 'Die Routenlinie ist kräftig genug', `${thinnest} px`);
      check.ok(casings[0].width > thinnest + 2,
        'Die Kontur steht auf beiden Seiten über',
        `Kontur ${casings[0].width} px, Linie ${thinnest} px`);
      check.ok(lines.every((s) => s.opacity === 1),
        'Die Farben werden deckend gezeichnet, damit die Karte sie nicht aufhellt');
      check.ok(casings[0].color !== lines[0].color,
        'Die Kontur hebt sich von der Linie ab');

      await page.selectOption('#route-style', 'surface');
      await page.waitForTimeout(600);
      const surfaceLegend = await page.locator('.route-legend .legend-row').allTextContents();
      check.ok(surfaceLegend.length >= 2, 'Nach Wegbedingungen erscheint eine Legende',
        surfaceLegend.join(' | '));
      check.ok(surfaceLegend.some((t) => t.includes('Wanderweg') || t.includes('Pfad')),
        'Die Legende nennt Wegarten');
      check.ok(await page.locator('#router-note').isHidden(),
        'Solange die Wegedaten da sind, steht kein Hinweis in der Leiste');
      const surfaceColors = await page.locator('#map path.route-line')
        .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('stroke')))]);
      check.ok(surfaceColors.length >= 2,
        'Die Route wird tatsächlich in mehreren Farben gezeichnet',
        surfaceColors.join(' '));
      check.ok(!surfaceColors.every((c) => c.toLowerCase() === '#c0392b'),
        'Und nicht durchgehend in der Farbe der einfarbigen Darstellung');

      /* ---- Rundkurs: Wegedaten dürfen nicht verloren gehen ---- */
      // Hin- und Rückweg werden zu einer Strecke zusammengesetzt. Die
      // Wegedaten beider Teile blieben dabei liegen – ein Rundkurs hatte
      // deshalb weder Einfärbung noch Aufschlüsselung noch Warnliste,
      // während dieselbe Strecke ohne Rundkurs alles hatte.
      await page.check('#opt-roundtrip');
      await page.waitForTimeout(1800);
      check.ok(await page.locator('#router-note').isHidden(),
        'Auch der Rundkurs bringt Wegedaten mit');
      const roundLegend = await page.locator('.route-legend .legend-row').allTextContents();
      check.ok(roundLegend.length >= 2,
        'Der Rundkurs wird nach Wegbedingungen eingefärbt',
        roundLegend.join(' | '));

      await page.click('.tab[data-tab=analyse]');
      await page.waitForTimeout(600);
      check.ok(await page.locator('#section-waytypes').isVisible(),
        'Und die Aufschlüsselung bleibt gefüllt');
      check.contains(
        (await page.locator('.waytype-legend li').allTextContents()).join(' | '),
        'Wanderweg', 'Mit denselben Wegarten wie sonst');

      await page.click('.tab[data-tab=planung]');
      await page.uncheck('#opt-roundtrip');
      await page.waitForTimeout(1600);

      /* ---- Ohne BRouter: der Grund muss dastehen ---- */
      // Genau der Fall aus der Praxis: BRouter fällt aus, OSRM springt ein –
      // und liefert keine Wegedaten. Bisher stand in der Legende nur, dass
      // welche fehlen, nicht warum.
      await page.unroute('**/brouter.de/brouter?**');
      await page.route('**/brouter.de/brouter?**', (route) => route.abort());
      await page.click('#btn-clear');
      await page.waitForTimeout(400);
      await drawRoute(page);
      await page.waitForTimeout(1200);

      const routerNote = page.locator('#router-note');
      check.ok(!(await routerNote.isHidden()),
        'Fehlen die Wegedaten, steht der Grund neben der Auswahl');
      const noteText = await routerNote.textContent();
      check.contains(noteText, 'OSRM', 'Der Hinweis nennt den Ersatzrouter');
      check.contains(noteText, 'BRouter', 'Und wer eigentlich zuständig wäre');
      check.contains(await page.textContent('.route-legend'), 'OSRM',
        'Auch die Legende auf der Karte nennt den Grund');

      // Zurück auf BRouter: der Hinweis muss wieder verschwinden.
      await page.unroute('**/brouter.de/brouter?**');
      // Mit demselben Mitzähler wie am Anfang: Playwright bedient die zuletzt
      // gesetzte Route zuerst, ein Stub ohne Zähler würde die Zählung
      // stillschweigend einfrieren.
      await stubExternals(page, { onBrouterRequest: (url) => brouterUrls.push(url) });
      await page.click('#btn-clear');
      await page.waitForTimeout(400);
      await drawRoute(page);
      await page.waitForTimeout(1200);
      check.ok(await routerNote.isHidden(),
        'Mit BRouter verschwindet der Hinweis wieder');

      /* ---- Eigener BRouter im Heimnetz ---- */
      // Ein nachgebauter eigener Dienst unter anderer Adresse. Er muss
      // genauso bedient werden wie der öffentliche – sonst nützt die
      // Einstellung nichts.
      let ownCalls = 0;
      let ownProfileCalls = 0;
      await page.route('**/brouter.example/**', (route, request) => {
        const url = request.url();
        if (url.includes('/profile')) {
          ownProfileCalls++;
          return route.fulfill({ json: { profileid: 'eigenes-profil' } });
        }
        ownCalls++;
        const alt = Number((url.match(/alternativeidx=(\d+)/) || [, '0'])[1]);
        route.fulfill({ json: defaultRoute(alt) });
      });

      await openSettings(page, 'routing');
      await page.fill('#brouter-url', 'https://brouter.example/brouter');
      await page.dispatchEvent('#brouter-url', 'change');
      await page.waitForTimeout(300);
      check.contains(await page.textContent('#brouter-note'), 'brouter.example',
        'Die eingetragene Adresse wird bestätigt');

      await page.click('#btn-test-brouter');
      await page.waitForTimeout(1200);
      const testNote = await page.textContent('#brouter-note');
      check.contains(testNote, '✓', 'Die Verbindungsprüfung meldet Erfolg');
      check.contains(testNote, 'Profile', 'Und ob eigene Profile angenommen werden');

      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      const brouterDeBefore = brouterUrls.length;
      await page.click('#btn-clear');
      await page.waitForTimeout(400);
      await drawRoute(page);
      await page.waitForTimeout(1400);

      check.ok(ownCalls > 0, 'Die Route kommt vom eigenen Dienst', `${ownCalls} Aufrufe`);
      check.ok(ownProfileCalls > 0, 'Auch das Profil geht dorthin');
      check.equal(brouterUrls.length, brouterDeBefore,
        'Der öffentliche Dienst wird dabei nicht mehr gefragt');
      check.ok(await page.locator('#router-note').isHidden(),
        'Mit dem eigenen Dienst gibt es nichts zu beanstanden');

      // Die Adresse muss einen Neustart überstehen.
      await page.reload();
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(800);
      await openSettings(page, 'routing');
      check.equal(await page.locator('#brouter-url').inputValue(),
        'https://brouter.example/brouter', 'Die Adresse bleibt gespeichert');

      // Zurücksetzen führt wieder zum öffentlichen Dienst.
      await page.click('#btn-reset-brouter');
      await page.waitForTimeout(400);
      check.equal(await page.locator('#brouter-url').inputValue(), '',
        'Der Knopf leert das Feld');
      check.contains(await page.textContent('#brouter-note'), 'brouter.de',
        'Und sagt, dass wieder der öffentliche Dienst zählt');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);

      const publicBefore = brouterUrls.length;
      // Nach dem Neuladen ist die Planung leer – dann gibt es nichts zu leeren.
      if (await page.locator('#btn-clear').isEnabled()) {
        await page.click('#btn-clear');
        await page.waitForTimeout(400);
      }
      await drawRoute(page);
      await page.waitForTimeout(1400);
      check.ok(brouterUrls.length > publicBefore,
        'Danach fragt die App wieder brouter.de');

      // Die Wahl muss einen Neustart überstehen.
      await page.reload();
      await page.waitForSelector('#map.leaflet-container');
      await page.waitForTimeout(700);
      check.equal(await page.locator('#route-style').inputValue(), 'surface',
        'Die gewählte Darstellung bleibt gespeichert');

      check.equal(errors.length, 0, 'Keine Skriptfehler',
        errors.join(' | '));
    } finally {
      await browser.close();
      server.stop();
    }
  },
};
