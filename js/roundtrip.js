'use strict';

/**
 * Erzeugt eine Rundtour mit ungefährer Wunschlänge ab einem Startpunkt.
 *
 * Verfahren: Zwischenpunkte werden auf einen Kreis um den Start gelegt und
 * geroutet. Weil die tatsächliche Wegstrecke fast immer länger ist als der
 * Kreisumfang, wird der Radius in wenigen Schritten nachgeregelt, bis die
 * Länge passt. Jeder Versuch kostet eine Routing-Anfrage – deshalb wenige
 * Durchläufe und ein großzügiges Toleranzfenster.
 */
const RoundTrip = {
  MAX_ATTEMPTS: 5,
  TOLERANCE: 0.15,   // 15 % Abweichung gelten als Treffer

  /**
   * @param {{lat:number,lng:number}} start
   * @param {number} targetKm gewünschte Länge
   * @param {object} settings Routing-Einstellungen
   * @param {number} bearingDeg Richtung, in die die Schleife zeigt
   * @param {(msg:string) => void} onProgress
   * @returns {Promise<{points:Array, route:object, attempts:number}>}
   */
  async generate(start, targetKm, settings, bearingDeg = 0, onProgress = () => {}) {
    const targetM = targetKm * 1000;

    // Startradius: Umfang eines Kreises mit der Zielstrecke, abzüglich eines
    // Zuschlags, weil echte Wege nie exakt im Kreis verlaufen.
    let radius = (targetM / (2 * Math.PI)) * 0.75;
    let best = null;

    for (let attempt = 1; attempt <= this.MAX_ATTEMPTS; attempt++) {
      onProgress(`Versuch ${attempt} von ${this.MAX_ATTEMPTS} …`);

      const points = this._ring(start, radius, bearingDeg);
      let route;
      try {
        route = await Routing.fetchRoute(points, { ...settings, roundTrip: false });
      } catch (err) {
        // Punkt liegt zu weit von einem Weg entfernt: kleineren Kreis testen.
        radius *= 0.8;
        continue;
      }

      const error = Math.abs(route.distance - targetM) / targetM;
      if (!best || error < best.error) {
        best = { points, route, error, attempts: attempt };
      }
      if (error <= this.TOLERANCE) break;

      // Radius proportional zur Abweichung nachziehen, aber gedämpft, damit
      // die Anpassung nicht überschwingt.
      const factor = targetM / route.distance;
      radius *= 1 + (factor - 1) * 0.7;
      radius = Math.max(200, Math.min(radius, targetM / 2));
    }

    if (!best) {
      throw new Error(
        'Von hier aus ließ sich keine Rundtour berechnen – der Startpunkt liegt ' +
        'vermutlich zu weit von einem Weg entfernt.'
      );
    }
    return best;
  },

  /**
   * Legt Punkte auf einen Kreis um den Start. Der Start selbst ist Anfang
   * und Ende, dazwischen liegen fünf Stützpunkte – genug für eine runde
   * Schleife, wenig genug für eine schnelle Berechnung.
   */
  _ring(start, radius, bearingDeg) {
    const points = [{ lat: start.lat, lng: start.lng }];
    const count = 5;

    for (let i = 0; i < count; i++) {
      // Ungleichmäßige Verteilung wirkt natürlicher als ein exakter Kreis.
      const angle = bearingDeg + (360 / count) * i + (i % 2 === 0 ? 12 : -12);
      const wobble = i % 2 === 0 ? 1 : 0.82;
      points.push(this._offset(start, radius * wobble, angle));
    }
    points.push({ lat: start.lat, lng: start.lng });
    return points;
  },

  /** Punkt in `meters` Entfernung unter dem Kurswinkel `bearing`. */
  _offset(origin, meters, bearing) {
    const rad = (bearing * Math.PI) / 180;
    const dLat = (meters * Math.cos(rad)) / 111320;
    const dLng = (meters * Math.sin(rad)) /
      (111320 * Math.cos((origin.lat * Math.PI) / 180) || 1);
    return { lat: origin.lat + dLat, lng: origin.lng + dLng };
  },
};
