'use strict';

/**
 * Dauerhaft gespeicherte Punkte: Stempelstellen und Parkplätze.
 *
 * Beide verhalten sich gleich (GPX-Wegpunkte importieren, im localStorage
 * halten, Duplikate erkennen), unterscheiden sich nur im Speicherschlüssel
 * und in der Beschriftung – deshalb eine gemeinsame Fabrik.
 */
const PointStore = {
  DUPLICATE_RADIUS_M: 30,

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
   * Erzeugt einen Speicher für eine Punktart.
   * @param {string} storageKey   Schlüssel im localStorage
   * @param {string} namePrefix   Name für Einträge ohne <name> im GPX
   */
  create(storageKey, namePrefix) {
    const store = {
      STORAGE_KEY: storageKey,

      load() {
        try {
          const raw = localStorage.getItem(storageKey);
          if (!raw) return [];
          const data = JSON.parse(raw);
          const items = Array.isArray(data.items) ? data.items : data.stamps;
          if (!Array.isArray(items)) return [];
          // Grabsteine (gelöschte Einträge) haben keine Koordinaten, müssen
          // aber erhalten bleiben, damit der Abgleich sie nicht zurückholt.
          return items.filter(
            (s) => s.deletedAt || (Number.isFinite(s.lat) && Number.isFinite(s.lng))
          );
        } catch (err) {
          console.warn(`${namePrefix} konnten nicht geladen werden:`, err);
          return [];
        }
      },

      save(items) {
        try {
          localStorage.setItem(storageKey, JSON.stringify({ version: 2, items }));
        } catch (err) {
          console.warn(`${namePrefix} konnten nicht gespeichert werden:`, err);
        }
      },

      /**
       * Führt importierte Wegpunkte mit dem Bestand zusammen. Einträge mit
       * gleichem Namen oder in unmittelbarer Nähe gelten als Duplikate und
       * werden übersprungen, damit ein erneuter Import bestehende
       * Markierungen nicht überschreibt.
       */
      merge(existing, imported) {
        const items = existing.slice();
        let added = 0;
        let skipped = 0;

        for (const w of imported) {
          // Nur gegen sichtbare Einträge prüfen: ein früher gelöschter Eintrag
          // soll durch erneuten Import zurückkommen können.
          const duplicate = items.some(
            (s) =>
              !s.deletedAt &&
              ((w.name && s.name === w.name) ||
                Utils.haversine(s, w) < PointStore.DUPLICATE_RADIUS_M)
          );
          if (duplicate) {
            skipped++;
            continue;
          }
          items.push({
            id: Utils.uid(),
            lat: w.lat,
            lng: w.lng,
            name: w.name || `${namePrefix} ${items.length + 1}`,
            note: w.note,
            collected: false,
            updatedAt: Date.now(),
          });
          added++;
        }
        return { items, added, skipped };
      },
    };
    return store;
  },
};

/** Stempelstellen – Schlüssel bleibt kompatibel zu früheren Versionen. */
const Stamps = PointStore.create('wanderplaner.stempelstellen', 'Stempelstelle');

/** Parkplätze. */
const Parking = PointStore.create('wanderplaner.parkplaetze', 'Parkplatz');

// Frühere Versionen speicherten Stempelstellen unter {stamps: [...]}, die
// load()-Funktion oben liest beide Formate.
Stamps.parseGpxWaypoints = PointStore.parseGpxWaypoints.bind(PointStore);
Parking.parseGpxWaypoints = PointStore.parseGpxWaypoints.bind(PointStore);
