'use strict';

/**
 * Macht aus den rohen OSM-Merkmalen eines importierten POI etwas Lesbares.
 *
 * Viele GPX-Ausgaben schreiben die Merkmale als eine Zeile in die
 * Beschreibung: `natural=peak name=Einersberg ele=591.7 …`. Für die Karte ist
 * das Ballast – zugleich steckt darin alles, was man wissen will: um was für
 * eine Stelle es sich handelt, wie hoch sie liegt, ob es eine Webseite oder
 * ein Bild dazu gibt.
 *
 * Dieses Modul zerlegt die Zeile, ordnet die Stelle einer Art zu und holt die
 * paar Angaben heraus, die beim Wandern zählen. Alles Übrige bleibt erhalten
 * und ist im Popup unter „Alle Merkmale“ einsehbar.
 */
const PoiTypes = {
  /**
   * Arten in der Reihenfolge der Prüfung: Die erste passende gewinnt, also
   * stehen die spezielleren oben. Farbe und Zeichen erscheinen auf der Karte.
   */
  TYPES: [
    { key: 'peak', label: 'Gipfel', icon: '⛰', color: '#6b5334',
      test: (t) => t.natural === 'peak' || t.natural === 'hill' },
    { key: 'viewpoint', label: 'Aussichtspunkt', icon: '🔭', color: '#1d5fbf',
      test: (t) => t.tourism === 'viewpoint' },
    { key: 'tower', label: 'Turm', icon: '🗼', color: '#5b4b8a',
      test: (t) => t.man_made === 'tower' || t.man_made === 'obelisk'
        || (t['tower:type'] || '').includes('observation') },
    { key: 'hut', label: 'Hütte / Schutzhütte', icon: '🛖', color: '#8a5a2b',
      test: (t) => t.amenity === 'shelter' || t.tourism === 'alpine_hut'
        || t.tourism === 'wilderness_hut' || t.building === 'hut' },
    { key: 'food', label: 'Einkehr', icon: '🍽', color: '#c0392b',
      test: (t) => ['restaurant', 'cafe', 'pub', 'bar', 'biergarten', 'fast_food']
        .includes(t.amenity) },
    { key: 'water', label: 'Wasser', icon: '💧', color: '#1d7fbf',
      test: (t) => t.natural === 'spring' || t.amenity === 'drinking_water'
        || t.man_made === 'water_well' },
    { key: 'waterfall', label: 'Wasserfall', icon: '🌊', color: '#1d7fbf',
      test: (t) => t.waterway === 'waterfall' },
    { key: 'lake', label: 'Gewässer', icon: '🏞', color: '#2b8fa8',
      test: (t) => t.natural === 'water' || t.landuse === 'reservoir' },
    { key: 'cave', label: 'Höhle', icon: '🕳', color: '#4a4a4a',
      test: (t) => t.natural === 'cave_entrance' },
    { key: 'mine', label: 'Bergbau', icon: '⛏', color: '#4a4a4a',
      test: (t) => t.man_made === 'mineshaft' || t.man_made === 'adit'
        || t.historic === 'mine' || t.historic === 'mine_shaft' },
    { key: 'rock', label: 'Fels', icon: '🪨', color: '#6b7568',
      test: (t) => ['rock', 'stone', 'cliff', 'arch'].includes(t.natural) },
    { key: 'castle', label: 'Burg / Ruine', icon: '🏰', color: '#8a6100',
      test: (t) => ['castle', 'ruins', 'fort', 'city_gate'].includes(t.historic)
        || t.ruins === 'yes' },
    { key: 'church', label: 'Kirche / Kapelle', icon: '⛪', color: '#7a6a4a',
      test: (t) => t.amenity === 'place_of_worship' || t.building === 'chapel'
        || t.historic === 'chapel' },
    { key: 'monument', label: 'Denkmal', icon: '🗿', color: '#7a6a4a',
      test: (t) => ['monument', 'memorial', 'wayside_cross', 'wayside_shrine',
        'boundary_stone', 'archaeological_site'].includes(t.historic) },
    { key: 'museum', label: 'Museum', icon: '🏛', color: '#7a6a4a',
      test: (t) => t.tourism === 'museum' },
    { key: 'park', label: 'Park / Garten', icon: '🌳', color: '#2f6b3f',
      test: (t) => t.leisure === 'park' || t.leisure === 'garden' },
    { key: 'attraction', label: 'Sehenswürdigkeit', icon: '📍', color: '#8a5a2b',
      test: (t) => t.tourism === 'attraction' || t.tourism === 'artwork' },
    { key: 'lodging', label: 'Übernachtung', icon: '🛏', color: '#c0392b',
      test: (t) => ['hotel', 'guest_house', 'hostel', 'camp_site', 'chalet']
        .includes(t.tourism) },
    { key: 'rest', label: 'Rastplatz', icon: '🪑', color: '#2f6b3f',
      test: (t) => t.amenity === 'bench' || t.leisure === 'picnic_table'
        || t.tourism === 'picnic_site' },
    { key: 'info', label: 'Infotafel', icon: 'ℹ', color: '#2f6b3f',
      test: (t) => t.tourism === 'information' || t.information },
    { key: 'transit', label: 'Haltestelle', icon: '🚌', color: '#1d5fbf',
      test: (t) => t.highway === 'bus_stop' || t.railway === 'station'
        || t.railway === 'halt' || t.public_transport },
    { key: 'parking', label: 'Parkplatz', icon: '🅿', color: '#1d5fbf',
      test: (t) => t.amenity === 'parking' },
  ],

  DEFAULT: { key: 'other', label: 'POI', icon: '⚑', color: '#2f6b3f' },

  /**
   * Zerlegt eine Merkmalszeile in ein Objekt. Werte dürfen Leerzeichen
   * enthalten – erkannt wird das daran, dass der nächste Baustein selbst kein
   * `schlüssel=wert` ist. Sonst zerfiele „name=Kleiner Winterberg“ in zwei
   * unbrauchbare Teile.
   */
  parseTags(text) {
    const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
    const tags = {};
    let key = null;
    for (const token of tokens) {
      const match = token.match(/^([a-z][a-z0-9_:]*)=(.*)$/i);
      if (match) {
        key = match[1].toLowerCase();
        tags[key] = match[2];
      } else if (key) {
        tags[key] = `${tags[key]} ${token}`.trim();
      }
    }
    return tags;
  },

  /**
   * Steckt in dem Text eine Merkmalsliste?
   *
   * Die Ausgaben aus OSM schreiben je Merkmal eine Zeile. Das ist ein viel
   * verlässlicheres Kennzeichen als der Anteil von `schlüssel=wert` am
   * ganzen Text: Eine Hütte mit langem Hinweistext („Übernachtung
   * ausschließlich im Vorraum, die Hütte selbst ist verschlossen.“) hat
   * mehr gewöhnliche Wörter als Merkmale und rutschte über eine reine
   * Quote sonst durch.
   */
  looksLikeTags(text) {
    const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const tagLines = lines.filter((line) => /^[a-z][a-z0-9_:]*=/i.test(line)).length;
    if (tagLines >= 2) return true;
    // Ein einziges Merkmal reicht, wenn sonst nichts dasteht: Ein
    // Aussichtspunkt ohne Namen trägt nur `tourism=viewpoint`, und das ist
    // keine Notiz, die jemand geschrieben hätte.
    if (tagLines === 1 && lines.length === 1) return true;
    // Einzeilige Schreibweise, durch Leerzeichen getrennt.
    return PointStore.isTagDump(text);
  },

  /** Merkmale eines POI – egal ob schon zerlegt oder noch als Rohtext. */
  tagsOf(poi) {
    if (poi && poi.tags && typeof poi.tags === 'object') return poi.tags;
    if (poi && this.looksLikeTags(poi.note)) return this.parseTags(poi.note);
    return {};
  },

  /**
   * Name für die Anzeige. Punkte ohne eigenen Namen tragen in OSM-Ausgaben
   * die Objektkennung als Namen – „node/32600612“ sagt niemandem etwas.
   * Dann ist die Art der Stelle die bessere Auskunft.
   */
  displayName(poi) {
    const name = String((poi && poi.name) || '').trim();
    if (!name || /^(node|way|relation)\/\d+$/i.test(name)) {
      return this.typeOf(poi).label;
    }
    return name;
  },

  /** Art der Stelle: Zeichen, Beschriftung und Farbe für die Karte. */
  classify(tags) {
    const found = this.TYPES.find((type) => {
      try {
        return type.test(tags || {});
      } catch (err) {
        return false;
      }
    });
    return found || this.DEFAULT;
  },

  /** Kurzform für einen POI. */
  typeOf(poi) {
    return this.classify(this.tagsOf(poi));
  },

  /**
   * Verweise, die sich anklicken lassen. Wikipedia und Wikidata stehen in
   * OSM nicht als Adresse, sondern als Kürzel – daraus wird hier eine
   * richtige Adresse gebaut.
   */
  links(tags, extraLink) {
    const out = [];
    const add = (label, url) => {
      if (!url) return;
      if (out.some((l) => l.url === url)) return;
      out.push({ label, url });
    };

    const web = tags.website || tags.url || tags['contact:website'];
    if (web) add('Webseite', this._httpUrl(web));

    if (tags.wikipedia) {
      // Form: „de:Einersberg“ – Sprache und Titel.
      const [lang, ...rest] = String(tags.wikipedia).split(':');
      const title = rest.join(':');
      if (title) {
        add('Wikipedia',
          `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`);
      }
    }
    if (tags.wikidata && /^Q\d+$/.test(tags.wikidata)) {
      add('Wikidata', `https://www.wikidata.org/wiki/${tags.wikidata}`);
    }
    if (tags['contact:email'] || tags.email) {
      add('E-Mail', `mailto:${tags['contact:email'] || tags.email}`);
    }
    if (tags.phone || tags['contact:phone']) {
      add('Telefon', `tel:${String(tags.phone || tags['contact:phone']).replace(/\s/g, '')}`);
    }
    // Der <link> aus der GPX-Datei zeigt auf das Objekt in OSM. Dort steht
    // immer der vollständige, aktuelle Stand – auch das, was die Ausgabe
    // beim Export weggelassen hat.
    if (extraLink) {
      const url = this._httpUrl(extraLink);
      if (url) add(/openstreetmap|osm\.org/i.test(url) ? 'OpenStreetMap' : 'Quelle', url);
    }
    return out;
  },

  _httpUrl(value) {
    const text = String(value).trim();
    if (!text) return null;
    if (/^https?:\/\//i.test(text)) return text;
    if (/^[\w.-]+\.[a-z]{2,}/i.test(text)) return `https://${text}`;
    return null;
  },

  /**
   * Adresse eines Bildes, falls die Merkmale eines nennen.
   *
   * `image=` steht oft direkt als Adresse drin. `wikimedia_commons=File:…`
   * dagegen ist nur ein Dateiname; Wikimedia liefert dazu über
   * `Special:FilePath` ein Bild in gewünschter Breite.
   */
  imageUrl(tags, width = 320) {
    const commons = tags.wikimedia_commons || tags.image_commons;
    if (commons) {
      const file = String(commons).replace(/^File:/i, '').trim();
      if (file) {
        return 'https://commons.wikimedia.org/wiki/Special:FilePath/' +
          `${encodeURIComponent(file.replace(/ /g, '_'))}?width=${width}`;
      }
    }
    const direct = this._httpUrl(tags.image || tags.picture || '');
    return direct;
  },

  /** Die Angaben, die beim Wandern zählen – in fester Reihenfolge. */
  FACTS: [
    { key: 'ele', label: 'Höhe', format: (v) => {
      const num = Number(v);
      return Number.isFinite(num) ? `${num.toFixed(0)} m` : String(v);
    } },
    { key: 'opening_hours', label: 'Öffnungszeiten' },
    { key: 'operator', label: 'Betreiber' },
    { key: 'access', label: 'Zugang' },
    { key: 'fee', label: 'Gebühr' },
    { key: 'shelter_type', label: 'Art' },
    { key: 'material', label: 'Material' },
    { key: 'start_date', label: 'Erbaut' },
    { key: 'inscription', label: 'Inschrift' },
  ],

  facts(tags) {
    return this.FACTS
      .filter((f) => tags[f.key])
      .map((f) => ({
        label: f.label,
        value: f.format ? f.format(tags[f.key]) : String(tags[f.key]),
      }));
  },

  /**
   * Beschreibender Text, sofern die Merkmale einen enthalten. Der Name zählt
   * nicht dazu – der steht schon in der Überschrift.
   */
  description(tags) {
    return String(tags.description || tags.note || tags.inscription || '').trim();
  },

  /** Alle übrigen Merkmale, alphabetisch – für die Ausklappliste. */
  rest(tags) {
    const shown = new Set([
      'name', 'description', 'note', 'ele', 'website', 'url', 'contact:website',
      'wikipedia', 'wikidata', 'wikimedia_commons', 'image_commons', 'image',
      'picture', 'phone', 'contact:phone', 'email', 'contact:email',
      ...this.FACTS.map((f) => f.key),
    ]);
    return Object.keys(tags)
      .filter((k) => !shown.has(k))
      .sort()
      .map((k) => ({ key: k, value: tags[k] }));
  },
};
