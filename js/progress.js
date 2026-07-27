'use strict';

/**
 * Fortschritt beim Stempelsammeln: Stufen, Zähler und ein wenig Chronik.
 *
 * Die Stufen sind an die Harzer Wandernadel angelehnt, lassen sich aber
 * anpassen – andere Sammlungen haben andere Schwellen.
 */
const Progress = {
  SETTINGS_KEY: 'wanderplaner.stufen',

  DEFAULT_LEVELS: [
    { at: 11, label: 'Bronze', icon: '🥉' },
    { at: 24, label: 'Silber', icon: '🥈' },
    { at: 50, label: 'Gold', icon: '🥇' },
    { at: 111, label: 'Wanderkönig', icon: '👑' },
    { at: 222, label: 'Wanderkaiser', icon: '🏆' },
  ],

  levels() {
    try {
      const raw = localStorage.getItem(this.SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (err) {
      console.warn('Stufen konnten nicht geladen werden:', err);
    }
    return this.DEFAULT_LEVELS;
  },

  saveLevels(levels) {
    try {
      localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(levels));
    } catch (err) {
      console.warn('Stufen konnten nicht gespeichert werden:', err);
    }
  },

  /**
   * Wertet den Sammelstand aus.
   * @param {Array} stamps sichtbare Stempelstellen
   * @returns {{collected:number, total:number, share:number, current:?object,
   *            next:?object, remaining:number, thisYear:number, last:?object,
   *            perYear:Array<{year:number, count:number}>}}
   */
  summary(stamps) {
    const collected = stamps.filter((s) => s.collected);
    const levels = this.levels();

    // Höchste erreichte und nächste offene Stufe.
    let current = null;
    let next = null;
    for (const level of levels) {
      if (collected.length >= level.at) current = level;
      else if (!next) next = level;
    }

    const now = new Date();
    const dated = collected
      .filter((s) => s.collectedAt)
      .sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt));

    const perYear = new Map();
    dated.forEach((s) => {
      const year = new Date(s.collectedAt).getFullYear();
      if (Number.isFinite(year)) perYear.set(year, (perYear.get(year) || 0) + 1);
    });

    return {
      collected: collected.length,
      total: stamps.length,
      share: stamps.length > 0 ? collected.length / stamps.length : 0,
      current,
      next,
      remaining: next ? next.at - collected.length : 0,
      thisYear: perYear.get(now.getFullYear()) || 0,
      undated: collected.length - dated.length,
      last: dated[0] || null,
      perYear: [...perYear.entries()]
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => b.year - a.year),
    };
  },

  formatDate(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  },
};
