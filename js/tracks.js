'use strict';

/**
 * Abgeschlossene Touren: GPX-Tracks importieren und dauerhaft auf der Karte
 * hinterlegen. Die Geometrie wird beim Import ausgedünnt, damit auch viele
 * Touren in den localStorage passen.
 */
const Tracks = {
  STORAGE_KEY: 'wanderplaner.tracks',
  SIMPLIFY_TOLERANCE_M: 8,

  // Farben für die hinterlegten Spuren, damit sich mehrere unterscheiden.
  COLORS: ['#7b3fa0', '#1d5fbf', '#b35c00', '#0e8a6a', '#a01f5b', '#5c6f00'],

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data.items)) return [];
      return data.items.filter((t) => Array.isArray(t.points) && t.points.length > 1);
    } catch (err) {
      console.warn('Hinterlegte Touren konnten nicht geladen werden:', err);
      return [];
    }
  },

  save(items) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ version: 1, items }));
      return true;
    } catch (err) {
      // Bei vollem Speicher soll die App weiterlaufen und es sagen.
      console.warn('Hinterlegte Touren konnten nicht gespeichert werden:', err);
      return false;
    }
  },

  /**
   * Liest alle <trk>-Segmente aus einer GPX-Datei. Mehrere Segmente eines
   * Tracks werden zu einer Linie zusammengefasst.
   * @returns {Array<{name:string, points:Array<{lat:number,lng:number,ele:?number}>}>}
   */
  parseGpxTracks(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('Die Datei ist keine gültige GPX-Datei.');
    }

    const readPoints = (nodes) =>
      [...nodes]
        .map((pt) => {
          const ele = pt.querySelector('ele');
          return {
            lat: parseFloat(pt.getAttribute('lat')),
            lng: parseFloat(pt.getAttribute('lon')),
            ele: ele ? parseFloat(ele.textContent) : null,
          };
        })
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    const tracks = [...doc.querySelectorAll('trk')]
      .map((trk) => ({
        name: (trk.querySelector('name')?.textContent || '').trim(),
        points: readPoints(trk.querySelectorAll('trkpt')),
      }))
      .filter((t) => t.points.length > 1);

    // Manche Programme exportieren nur <rte> statt <trk>.
    if (tracks.length === 0) {
      const routes = [...doc.querySelectorAll('rte')]
        .map((rte) => ({
          name: (rte.querySelector('name')?.textContent || '').trim(),
          points: readPoints(rte.querySelectorAll('rtept')),
        }))
        .filter((t) => t.points.length > 1);
      return routes;
    }
    return tracks;
  },

  /**
   * Douglas-Peucker: entfernt Stützpunkte, die kaum vom Verlauf abweichen.
   * @param {Array<{lat:number,lng:number}>} points
   * @param {number} toleranceM maximale Abweichung in Metern
   */
  simplify(points, toleranceM = this.SIMPLIFY_TOLERANCE_M) {
    if (points.length <= 2) return points.slice();

    // Abstand Punkt↔Strecke, in Metern genähert über eine lokale Ebene.
    const perpendicular = (p, a, b) => {
      const mPerDegLat = 111320;
      const mPerDegLng = 111320 * Math.cos((p.lat * Math.PI) / 180);
      const px = (p.lng - a.lng) * mPerDegLng;
      const py = (p.lat - a.lat) * mPerDegLat;
      const bx = (b.lng - a.lng) * mPerDegLng;
      const by = (b.lat - a.lat) * mPerDegLat;
      const lenSq = bx * bx + by * by;
      if (lenSq === 0) return Math.hypot(px, py);
      let t = (px * bx + py * by) / lenSq;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - t * bx, py - t * by);
    };

    const keep = new Array(points.length).fill(false);
    keep[0] = true;
    keep[points.length - 1] = true;

    const stack = [[0, points.length - 1]];
    while (stack.length > 0) {
      const [start, end] = stack.pop();
      let maxDist = 0;
      let index = -1;
      for (let i = start + 1; i < end; i++) {
        const d = perpendicular(points[i], points[start], points[end]);
        if (d > maxDist) {
          maxDist = d;
          index = i;
        }
      }
      if (index !== -1 && maxDist > toleranceM) {
        keep[index] = true;
        stack.push([start, index], [index, end]);
      }
    }
    return points.filter((_, i) => keep[i]);
  },

  /** Länge einer Punktfolge in Metern. */
  length(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += Utils.haversine(points[i - 1], points[i]);
    }
    return total;
  },

  /**
   * Bereitet importierte Tracks zum Speichern auf: ausdünnen, Koordinaten
   * runden (5 Nachkommastellen ≈ 1 m) und Länge vorberechnen.
   */
  prepare(track, existingCount) {
    const simplified = this.simplify(track.points);
    const round = (v) => Math.round(v * 1e5) / 1e5;
    return {
      id: Utils.uid(),
      name: track.name || `Tour ${existingCount + 1}`,
      date: new Date().toISOString().slice(0, 10),
      color: this.COLORS[existingCount % this.COLORS.length],
      visible: true,
      length: Math.round(this.length(track.points)),
      points: simplified.map((p) => [round(p.lat), round(p.lng)]),
    };
  },

  /** Gespeicherte [lat, lng]-Paare zurück in Objektform. */
  toLatLngs(track) {
    return track.points.map((p) => ({ lat: p[0], lng: p[1] }));
  },
};
