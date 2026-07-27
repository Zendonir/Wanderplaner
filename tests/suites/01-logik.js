'use strict';

/**
 * Prüft die reine Rechenlogik ohne Browser: QR-Code, Sonnenzeiten,
 * Wegetyp-Auswertung, Stempelgruppen und Fortschritt.
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../helpers');

/** Lädt Module der App in einer minimalen Browser-Attrappe. */
function loadModules(names) {
  const store = new Map();
  const sandbox = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    console,
    TextEncoder,
    Date,
    Math,
    JSON,
    document: { createElementNS: () => ({ setAttribute() {}, appendChild() {} }) },
  };

  const sources = names
    .map((n) => fs.readFileSync(path.join(ROOT, 'js', `${n}.js`), 'utf8'))
    .join('\n');

  const factory = new Function(
    ...Object.keys(sandbox),
    `${sources}\n return { ${names.map((n) => moduleName(n)).join(', ')} };`
  );
  return factory(...Object.values(sandbox));
}

/** Dateiname → Name der Modulkonstante. */
function moduleName(file) {
  const map = {
    utils: 'Utils', qrcode: 'QRCode', daylight: 'Daylight', nearby: 'Nearby',
    waytypes: 'WayTypes', clusters: 'Clusters', progress: 'Progress',
    maplinks: 'MapLinks', tracks: 'Tracks',
  };
  return map[file] || file;
}

