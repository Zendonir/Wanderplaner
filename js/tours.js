'use strict';

/**
 * Geplante Touren mit Namen speichern, laden und verwalten.
 *
 * Gespeichert werden die gesetzten Routenpunkte, die POIs und die
 * Routing-Einstellungen – beim Laden wird die Route daraus neu berechnet.
 * Zusätzlich wird der berechnete Verlauf ausgedünnt mitgeschrieben, damit
 * die Tour auf der Karte zu sehen ist, ohne sie erst laden zu müssen, und
 * damit beim Abhaken als „abgeschlossen“ die echte Strecke übernommen wird.
 */
const Tours = {
  STORAGE_KEY: 'wanderplaner.touren',

  // Blautöne für die Planung – abgeschlossene Touren tragen die wärmeren
  // Farben aus Tracks.COLORS, damit sich beides auf der Karte unterscheidet.
  COLORS: ['#1d5fbf', '#0e8a6a', '#6c4bd1', '#0f7b9c', '#2f6b3f', '#8a5a00'],

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data.items)) return [];
      return data.items.filter((t) => t.deletedAt || Array.isArray(t.points));
    } catch (err) {
      console.warn('Gespeicherte Touren konnten nicht geladen werden:', err);
      return [];
    }
  },

  save(items) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ version: 1, items }));
      return true;
    } catch (err) {
      console.warn('Touren konnten nicht gespeichert werden:', err);
      return false;
    }
  },

  /**
   * Erzeugt einen Eintrag aus dem aktuellen Planungsstand.
   * @param {string} name
   * @param {object} state
   * @param {number} existingCount für die Farbwahl
   */
  fromState(name, state, existingCount = 0) {
    return {
      id: Utils.uid(),
      name,
      savedAt: new Date().toISOString(),
      updatedAt: Date.now(),
      distance: Math.round(state.distance || 0),
      color: this.COLORS[existingCount % this.COLORS.length],
      visible: true,
      points: state.points.map((p) => ({ lat: p.lat, lng: p.lng })),
      // Der berechnete Verlauf, ausgedünnt und auf ~1 m gerundet.
      line: this.lineFrom(state.geometry),
      pois: state.pois.map((p) => ({
        lat: p.lat, lng: p.lng, name: p.name, note: p.note,
      })),
      routing: { ...state.routing },
      preset: state.preset,
    };
  },

  /** Macht aus der Routengeometrie eine sparsame [lat, lng]-Liste. */
  lineFrom(geometry) {
    if (!Array.isArray(geometry) || geometry.length < 2) return [];
    const points = geometry.map((c) => ({ lat: c[1], lng: c[0] }));
    const round = (v) => Math.round(v * 1e5) / 1e5;
    return Tracks.simplify(points).map((p) => [round(p.lat), round(p.lng)]);
  },

  /**
   * Der Linienzug einer Tour für die Karte. Ohne mitgeschriebenen Verlauf –
   * etwa bei Touren aus einer älteren Fassung – bleiben die Routenpunkte als
   * grobe Näherung.
   */
  toLatLngs(tour) {
    const line = Array.isArray(tour.line) && tour.line.length > 1
      ? tour.line.map((p) => ({ lat: p[0], lng: p[1] }))
      : (tour.points || []).map((p) => ({ lat: p.lat, lng: p.lng }));
    return line;
  },

  formatSavedAt(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  },
};
