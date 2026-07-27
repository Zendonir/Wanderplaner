'use strict';

/**
 * Abgleich der Sammlung mit dem Server, damit alle Geräte denselben Stand
 * sehen. Ohne Server (Datei direkt im Browser geöffnet) arbeitet die App
 * unverändert nur mit dem localStorage weiter.
 *
 * Zusammengeführt wird eintragsweise über `updatedAt`; Löschungen bleiben als
 * Grabstein (`deletedAt`) erhalten, sonst käme ein auf Gerät A gelöschter
 * Eintrag beim nächsten Abgleich von Gerät B zurück.
 */
const Sync = {
  API_URL: 'api/data',
  COLLECTIONS: ['stamps', 'parking', 'tracks', 'tours'],

  available: false,   // Server erreichbar?
  lastSync: null,
  pending: false,
  // Gesetzt, wenn der Server zwar antwortet, aber nicht speichern kann –
  // sonst sähe ein wirkungsloser Abgleich wie ein erfolgreicher aus.
  problem: null,

  /** Prüft einmalig, ob ein Sync-Server hinter der App steht. */
  async probe() {
    try {
      const response = await Utils.fetchWithTimeout('api/health', {}, 4000);
      this.available = response.ok;
      this.problem = null;
      if (response.ok) {
        const health = await response.json().catch(() => null);
        if (health && health.storage && health.storage.writable === false) {
          this.problem = `Der Server kann sein Datenverzeichnis ` +
            `${health.storage.path} nicht beschreiben (${health.storage.reason}).`;
        }
      }
    } catch (err) {
      this.available = false;
      this.problem = null;
    }
    return this.available;
  },

  /** Versieht einen Eintrag mit Änderungszeitpunkt. */
  touch(item) {
    item.updatedAt = Date.now();
    return item;
  },

  /** Erzeugt einen Grabstein für einen gelöschten Eintrag. */
  tombstone(item) {
    return {
      id: item.id,
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    };
  },

  /** Entfernt Grabsteine – für die Anzeige. */
  visible(items) {
    return (items || []).filter((item) => !item.deletedAt);
  },

  /**
   * Führt zwei Listen eintragsweise zusammen; bei gleicher id gewinnt der
   * neuere Zeitstempel.
   */
  mergeList(mine, theirs) {
    const byId = new Map();
    const put = (item) => {
      if (!item || !item.id) return;
      const stamp = Number(item.updatedAt) || 0;
      const existing = byId.get(item.id);
      if (!existing || stamp >= (Number(existing.updatedAt) || 0)) {
        byId.set(item.id, item);
      }
    };
    (mine || []).forEach(put);
    (theirs || []).forEach(put);
    return [...byId.values()];
  },

  /**
   * Schickt den lokalen Stand zum Server und liefert den vereinigten zurück.
   * @param {{stamps:Array, parking:Array, tracks:Array, tours:Array}} local
   * @returns {Promise<object|null>} vereinigter Stand oder null bei Fehler
   */
  async push(local) {
    if (!this.available) return null;
    this.pending = true;
    try {
      const payload = {};
      this.COLLECTIONS.forEach((name) => { payload[name] = local[name] || []; });

      const response = await Utils.fetchWithTimeout(
        this.API_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        15000
      );
      if (!response.ok) {
        // Der Server ist da, kommt aber nicht zum Ziel. Das ist etwas
        // anderes als „kein Server“ und muss auch so benannt werden.
        const detail = await response.json().catch(() => null);
        this.problem = (detail && detail.error) || `Der Server meldet HTTP ${response.status}.`;
        return null;
      }

      const merged = await response.json();
      this.problem = null;
      this.lastSync = new Date();
      return merged;
    } catch (err) {
      console.warn('Abgleich fehlgeschlagen:', err);
      this.available = false; // bei der nächsten Gelegenheit erneut prüfen
      this.problem = null;
      return null;
    } finally {
      this.pending = false;
    }
  },

  /** Holt den Serverstand, ohne etwas zu senden. */
  async pull() {
    if (!this.available) return null;
    try {
      const response = await Utils.fetchWithTimeout(this.API_URL, {}, 15000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      this.lastSync = new Date();
      return data;
    } catch (err) {
      console.warn('Abgleich fehlgeschlagen:', err);
      this.available = false;
      return null;
    }
  },

  formatLastSync() {
    if (!this.lastSync) return 'noch nicht abgeglichen';
    return `zuletzt ${this.lastSync.toLocaleTimeString('de-DE', {
      hour: '2-digit', minute: '2-digit',
    })} Uhr`;
  },
};

/**
 * Sicherung der gesamten Sammlung als Datei – unabhängig vom Server, etwa
 * zum Umziehen auf ein anderes Gerät oder als Backup.
 */
const Backup = {
  build(state) {
    return {
      format: 'wanderplaner-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      stamps: state.stamps,
      parking: state.parking,
      tracks: state.tracks,
      tours: state.savedTours,
    };
  },

  download(state) {
    const data = this.build(state);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `_${pad(now.getHours())}-${pad(now.getMinutes())}`;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wanderplaner-sicherung_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /**
   * Liest eine Sicherungsdatei.
   * @returns {{stamps:Array, parking:Array, tracks:Array, tours:Array}}
   */
  parse(text) {
    const data = JSON.parse(text);
    if (data.format !== 'wanderplaner-backup') {
      throw new Error('Die Datei ist keine Wanderplaner-Sicherung.');
    }
    return {
      stamps: Array.isArray(data.stamps) ? data.stamps : [],
      parking: Array.isArray(data.parking) ? data.parking : [],
      tracks: Array.isArray(data.tracks) ? data.tracks : [],
      tours: Array.isArray(data.tours) ? data.tours : [],
    };
  },
};
