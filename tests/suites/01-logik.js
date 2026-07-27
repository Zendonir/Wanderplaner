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
    maplinks: 'MapLinks', tracks: 'Tracks', routestyle: 'RouteStyle',
    roundtrip: 'RoundTrip',
  };
  return map[file] || file;
}

module.exports = {
  name: 'Logik (ohne Browser)',

  async run(check) {
    const { Utils, QRCode, Daylight, Nearby, WayTypes, Clusters, Progress, MapLinks,
            RouteStyle, Tracks, RoundTrip } =
      loadModules(['utils', 'qrcode', 'daylight', 'nearby', 'waytypes', 'clusters',
                   'progress', 'maplinks', 'routestyle', 'tracks', 'roundtrip']);

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

    /* ---- Farbige Darstellung der Route ---- */
    // Strecke mit flachem Anfang, wechselnd steilem Anstieg und Abstieg –
    // eine exakt gleichmäßige Steigung ergäbe nur eine einzige Farbe und
    // würde die Abstufung nicht prüfen.
    const routeCoords = [];
    const routeEle = [];
    let height = 600;
    for (let i = 0; i <= 60; i++) {
      routeCoords.push([10.60, 51.80 + i * 0.0009]);
      routeEle.push(height);
      // Steigung schwankt: flach, dann zunehmend steiler bergauf, dann bergab.
      const slope = i < 15 ? 0.5
        : i < 38 ? 4 + (i - 15) * 0.9
        : -6 - (i - 38) * 0.7;
      height += slope; // je Stützpunkt rund 100 m Strecke
    }

    const plain = RouteStyle.build('plain', routeCoords, routeEle, null);
    check.equal(plain.sections.length, 1, 'Einfarbig ergibt genau ein Teilstück');
    check.equal(plain.legend.length, 0, 'Einfarbig braucht keine Legende');

    const slope = RouteStyle.build('slope', routeCoords, routeEle, null);
    const slopeColors = new Set(slope.sections.map((s) => s.color));
    check.ok(slopeColors.size >= 4, 'Nach Steigung entstehen viele Farbabstufungen',
      `${slopeColors.size} Farben in ${slope.sections.length} Abschnitten`);
    // Bei stufenloser Skala hat 0,5 % nicht exakt dieselbe Farbe wie 0 % –
    // geprüft wird deshalb die Eigenschaft, nicht der Hexwert.
    const isGreenish = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return g > r && g > b;
    };
    check.ok(isGreenish(slope.sections[0].color), 'Flacher Anfang ist grün',
      slope.sections[0].color);
    check.ok(slope.scale && slope.scale.stops.length > 10,
      'Die Legende beschreibt einen Farbverlauf statt fester Klassen');
    check.equal(slope.legend.length, 0, 'Es gibt keine Klassenliste mehr');
    check.ok(slope.scale.actualMax > 10 && slope.scale.actualMin < -5,
      'Die Skala nennt die tatsächliche Spanne der Route',
      `${slope.scale.actualMin} bis ${slope.scale.actualMax} %`);
    // Die Achse darf nicht über die Farbrampe hinausgehen – dort ändert
    // sich die Farbe nicht mehr.
    const rampEnd = RouteStyle.SLOPE_RAMP[RouteStyle.SLOPE_RAMP.length - 1].at;
    check.ok(slope.scale.max <= rampEnd,
      'Die Achse endet dort, wo die Farbrampe endet',
      `Achse bis ${slope.scale.max} %, Rampe bis ${rampEnd} %`);

    // Die Farbrampe muss stufenlos und richtig herum verlaufen.
    check.equal(RouteStyle.slopeColor(0), '#4a9a5c', 'Ebene Strecke ist grün');
    const uphill = [2, 5, 9, 14, 20].map((p) => RouteStyle.slopeColor(p));
    check.equal(new Set(uphill).size, uphill.length,
      'Jede Steigung bekommt einen eigenen Farbwert');
    const red = (hex) => parseInt(hex.slice(1, 3), 16);
    const blue = (hex) => parseInt(hex.slice(5, 7), 16);
    check.ok(red(uphill[4]) > red(uphill[0]),
      'Je steiler bergauf, desto röter');
    const downhill = [-2, -6, -12, -20].map((p) => RouteStyle.slopeColor(p));
    check.ok(blue(downhill[3]) > blue(RouteStyle.slopeColor(0)),
      'Bergab wird kühler dargestellt');
    // Zwischenwerte müssen echt interpoliert sein, nicht auf Stützpunkte springen.
    const between = RouteStyle.slopeColor(5.5);
    check.ok(between !== RouteStyle.slopeColor(3) && between !== RouteStyle.slopeColor(8),
      'Zwischen den Stützpunkten wird überblendet');
    // Extremwerte dürfen nicht aus der Rampe laufen.
    check.equal(RouteStyle.slopeColor(80), RouteStyle.slopeColor(25),
      'Sehr steile Werte werden auf das Rampenende begrenzt');
    check.equal(RouteStyle.slopeColor(-80), RouteStyle.slopeColor(-25),
      'Das gilt auch nach unten');

    // Ohne Höhenwerte darf es nicht abstürzen, sondern muss es erklären.
    const noEle = RouteStyle.build('slope', routeCoords, null, null);
    check.equal(noEle.sections.length, 1, 'Ohne Höhen wird einfarbig gezeichnet');
    check.contains(noEle.note, 'Steigung', 'Der Grund wird genannt');

    const styleSegments = [
      { length: 1600, lat: 51.809, lng: 10.60, tags: { highway: 'path', route_hiking_rwn: 'yes' } },
      { length: 1200, lat: 51.827, lng: 10.60, tags: { highway: 'track' } },
      { length: 700, lat: 51.845, lng: 10.60, tags: { highway: 'tertiary' } },
    ];
    const surface = RouteStyle.build('surface', routeCoords, routeEle, styleSegments);
    check.ok(surface.sections.length >= 2,
      'Nach Wegbedingungen entstehen mehrere Abschnitte',
      `${surface.sections.length} Abschnitte`);
    check.ok(surface.legend.some((l) => l.label.includes('Markierter')),
      'Die Legende nennt die vorkommenden Wegarten');
    check.ok(surface.sections.every((s) => s.coordinates.length >= 2),
      'Jedes Teilstück hat mindestens zwei Punkte');

    // Alle Teilstücke zusammen müssen die Strecke lückenlos abdecken.
    const covered = surface.sections.reduce((sum, s) => sum + s.coordinates.length - 1, 0);
    check.equal(covered, routeCoords.length - 1,
      'Die Teilstücke decken die Strecke lückenlos ab');

    const noSegments = RouteStyle.build('surface', routeCoords, routeEle, null);
    check.contains(noSegments.note, 'Wegedaten', 'Fehlende Wegedaten werden erklärt');

    /* ---- Dieselben Farben im Höhenprofil ---- */
    // Stützpunkte, wie sie das Höhenprofil verwendet: Position, gelaufene
    // Strecke und Höhe.
    const profileSamples = routeCoords.map((c, i) => ({
      lat: c[1], lng: c[0], dist: i * 100, ele: routeEle[i],
    }));

    check.equal(RouteStyle.sampleColors('plain', profileSamples, routeCoords, null), null,
      'Einfarbig lässt das Profil unverändert');

    const profileSlope = RouteStyle.sampleColors('slope', profileSamples, routeCoords, null);
    check.equal(profileSlope.length, profileSamples.length,
      'Für jeden Stützpunkt gibt es eine Farbe');
    check.ok(profileSlope.every((c) => /^#[0-9a-f]{6}$/.test(c)),
      'Alle Profilfarben sind gültige Farbwerte');
    check.ok(new Set(profileSlope).size >= 4,
      'Das Profil ist genauso fein abgestuft wie die Karte',
      `${new Set(profileSlope).size} Farben`);
    check.ok(isGreenish(profileSlope[0]), 'Der flache Anfang ist auch im Profil grün',
      profileSlope[0]);
    check.ok(red(profileSlope[30]) > red(profileSlope[5]),
      'Der steile Teil ist im Profil röter als der flache');
    // Die Farbe des steilsten Stücks muss zur Kartenfarbe derselben Steigung passen.
    const steepIndex = 30;
    const steepPercent = (profileSamples[steepIndex].ele - profileSamples[steepIndex - 1].ele)
      / (profileSamples[steepIndex].dist - profileSamples[steepIndex - 1].dist) * 100;
    check.equal(profileSlope[steepIndex],
      RouteStyle.slopeColor(Math.round(steepPercent / RouteStyle.SLOPE_STEP) * RouteStyle.SLOPE_STEP),
      'Profil und Karte nutzen dieselbe Farbrampe');

    const noEleSamples = profileSamples.map((s) => ({ ...s, ele: null }));
    check.equal(RouteStyle.sampleColors('slope', noEleSamples, routeCoords, null), null,
      'Ohne Höhen bleibt das Profil einfarbig');

    const profileSurface = RouteStyle.sampleColors(
      'surface', profileSamples, routeCoords, styleSegments
    );
    check.equal(profileSurface.length, profileSamples.length,
      'Auch nach Wegart bekommt jeder Stützpunkt eine Farbe');
    const surfaceUsed = new Set(profileSurface);
    check.ok(surfaceUsed.size >= 2, 'Das Profil zeigt die Wegarten unterschiedlich',
      [...surfaceUsed].join(' '));
    const mapSurfaceColors = new Set(surface.sections.map((s) => s.color));
    check.ok([...surfaceUsed].every((c) => mapSurfaceColors.has(c)),
      'Die Profilfarben stammen aus derselben Palette wie die Karte');
    check.equal(RouteStyle.sampleColors('surface', profileSamples, routeCoords, null), null,
      'Ohne Wegedaten bleibt das Profil einfarbig');

    check.equal(RouteStyle.fade('#4a9a5c', 0.35), 'rgba(74, 154, 92, 0.35)',
      'Die Fläche unter dem Profil nutzt dieselbe Farbe, nur blasser');

    /* ---- Hinterlegte Spur auf Stützpunkte eindampfen ---- */
    // Eine dichte Spur mit einer klaren Kehre – die muss erhalten bleiben.
    const dense = [];
    for (let i = 0; i < 200; i++) dense.push({ lat: 51.80 + i * 0.0002, lng: 10.60 });
    for (let i = 0; i < 200; i++) dense.push({ lat: 51.84, lng: 10.60 + i * 0.0002 });
    const thinned = Tracks.simplify(dense, 120);
    check.ok(thinned.length >= 3 && thinned.length <= 25,
      'Aus einer dichten Spur werden wenige Stützpunkte', `${thinned.length} Punkte`);
    check.equal(thinned[0].lat, dense[0].lat, 'Der Startpunkt bleibt erhalten');
    check.equal(thinned[thinned.length - 1].lng, dense[dense.length - 1].lng,
      'Der Endpunkt bleibt erhalten');
    check.ok(thinned.some((p) => Math.abs(p.lat - 51.84) < 1e-4 && Math.abs(p.lng - 10.60) < 1e-4),
      'Die Kehre bleibt als Stützpunkt erhalten');

    /* ---- Stichwege in einer Rundtour erkennen ---- */
    // Nachgebaute Schleife: von West nach Ost, dazwischen ein Abstecher nach
    // Norden und auf demselben Weg zurück – genau der Dorn, der beim
    // Rundtour-Generator entsteht, wenn ein Stützpunkt in einer Sackgasse
    // landet.
    const loop = [];
    const push = (lat, lng) => loop.push([lng, lat]);
    for (let i = 0; i <= 20; i++) push(51.80, 10.60 + i * 0.0012);      // Hinweg
    for (let i = 1; i <= 12; i++) push(51.80 + i * 0.0009, 10.624);     // Abstecher hin
    for (let i = 11; i >= 0; i--) push(51.80 + i * 0.0009, 10.624);     // und zurück
    for (let i = 1; i <= 20; i++) push(51.80 - i * 0.0009, 10.624 - i * 0.0012);
    for (let i = 1; i <= 20; i++) push(51.782 + i * 0.0009, 10.60);     // zurück zum Start

    const abzweigung = { lat: 51.8108, lng: 10.624 };  // Spitze des Abstechers
    const amWeg = { lat: 51.80, lng: 10.612 };         // ganz normal am Hinweg

    const spurPoints = [
      { lat: 51.80, lng: 10.60 },
      amWeg,
      abzweigung,
      { lat: 51.782, lng: 10.60 },
      { lat: 51.80, lng: 10.60 },
    ];
    const spurs = RoundTrip.findSpurs(spurPoints, loop);
    check.equal(spurs.length, 1, 'Genau ein Stichweg wird erkannt',
      `gefunden: ${JSON.stringify(spurs)}`);
    check.equal(spurs[0], 2, 'Und zwar der Punkt am Ende der Sackgasse');
    check.ok(!spurs.includes(1),
      'Ein Punkt mitten auf der Strecke gilt nicht als Stichweg');

    // Start und Ziel dürfen nie entfallen, auch wenn sie aufeinanderliegen.
    check.ok(!spurs.includes(0) && !spurs.includes(spurPoints.length - 1),
      'Start und Ziel bleiben unangetastet');

    // Eine saubere Schleife ohne Abstecher darf nichts auslösen.
    const sauber = [];
    for (let i = 0; i <= 20; i++) sauber.push([10.60 + i * 0.0012, 51.80]);
    for (let i = 1; i <= 20; i++) sauber.push([10.624 - i * 0.0012, 51.80 - i * 0.0009]);
    for (let i = 1; i <= 20; i++) sauber.push([10.60, 51.782 + i * 0.0009]);
    check.equal(
      RoundTrip.findSpurs([
        { lat: 51.80, lng: 10.60 }, { lat: 51.80, lng: 10.612 },
        { lat: 51.791, lng: 10.612 }, { lat: 51.80, lng: 10.60 },
      ], sauber).length,
      0, 'Eine Schleife ohne Abstecher bleibt unverändert');

    // Ein sehr kurzer Versatz ist kein Dorn – etwa eine kleine Wendeschleife.
    const kurz = [];
    for (let i = 0; i <= 20; i++) kurz.push([10.60 + i * 0.0012, 51.80]);
    for (let i = 1; i <= 3; i++) kurz.push([10.624, 51.80 + i * 0.0002]);
    for (let i = 2; i >= 0; i--) kurz.push([10.624, 51.80 + i * 0.0002]);
    for (let i = 1; i <= 20; i++) kurz.push([10.624 - i * 0.0012, 51.80 - i * 0.0009]);
    for (let i = 1; i <= 20; i++) kurz.push([10.60, 51.782 + i * 0.0009]);
    check.equal(
      RoundTrip.findSpurs([
        { lat: 51.80, lng: 10.60 }, { lat: 51.8006, lng: 10.624 },
        { lat: 51.782, lng: 10.60 }, { lat: 51.80, lng: 10.60 },
      ], kurz).length,
      0, 'Ein sehr kurzer Versatz zählt nicht als Stichweg');

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
