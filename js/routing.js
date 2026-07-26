'use strict';

/**
 * Routenberechnung entlang echter Wege über den öffentlichen OSRM-Demo-Server
 * (Fußgänger-Profil). Läuft komplett clientseitig im Browser.
 */
const Routing = {
  BASE_URL: 'https://router.project-osrm.org/route/v1/foot/',

  /**
   * Berechnet eine Route durch alle übergebenen Punkte (in Reihenfolge).
   * @param {Array<{lat:number, lng:number}>} points  mindestens 2 Punkte
   * @returns {Promise<{coordinates: Array<[number,number]>, distance: number}>}
   *          coordinates als [lng, lat]-Paare, distance in Metern
   */
  async fetchRoute(points) {
    const coords = points
      .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
      .join(';');
    const url =
      this.BASE_URL + coords + '?overview=full&geometries=geojson&steps=false';

    let response;
    try {
      response = await Utils.fetchWithTimeout(url);
    } catch (err) {
      throw new Error('Routing-Dienst (OSRM) nicht erreichbar.');
    }
    if (!response.ok) {
      throw new Error(`Routing-Dienst antwortet mit Fehler (HTTP ${response.status}).`);
    }

    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('Zwischen den Punkten konnte keine Route gefunden werden.');
    }

    const route = data.routes[0];
    return {
      coordinates: route.geometry.coordinates,
      distance: route.distance,
    };
  },
};