module.exports = {
  name: 'Logik (ohne Browser)',

  async run(check) {
    const { Utils, QRCode, Daylight, Nearby, WayTypes, Clusters, Progress, MapLinks } =
      loadModules(['utils', 'qrcode', 'daylight', 'nearby', 'waytypes', 'clusters',
                   'progress', 'maplinks']);

    /* ---- QR-Code: gegen einen unabhängigen Decoder ---- */
    const jsQR = require('jsqr');
    const toImage = (matrix, scale = 3) => {
      const quiet = 4;
      const total = (matrix.size + quiet * 2) * scale;
      const data = new Uint8ClampedArray(total * total * 4).fill(255);
      for (let y = 0; y < matrix.size; y++) {
        for (let x = 0; x < matrix.size; x++) {
          if (!matrix.modules[y][x]) continue;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const i = (((y + quiet) * scale + dy) * total + (x + quiet) * scale + dx) * 4;
              data[i] = data[i + 1] = data[i + 2] = 0;
            }
          }
        }
      }
      return { data, width: total, height: total };
    };

    const qrCases = [
      'https://maps.apple.com/?ll=51.799990,10.612340&q=Wanderparkplatz',
      'geo:51.8,10.6',
      'Umlaute: Höhenweg Käsealm Größe Fußweg äöüß',
      'x'.repeat(213),
    ];
    let qrOk = 0;
    for (const text of qrCases) {
      const img = toImage(QRCode.encode(text));
      const decoded = jsQR(img.data, img.width, img.height);
      if (decoded && decoded.data === text) qrOk++;
    }
    check.equal(qrOk, qrCases.length, 'QR-Codes sind mit jsQR wieder lesbar');

    let overflow = false;
    try { QRCode.encode('y'.repeat(214)); } catch (err) { overflow = true; }
    check.ok(overflow, 'Zu langer Inhalt wird als Fehler gemeldet');

    /* ---- Sonnenzeiten: gegen SunCalc ---- */
    const SunCalc = require('suncalc');
    let maxDiff = 0;
    for (const [lat, lng] of [[51.7991, 10.6156], [52.52, 13.405], [47.42, 10.98]]) {
      for (const [month, day] of [[0, 15], [5, 21], [8, 15], [11, 21]]) {
        const mine = Daylight.times(new Date(2025, month, day), lat, lng);
        const ref = SunCalc.getTimes(new Date(2025, month, day, 12), lat, lng);
        maxDiff = Math.max(
          maxDiff,
          Math.abs(mine.sunrise - ref.sunrise) / 60000,
          Math.abs(mine.sunset - ref.sunset) / 60000
        );
      }
    }
    check.ok(maxDiff < 1.5, 'Sonnenzeiten decken sich mit SunCalc',
      `größte Abweichung ${maxDiff.toFixed(2)} min`);

    const polar = Daylight.times(new Date(2025, 5, 21), 78.2, 15.6);
    check.ok(polar.polarDay, 'Polartag wird erkannt');

    const dark = Daylight.check(new Date(2025, 11, 15, 14, 0), 4.5, { lat: 51.8, lng: 10.6 });
    check.equal(dark.level, 'dark', 'Zu späte Winterwanderung wird als „dunkel“ gemeldet');
    const fine = Daylight.check(new Date(2025, 6, 15, 9, 0), 4.5, { lat: 51.8, lng: 10.6 });
    check.equal(fine.level, 'ok', 'Sommerwanderung am Vormittag ist unkritisch');

    /* ---- Abstand zur Route ---- */
    const line = [];
    for (let i = 0; i <= 20; i++) line.push([10.60, 51.80 + i * 0.0006]);
    const near = Nearby.alongRoute(
      [
        { id: 'a', name: 'am Weg', lat: 51.8020, lng: 10.6010 },
        { id: 'b', name: 'weiter weg', lat: 51.8050, lng: 10.6045 },
        { id: 'c', name: 'Berlin', lat: 52.5, lng: 13.4 },
      ],
      line, 500
    );
    check.equal(near.length, 2, 'Umkreissuche findet nur die nahen Punkte');
    check.ok(near[0].detour < near[1].detour, 'Treffer sind nach Position sortiert');

    /* ---- Wegetypen ---- */
    const segments = [
      { length: 1600, lat: 51.801, lng: 10.6, tags: { highway: 'path', surface: 'ground', route_hiking_rwn: 'yes' } },
      { length: 1200, lat: 51.804, lng: 10.6, tags: { highway: 'track', surface: 'compacted' } },
      { length: 700, lat: 51.807, lng: 10.6, tags: { highway: 'tertiary', surface: 'asphalt' } },
      { length: 500, lat: 51.809, lng: 10.6, tags: { highway: 'path', sac_scale: 'alpine_hiking' } },
    ];
    const analysis = WayTypes.analyse(segments);
    check.equal(analysis.total, 4000, 'Gesamtlänge der Abschnitte stimmt');
    check.equal(analysis.types[0].key, 'marked', 'Markierter Wanderweg ist der größte Anteil');
    check.ok(Math.abs(analysis.types[0].share - 0.4) < 0.01, 'Anteil wird richtig berechnet');

    const warnings = WayTypes.warnings(segments);
    check.equal(warnings.length, 2, 'Straße ohne Gehweg und schweres Gelände werden gemeldet');

    const paved = WayTypes.pavedSections(segments);
    check.ok(paved.length === 1 && paved[0].length >= 2,
      'Einzelner Asphaltabschnitt ergibt eine zeichenbare Linie');

    /* ---- Stempelgruppen ---- */
    const stamps = [];
    // Nest 1: fünf Stempel eng beieinander
    for (let i = 0; i < 5; i++) {
      stamps.push({ id: `n1-${i}`, name: `Nest1-${i}`, collected: false,
        lat: 51.80 + i * 0.004, lng: 10.60 + (i % 2) * 0.004 });
    }
    // Nest 2: drei Stempel 30 km entfernt
    for (let i = 0; i < 3; i++) {
      stamps.push({ id: `n2-${i}`, name: `Nest2-${i}`, collected: false,
        lat: 52.10 + i * 0.004, lng: 10.90 });
    }
    // Bereits erledigt – darf nicht vorgeschlagen werden
    stamps.push({ id: 'done', name: 'Erledigt', collected: true, lat: 51.802, lng: 10.601 });

    const parking = [{ id: 'p1', name: 'Parkplatz Mitte', lat: 51.806, lng: 10.602 }];
    const groups = Clusters.find(stamps, parking, 12);
    check.ok(groups.length >= 2, 'Zwei getrennte Stempel-Nester werden gefunden',
      `gefunden: ${groups.length}`);
    check.ok(groups.every((g) => g.stamps.every((s) => !s.collected)),
      'Erledigte Stempel tauchen in keinem Vorschlag auf');
    check.ok(groups[0].start && groups[0].start.name === 'Parkplatz Mitte',
      'Nächstgelegener Parkplatz wird als Start vorgeschlagen');
    check.ok(groups[0].lengthKm > 0 && groups[0].lengthKm < 12 * 1.35,
      'Geschätzte Rundenlänge bleibt im gewünschten Rahmen',
      `${groups[0].lengthKm.toFixed(1)} km`);

    /* ---- Fortschritt ---- */
    const progressStamps = [
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `c${i}`, collected: true, name: `S${i}`,
        collectedAt: new Date(2025, 5, 1).toISOString(),
      })),
      ...Array.from({ length: 20 }, (_, i) => ({ id: `o${i}`, collected: false, name: `O${i}` })),
    ];
    const summary = Progress.summary(progressStamps);
    check.equal(summary.collected, 30, 'Erhaltene Stempel werden gezählt');
    check.equal(summary.current.label, 'Silber', 'Aktuelle Stufe ist Silber');
    check.equal(summary.next.label, 'Gold', 'Nächste Stufe ist Gold');
    check.equal(summary.remaining, 20, 'Rest bis Gold wird berechnet');

    /* ---- Karten-Links ---- */
    const apple = MapLinks.build({ lat: 51.8, lng: 10.6, name: 'Test' }, 'apple', 'show');
    check.contains(apple, 'maps.apple.com', 'Apple-Karten-Link wird erzeugt');
    const drive = MapLinks.build({ lat: 51.8, lng: 10.6 }, 'google', 'drive');
    check.contains(drive, 'daddr=', 'Navigations-Link enthält Ziel');

    /* ---- Reihenfolge-Optimierung ---- */
    const messy = [
      { lat: 51.80, lng: 10.60 }, { lat: 51.90, lng: 10.60 },
      { lat: 51.82, lng: 10.60 }, { lat: 51.88, lng: 10.60 },
    ];
    const ordered = Utils.optimizeOrder(messy);
    const lengthOf = (pts) => pts.slice(1).reduce(
      (sum, p, i) => sum + Utils.haversine(pts[i], p), 0);
    check.ok(lengthOf(ordered) <= lengthOf(messy),
      'Optimierte Reihenfolge ist nicht länger als die ursprüngliche');

    /* ---- Der Service Worker muss alle Programmdateien kennen ---- */
    // Ein vergessener Eintrag fällt sonst erst offline auf, wo die App dann
    // mit „… is not defined“ abbricht.
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const referenced = [...html.matchAll(/src="((?:js|vendor)\/[^"]+)"/g)].map((m) => m[1]);
    const missing = referenced.filter((file) => !sw.includes(file));
    check.equal(missing.length, 0,
      'Alle eingebundenen Skripte stehen in der Offline-Liste des Service Workers',
      missing.join(', '));

    const cssMissing = !sw.includes('css/style.css');
    check.ok(!cssMissing, 'Auch das Stylesheet steht in der Offline-Liste');
  },
};
