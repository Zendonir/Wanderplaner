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
   * @returns {{sections: Array<{coordinates:Array, color:string}>,
   *            legend: Array<{color:string, label:string}>, note: ?string}}
   */
  build(mode, coordinates, elevations, segments) {
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
          note: 'Für diese Route liegen keine Wegedaten vor (nur mit BRouter verfügbar).',
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

  _bySurface(coordinates, segments) {
    // Jeden Wegabschnitt auf der Geometrie verorten: Die Koordinate eines
    // Abschnitts markiert dessen Ende.
    const marks = [];
    for (const segment of segments) {
      if (segment.lat == null || segment.lng == null) continue;
      marks.push({
        index: this._nearestIndex(coordinates, segment.lat, segment.lng),
        tags: segment.tags,
      });
    }
    if (marks.length === 0) {
      return {
        sections: this._single(coordinates, this.PLAIN_COLOR),
        legend: [],
        scale: null,
        note: 'Die Wegabschnitte ließen sich der Strecke nicht zuordnen.',
      };
    }
    marks.sort((a, b) => a.index - b.index);

    const colorFor = (tags) => {
      const category = WayTypes.CATEGORIES.find((c) => c.test(tags));
      return category ? category.color : '#b0b6ac';
    };
    const labelFor = (tags) => {
      const category = WayTypes.CATEGORIES.find((c) => c.test(tags));
      return category ? category.label : 'Sonstige';
    };

    const colors = [];
    const usedLabels = new Map();
    let markIndex = 0;

    for (let i = 1; i < coordinates.length; i++) {
      // Zum nächsten Abschnitt weiterrücken, sobald er erreicht ist.
      while (markIndex < marks.length - 1 && marks[markIndex].index < i) markIndex++;
      const tags = marks[markIndex].tags;
      colors.push(colorFor(tags));
      usedLabels.set(colorFor(tags), labelFor(tags));
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
      note: null,
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
      const marks = segments
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({
          index: this._nearestIndex(coordinates, s.lat, s.lng),
          tags: s.tags,
        }))
        .sort((a, b) => a.index - b.index);
      if (marks.length === 0) return null;

      const colors = samples.map((sample) => {
        // Den Stützpunkt auf der Geometrie verorten und den Wegabschnitt
        // nehmen, der dort gilt.
        const index = this._nearestIndex(coordinates, sample.lat, sample.lng);
        const mark = marks.find((m) => m.index >= index) || marks[marks.length - 1];
        const category = WayTypes.CATEGORIES.find((c) => c.test(mark.tags));
        return category ? category.color : '#b0b6ac';
      });
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
