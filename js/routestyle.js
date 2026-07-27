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
   * Steigungsklassen. Bergauf warm, bergab kühl, flach grün – so ist auf
   * einen Blick erkennbar, wo es zieht.
   */
  SLOPE_CLASSES: [
    { max: -15, color: '#2c5c9c', label: 'steil bergab (über 15 %)' },
    { max: -8, color: '#5b8ac4', label: 'bergab 8–15 %' },
    { max: -3, color: '#9dc0e0', label: 'leicht bergab 3–8 %' },
    { max: 3, color: '#4a9a5c', label: 'flach (unter 3 %)' },
    { max: 8, color: '#e0c341', label: 'leicht bergauf 3–8 %' },
    { max: 15, color: '#e08a2e', label: 'bergauf 8–15 %' },
    { max: Infinity, color: '#c0392b', label: 'steil bergauf (über 15 %)' },
  ],

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
      return { sections: [], legend: [], note: null };
    }

    if (mode === 'slope') {
      if (!elevations || elevations.length !== coordinates.length) {
        return {
          sections: this._single(coordinates, this.PLAIN_COLOR),
          legend: [],
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
          note: 'Für diese Route liegen keine Wegedaten vor (nur mit BRouter verfügbar).',
        };
      }
      return this._bySurface(coordinates, segments);
    }

    return { sections: this._single(coordinates, this.PLAIN_COLOR), legend: [], note: null };
  },

  _single(coordinates, color) {
    return [{ coordinates: coordinates.slice(), color }];
  },

  /* ---------- Nach Steigung ---------- */

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
    const used = new Set();

    for (let i = 1; i < coordinates.length; i++) {
      // Fenster um das aktuelle Teilstück suchen, damit einzelne
      // Ausreißer der Höhendaten nicht durchschlagen.
      const target = this.SLOPE_WINDOW_M / 2;
      let from = i - 1;
      let to = i;
      while (from > 0 && cum[i] - cum[from] < target) from--;
      while (to < coordinates.length - 1 && cum[to] - cum[i - 1] < target) to++;

      const run = cum[to] - cum[from];
      const rise = elevations[to] - elevations[from];
      const percent = run > 1 ? (rise / run) * 100 : 0;

      const cls = this.SLOPE_CLASSES.find((c) => percent < c.max)
        || this.SLOPE_CLASSES[this.SLOPE_CLASSES.length - 1];
      colors.push(cls.color);
      used.add(cls.color);
    }

    return {
      sections: this._group(coordinates, colors),
      legend: this.SLOPE_CLASSES
        .filter((c) => used.has(c.color))
        .map((c) => ({ color: c.color, label: c.label })),
      note: null,
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
      note: null,
    };
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
