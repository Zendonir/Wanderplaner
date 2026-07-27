'use strict';

/**
 * Sucht nützliche Orte entlang der Route über die Overpass-API von
 * OpenStreetMap: Einkehr, Trinkwasser, Toiletten, Unterstände und
 * Haltestellen.
 *
 * Overpass ist ein öffentlicher Dienst mit Fair-Use-Grenzen – deshalb wird
 * der Korridor ausgedünnt, die Anfrage bleibt klein und Ergebnisse werden
 * für die laufende Sitzung zwischengespeichert.
 */
const Overpass = {
  URL: 'https://overpass-api.de/api/interpreter',
  FALLBACK_URL: 'https://overpass.kumi.systems/api/interpreter',
  MAX_CORRIDOR_POINTS: 60,

  CATEGORIES: {
    food: {
      label: 'Einkehr',
      icon: '🍽',
      color: '#b35c00',
      // Hütten zuerst: für Wanderungen die wichtigste Gruppe.
      filters: [
        'node["tourism"~"^(alpine_hut|wilderness_hut)$"]',
        'node["amenity"~"^(restaurant|cafe|pub|biergarten|fast_food)$"]',
      ],
    },
    water: {
      label: 'Trinkwasser',
      icon: '💧',
      color: '#1d5fbf',
      filters: [
        'node["amenity"="drinking_water"]',
        'node["natural"="spring"]["drinking_water"="yes"]',
      ],
    },
    toilets: {
      label: 'Toiletten',
      icon: '🚻',
      color: '#5c6f00',
      filters: ['node["amenity"="toilets"]'],
    },
    shelter: {
      label: 'Schutzhütte',
      icon: '⛺',
      color: '#7b3fa0',
      filters: ['node["amenity"="shelter"]'],
    },
    transit: {
      label: 'Haltestelle',
      icon: '🚌',
      color: '#a01f5b',
      filters: [
        'node["highway"="bus_stop"]',
        'node["railway"~"^(station|halt|tram_stop)$"]',
      ],
    },
  },

  _cache: new Map(),

  /**
   * Dünnt die Routengeometrie aus, damit die Anfrage kurz bleibt.
   * @returns {Array<[number,number]>} [lat, lng]-Paare
   */
  _corridor(coordinates) {
    const step = Math.max(1, Math.ceil(coordinates.length / this.MAX_CORRIDOR_POINTS));
    const points = [];
    for (let i = 0; i < coordinates.length; i += step) {
      points.push([coordinates[i][1], coordinates[i][0]]);
    }
    const last = coordinates[coordinates.length - 1];
    points.push([last[1], last[0]]);
    return points;
  },

  /**
   * Sucht Orte im Korridor um die Route.
   * @param {Array<[number,number]>} coordinates Routengeometrie [lng, lat]
   * @param {string[]} categories Schlüssel aus CATEGORIES
   * @param {number} radius Meter neben der Route
   * @returns {Promise<Array>} Orte mit lat, lng, name, category
   */
  async search(coordinates, categories, radius = 500) {
    if (!coordinates || coordinates.length < 2 || categories.length === 0) return [];

    const corridor = this._corridor(coordinates);
    const around = `around:${radius},` +
      corridor.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',');

    const parts = [];
    for (const key of categories) {
      const category = this.CATEGORIES[key];
      if (!category) continue;
      for (const filter of category.filters) {
        parts.push(`${filter}(${around});`);
      }
    }
    if (parts.length === 0) return [];

    const query = `[out:json][timeout:25];(${parts.join('')});out center 200;`;
    const cacheKey = query;
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);

    const data = await this._request(query);
    const results = (data.elements || [])
      .map((el) => this._toPlace(el, categories))
      .filter(Boolean);

    this._cache.set(cacheKey, results);
    return results;
  },

  async _request(query) {
    const body = 'data=' + encodeURIComponent(query);
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    };

    try {
      const response = await Utils.fetchWithTimeout(this.URL, options, 30000);
      if (response.ok) return await response.json();
      // 429/504 heißt meist: Dienst überlastet – Spiegelserver versuchen.
      if (![429, 504, 503].includes(response.status)) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      console.warn('Overpass-Hauptserver nicht erreichbar:', err);
    }

    const response = await Utils.fetchWithTimeout(this.FALLBACK_URL, options, 30000);
    if (!response.ok) {
      throw new Error('Die Umgebungssuche ist gerade nicht erreichbar.');
    }
    return await response.json();
  },

  /** Ordnet ein Overpass-Element einer Kategorie zu. */
  _toPlace(el, categories) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const tags = el.tags || {};
    let category = null;
    if (tags.tourism === 'alpine_hut' || tags.tourism === 'wilderness_hut' ||
        ['restaurant', 'cafe', 'pub', 'biergarten', 'fast_food'].includes(tags.amenity)) {
      category = 'food';
    } else if (tags.amenity === 'drinking_water' || tags.natural === 'spring') {
      category = 'water';
    } else if (tags.amenity === 'toilets') {
      category = 'toilets';
    } else if (tags.amenity === 'shelter') {
      category = 'shelter';
    } else if (tags.highway === 'bus_stop' || tags.railway) {
      category = 'transit';
    }
    if (!category || !categories.includes(category)) return null;

    const kind = tags.tourism === 'alpine_hut' ? 'Berghütte'
      : tags.tourism === 'wilderness_hut' ? 'Selbstversorgerhütte'
      : tags.amenity === 'restaurant' ? 'Gaststätte'
      : tags.amenity === 'cafe' ? 'Café'
      : tags.amenity === 'pub' ? 'Kneipe'
      : tags.amenity === 'biergarten' ? 'Biergarten'
      : tags.amenity === 'fast_food' ? 'Imbiss'
      : tags.amenity === 'drinking_water' ? 'Trinkwasser'
      : tags.natural === 'spring' ? 'Quelle'
      : tags.amenity === 'toilets' ? 'Toilette'
      : tags.amenity === 'shelter' ? 'Unterstand'
      : tags.railway ? 'Bahn'
      : 'Bushaltestelle';

    return {
      id: `${el.type}/${el.id}`,
      lat,
      lng,
      category,
      kind,
      name: tags.name || kind,
      opening: tags.opening_hours || null,
      seasonal: tags.seasonal || null,
    };
  },
};
