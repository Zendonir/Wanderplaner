'use strict';

/**
 * Färbt die geplante Route ein – wahlweise einfarbig, nach Steigung oder
 * nach Wegbeschaffenheit.
 *
 * Ergebnis ist jeweils eine Liste von Teilstücken mit Farbe, die die
 * Kartenansicht als einzelne Linien zeichnet. Aufeinanderfolgende Stücke
 * gleicher Farbe werden zusammengefasst, damit nicht hunderte winziger
 * Linien entstehen.
 */
const RouteStyle = {
  PLAIN_COLOR: '#c0392b',

  MODES: {
    plain: 'Einfarbig',
    slope: 'Nach Steigung',
    surface: 'Nach Wegbedingungen',
  },

  /**
   * Stützpunkte der Steigungsfarbe. Zwischen ihnen wird stufenlos
   * überblendet: bergab kühl, flach grün, bergauf warm bis rot.
   */
  SLOPE_RAMP: [
    { at: -25, rgb: [23, 48, 105] },
    { at: -15, rgb: [44, 92, 156] },
    { at: -8, rgb: [110, 160, 205] },
    { at: -3, rgb: [168, 205, 224] },
    { at: 0, rgb: [74, 154, 92] },
    { at: 3, rgb: [163, 196, 84] },
    { at: 8, rgb: [224, 195, 65] },
    { at: 15, rgb: [224, 138, 46] },
    { at: 25, rgb: [192, 57, 43] },
  ],

  // Die Steigung wird auf halbe Prozentpunkte gerundet. Feiner sieht das
  // Auge ohnehin nicht, und es hält die Zahl der Teilstücke im Rahmen –
  // eine eigene Linie je Stützpunkt wäre für lange Touren zu viel.
  SLOPE_STEP: 0.5,

  // Über wie viele Meter die Steigung gemittelt wird. Ohne Glättung
  // schwankt sie durch Ungenauigkeiten der Höhendaten stark.
  SLOPE_WINDOW_M: 80,

  /**
   * Erzeugt die farbigen Teilstücke.
   * @param {string} mode  plain | slope | surface
   * @param {Array<[number,number]>} coordinates [lng, lat]
   * @param {?number[]} elevations Höhe je Koordinate
   * @param {?Array} segments Wegabschnitte mit OSM-Tags (aus BRouter)
   * @param {?string} engine Welcher Router die Strecke berechnet hat
   * @returns {{sections: Array<{coordinates:Array, color:string}>,
   *            legend: Array<{color:string, label:string}>, note: ?string}}
   */
  build(mode, coordinates, elevations, segments, engine) {
    if (!coordinates || coordinates.length < 2) {
      return { sections: [], legend: [], scale: null, note: null };
    }

    if (mode === 'slope') {
      if (!elevations || elevations.length !== coordinates.length) {
        return {
          sections: this._single(coordinates, this.PLAIN_COLOR),
          legend: [],
          scale: null,
          note: 'Ohne Höhenwerte lässt sich die Steigung nicht darstellen.',
        };
      }
      return this._bySlope(coordinates, elevations);
    }

    if (mode === 'surface') {
      if (!segments || segments.length === 0) {
        return {
          sections: this._single(coordinates, this.PLAIN_COLOR),
          legend: [],
          scale: null,
          // Den Grund nennen, nicht nur die Folge: „keine Wegedaten“ allein
          // ließ offen, ob die App etwas falsch macht oder schlicht nichts
          // bekommen hat – und wenn ja, von wem nicht.
          note: this.missingDataReason(engine),
        };
      }
      return this._bySurface(coordinates, segments);
    }

    return {
      sections: this._single(coordinates, this.PLAIN_COLOR),
      legend: [], scale: null, note: null,
    };
  },

  _single(coordinates, color) {
    return [{ coordinates: coordinates.slice(), color }];
  },

  /**
   * Erklärt, warum es zu einer Route keine Wegedaten gibt. Die Antwort hängt
   * daran, welcher Router sie berechnet hat – nur BRouter liefert die
   * OSM-Merkmale der Wege mit.
   */
  missingDataReason(engine) {
    if (engine === 'osrm') {
      return 'Diese Route stammt vom Ersatzrouter OSRM, weil BRouter nicht ' +
        'erreichbar war. OSRM liefert keine Wegedaten – ohne sie lässt sich ' +
        'die Strecke nicht nach Wegbedingungen einfärben.';
    }
    if (engine === 'brouter') {
      return 'BRouter hat diese Route ohne Wegedaten zurückgegeben. Ein neuer ' +
        'Versuch (Route einmal neu berechnen lassen) hilft meist.';
    }
    return 'Für diese Route liegen keine Wegedaten vor (nur mit BRouter verfügbar).';
  },

  /* ---------- Nach Steigung ---------- */

  /** Farbe für eine Steigung in Prozent, stufenlos aus der Rampe. */
  slopeColor(percent) {
    const ramp = this.SLOPE_RAMP;
    if (percent <= ramp[0].at) return this._hex(ramp[0].rgb);
    if (percent >= ramp[ramp.length - 1].at) return this._hex(ramp[ramp.length - 1].rgb);

    for (let i = 1; i < ramp.length; i++) {
      if (percent > ramp[i].at) continue;
      const a = ramp[i - 1];
      const b = ramp[i];
      const t = (percent - a.at) / (b.at - a.at);
      return this._hex([
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
      ]);
    }
    return this._hex(ramp[ramp.length - 1].rgb);
  },

  _hex(rgb) {
    return '#' + rgb.map((v) => Math.max(0, Math.min(255, v))
      .toString(16).padStart(2, '0')).join('');
  },

  _bySlope(coordinates, elevations) {
    // Abstände und Gesamtstrecke bis zu jedem Punkt.
    const cum = [0];
    for (let i = 1; i < coordinates.length; i++) {
      cum.push(cum[i - 1] + Utils.haversine(
        { lat: coordinates[i - 1][1], lng: coordinates[i - 1][0] },
        { lat: coordinates[i][1], lng: coordinates[i][0] }
      ));
    }

    const colors = [];
    const used = [];

    for (let i = 1; i < coordinates.length; i++) {
      // Fenster um das aktuelle Teilstück suchen, damit einzelne
      // Ausreißer der Höhendaten nicht durchschlagen.
      // (Steigungen werden anschließend auf SLOPE_STEP gerundet.)
      const target = this.SLOPE_WINDOW_M / 2;
      let from = i - 1;
      let to = i;
      while (from > 0 && cum[i] - cum[from] < target) from--;
      while (to < coordinates.length - 1 && cum[to] - cum[i - 1] < target) to++;

      const run = cum[to] - cum[from];
      const rise = elevations[to] - elevations[from];
      const percent = run > 1 ? (rise / run) * 100 : 0;

      const stepped = Math.round(percent / this.SLOPE_STEP) * this.SLOPE_STEP;
      colors.push(this.slopeColor(stepped));
      used.push(stepped);
    }

    return {
      sections: this._group(coordinates, colors),
      legend: [],
      // Statt einzelner Klassen ein Farbverlauf mit Skala – bei stufenloser
      // Färbung wäre eine Liste von Farbfeldern sinnlos lang.
      scale: this._slopeScale(used),
      note: null,
    };
  },

  /**
   * Beschreibt den Farbverlauf für die Legende: Verlaufsdefinition plus
   * die Spanne, die auf dieser Route tatsächlich vorkommt.
   */
  _slopeScale(values) {
    const min = Math.min(...values);
    const max = Math.max(...values);

    // Anzeigebereich auf glatte Werte runden, mindestens ±5 %. Über das Ende
    // der Farbrampe hinaus hat die Achse keinen Sinn – dort ändert sich die
    // Farbe nicht mehr, die Skala würde also mehr Auflösung vortäuschen.
    const rampMax = this.SLOPE_RAMP[this.SLOPE_RAMP.length - 1].at;
    const needed = Math.ceil(Math.max(Math.abs(min), Math.abs(max)) / 5) * 5;
    const bound = Math.min(rampMax, Math.max(5, needed));

    const stops = [];
    for (let i = 0; i <= 20; i++) {
      const percent = -bound + (2 * bound * i) / 20;
      stops.push({ offset: i / 20, color: this.slopeColor(percent) });
    }

    return {
      title: 'Steigung',
      stops,
      min: -bound,
      max: bound,
      // Die tatsächlich vorkommende Spanne, damit die Zahlen zur Tour passen.
      actualMin: min,
      actualMax: max,
    };
  },

  /* ---------- Nach Wegbeschaffenheit ---------- */

  /** Aufsummierte Streckenlänge bis zu jedem Geometriepunkt, in Metern. */
  _cumulative(coordinates) {
    const cum = [0];
    for (let i = 1; i < coordinates.length; i++) {
      cum.push(cum[i - 1] + Utils.haversine(
        { lat: coordinates[i - 1][1], lng: coordinates[i - 1][0] },
        { lat: coordinates[i][1], lng: coordinates[i][0] }
      ));
    }
    return cum;
  },

  /**
   * Ordnet jedem Geometriepunkt die OSM-Tags des dort gültigen Wegabschnitts
   * zu und liefert eine Nachschlagefunktion `(index) => tags`.
   *
   * Zwei Wege dorthin, in dieser Reihenfolge:
   *
   *  1. Über die Länge. Der Router nennt zu jedem Abschnitt, wie lang er ist;
   *     aneinandergereiht ergeben die Längen die Strecke. Das braucht keine
   *     Koordinaten und ist deshalb unempfindlich dagegen, ob und wie der
   *     Router sie mitschickt.
   *  2. Über die Koordinaten, falls die Längen fehlen oder nicht zur Strecke
   *     passen: Die Koordinate eines Abschnitts markiert dessen Ende.
   *
   * Zuvor lag nur Weg 2 vor. Fehlten die Koordinatenspalten in der Antwort,
   * ließ sich kein einziger Abschnitt verorten und die Route wurde
   * stillschweigend wieder einfarbig gezeichnet – obwohl die Wegedaten selbst
   * vollständig da waren und die Aufschlüsselung sie auch auswertete.
   *
   * @returns {?{tagsAt: function(number): object, via: string}}
   */
  _surfaceLookup(coordinates, segments) {
    const cum = this._cumulative(coordinates);
    const total = cum[cum.length - 1];

    /* ---- Weg 1: über die Längen ---- */
    const lengths = segments.map((s) => Number(s.length));
    const sum = lengths.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    if (lengths.every((l) => Number.isFinite(l) && l > 0) && sum > 0 && total > 0
        // Kleine Abweichungen sind normal – der Router misst auf der
        // ungeglätteten Geometrie. Grobe Abweichungen heißen dagegen, dass
        // die Längen nicht zu dieser Strecke gehören.
        && Math.abs(sum - total) / total < 0.25) {
      const scale = total / sum;
      const ends = [];
      let running = 0;
      lengths.forEach((l) => { running += l * scale; ends.push(running); });

      let k = 0;
      const byIndex = coordinates.map((_, i) => {
        while (k < segments.length - 1 && ends[k] < cum[i]) k++;
        return segments[k].tags || {};
      });
      return { tagsAt: (i) => byIndex[Math.min(Math.max(i, 0), byIndex.length - 1)], via: 'länge' };
    }

    /* ---- Weg 2: über die Koordinaten ---- */
    const marks = [];
    for (const segment of segments) {
      if (segment.lat == null || segment.lng == null) continue;
      if (!Number.isFinite(segment.lat) || !Number.isFinite(segment.lng)) continue;
      marks.push({
        index: this._nearestIndex(coordinates, segment.lat, segment.lng),
        tags: segment.tags || {},
      });
    }
    if (marks.length === 0) return null;
    marks.sort((a, b) => a.index - b.index);

    let m = 0;
    const byIndex = coordinates.map((_, i) => {
      while (m < marks.length - 1 && marks[m].index < i) m++;
      return marks[m].tags;
    });
    return { tagsAt: (i) => byIndex[Math.min(Math.max(i, 0), byIndex.length - 1)], via: 'koordinaten' };
  },

  _surfaceColor(tags) {
    const category = WayTypes.CATEGORIES.find((c) => c.test(tags));
    return category ? category.color : '#b0b6ac';
  },

  _surfaceLabel(tags) {
    const category = WayTypes.CATEGORIES.find((c) => c.test(tags));
    return category ? category.label : 'Sonstige';
  },

  _bySurface(coordinates, segments) {
    const lookup = this._surfaceLookup(coordinates, segments);
    if (!lookup) {
      return {
        sections: this._single(coordinates, this.PLAIN_COLOR),
        legend: [],
        scale: null,
        note: 'Die Wegabschnitte ließen sich der Strecke nicht zuordnen.',
      };
    }

    const colors = [];
    const usedLabels = new Map();

    for (let i = 1; i < coordinates.length; i++) {
      const tags = lookup.tagsAt(i);
      const color = this._surfaceColor(tags);
      colors.push(color);
      usedLabels.set(color, this._surfaceLabel(tags));
    }

    return {
      sections: this._group(coordinates, colors),
      // Reihenfolge wie in der Aufschlüsselung, damit beides zusammenpasst.
      legend: WayTypes.CATEGORIES
        .filter((c) => usedLabels.has(c.color))
        .map((c) => ({ color: c.color, label: c.label }))
        .concat(usedLabels.has('#b0b6ac')
          ? [{ color: '#b0b6ac', label: 'Sonstige' }] : []),
      scale: null,
      // Nur eine Farbe heißt: Die Wegedaten sind da, sie sagen aber überall
      // dasselbe. Ohne diesen Hinweis sieht das aus wie „einfarbig“ und
      // wirkt wie ein Fehler.
      note: usedLabels.size === 1
        ? `Die ganze Route läuft über denselben Wegetyp (${[...usedLabels.values()][0]}).`
        : null,
    };
  },

  /* ---------- Farben für das Höhenprofil ---------- */

  /**
   * Farbe je Stützpunkt des Höhenprofils, damit das Diagramm dieselbe
   * Sprache spricht wie die Linie auf der Karte.
   *
   * Zurückgegeben wird die Farbe des Stücks, das *zu* einem Stützpunkt
   * führt; der erste Eintrag wiederholt den zweiten, damit die Länge zur
   * Datenreihe passt.
   *
   * @param {string} mode plain | slope | surface
   * @param {Array<{lat:number,lng:number,dist:number,ele:?number}>} samples
   * @param {?Array<[number,number]>} coordinates Routengeometrie [lng, lat]
   * @param {?Array} segments Wegabschnitte mit OSM-Tags
   * @returns {?string[]} null, wenn einfarbig gezeichnet werden soll
   */
  sampleColors(mode, samples, coordinates, segments) {
    if (!samples || samples.length < 2) return null;

    if (mode === 'slope') {
      if (samples.some((s) => s.ele == null)) return null;
      // Die Stützpunkte liegen bereits mindestens 50 m auseinander – die
      // Steigung zwischen ihnen ist damit von sich aus geglättet.
      const colors = samples.map((sample, i) => {
        if (i === 0) return null;
        const run = sample.dist - samples[i - 1].dist;
        const rise = sample.ele - samples[i - 1].ele;
        const percent = run > 1 ? (rise / run) * 100 : 0;
        return this.slopeColor(Math.round(percent / this.SLOPE_STEP) * this.SLOPE_STEP);
      });
      colors[0] = colors[1];
      return colors;
    }

    if (mode === 'surface') {
      if (!coordinates || !segments || segments.length === 0) return null;
      // Dieselbe Zuordnung wie auf der Karte – sonst zeigten Linie und
      // Diagramm an derselben Stelle verschiedene Wegetypen an.
      const lookup = this._surfaceLookup(coordinates, segments);
      if (!lookup) return null;

      const colors = samples.map((sample) => this._surfaceColor(
        lookup.tagsAt(this._nearestIndex(coordinates, sample.lat, sample.lng))
      ));
      colors[0] = colors[1];
      return colors;
    }

    return null;
  },

  /** Hex-Farbe mit Deckkraft, für die Fläche unter dem Höhenprofil. */
  fade(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  },

  /** Index des Geometriepunkts, der einer Position am nächsten liegt. */
  _nearestIndex(coordinates, lat, lng) {
    const cosLat = Math.cos((lat * Math.PI) / 180);
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < coordinates.length; i++) {
      const dLat = coordinates[i][1] - lat;
      const dLng = (coordinates[i][0] - lng) * cosLat;
      const d = dLat * dLat + dLng * dLng;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  },

  /**
   * Fasst gleichfarbige Teilstücke zusammen. Benachbarte Stücke teilen sich
   * einen Punkt, damit keine Lücken in der Linie entstehen.
   * @param {Array} coordinates
   * @param {string[]} colors je Teilstück (Länge = coordinates.length - 1)
   */
  _group(coordinates, colors) {
    const sections = [];
    let current = { coordinates: [coordinates[0]], color: colors[0] };

    for (let i = 1; i < coordinates.length; i++) {
      const color = colors[i - 1];
      if (color !== current.color) {
        // Der letzte Punkt des alten Stücks ist zugleich der erste des
        // neuen – so schließen die Linien ohne Lücke aneinander an, ohne
        // dass ein Punkt doppelt in derselben Linie landet.
        sections.push(current);
        current = { coordinates: [coordinates[i - 1]], color };
      }
      current.coordinates.push(coordinates[i]);
    }
    sections.push(current);

    return sections.filter((s) => s.coordinates.length >= 2);
  },
};
