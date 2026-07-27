'use strict';

/**
 * Wettervorhersage für den Startpunkt zur geplanten Zeit über Open-Meteo
 * (kostenlos, ohne Zugangsschlüssel). Braucht naturgemäß eine Verbindung –
 * ohne Netz bleibt der Bereich einfach leer.
 */
const Weather = {
  URL: 'https://api.open-meteo.com/v1/forecast',

  /** Kürzel des Deutschen Wetterdienstes für die Wettercodes von Open-Meteo. */
  CODES: {
    0: ['Klar', '☀'], 1: ['Überwiegend klar', '🌤'], 2: ['Teils bewölkt', '⛅'],
    3: ['Bedeckt', '☁'], 45: ['Nebel', '🌫'], 48: ['Reifnebel', '🌫'],
    51: ['Leichter Niesel', '🌦'], 53: ['Niesel', '🌦'], 55: ['Starker Niesel', '🌧'],
    56: ['Gefrierender Niesel', '🌧'], 57: ['Gefrierender Niesel', '🌧'],
    61: ['Leichter Regen', '🌦'], 63: ['Regen', '🌧'], 65: ['Starker Regen', '🌧'],
    66: ['Gefrierender Regen', '🌧'], 67: ['Gefrierender Regen', '🌧'],
    71: ['Leichter Schneefall', '🌨'], 73: ['Schneefall', '🌨'],
    75: ['Starker Schneefall', '❄'], 77: ['Schneegriesel', '🌨'],
    80: ['Regenschauer', '🌦'], 81: ['Regenschauer', '🌧'], 82: ['Heftige Schauer', '⛈'],
    85: ['Schneeschauer', '🌨'], 86: ['Starke Schneeschauer', '❄'],
    95: ['Gewitter', '⛈'], 96: ['Gewitter mit Hagel', '⛈'], 99: ['Schweres Gewitter', '⛈'],
  },

  /**
   * Holt die Vorhersage für den Zeitraum der Tour.
   * @param {{lat:number,lng:number}} point
   * @param {Date} start
   * @param {number} hours geschätzte Dauer
   * @returns {Promise<?{summary:string, icon:string, tempMin:number, tempMax:number,
   *                     rainChance:number, rainMm:number, windMax:number, hourly:Array}>}
   */
  async forecast(point, start, hours) {
    // Open-Meteo liefert bis zu 16 Tage im Voraus; darüber hinaus hat eine
    // Anfrage keinen Sinn.
    const daysAhead = (start - Date.now()) / 86400000;
    if (daysAhead > 15) return null;

    const date = this._isoDate(start);
    const url = `${this.URL}?latitude=${point.lat.toFixed(4)}&longitude=${point.lng.toFixed(4)}` +
      '&hourly=temperature_2m,precipitation_probability,precipitation,weathercode,windspeed_10m' +
      `&timezone=auto&start_date=${date}&end_date=${this._isoDate(
        new Date(start.getTime() + hours * 3600000)
      )}`;

    const response = await Utils.fetchWithTimeout(url, {}, 12000);
    if (!response.ok) throw new Error(`Wetterdienst antwortet mit HTTP ${response.status}.`);

    const data = await response.json();
    if (!data.hourly || !Array.isArray(data.hourly.time)) return null;

    // Nur die Stunden der Tour betrachten.
    const from = start.getTime();
    const to = from + hours * 3600000;
    const hourly = [];
    data.hourly.time.forEach((iso, i) => {
      const t = new Date(iso).getTime();
      if (t < from - 1800000 || t > to + 1800000) return;
      hourly.push({
        time: new Date(iso),
        temp: data.hourly.temperature_2m[i],
        rainChance: data.hourly.precipitation_probability?.[i] ?? null,
        rain: data.hourly.precipitation?.[i] ?? 0,
        code: data.hourly.weathercode[i],
        wind: data.hourly.windspeed_10m?.[i] ?? null,
      });
    });

    if (hourly.length === 0) return null;

    const temps = hourly.map((h) => h.temp).filter(Number.isFinite);
    const chances = hourly.map((h) => h.rainChance).filter(Number.isFinite);
    const winds = hourly.map((h) => h.wind).filter(Number.isFinite);

    // Für die Zusammenfassung das ungünstigste Wetter der Tour nehmen –
    // beim Wandern zählt der schlechteste Abschnitt, nicht der Durchschnitt.
    const worstCode = hourly.reduce(
      (worst, h) => (h.code > worst ? h.code : worst), 0
    );
    const [summary, icon] = this.CODES[worstCode] || ['Unbekannt', '❓'];

    return {
      summary,
      icon,
      tempMin: temps.length ? Math.min(...temps) : null,
      tempMax: temps.length ? Math.max(...temps) : null,
      rainChance: chances.length ? Math.max(...chances) : null,
      rainMm: hourly.reduce((sum, h) => sum + (h.rain || 0), 0),
      windMax: winds.length ? Math.max(...winds) : null,
      hourly,
    };
  },

  _isoDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  },

  /** Kurztext für die Anzeige. */
  describe(f) {
    if (!f) return null;
    const parts = [`${f.icon} ${f.summary}`];
    if (f.tempMin != null) {
      parts.push(f.tempMin === f.tempMax
        ? `${Math.round(f.tempMax)} °C`
        : `${Math.round(f.tempMin)} bis ${Math.round(f.tempMax)} °C`);
    }
    if (f.rainChance != null) parts.push(`Regen ${Math.round(f.rainChance)} %`);
    if (f.rainMm >= 0.2) parts.push(`${f.rainMm.toFixed(1)} mm`);
    if (f.windMax != null) parts.push(`Wind bis ${Math.round(f.windMax)} km/h`);
    return parts.join(' · ');
  },
};
