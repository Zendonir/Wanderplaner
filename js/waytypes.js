'use strict';

/**
 * Wertet die Wegabschnitte einer berechneten Route aus: Welche Wegarten und
 * Oberflächen kommen vor, und wo lauern Stellen, die man vorher wissen will
 * (schwieriges Gelände, kaum sichtbare Pfade, Straßen ohne Gehweg)?
 *
 * Damit lässt sich prüfen, ob die eingestellte Gewichtung wirklich greift.
 */
const WayTypes = {
  /**
   * Wegarten zu Gruppen zusammengefasst, in der Reihenfolge, in der sie
   * angezeigt werden. `test` bekommt die OSM-Tags eines Abschnitts.
   */
  CATEGORIES: [
    {
      key: 'marked',
      label: 'Markierter Wanderweg',
      color: '#2f6b3f',
      test: (t) => Boolean(
        t.route_hiking_iwn || t.route_hiking_nwn || t.route_hiking_rwn ||
        t.route_hiking_lwn || t.route_foot_iwn || t.route_foot_nwn ||
        t.route_foot_rwn || t.route_foot_lwn
      ),
    },
    {
      key: 'path',
      label: 'Pfad / Fußweg',
      color: '#5c9c6b',
      test: (t) => ['path', 'footway', 'steps', 'bridleway'].includes(t.highway),
    },
    {
      key: 'track',
      label: 'Forst- / Feldweg',
      color: '#a9863f',
      test: (t) => t.highway === 'track',
    },
    {
      key: 'quiet',
      label: 'Ruhige Straße',
      color: '#c98b3a',
      test: (t) => ['living_street', 'service', 'pedestrian', 'residential', 'unclassified']
        .includes(t.highway),
    },
    {
      key: 'road',
      label: 'Landstraße oder größer',
      color: '#c0392b',
      test: (t) => ['tertiary', 'secondary', 'primary', 'trunk', 'motorway']
        .some((h) => (t.highway || '').startsWith(h)),
    },
  ],

  /** Oberflächen, gebündelt auf das, was beim Gehen zählt. */
  SURFACES: [
    {
      key: 'paved',
      label: 'Asphalt / Beton',
      color: '#6b7568',
      values: ['asphalt', 'concrete', 'paved', 'concrete:plates', 'concrete:lanes'],
    },
    {
      key: 'stone',
      label: 'Pflaster / Schotter',
      color: '#9aa294',
      values: ['paving_stones', 'sett', 'cobblestone', 'unhewn_cobblestone',
               'gravel', 'compacted', 'fine_gravel', 'pebblestone'],
    },
    {
      key: 'natural',
      label: 'Natur (Erde, Gras, Fels)',
      color: '#7a9c5c',
      values: ['ground', 'dirt', 'earth', 'grass', 'mud', 'sand', 'rock',
               'woodchips', 'unpaved'],
    },
  ],

  /**
   * Fasst die Abschnitte zusammen.
   * @param {Array<{length:number, tags:object}>} segments
   * @returns {?{total:number, types:Array, surfaces:Array, unknownSurface:number}}
   */
  analyse(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return null;

    const typeTotals = new Map();
    const surfaceTotals = new Map();
    let total = 0;
    let unknownSurface = 0;

    for (const seg of segments) {
      total += seg.length;

      const category = this.CATEGORIES.find((c) => c.test(seg.tags));
      const key = category ? category.key : 'other';
      typeTotals.set(key, (typeTotals.get(key) || 0) + seg.length);

      const surfaceValue = seg.tags.surface;
      const surface = this.SURFACES.find((s) => s.values.includes(surfaceValue));
      if (surface) {
        surfaceTotals.set(surface.key, (surfaceTotals.get(surface.key) || 0) + seg.length);
      } else if (surfaceValue) {
        surfaceTotals.set('other', (surfaceTotals.get('other') || 0) + seg.length);
      } else {
        // Ohne surface-Tag lässt sich nichts sagen – ehrlich ausweisen,
        // statt es stillschweigend einer Gruppe zuzuschlagen.
        unknownSurface += seg.length;
      }
    }

    if (total === 0) return null;

    const toList = (totals, definitions) => {
      const list = definitions
        .filter((d) => totals.has(d.key))
        .map((d) => ({
          key: d.key,
          label: d.label,
          color: d.color,
          length: totals.get(d.key),
          share: totals.get(d.key) / total,
        }));
      if (totals.has('other')) {
        list.push({
          key: 'other',
          label: 'Sonstige',
          color: '#b0b6ac',
          length: totals.get('other'),
          share: totals.get('other') / total,
        });
      }
      return list.sort((a, b) => b.length - a.length);
    };

    return {
      total,
      types: toList(typeTotals, this.CATEGORIES),
      surfaces: toList(surfaceTotals, this.SURFACES),
      unknownSurface,
    };
  },

  /**
   * Sammelt Abschnitte, die eine Vorwarnung verdienen, und fasst
   * aufeinanderfolgende gleiche Befunde zusammen.
   * @returns {Array<{kind:string, label:string, length:number, lat:?number, lng:?number}>}
   */
  warnings(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return [];

    const checks = [
      {
        kind: 'sac',
        test: (t) => ['demanding_mountain_hiking', 'alpine_hiking',
                      'demanding_alpine_hiking', 'difficult_alpine_hiking']
          .includes(t.sac_scale),
        label: (t) => `Anspruchsvolles Gelände (${t.sac_scale})`,
      },
      {
        kind: 'visibility',
        test: (t) => ['bad', 'horrible', 'no'].includes(t.trail_visibility),
        label: (t) => `Weg kaum erkennbar (trail_visibility=${t.trail_visibility})`,
      },
      {
        kind: 'road',
        test: (t) => ['tertiary', 'secondary', 'primary', 'trunk']
          .some((h) => (t.highway || '').startsWith(h)) && !t.sidewalk,
        label: (t) => `Straße ohne ausgewiesenen Gehweg (${t.highway})`,
      },
      {
        kind: 'ford',
        test: (t) => t.ford && t.ford !== 'no',
        label: () => 'Furt – Bachdurchquerung',
      },
    ];

    const found = [];
    for (const seg of segments) {
      const hit = checks.find((c) => c.test(seg.tags));
      if (!hit) continue;

      const label = hit.label(seg.tags);
      const last = found[found.length - 1];
      // Gleiche Warnung direkt hintereinander zu einem Eintrag bündeln.
      if (last && last.label === label) {
        last.length += seg.length;
      } else {
        found.push({
          kind: hit.kind,
          label,
          length: seg.length,
          lat: seg.lat,
          lng: seg.lng,
        });
      }
    }
    return found;
  },

  /**
   * Liefert die Teilstücke der Route, die auf Asphalt oder größeren Straßen
   * verlaufen – zum Hervorheben auf der Karte.
   * @returns {Array<Array<[number,number]>>} Linienzüge in [lng, lat]
   */
  pavedSections(segments) {
    if (!Array.isArray(segments)) return [];

    const isPaved = (t) =>
      ['asphalt', 'concrete', 'paved'].includes(t.surface) ||
      ['tertiary', 'secondary', 'primary', 'trunk'].some((h) => (t.highway || '').startsWith(h));

    // Die Koordinate eines Abschnitts markiert dessen Ende. Für eine Linie
    // wird deshalb auch der Punkt davor gebraucht – sonst verschwindet ein
    // einzeln stehender Asphaltabschnitt, weil er nur einen Punkt hätte.
    const sections = [];
    let current = null;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.lat == null || seg.lng == null) continue;

      if (isPaved(seg.tags)) {
        if (!current) {
          current = [];
          const previous = segments[i - 1];
          if (previous && previous.lat != null) {
            current.push([previous.lng, previous.lat]);
          }
        }
        current.push([seg.lng, seg.lat]);
      } else if (current) {
        // Bis zum Beginn des nächsten Abschnitts weiterzeichnen.
        current.push([seg.lng, seg.lat]);
        if (current.length > 1) sections.push(current);
        current = null;
      }
    }
    if (current && current.length > 1) sections.push(current);
    return sections;
  },
};
