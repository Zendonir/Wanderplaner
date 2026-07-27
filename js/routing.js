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
      if (settings && settings.roundTrip && points.length >= 2) {
        return await this._roundTrip(points, settings);
      }
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

  /**
   * Rundkurs: Hinweg wie gewohnt, für den Rückweg werden entlang des Hinwegs
   * Sperrbereiche gesetzt, damit ein anderer (paralleler) Weg gewählt wird.
   * Findet sich keiner, wird der Rückweg ohne Sperren berechnet – lieber ein
   * Rundkurs auf gleichem Weg als gar keine Route.
   */
  async _roundTrip(points, settings) {
    const outbound = await this._viaBRouter(points, settings);

    const back = [points[points.length - 1], points[0]];
    const nogos = this._nogosAlong(outbound.coordinates);

    let inbound;
    let sameWayBack = false;
    try {
      inbound = await this._viaBRouter(back, settings, nogos);
    } catch (err) {
      console.warn('Kein Parallelweg gefunden, Rückweg ohne Sperren:', err);
      inbound = await this._viaBRouter(back, settings);
      sameWayBack = true;
    }

    const coordinates = outbound.coordinates.concat(inbound.coordinates.slice(1));
    const elevations =
      outbound.elevations && inbound.elevations
        ? outbound.elevations.concat(inbound.elevations.slice(1))
        : null;

    return {
      coordinates,
      elevations,
      distance: outbound.distance + inbound.distance,
      engine: 'brouter',
      warning: sameWayBack
        ? 'Für den Rückweg wurde kein ausreichend eigenständiger Parallelweg ' +
          'gefunden – die Route führt streckenweise über den Hinweg zurück.'
        : undefined,
    };
  },

  /**
   * Legt Sperrkreise entlang einer Route an, lässt aber Anfang und Ende frei,
   * damit Start- und Zielpunkt erreichbar bleiben. Die Anzahl ist begrenzt,
   * weil alle Kreise in die Anfrage-URL passen müssen.
   */
  _nogosAlong(coordinates, maxCount = 40, radius = 40) {
    if (coordinates.length < 2) return [];

    // Etwa 250 m an beiden Enden aussparen, damit Start und Ziel erreichbar
    // bleiben – ein Sperrkreis über dem Startpunkt macht die Route unmöglich.
    const FREE_END_M = 250;

    const cum = [0];
    for (let i = 1; i < coordinates.length; i++) {
      cum.push(cum[i - 1] + Utils.haversine(
        { lat: coordinates[i - 1][1], lng: coordinates[i - 1][0] },
        { lat: coordinates[i][1], lng: coordinates[i][0] }
      ));
    }
    const total = cum[cum.length - 1];
    if (total <= FREE_END_M * 2.5) return [];

    const from = FREE_END_M;
    const to = total - FREE_END_M;
    const count = Math.min(maxCount, Math.max(2, Math.round((to - from) / 150)));

    // Positionen werden entlang der Strecke interpoliert, nicht aus den
    // vorhandenen Stützpunkten gewählt: eine gerade Route kann aus sehr
    // wenigen Punkten bestehen und bekäme sonst kaum Sperren.
    const nogos = [];
    let seg = 1;
    for (let k = 0; k < count; k++) {
      const target = from + ((to - from) * k) / (count - 1);
      while (seg < cum.length - 1 && cum[seg] < target) seg++;
      const segLen = cum[seg] - cum[seg - 1] || 1;
      const t = (target - cum[seg - 1]) / segLen;
      const a = coordinates[seg - 1];
      const b = coordinates[seg];
      nogos.push({
        lng: a[0] + (b[0] - a[0]) * t,
        lat: a[1] + (b[1] - a[1]) * t,
        radius,
      });
    }
    return nogos;
  },

  /**
   * Berechnet zusätzlich zur Hauptroute die Varianten, die BRouter über
   * `alternativeidx` anbietet. Fehlschläge einzelner Varianten sind normal
   * (nicht überall gibt es echte Alternativen) und werden übergangen.
   * @returns {Promise<Array>} Routen, beginnend mit der Hauptroute
   */
  async fetchAlternatives(points, settings, count = 3) {
    const results = await Promise.allSettled(
      Array.from({ length: count }, (_, i) =>
        this._viaBRouter(points, settings, null, i)
      )
    );

    const routes = [];
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      // Varianten, die sich in der Länge kaum unterscheiden, sind meist
      // dieselbe Strecke – die blenden wir aus.
      const duplicate = routes.some(
        (existing) => Math.abs(existing.distance - r.value.distance) < 50
      );
      if (duplicate) return;
      routes.push({ ...r.value, alternativeIndex: i });
    });
    return routes;
  },

  async _viaBRouter(points, settings, nogos = null, alternativeIdx = 0) {
    const profileText = Profiles.build(settings);
    const profileId = await this._uploadProfile(profileText);

    const lonlats = points
      .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
      .join('|');
    let url =
      `${this.BROUTER_URL}?lonlats=${lonlats}` +
      `&profile=${encodeURIComponent(profileId)}` +
      `&alternativeidx=${alternativeIdx}&format=geojson`;

    if (nogos && nogos.length > 0) {
      // Gewichtete Sperren: hohe Kosten statt hartem Verbot, damit BRouter
      // im Notfall doch hindurchführt, statt die Route aufzugeben.
      const list = nogos
        .map((n) => `${n.lng.toFixed(5)},${n.lat.toFixed(5)},${n.radius}`)
        .join('|');
      url += `&nogos=${list}`;
    }

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
      // Abschnittsweise Wegedaten für die Wegetyp-Auswertung; BRouter liefert
      // sie als Tabelle mit Kopfzeile mit.
      segments: this._parseMessages(props.messages),
      engine: 'brouter',
    };
  },

  /**
   * Wandelt BRouters `messages`-Tabelle in Abschnitte um.
   * Aufbau: erste Zeile Spaltennamen, danach je ein Wegabschnitt mit
   * Koordinate, Länge und den OSM-Tags des Weges.
   * @returns {?Array<{lat:number,lng:number,length:number,tags:object}>}
   */
  _parseMessages(messages) {
    if (!Array.isArray(messages) || messages.length < 2) return null;

    const header = messages[0].map((h) => String(h).toLowerCase());
    const idxLon = header.indexOf('longitude');
    const idxLat = header.indexOf('latitude');
    const idxDist = header.indexOf('distance');
    const idxTags = header.indexOf('waytags');
    if (idxDist < 0 || idxTags < 0) return null;

    const segments = [];
    for (let i = 1; i < messages.length; i++) {
      const row = messages[i];
      const length = parseFloat(row[idxDist]);
      if (!Number.isFinite(length) || length <= 0) continue;

      // WayTags kommen als "highway=path surface=ground sac_scale=hiking".
      const tags = {};
      String(row[idxTags] || '').split(/\s+/).forEach((pair) => {
        const eq = pair.indexOf('=');
        if (eq > 0) tags[pair.slice(0, eq)] = pair.slice(eq + 1);
      });

      segments.push({
        // BRouter gibt die Koordinaten hier in Mikrograd an.
        lng: idxLon >= 0 ? Number(row[idxLon]) / 1e6 : null,
        lat: idxLat >= 0 ? Number(row[idxLat]) / 1e6 : null,
        length,
        tags,
      });
    }
    return segments.length > 0 ? segments : null;
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
