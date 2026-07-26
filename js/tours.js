'use strict';

/**
 * Geplante Touren mit Namen speichern, laden und verwalten.
 * Gespeichert werden die gesetzten Routenpunkte, die POIs und die
 * Routing-Einstellungen – die Route selbst wird beim Laden neu berechnet.
 */
const Tours = {
  STORAGE_KEY: 'wanderplaner.touren',

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data.items)) return [];
      return data.items.filter((t) => Array.isArray(t.points));
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

  /** Erzeugt einen Eintrag aus dem aktuellen Planungsstand. */
  fromState(name, state) {
    return {
      id: Utils.uid(),
      name,
      savedAt: new Date().toISOString(),
      distance: Math.round(state.distance || 0),
      points: state.points.map((p) => ({ lat: p.lat, lng: p.lng })),
      pois: state.pois.map((p) => ({
        lat: p.lat, lng: p.lng, name: p.name, note: p.note,
      })),
      routing: { ...state.routing },
      preset: state.preset,
    };
  },

  formatSavedAt(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  },
};
