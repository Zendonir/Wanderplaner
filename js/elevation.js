'use strict';

/**
 * Höhendaten entlang der Route: Stützpunkte in regelmäßigen Abständen
 * bilden, Höhen per Open-Elevation abfragen und bei Ausfall auf
 * Open-Topo-Data ausweichen.
 */
const Elevation = {
  MAX_SAMPLES: 100,
  MIN_SPACING_M: 50,
  OPEN_ELEVATION_URL: 'https://api.open-elevation.com/api/v1/lookup',
  OPEN_TOPO_DATA_URL: 'https://api.opentopodata.org/v1/aster30m',

  /**
   * Erzeugt gleichmäßig verteilte Stützpunkte entlang der Routengeometrie.
   * @param {Array<[number,number]>} coordinates  [lng, lat]-Paare der Route
   * @returns {Array<{lat:number, lng:number, dist:number}>} dist in Metern ab Start
   */
  sampleAlong(coordinates) {
    const pts = coordinates.map((c) => ({ lat: c[1], lng: c[0] }));
    if (pts.length === 0) return [];

    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Utils.haversine(pts[i - 1], pts[i]));
    }
    const total = cum[cum.length - 1];
    if (total === 0) return [{ ...pts[0], dist: 0 }];

    const n = Math.min(
      this.MAX_SAMPLES,
      Math.max(2, Math.floor(total / this.MIN_SPACING_M) + 1)
    );

    const samples = [];
    let seg = 1;
    for (let k = 0; k < n; k++) {
      const target = (total * k) / (n - 1);
      while (seg < cum.length - 1 && cum[seg] < target) seg++;
      const segLen = cum[seg] - cum[seg - 1] || 1;
      const t = (target - cum[seg - 1]) / segLen;
      samples.push({
        lat: pts[seg - 1].lat + (pts[seg].lat - pts[seg - 1].lat) * t,
        lng: pts[seg - 1].lng + (pts[seg].lng - pts[seg - 1].lng) * t,
        dist: target,
      });
    }
    return samples;
  },

  /**
   * Fragt Höhenwerte für alle Stützpunkte ab. Erst Open-Elevation,
   * bei Fehler/Timeout Open-Topo-Data als Fallback.
   * @returns {Promise<number[]>} Höhen in Metern, gleiche Länge wie samples
   */
  async fetchElevations(samples) {
    try {
      return await this._fromOpenElevation(samples);
    } catch (err) {
      console.warn('Open-Elevation fehlgeschlagen, versuche Open-Topo-Data:', err);
      return await this._fromOpenTopoData(samples);
    }
  },

  async _fromOpenElevation(samples) {
    const body = {
      locations: samples.map((s) => ({ latitude: s.lat, longitude: s.lng })),
    };
    const response = await Utils.fetchWithTimeout(this.OPEN_ELEVATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.results || data.results.length !== samples.length) {
      throw new Error('Unerwartete Antwort von Open-Elevation.');
    }
    return data.results.map((r) => r.elevation);
  },

  async _fromOpenTopoData(samples) {
    const locations = samples
      .map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`)
      .join('|');
    const response = await Utils.fetchWithTimeout(
      `${this.OPEN_TOPO_DATA_URL}?locations=${locations}`
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.status !== 'OK' || !data.results || data.results.length !== samples.length) {
      throw new Error('Unerwartete Antwort von Open-Topo-Data.');
    }
    // Fehlende Werte (z. B. über Wasser) durch den letzten bekannten ersetzen.
    let last = 0;
    return data.results.map((r) => {
      if (r.elevation != null) last = r.elevation;
      return last;
    });
  },

  /**
   * Gesamtanstieg/-abstieg aus der Höhenreihe. Die Werte werden leicht
   * geglättet und kleine Schwankungen (< 3 m) ignoriert, damit Rauschen
   * der Höhendaten die Summen nicht aufbläht.
   * @returns {{ascent:number, descent:number}}
   */
  computeAscentDescent(elevations) {
    if (!elevations || elevations.length < 2) return { ascent: 0, descent: 0 };

    const smoothed = elevations.map((_, i) => {
      const from = Math.max(0, i - 1);
      const to = Math.min(elevations.length - 1, i + 1);
      let sum = 0;
      for (let j = from; j <= to; j++) sum += elevations[j];
      return sum / (to - from + 1);
    });

    const THRESHOLD = 3;
    let ascent = 0;
    let descent = 0;
    let ref = smoothed[0];
    for (const v of smoothed) {
      const diff = v - ref;
      if (diff >= THRESHOLD) {
        ascent += diff;
        ref = v;
      } else if (diff <= -THRESHOLD) {
        descent -= diff;
        ref = v;
      }
    }
    return { ascent, descent };
  },
};
