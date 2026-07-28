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

  // Bis hierhin gelten zwei Stellen als dieselbe, wenn ein Name den anderen
  // enthält. Dieselbe Stempelstelle steht in verschiedenen Quellen gern
  // einmal als „HWN143 Köte Schindelkopf“ und einmal als „Köte
  // Schindelkopf“, dazu mit leicht abweichenden Koordinaten.
  NEAR_NAME_RADIUS_M: 250,

  /** Namen vergleichbar machen: Groß-/Kleinschreibung, Zeichensetzung, Leerraum. */
  normalizeName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  },

  /**
   * Beschreiben zwei Einträge dieselbe Stelle?
   */
  sameSpot(a, b) {
    const left = this.normalizeName(a.name);
    const right = this.normalizeName(b.name);
    if (left && right && left === right) return true;

    const distance = Utils.haversine(a, b);
    if (distance < this.DUPLICATE_RADIUS_M) return true;

    // Ein Name steckt im anderen und die Stellen liegen nah beieinander.
    if (left && right && distance < this.NEAR_NAME_RADIUS_M
      && (left.includes(right) || right.includes(left))) {
      return true;
    }
    return false;
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
            (s) => !s.deletedAt && PointStore.sameSpot(s, w)
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
      sameSpot(a, b) {
        return PointStore.sameSpot(a, b);
      },

      /**
       * Fasst Einträge zusammen, die dieselbe Stelle beschreiben.
       *
       * Nötig, weil der Abgleich zwischen Geräten über die id läuft: Wer
       * dieselbe GPX-Datei auf zwei Geräten importiert hat, hat für jede
       * Stelle zwei verschiedene ids – und bekommt beim ersten gemeinsamen
       * Abgleich alles doppelt.
       *
       * Der informationsreichere Eintrag bleibt: Ein abgehakter Stempel
       * schlägt einen offenen, sonst gewinnt der neuere Stand. Notiz und
       * Abhak-Datum des anderen ziehen mit um, damit nichts verloren geht.
       * Der Verlierer bleibt als Grabstein – ohne ihn holt das nächste Gerät
       * die Dublette beim nächsten Abgleich zurück.
       *
       * @returns {{items: Array, merged: number}}
       */
      dedupe(items) {
        const survivors = [];
        const tombstones = [];
        let merged = 0;

        for (const item of items || []) {
          if (item.deletedAt) {
            tombstones.push(item);
            continue;
          }

          const index = survivors.findIndex((s) => store.sameSpot(s, item));
          if (index < 0) {
            survivors.push({ ...item });
            continue;
          }

          const twin = survivors[index];
          const itemNewer = (Number(item.updatedAt) || 0) > (Number(twin.updatedAt) || 0);
          const itemWins = Boolean(item.collected) === Boolean(twin.collected)
            ? itemNewer
            : Boolean(item.collected);

          const winner = { ...(itemWins ? item : twin) };
          const loser = itemWins ? twin : item;

          if (!winner.note && loser.note) winner.note = loser.note;
          if (!winner.collected && loser.collected) winner.collected = true;
          if (!winner.collectedAt && loser.collectedAt) winner.collectedAt = loser.collectedAt;
          winner.updatedAt = Date.now();

          survivors[index] = winner;
          tombstones.push({ ...loser, deletedAt: Date.now(), updatedAt: Date.now() });
          merged++;
        }

        return { items: [...survivors, ...tombstones], merged };
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
