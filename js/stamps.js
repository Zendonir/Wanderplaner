'use strict';

/**
 * Stempelstellen: GPX-Import, dauerhafte Speicherung im localStorage
 * und Zusammenführen mit bereits vorhandenen Stempelstellen.
 */
const Stamps = {
  STORAGE_KEY: 'wanderplaner.stempelstellen',
  DUPLICATE_RADIUS_M: 30,

  /** Lädt die gespeicherten Stempelstellen (leere Liste bei Erststart). */
  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data.stamps)) return [];
      return data.stamps.filter(
        (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)
      );
    } catch (err) {
      console.warn('Stempelstellen konnten nicht geladen werden:', err);
      return [];
    }
  },

  save(stamps) {
    try {
      localStorage.setItem(
        this.STORAGE_KEY,
        JSON.stringify({ version: 1, stamps })
      );
    } catch (err) {
      console.warn('Stempelstellen konnten nicht gespeichert werden:', err);
    }
  },

  /**
   * Liest alle <wpt>-Einträge aus einer GPX-Datei.
   * @returns {Array<{lat:number, lng:number, name:string, note:string}>}
   */
  parseGpxWaypoints(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('Die Datei ist keine gültige GPX-Datei.');
    }
    const waypoints = [...doc.querySelectorAll('wpt')].map((w) => ({
      lat: parseFloat(w.getAttribute('lat')),
      lng: parseFloat(w.getAttribute('lon')),
      name: (w.querySelector('name')?.textContent || '').trim(),
      note: (
        w.querySelector('desc')?.textContent ||
        w.querySelector('cmt')?.textContent ||
        ''
      ).trim(),
    }));
    return waypoints.filter(
      (w) => Number.isFinite(w.lat) && Number.isFinite(w.lng)
    );
  },

  /**
   * Führt importierte Wegpunkte mit dem Bestand zusammen. Einträge mit
   * gleichem Namen oder in unmittelbarer Nähe (< 30 m) gelten als
   * Duplikate und werden übersprungen, damit ein erneuter Import die
   * "erhalten"-Markierungen nicht überschreibt.
   * @returns {{stamps: Array, added: number, skipped: number}}
   */
  merge(existing, imported) {
    const stamps = existing.slice();
    let added = 0;
    let skipped = 0;

    for (const w of imported) {
      const duplicate = stamps.some(
        (s) =>
          (w.name && s.name === w.name) ||
          Utils.haversine(s, w) < this.DUPLICATE_RADIUS_M
      );
      if (duplicate) {
        skipped++;
        continue;
      }
      stamps.push({
        id: Utils.uid(),
        lat: w.lat,
        lng: w.lng,
        name: w.name || `Stempelstelle ${stamps.length + 1}`,
        note: w.note,
        collected: false,
      });
      added++;
    }
    return { stamps, added, skipped };
  },
};
