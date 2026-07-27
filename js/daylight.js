'use strict';

/**
 * Sonnenauf- und -untergang nach dem Verfahren des NOAA Solar Calculator.
 * Reine Rechnung ohne Netzzugriff – wichtig, damit die Warnung auch im
 * Funkloch funktioniert.
 *
 * Genauigkeit: rund eine Minute für mitteleuropäische Breiten.
 */
const Daylight = {
  // Sonnenmittelpunkt 0,833° unter dem Horizont: berücksichtigt Refraktion
  // und den scheinbaren Radius der Sonne.
  ZENITH: 90.833,

  _rad(deg) { return (deg * Math.PI) / 180; },
  _deg(rad) { return (rad * 180) / Math.PI; },

  /** Tage seit dem 1.1.2000, 12:00 UTC. */
  _julianDay(date) {
    return date.getTime() / 86400000 + 2440587.5;
  },

  /**
   * Sonnenauf- und -untergang für einen Ort und einen Tag.
   * @param {Date} date  Tag (Uhrzeit wird ignoriert)
   * @param {number} lat
   * @param {number} lng
   * @returns {{sunrise: ?Date, sunset: ?Date, polarDay: boolean, polarNight: boolean}}
   */
  /**
   * Sonnendeklination und Zeitgleichung für ein julianisches Jahrhundert.
   * @returns {{decl:number, eqTime:number}} decl in Grad, eqTime in Minuten
   */
  _solarPosition(jc) {
    const sin = (d) => Math.sin(this._rad(d));
    const cos = (d) => Math.cos(this._rad(d));

    // Geometrische mittlere Länge und Anomalie der Sonne
    const l0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
    const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
    const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);

    // Mittelpunktsgleichung → wahre Länge
    const c = sin(m) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
            + sin(2 * m) * (0.019993 - 0.000101 * jc)
            + sin(3 * m) * 0.000289;
    const trueLong = l0 + c;

    // Scheinbare Länge (Nutation und Aberration)
    const omega = 125.04 - 1934.136 * jc;
    const appLong = trueLong - 0.00569 - 0.00478 * sin(omega);

    // Schiefe der Ekliptik
    const epsilon0 = 23 + (26 + 21.448 / 60) / 60
                   - (jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 3600;
    const epsilon = epsilon0 + 0.00256 * cos(omega);

    const decl = this._deg(Math.asin(sin(epsilon) * sin(appLong)));

    // Zeitgleichung in Minuten
    const y = Math.tan(this._rad(epsilon / 2)) ** 2;
    const eqTime = 4 * this._deg(
      y * sin(2 * l0)
      - 2 * e * sin(m)
      + 4 * e * y * sin(m) * cos(2 * l0)
      - 0.5 * y * y * sin(4 * l0)
      - 1.25 * e * e * sin(2 * m)
    );

    return { decl, eqTime };
  },

  times(date, lat, lng) {
    // Julianischer Tag für Mitternacht UTC des gewünschten Kalendertags.
    const midnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const jdMidnight = midnight / 86400000 + 2440587.5;

    let polar = null;

    /** Ereigniszeit in Minuten nach Mitternacht UTC. */
    const compute = (isSunrise) => {
      // Startschätzung: Sonnenmittag am Ort.
      let minutes = 720 - 4 * lng;

      // Zwei Durchläufe: beim zweiten wird die Sonnenposition bereits zum
      // geschätzten Ereigniszeitpunkt ausgewertet – ohne das liegt die
      // Rechnung im Winter über zehn Minuten daneben.
      for (let i = 0; i < 2; i++) {
        const jc = (jdMidnight + minutes / 1440 - 2451545.0) / 36525;
        const { decl, eqTime } = this._solarPosition(jc);

        const cosHa =
          Math.cos(this._rad(this.ZENITH)) /
            (Math.cos(this._rad(lat)) * Math.cos(this._rad(decl)))
          - Math.tan(this._rad(lat)) * Math.tan(this._rad(decl));

        if (cosHa > 1) { polar = 'night'; return null; }
        if (cosHa < -1) { polar = 'day'; return null; }

        const ha = this._deg(Math.acos(cosHa)) * (isSunrise ? 1 : -1);
        minutes = 720 - 4 * (lng + ha) - eqTime;
      }
      return minutes;
    };

    const riseMin = compute(true);
    const setMin = compute(false);
    const toDate = (min) => (min == null ? null : new Date(midnight + min * 60000));

    return {
      sunrise: toDate(riseMin),
      sunset: toDate(setMin),
      polarDay: polar === 'day',
      polarNight: polar === 'night',
    };
  },

  /**
   * Prüft, ob eine Tour im Hellen zu schaffen ist.
   * @param {Date} start        geplante Startzeit
   * @param {number} hours      geschätzte Gehzeit in Stunden
   * @param {{lat:number, lng:number}} point Startpunkt der Tour
   * @returns {{finish:Date, sunset:?Date, sunrise:?Date, level:'ok'|'tight'|'dark'|'unknown', message:string}}
   */
  check(start, hours, point) {
    const finish = new Date(start.getTime() + hours * 3600000);
    const { sunrise, sunset, polarDay, polarNight } = this.times(start, point.lat, point.lng);

    const fmt = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    if (polarDay) {
      return { finish, sunset, sunrise, level: 'ok', message: 'Die Sonne geht heute nicht unter.' };
    }
    if (polarNight || !sunset) {
      return {
        finish, sunset, sunrise, level: 'unknown',
        message: 'Für diesen Ort und Tag lässt sich kein Sonnenuntergang bestimmen.',
      };
    }

    const reserveMin = (sunset - finish) / 60000;
    const base = `Ankunft gegen ${fmt(finish)} Uhr, Sonnenuntergang ${fmt(sunset)} Uhr`;

    if (reserveMin < 0) {
      return {
        finish, sunset, sunrise, level: 'dark',
        message: `${base} – die Tour endet ${Math.round(-reserveMin)} Minuten nach Einbruch der Dunkelheit. Stirnlampe einpacken oder früher starten.`,
      };
    }
    if (reserveMin < 60) {
      return {
        finish, sunset, sunrise, level: 'tight',
        message: `${base} – nur ${Math.round(reserveMin)} Minuten Reserve. Wenig Spielraum für Pausen.`,
      };
    }
    const hoursLeft = Math.floor(reserveMin / 60);
    const minsLeft = Math.round(reserveMin % 60);
    return {
      finish, sunset, sunrise, level: 'ok',
      message: `${base} – ${hoursLeft} h ${minsLeft} min Reserve bis zur Dunkelheit.`,
    };
  },
};
