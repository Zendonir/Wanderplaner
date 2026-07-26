'use strict';

/**
 * Kleine Hilfsfunktionen ohne Abhängigkeiten zu anderen Modulen.
 */
const Utils = {
  /** Verzögert Aufrufe, bis `ms` Millisekunden lang Ruhe war. */
  debounce(fn, ms) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  },

  /** Großkreis-Distanz in Metern zwischen zwei Punkten {lat, lng}. */
  haversine(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  },

  /** fetch mit Timeout, damit die App bei hängenden APIs nicht blockiert. */
  async fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  },

  /** Meter → "12,3 km" bzw. "850 m" */
  formatDistance(meters) {
    if (meters >= 1000) {
      return (meters / 1000).toLocaleString('de-DE', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }) + ' km';
    }
    return Math.round(meters) + ' m';
  },

  /** Höhenmeter → "540 Hm" */
  formatClimb(meters) {
    return Math.round(meters).toLocaleString('de-DE') + ' Hm';
  },

  /** Stunden (dezimal) → "3:45 h" */
  formatDuration(hours) {
    const totalMin = Math.round(hours * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}:${String(m).padStart(2, '0')} h`;
  },

  /**
   * Gehzeit nach DIN 33466 (Faustformel des Alpenvereins):
   * 4 km/h horizontal, 300 Hm/h bergauf, 500 Hm/h bergab.
   * Gesamtzeit = größerer Wert + halber kleinerer Wert.
   */
  estimateWalkTime(distanceMeters, ascent, descent) {
    const horizontal = distanceMeters / 1000 / 4;
    if (ascent == null || descent == null) return horizontal;
    const vertical = ascent / 300 + descent / 500;
    return Math.max(horizontal, vertical) + Math.min(horizontal, vertical) / 2;
  },

  escapeXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  },

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },
};
