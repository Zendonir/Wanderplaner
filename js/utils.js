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

  /**
   * Bringt Punkte in eine möglichst kurze Besuchsreihenfolge (offener Weg):
   * Nearest-Neighbor-Start plus 2-Opt-Verbesserung auf Luftlinien-Basis.
   * Für die typische Anzahl an Stempelstellen pro Tour völlig ausreichend.
   * @param {Array<{lat:number, lng:number}>} points
   * @returns {Array} dieselben Objekte in optimierter Reihenfolge
   */
  optimizeOrder(points) {
    const n = points.length;
    if (n <= 2) return points.slice();

    const dist = [];
    for (let i = 0; i < n; i++) {
      dist.push([]);
      for (let j = 0; j < n; j++) {
        dist[i][j] = i === j ? 0 : this.haversine(points[i], points[j]);
      }
    }

    // Nearest Neighbor ab dem ersten Punkt
    const order = [0];
    const used = new Array(n).fill(false);
    used[0] = true;
    while (order.length < n) {
      const last = order[order.length - 1];
      let best = -1;
      let bestDist = Infinity;
      for (let j = 0; j < n; j++) {
        if (!used[j] && dist[last][j] < bestDist) {
          bestDist = dist[last][j];
          best = j;
        }
      }
      used[best] = true;
      order.push(best);
    }

    // 2-Opt: Teilstücke umdrehen, solange der Weg dadurch kürzer wird
    let improved = true;
    let passes = 0;
    while (improved && passes < 50) {
      improved = false;
      passes++;
      for (let i = 1; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          const before =
            dist[order[i - 1]][order[i]] +
            (j + 1 < n ? dist[order[j]][order[j + 1]] : 0);
          const after =
            dist[order[i - 1]][order[j]] +
            (j + 1 < n ? dist[order[i]][order[j + 1]] : 0);
          if (after < before - 0.01) {
            let lo = i;
            let hi = j;
            while (lo < hi) {
              [order[lo], order[hi]] = [order[hi], order[lo]];
              lo++;
              hi--;
            }
            improved = true;
          }
        }
      }
    }

    return order.map((i) => points[i]);
  },
};
