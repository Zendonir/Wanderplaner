'use strict';

/**
 * Routenberechnung entlang echter Wege.
 *
 * Primär wird BRouter genutzt: Dort lässt sich ein eigenes Profil übergeben,
 * sodass die Routing-Einstellungen der App tatsächlich die Wegekosten
 * beeinflussen (OSM-Tags wie surface, tracktype, sac_scale, trail_visibility,
 * foot/access und Wanderweg-Relationen). BRouter liefert außerdem Höhenwerte
 * direkt in der Geometrie mit.
 *
 * Fällt BRouter aus, wird auf den öffentlichen OSRM-Server zurückgegriffen.
 * Wichtig zu wissen: dessen Fuß-Endpunkt routet faktisch über Straßen und
 * kennt keine Wandergewichtung – deshalb nur als Notnagel, und die App weist
 * den Nutzer darauf hin.
 *
 * Alle Aufrufe laufen clientseitig im Browser.
 */
const Routing = {
  BROUTER_URL: 'https://brouter.de/brouter',
  BROUTER_PROFILE_URL: 'https://brouter.de/brouter/profile',
  OSRM_URL: 'https://router.project-osrm.org/route/v1/foot/',

  /** Zuletzt hochgeladenes Profil, damit nicht bei jeder Änderung neu geladen wird. */
  _profileCache: { text: null, id: null },

  /**
   * Lädt den Profiltext zu BRouter hoch und liefert die Profil-ID.
   * Ergebnis wird gecacht, solange sich der Text nicht ändert.
   */
  async _uploadProfile(profileText) {
    if (this._profileCache.text === profileText && this._profileCache.id) {
      return this._profileCache.id;
    }
    const response = await Utils.fetchWithTimeout(
      this.BROUTER_PROFILE_URL,
      {
        method: 'POST',
        // text/plain vermeidet einen CORS-Preflight.
        headers: { 'Content-Type': 'text/plain' },
        body: profileText,
      },
      20000
    );
    if (!response.ok) throw new Error(`Profil-Upload fehlgeschlagen (HTTP ${response.status}).`);
    const data = await response.json();
    if (data.error) throw new Error(`BRouter lehnt das Profil ab: ${data.error}`);
    if (!data.profileid) throw new Error('BRouter hat keine Profil-ID zurückgegeben.');

    this._profileCache = { text: profileText, id: data.profileid };
    return data.profileid;
  },

  /**
   * Berechnet eine Route durch alle übergebenen Punkte (in Reihenfolge).
   * @param {Array<{lat:number, lng:number}>} points mindestens 2 Punkte
   * @param {object} settings Routing-Einstellungen (siehe Profiles)
   * @returns {Promise<{coordinates:Array, distance:number, elevations:?Array,
   *                    ascent:?number, descent:?number, engine:string}>}
   */
  async fetchRoute(points, settings) {
    try {
      return await this._viaBRouter(points, settings);
    } catch (brouterError) {
      console.warn('BRouter fehlgeschlagen, weiche auf OSRM aus:', brouterError);
      try {
        const result = await this._viaOsrm(points);
        result.warning =
          'BRouter (Wander-Routing) ist gerade nicht erreichbar – die Route wurde ' +
          'ersatzweise über OSRM berechnet. Dieser Dienst folgt überwiegend Straßen ' +
          'und ignoriert die Routing-Einstellungen.';
        return result;
      } catch (osrmError) {
        throw new Error(
          `Kein Routing-Dienst erreichbar. BRouter: ${brouterError.message} ` +
          `OSRM: ${osrmError.message}`
        );
      }
    }
  },

  async _viaBRouter(points, settings) {
    const profileText = Profiles.build(settings);
    const profileId = await this._uploadProfile(profileText);

    const lonlats = points
      .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
      .join('|');
    const url =
      `${this.BROUTER_URL}?lonlats=${lonlats}` +
      `&profile=${encodeURIComponent(profileId)}&alternativeidx=0&format=geojson`;

    let response;
    try {
      response = await Utils.fetchWithTimeout(url, {}, 30000);
    } catch (err) {
      throw new Error('BRouter nicht erreichbar.');
    }
    if (!response.ok) {
      throw new Error(`BRouter antwortet mit HTTP ${response.status}.`);
    }

    const text = await response.text();
    // Bei Fehlern (z. B. Punkt zu weit von einem Weg entfernt) antwortet
    // BRouter mit Klartext statt GeoJSON.
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(text.trim().slice(0, 200) || 'Unerwartete Antwort von BRouter.');
    }
    const feature = data.features && data.features[0];
    if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) {
      throw new Error('BRouter hat keine Route gefunden.');
    }

    const coords = feature.geometry.coordinates;
    const props = feature.properties || {};
    const distance = parseFloat(props['track-length']);

    // BRouter liefert je Stützpunkt [lng, lat, ele] – die Höhen können damit
    // direkt genutzt werden, ohne eine Elevation-API zu befragen.
    const hasElevation = coords.length > 0 && coords[0].length >= 3;

    return {
      coordinates: coords.map((c) => [c[0], c[1]]),
      elevations: hasElevation ? coords.map((c) => c[2]) : null,
      distance: Number.isFinite(distance) ? distance : this._lengthOf(coords),
      engine: 'brouter',
    };
  },

  async _viaOsrm(points) {
    const coords = points
      .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
      .join(';');
    const url = this.OSRM_URL + coords + '?overview=full&geometries=geojson&steps=false';

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
      elevations: null,
      distance: route.distance,
      engine: 'osrm',
    };
  },

  /** Ersatzberechnung der Länge, falls der Router keine mitliefert. */
  _lengthOf(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
      total += Utils.haversine(
        { lat: coords[i - 1][1], lng: coords[i - 1][0] },
        { lat: coords[i][1], lng: coords[i][0] }
      );
    }
    return total;
  },
};
