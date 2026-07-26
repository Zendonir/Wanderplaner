'use strict';

/**
 * Links auf externe Karten-Apps, für die QR-Codes am Parkplatz bzw. am
 * Startpunkt. Ein iPhone öffnet `maps.apple.com`-Links direkt in der
 * Karten-App, Android-Geräte öffnen `maps.google.com` in Google Maps.
 */
const MapLinks = {
  SERVICES: {
    apple: { label: 'Apple Karten (iPhone)' },
    google: { label: 'Google Maps' },
    geo: { label: 'geo: (Standard-App)' },
  },

  MODES: {
    show: { label: 'Ort anzeigen' },
    drive: { label: 'Route dorthin (Auto)' },
  },

  /**
   * @param {{lat:number, lng:number, name?:string}} point
   * @param {'apple'|'google'|'geo'} service
   * @param {'show'|'drive'} mode
   * @returns {string} URL für den QR-Code
   */
  build(point, service = 'apple', mode = 'show') {
    const lat = point.lat.toFixed(6);
    const lng = point.lng.toFixed(6);
    const name = encodeURIComponent(point.name || 'Parkplatz');

    if (service === 'google') {
      return mode === 'drive'
        ? `https://maps.google.com/maps?daddr=${lat},${lng}&dirflg=d`
        : `https://maps.google.com/maps?q=${lat},${lng}`;
    }
    if (service === 'geo') {
      // Nur "Ort anzeigen"; geo: kennt keine Navigationsabsicht.
      return `geo:${lat},${lng}?q=${lat},${lng}(${name})`;
    }
    // Apple Karten
    return mode === 'drive'
      ? `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
      : `https://maps.apple.com/?ll=${lat},${lng}&q=${name}`;
  },
};
