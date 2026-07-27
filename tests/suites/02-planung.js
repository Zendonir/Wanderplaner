'use strict';

/**
 * Routenplanung im Browser: Punkte setzen, Route ziehen, umkehren,
 * Varianten wählen, Wegebeschaffenheit und Hinweise.
 */
const { startServer, launchBrowser, stubExternals, drawRoute } = require('../helpers');

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
      await drawRoute(page);

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

      /* ---- Umkehren ---- */
      const firstBefore = await page.locator('#point-list li .item-label').first().textContent();
      await page.click('#btn-reverse');
      await page.waitForTimeout(900);
      const firstAfter = await page.locator('#point-list li .item-label').first().textContent();
      check.ok(firstBefore !== firstAfter, 'Umkehren dreht die Reihenfolge');

      /* ---- Rundtour-Generator ---- */
      await page.click('#generator-panel summary');
      await page.fill('#gen-length', '8');
      await page.click('#btn-generate');
      await page.waitForTimeout(2500);
      const note = await page.textContent('#generator-note');
      check.contains(note, 'Rundtour über', 'Rundtour wird erzeugt');
      check.ok(await page.locator('#point-list li:not(.list-empty)').count() >= 6,
        'Die Rundtour besteht aus mehreren Punkten');

      /* ---- Farbliche Darstellung ---- */
      const lineColors = () => page.evaluate(() =>
        [...document.querySelectorAll('#map path')]
          .map((p) => p.getAttribute('stroke'))
          .filter((c) => c && c !== 'none'));

      await page.selectOption('#route-style', 'plain');
      await page.waitForTimeout(500);
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
      const slopeLegend = await page.locator('.route-legend .legend-row').count();
      check.ok(slopeLegend >= 2, 'Die Legende nennt die Steigungsklassen',
        `${slopeLegend} Einträge`);

      await page.selectOption('#route-style', 'surface');
      await page.waitForTimeout(600);
      const surfaceLegend = await page.locator('.route-legend .legend-row').allTextContents();
      check.ok(surfaceLegend.length >= 2, 'Nach Wegbedingungen erscheint eine Legende',
        surfaceLegend.join(' | '));
      check.ok(surfaceLegend.some((t) => t.includes('Wanderweg') || t.includes('Pfad')),
        'Die Legende nennt Wegarten');

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
