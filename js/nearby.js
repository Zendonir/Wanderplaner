'use strict';

/**
 * Findet Punkte in der Nähe einer Route oder einer Position – für
 * „welche Stempelstellen liegen an meiner Tour?“ und „welche sind hier
 * gerade in Reichweite?“.
 */
const Nearby = {
  /**
   * Abstand eines Punktes zu einer Strecke in Metern. Gerechnet wird in
   * einer lokalen Ebene; auf den hier üblichen Entfernungen ist der Fehler
   * vernachlässigbar und die Rechnung deutlich schneller als mit Haversine
   * für jeden Streckenpunkt.
   */
  _distanceToSegment(p, a, b) {
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
  },

  /**
   * Kürzester Abstand eines Punktes zur Route.
   * @param {{lat:number, lng:number}} point
   * @param {Array<[number,number]>} coordinates [lng, lat]-Paare
   * @returns {{distance:number, index:number}} Meter und Segmentanfang
   */
  distanceToRoute(point, coordinates) {
    let best = Infinity;
    let bestIndex = 0;
    for (let i = 1; i < coordinates.length; i++) {
      const a = { lat: coordinates[i - 1][1], lng: coordinates[i - 1][0] };
      const b = { lat: coordinates[i][1], lng: coordinates[i][0] };
      const d = this._distanceToSegment(point, a, b);
      if (d < best) {
        best = d;
        bestIndex = i - 1;
      }
    }
    return { distance: best, index: bestIndex };
  },

  /**
   * Alle Punkte, die höchstens `radius` Meter von der Route entfernt liegen.
   * Ein Umgebungsrechteck filtert vorab grob, damit auch viele hundert
   * Stempelstellen ohne spürbare Verzögerung geprüft werden können.
   *
   * @param {Array<{lat:number,lng:number}>} points
   * @param {Array<[number,number]>} coordinates Routengeometrie
   * @param {number} radius Meter
   * @returns {Array} Punkte mit `detour` (Abstand in Metern), sortiert nach
   *                  Position entlang der Route
   */
  alongRoute(points, coordinates, radius = 500) {
    if (!coordinates || coordinates.length < 2 || points.length === 0) return [];

    // Grobfilter über ein Rechteck um die Route.
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const c of coordinates) {
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
      if (c[0] < minLng) minLng = c[0];
      if (c[0] > maxLng) maxLng = c[0];
    }
    const padLat = radius / 111320;
    const padLng = radius / (111320 * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180) || 1);

    const candidates = points.filter(
      (p) =>
        p.lat >= minLat - padLat && p.lat <= maxLat + padLat &&
        p.lng >= minLng - padLng && p.lng <= maxLng + padLng
    );

    // Streckenlänge bis zu jedem Stützpunkt, um die Treffer in Gehrichtung
    // zu sortieren statt alphabetisch.
    const cum = [0];
    for (let i = 1; i < coordinates.length; i++) {
      cum.push(cum[i - 1] + Utils.haversine(
        { lat: coordinates[i - 1][1], lng: coordinates[i - 1][0] },
        { lat: coordinates[i][1], lng: coordinates[i][0] }
      ));
    }

    return candidates
      .map((p) => {
        const { distance, index } = this.distanceToRoute(p, coordinates);
        return { ...p, detour: distance, at: cum[index] };
      })
      .filter((p) => p.detour <= radius)
      .sort((a, b) => a.at - b.at);
  },

  /**
   * Punkte im Umkreis einer Position, nach Entfernung sortiert.
   * @returns {Array} Punkte mit `distance` in Metern
   */
  aroundPosition(points, position, radius = 250) {
    return points
      .map((p) => ({ ...p, distance: Utils.haversine(p, position) }))
      .filter((p) => p.distance <= radius)
      .sort((a, b) => a.distance - b.distance);
  },
};
