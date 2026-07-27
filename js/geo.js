'use strict';

/**
 * Eigener Standort über die Geolocation-Schnittstelle des Browsers.
 * Braucht HTTPS (oder localhost) – bei reinem HTTP verweigern die Browser
 * den Zugriff, darauf weist die App dann hin.
 */
const Geo = {
  watchId: null,
  position: null,   // {lat, lng, accuracy}
  active: false,

  get supported() {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  },

  /** Ohne sicheren Kontext liefert der Browser dauerhaft Fehler. */
  get secureContext() {
    return window.isSecureContext ||
      ['localhost', '127.0.0.1'].includes(window.location.hostname);
  },

  /**
   * Startet die fortlaufende Standortverfolgung.
   * @param {(pos:{lat:number,lng:number,accuracy:number}) => void} onUpdate
   * @param {(message:string) => void} onError
   */
  start(onUpdate, onError) {
    if (!this.supported) {
      onError('Dieses Gerät oder dieser Browser kennt keine Standortbestimmung.');
      return false;
    }
    if (!this.secureContext) {
      onError('Standort braucht eine verschlüsselte Verbindung (HTTPS). ' +
              'Hinter einem Reverse Proxy mit Zertifikat funktioniert es.');
      return false;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.position = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        this.active = true;
        onUpdate(this.position);
      },
      (err) => {
        this.active = false;
        const messages = {
          1: 'Zugriff auf den Standort wurde abgelehnt.',
          2: 'Der Standort ist gerade nicht ermittelbar (kein Empfang?).',
          3: 'Die Standortbestimmung hat zu lange gedauert.',
        };
        onError(messages[err.code] || 'Der Standort konnte nicht ermittelt werden.');
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
    return true;
  },

  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.active = false;
    this.position = null;
  },

  get running() {
    return this.watchId !== null;
  },
};
