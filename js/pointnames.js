'use strict';

/**
 * Lesbare Namen für Routenpunkte.
 *
 * Eine Koordinate wie „51.80123, 10.61234“ sagt beim Planen nichts. Deshalb
 * wird der Reihe nach etwas Besseres gesucht:
 *
 *  1. der eigene Name des Punkts (gesetzt aus Stempelstelle oder Parkplatz),
 *  2. eine Stempelstelle, ein Parkplatz oder ein POI aus der Sammlung direkt
 *     am Punkt, sonst „bei …“ im näheren Umkreis,
 *  3. eine Ortsangabe aus OpenStreetMap (Nominatim), etwa „Kaiserweg,
 *     Schierke“ – einmal je Stelle abgefragt und im Browser gemerkt,
 *  4. erst wenn nichts davon greift, die Koordinate.
 *
 * Namen, die nur eine OSM-Kennung sind („way/667108954“), zählen nicht als
 * Name: Sie stammen aus Exporten, bei denen das Objekt keinen Namen hatte.
 */
const PointNames = {
  EXACT_M: 30,
  NEAR_M: 200,
  REVERSE_URL: 'https://nominatim.openstreetmap.org/reverse',
  CACHE_KEY: 'wanderplaner.ortsnamen',
  // Nominatim erlaubt höchstens eine Anfrage pro Sekunde.
  GAP_MS: 1100,

  _cache: null,
  _queue: [],
  _pending: new Set(),
  _running: false,

  /** Ist das ein echter Name – oder nur eine Kennung bzw. leer? */
  isUsable(name) {
    const text = String(name || '').trim();
    if (!text) return false;
    if (/^(node|way|relation)\s*[/:#]?\s*\d+$/i.test(text)) return false;
    if (/^[nwr]\d+$/i.test(text)) return false;
    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(text)) return false;
    return true;
  },

  /** Schlüssel für den Zwischenspeicher: auf etwa 10 m gerundet. */
  key(p) {
    return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
  },

  _load() {
    if (this._cache) return this._cache;
    try {
      this._cache = JSON.parse(localStorage.getItem(this.CACHE_KEY)) || {};
    } catch (err) {
      this._cache = {};
    }
    return this._cache;
  },

  _save() {
    try {
      // Nicht endlos wachsen lassen: die jüngsten 500 Stellen genügen.
      const entries = Object.entries(this._cache);
      if (entries.length > 500) this._cache = Object.fromEntries(entries.slice(-500));
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(this._cache));
    } catch (err) {
      // Speicher voll oder gesperrt – dann eben ohne Gedächtnis.
    }
  },

  /** Bereits bekannte Ortsangabe (oder undefined, wenn noch nie gefragt). */
  cached(p) {
    return this._load()[this.key(p)];
  },

  /**
   * Sucht in den Sammlungen. `places` sind Listen von {lat,lng,name}; die
   * erste Liste mit einem Treffer direkt am Punkt gewinnt, danach der
   * nächste Treffer im Umkreis.
   * @param {object} p
   * @param {Array<{list:Array, generic:?string}>} sources
   * @returns {?string}
   */
  fromCollections(p, sources) {
    // Grob vorsortieren: 0,003° sind rund 200–330 m.
    const near = (place) => Math.abs(place.lat - p.lat) < 0.003
      && Math.abs(place.lng - p.lng) < 0.005;

    let nearest = null;
    let nearestDist = this.NEAR_M;
    for (const { list, generic } of sources) {
      let exact = null;
      let exactDist = this.EXACT_M;
      for (const place of list) {
        if (!near(place)) continue;
        const name = this.isUsable(place.name) ? place.name : generic;
        if (!name) continue;
        const d = Utils.haversine(p, place);
        if (d <= exactDist) {
          exact = name;
          exactDist = d;
        }
        // Für „bei …“ nur echte Namen – „bei Parkplatz“ hilft niemandem.
        if (this.isUsable(place.name) && d < nearestDist) {
          nearest = place.name;
          nearestDist = d;
        }
      }
      if (exact) return exact;
    }
    return nearest ? `bei ${nearest}` : null;
  },

  /** Macht aus einer Nominatim-Antwort eine kurze Ortsangabe. */
  describe(result) {
    if (!result || typeof result !== 'object' || result.error) return '';
    const a = result.address || {};
    const place = a.village || a.hamlet || a.town || a.city || a.municipality
      || a.suburb || a.county || '';
    const way = a.road || a.footway || a.path || a.track || a.pedestrian || '';
    const ownName = this.isUsable(result.name) ? result.name : '';

    if (ownName && result.category !== 'highway') {
      return place && place !== ownName ? `${ownName}, ${place}` : ownName;
    }
    const road = ownName || way;
    if (road && place) return `${road}, ${place}`;
    if (road) return road;
    if (place) return `bei ${place}`;
    return '';
  },

  /**
   * Fragt die Ortsangabe im Hintergrund nach. `onName` wird aufgerufen,
   * sobald für eine Stelle etwas gefunden ist.
   */
  request(p, onName) {
    const key = this.key(p);
    if (this.cached(p) !== undefined || this._pending.has(key)) return;
    this._pending.add(key);
    this._queue.push({ lat: p.lat, lng: p.lng, key, onName });
    this._pump();
  },

  async _pump() {
    if (this._running) return;
    this._running = true;
    while (this._queue.length > 0) {
      const job = this._queue.shift();
      try {
        const url = `${this.REVERSE_URL}?format=jsonv2&addressdetails=1&zoom=17` +
          `&accept-language=de&lat=${job.lat.toFixed(5)}&lon=${job.lng.toFixed(5)}`;
        const response = await Utils.fetchWithTimeout(url, {}, 10000);
        if (response.ok) {
          const name = this.describe(await response.json());
          this._load()[job.key] = name;
          this._save();
          if (name) job.onName(name);
        }
      } catch (err) {
        // Ohne Netz bleibt es bei der Koordinate; beim nächsten Mal wieder versuchen.
      }
      this._pending.delete(job.key);
      if (this._queue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.GAP_MS));
      }
    }
    this._running = false;
  },
};
