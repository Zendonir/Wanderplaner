'use strict';

/**
 * Sucht Gruppen offener Stempelstellen, die dicht genug beieinander liegen,
 * um an einem Tag zusammen abgelaufen zu werden – und schlägt für jede
 * Gruppe einen Startpunkt vor.
 *
 * Die Längenangabe ist eine Schätzung aus der optimierten Reihenfolge
 * (Luftlinie plus Zuschlag), keine Routenberechnung: Für einen Vorschlag
 * genügt die Größenordnung, und es kostet keine Anfrage an den Router.
 */
const Clusters = {
  // Erfahrungswert: echte Wege sind rund 30 % länger als die Luftlinie.
  DETOUR_FACTOR: 1.3,

  /**
   * @param {Array} stamps sichtbare Stempelstellen
   * @param {Array} parking bekannte Parkplätze
   * @param {number} maxKm gewünschte Obergrenze der Rundenlänge
   * @returns {Array<{stamps:Array, start:?object, lengthKm:number, center:object}>}
   */
  find(stamps, parking, maxKm = 12) {
    const open = stamps.filter((s) => !s.collected);
    if (open.length === 0) return [];

    // Radius, in dem Stempel noch zur selben Runde gehören: Die Runde führt
    // hin und zurück, also etwa ein Drittel der Ziellänge als Ausdehnung.
    const radiusM = (maxKm * 1000) / 3;

    const remaining = new Set(open.map((s) => s.id));
    const byId = new Map(open.map((s) => [s.id, s]));
    const groups = [];

    while (remaining.size > 0) {
      // Ausgangspunkt: der Stempel mit den meisten Nachbarn – so entstehen
      // volle Gruppen statt vieler Einzelstücke.
      let seed = null;
      let bestCount = -1;
      for (const id of remaining) {
        const stamp = byId.get(id);
        let count = 0;
        for (const otherId of remaining) {
          if (Utils.haversine(stamp, byId.get(otherId)) <= radiusM) count++;
        }
        if (count > bestCount) {
          bestCount = count;
          seed = stamp;
        }
      }

      const group = [];
      for (const id of [...remaining]) {
        if (Utils.haversine(seed, byId.get(id)) <= radiusM) {
          group.push(byId.get(id));
          remaining.delete(id);
        }
      }

      if (group.length >= 2) groups.push(group);
    }

    return groups
      .map((group) => this._describe(group, parking, maxKm))
      .filter(Boolean)
      .sort((a, b) => b.stamps.length - a.stamps.length);
  },

  /** Ergänzt eine Gruppe um Startpunkt, geschätzte Länge und Mittelpunkt. */
  _describe(group, parking, maxKm) {
    const center = {
      lat: group.reduce((sum, s) => sum + s.lat, 0) / group.length,
      lng: group.reduce((sum, s) => sum + s.lng, 0) / group.length,
    };

    // Nächstgelegener Parkplatz als Startvorschlag.
    let start = null;
    let bestDist = Infinity;
    (parking || []).forEach((place) => {
      const d = Utils.haversine(center, place);
      if (d < bestDist) {
        bestDist = d;
        start = place;
      }
    });
    // Parkplätze weit außerhalb helfen nicht.
    if (start && bestDist > maxKm * 1000) start = null;

    const ordered = this.order(group, start);
    const lengthM = this._roundLength(ordered, start);
    const lengthKm = lengthM / 1000;

    // Gruppen, die deutlich über der Wunschlänge liegen, sind kein Vorschlag.
    if (lengthKm > maxKm * 1.35) return null;

    return {
      stamps: ordered,
      start,
      startDistance: start ? bestDist : null,
      lengthKm,
      center,
    };
  },

  /** Besuchsreihenfolge, beginnend beim Startpunkt (falls vorhanden). */
  order(group, start) {
    if (!start) return Utils.optimizeOrder(group);
    // Den Startpunkt mit optimieren und danach wieder entfernen, damit die
    // Reihenfolge wirklich am Parkplatz beginnt.
    const withStart = Utils.optimizeOrder([
      { lat: start.lat, lng: start.lng, __start: true },
      ...group,
    ]);
    const index = withStart.findIndex((p) => p.__start);
    const rotated = withStart.slice(index + 1).concat(withStart.slice(0, index));
    return rotated.filter((p) => !p.__start);
  },

  /** Geschätzte Länge der Runde inklusive Rückweg zum Start. */
  _roundLength(ordered, start) {
    if (ordered.length === 0) return 0;
    let total = 0;
    const from = start || ordered[0];

    total += Utils.haversine(from, ordered[0]);
    for (let i = 1; i < ordered.length; i++) {
      total += Utils.haversine(ordered[i - 1], ordered[i]);
    }
    total += Utils.haversine(ordered[ordered.length - 1], from);

    return total * this.DETOUR_FACTOR;
  },
};
