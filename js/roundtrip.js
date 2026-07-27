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

  // Erkennung von Stichwegen: Ein Zwischenpunkt, der nur über einen
  // Sackgassen-Abstecher erreichbar ist, zwingt den Router hin und wieder
  // zurück. Auf der Karte sieht das aus wie ein Dorn an der Schleife.
  SPUR_TOLERANCE_M: 35,   // wie nah Hin- und Rückweg beieinander liegen müssen
  SPUR_MIN_LENGTH_M: 120, // kürzere Abstecher fallen nicht auf
  SPUR_STEPS: 5,          // so viele Stützpunkte müssen sich spiegeln
  SPUR_PASSES: 2,         // Durchläufe: nach dem Kürzen kann ein neuer entstehen

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
    return this._withoutSpurs(best, settings, onProgress);
  },

  /**
   * Entfernt Zwischenpunkte, die nur über einen Stichweg zu erreichen sind,
   * und berechnet die Schleife ohne sie neu.
   *
   * Ursache solcher Dornen: Die Stützpunkte liegen auf einem gedachten Kreis,
   * ohne Rücksicht auf den Wegeverlauf. Fällt einer davon auf eine Lichtung
   * oder ans Ende eines Forstwegs, muss der Router hin und auf demselben Weg
   * wieder zurück.
   */
  async _withoutSpurs(best, settings, onProgress) {
    let current = best;
    let removed = 0;

    for (let pass = 0; pass < this.SPUR_PASSES; pass++) {
      const spurs = this.findSpurs(current.points, current.route.coordinates);
      if (spurs.length === 0) break;

      const points = current.points.filter((_, i) => !spurs.includes(i));
      // Unter vier Punkten bleibt keine Schleife mehr übrig – dann lieber
      // die Tour mit Dorn als gar keine.
      if (points.length < 4) break;

      onProgress(`${spurs.length} Stichweg(e) gefunden – berechne ohne sie neu …`);
      let route;
      try {
        route = await Routing.fetchRoute(points, { ...settings, roundTrip: false });
      } catch (err) {
        break;
      }
      removed += spurs.length;
      current = { ...current, points, route };
    }

    return { ...current, removedSpurs: removed };
  },

  /**
   * Sucht Zwischenpunkte, die auf einem Hin-und-zurück-Abstecher liegen.
   *
   * Erkannt wird das an der Geometrie selbst: Rund um einen solchen Punkt
   * spiegelt sich die Strecke – der Punkt davor liegt fast genau dort, wo
   * auch der Punkt danach liegt.
   *
   * @param {Array<{lat:number,lng:number}>} points Stützpunkte der Planung
   * @param {Array<[number,number]>} coordinates berechnete Geometrie [lng, lat]
   * @returns {number[]} Indizes der Punkte, die entfallen sollten
   */
  findSpurs(points, coordinates) {
    if (!coordinates || coordinates.length < 2 * this.SPUR_STEPS + 3) return [];

    const spurs = [];
    // Start und Ziel sind derselbe Punkt – die bleiben in jedem Fall stehen.
    for (let i = 1; i < points.length - 1; i++) {
      const k = this._nearestIndex(coordinates, points[i]);
      const length = this._spurLength(coordinates, k);
      if (length >= this.SPUR_MIN_LENGTH_M) spurs.push(i);
    }
    return spurs;
  },

  /**
   * Länge des Abstechers um den Geometriepunkt `k`, oder 0, wenn sich die
   * Strecke dort nicht spiegelt.
   */
  _spurLength(coordinates, k) {
    let matched = 0;
    let length = 0;

    for (let j = 1; k - j >= 0 && k + j < coordinates.length; j++) {
      const before = { lat: coordinates[k - j][1], lng: coordinates[k - j][0] };
      const after = { lat: coordinates[k + j][1], lng: coordinates[k + j][0] };
      if (Utils.haversine(before, after) > this.SPUR_TOLERANCE_M) break;

      matched++;
      // Weg vom Wendepunkt aus gerechnet – das ist die Länge des Dorns.
      length += Utils.haversine(
        { lat: coordinates[k - j + 1][1], lng: coordinates[k - j + 1][0] },
        before
      );
    }

    return matched >= this.SPUR_STEPS ? length : 0;
  },

  /** Index des Geometriepunkts, der einem Stützpunkt am nächsten liegt. */
  _nearestIndex(coordinates, point) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < coordinates.length; i++) {
      const d = Utils.haversine(point, { lat: coordinates[i][1], lng: coordinates[i][0] });
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
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
