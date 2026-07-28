'use strict';

/**
 * Anwendungslogik: Zustand, UI-Rendering und Orchestrierung von
 * Karte, Routing, Höhenprofil und Export.
 */
(function () {
  const state = {
    mode: 'menu',       // 'menu' (Klick fragt nach) | 'route' | 'poi'
    points: [],         // [{id, lat, lng}]
    pois: [],           // [{id, lat, lng, name, note}]
    stamps: Stamps.load(), // [{id, lat, lng, name, note, collected}] – persistent
    parking: Parking.load(), // Parkplätze – persistent
    tracks: Tracks.load(),   // abgeschlossene Touren als Spur – persistent
    savedTours: Tours.load(), // benannte Planungen – persistent
    tourName: '',
    version: null,
    routeStyle: localStorage.getItem('wanderplaner.routestyle') || 'plain',
    tourSelection: [],  // Stempel-IDs, die in den Routenvorschlag sollen
    routing: loadRoutingSettings(), // Gewichtung der Wegetypen
    preset: localStorage.getItem('wanderplaner.preset') || 'wander',
    geometry: null,     // [[lng, lat], ...] der berechneten Route
    segments: null,     // Wegabschnitte mit OSM-Tags (nur BRouter)
    alternatives: [],   // von BRouter angebotene Varianten
    activeAlternative: 0,
    places: [],         // Fundstellen der Umgebungssuche
    clusters: null,     // Tourenvorschläge aus Stempelgruppen
    placeCategories: loadPlaceCategories(),
    distance: 0,        // Meter
    samples: null,      // [{lat, lng, dist, ele}] Höhen-Stützpunkte
    ascent: null,
    descent: null,
    undoStack: [],
  };

  let poiCounter = 1;
  let requestId = 0; // verwirft veraltete API-Antworten
  let chart = null;
  let dragIndex = null;

  const SLIDER_KEYS = [
    'avoidRoads', 'preferHiking', 'preferMarked', 'preferPaths', 'preferTracks',
    'avoidPaved', 'avoidRoughSurface', 'avoidSteep', 'avoidBadVisibility',
  ];
  const SLIDER_LABELS = ['aus', 'leicht', 'mittel', 'stark'];

  function loadRoutingSettings() {
    try {
      const raw = localStorage.getItem('wanderplaner.routing');
      if (raw) return { ...Profiles.defaultSettings(), ...JSON.parse(raw) };
    } catch (err) {
      console.warn('Routing-Einstellungen konnten nicht geladen werden:', err);
    }
    return Profiles.defaultSettings();
  }

  function loadPlaceCategories() {
    try {
      const raw = localStorage.getItem('wanderplaner.places');
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn('Kategorien konnten nicht geladen werden:', err);
    }
    return ['food', 'water'];
  }

  function saveRoutingSettings() {
    try {
      localStorage.setItem('wanderplaner.routing', JSON.stringify(state.routing));
      localStorage.setItem('wanderplaner.preset', state.preset);
    } catch (err) {
      console.warn('Routing-Einstellungen konnten nicht gespeichert werden:', err);
    }
  }

  const el = {
    status: document.getElementById('status'),
    distance: document.getElementById('stat-distance'),
    ascent: document.getElementById('stat-ascent'),
    descent: document.getElementById('stat-descent'),
    time: document.getElementById('stat-time'),
    modeMenu: document.getElementById('mode-menu'),
    modeRoute: document.getElementById('mode-route'),
    modePoi: document.getElementById('mode-poi'),
    modeHint: document.getElementById('mode-hint'),
    undo: document.getElementById('btn-undo'),
    clear: document.getElementById('btn-clear'),
    export: document.getElementById('btn-export'),
    pointList: document.getElementById('point-list'),
    poiList: document.getElementById('poi-list'),
    importType: document.getElementById('import-type'),
    importBtn: document.getElementById('btn-import'),
    importFile: document.getElementById('import-file'),
    stampCounter: document.getElementById('stamp-counter'),
    stampSearch: document.getElementById('stamp-search'),
    stampFilter: document.getElementById('stamp-filter'),
    stampList: document.getElementById('stamp-list'),
    tourCount: document.getElementById('tour-count'),
    suggest: document.getElementById('btn-suggest'),
    tourClear: document.getElementById('btn-tour-clear'),
    importHint: document.getElementById('import-hint'),
    parkingList: document.getElementById('parking-list'),
    trackList: document.getElementById('track-list'),
    tourList: document.getElementById('tour-list'),
    tourNameInput: document.getElementById('tour-name'),
    saveTour: document.getElementById('btn-save-tour'),
    roundTrip: document.getElementById('opt-roundtrip'),
    preset: document.getElementById('rs-preset'),
    presetBadge: document.getElementById('preset-badge'),
    presetDescription: document.getElementById('preset-description'),
    sacLimit: document.getElementById('rs-sacLimit'),
    allowSteps: document.getElementById('rs-allowSteps'),
    engineNote: document.getElementById('engine-note'),
    chartEmpty: document.getElementById('chart-empty'),
    searchForm: document.getElementById('search-form'),
    searchInput: document.getElementById('search-input'),
    layout: document.getElementById('layout'),
    sidebar: document.getElementById('sidebar'),
    sheetHandle: document.getElementById('sheet-handle'),
    profilePanel: document.querySelector('.profile-panel'),
    library: document.getElementById('library'),
    libraryToggle: document.getElementById('btn-library'),
    syncBadge: document.getElementById('sync-badge'),
    syncStatus: document.getElementById('sync-status'),
    syncBtn: document.getElementById('btn-sync'),
    backupBtn: document.getElementById('btn-backup'),
    restoreBtn: document.getElementById('btn-restore'),
    restoreFile: document.getElementById('restore-file'),
    startTime: document.getElementById('start-time'),
    nowBtn: document.getElementById('btn-now'),
    daylightNote: document.getElementById('daylight-note'),
    alongSection: document.getElementById('section-along'),
    alongRadius: document.getElementById('along-radius'),
    alongCount: document.getElementById('along-count'),
    alongList: document.getElementById('along-list'),
    locate: document.getElementById('btn-locate'),
    reverse: document.getElementById('btn-reverse'),
    genLength: document.getElementById('gen-length'),
    genBearing: document.getElementById('gen-bearing'),
    generate: document.getElementById('btn-generate'),
    generatorNote: document.getElementById('generator-note'),
    altSection: document.getElementById('section-alternatives'),
    altList: document.getElementById('alternative-list'),
    waytypeSection: document.getElementById('section-waytypes'),
    waytypeBars: document.getElementById('waytype-bars'),
    showPaved: document.getElementById('opt-show-paved'),
    warningSection: document.getElementById('section-warnings'),
    warningList: document.getElementById('warning-list'),
    placeFilters: document.getElementById('place-filters'),
    placeRadius: document.getElementById('place-radius'),
    placesBtn: document.getElementById('btn-places'),
    placeNote: document.getElementById('place-note'),
    placeList: document.getElementById('place-list'),
    weatherNote: document.getElementById('weather-note'),
    tabs: document.querySelectorAll('.tab'),
    panels: document.querySelectorAll('.tab-panel'),
    progressBox: document.getElementById('progress-box'),
    clusterLength: document.getElementById('cluster-length'),
    clustersBtn: document.getElementById('btn-clusters'),
    clusterList: document.getElementById('cluster-list'),
    appVersion: document.getElementById('app-version'),
    shellVersion: document.getElementById('shell-version'),
    reloadShell: document.getElementById('btn-reload-shell'),
    checkUpdate: document.getElementById('btn-check-update'),
    runUpdate: document.getElementById('btn-run-update'),
    updateSetup: document.getElementById('update-setup'),
    updateReason: document.getElementById('update-reason'),
    updateNote: document.getElementById('update-note'),
    routeStyle: document.getElementById('route-style'),
    settings: document.getElementById('settings'),
    settingsBtn: document.getElementById('btn-settings'),
    settingsClose: document.getElementById('btn-settings-close'),
    stampDetails: document.getElementById('stamp-details'),
  };

  /* ---------- Sammlungen: speichern, löschen, abgleichen ---------- */

  // Verbindet die vier Sammlungen mit ihrem Speicher und dem Feld im state.
  const STORES = {
    stamps: { store: Stamps, key: 'stamps' },
    parking: { store: Parking, key: 'parking' },
    tracks: { store: Tracks, key: 'tracks' },
    tours: { store: Tours, key: 'savedTours' },
  };

  /** Sichtbare Einträge einer Sammlung (ohne gelöschte). */
  function items(name) {
    return Sync.visible(state[STORES[name].key]);
  }

  /** Lokal speichern und den Abgleich mit dem Server anstoßen. */
  function persist(name) {
    const { store, key } = STORES[name];
    const ok = store.save(state[key]);
    scheduleSync();
    return ok !== false;
  }

  /**
   * Löscht einen Eintrag als Grabstein: der Eintrag bleibt mit `deletedAt`
   * erhalten, damit der Abgleich ihn nicht von einem anderen Gerät zurückholt.
   */
  function removeItem(name, id) {
    const { key } = STORES[name];
    const index = state[key].findIndex((i) => i.id === id);
    if (index < 0) return;
    state[key][index] = Sync.tombstone(state[key][index]);
    persist(name);
  }

  /** Übernimmt den vom Server vereinigten Stand. */
  function applyMerged(merged) {
    if (!merged) return;
    Object.entries(STORES).forEach(([name, { store, key }]) => {
      if (!Array.isArray(merged[name])) return;
      state[key] = Sync.mergeList(state[key], merged[name]);
      store.save(state[key]);
    });
    renderAll();
    updateSyncStatus();
  }

  const scheduleSync = Utils.debounce(runSync, 1500);

  async function runSync() {
    if (!Sync.available) {
      updateSyncStatus();
      return;
    }
    updateSyncStatus('busy');
    const merged = await Sync.push({
      stamps: state.stamps,
      parking: state.parking,
      tracks: state.tracks,
      tours: state.savedTours,
    });
    if (merged) applyMerged(merged);
    else updateSyncStatus();
  }

  /**
   * Sucht den Server, gleicht einmal ab und holt danach regelmäßig
   * Änderungen anderer Geräte.
   */
  async function initSync() {
    updateSyncStatus();
    await Sync.probe();
    if (!Sync.available) {
      updateSyncStatus();
      return;
    }
    await runSync();

    // Änderungen von anderen Geräten übernehmen, solange das Fenster sichtbar ist.
    setInterval(async () => {
      if (document.hidden || Sync.pending || !Sync.available) return;
      applyMerged(await Sync.pull());
    }, 30000);

    // Beim Zurückkehren auf den Tab sofort nachschauen.
    document.addEventListener('visibilitychange', async () => {
      if (!document.hidden && Sync.available && !Sync.pending) {
        applyMerged(await Sync.pull());
      }
    });
  }

  function updateSyncStatus(mode) {
    const badge = el.syncBadge;
    const status = el.syncStatus;

    if (mode === 'busy') {
      badge.textContent = '⟳ Abgleich …';
      badge.className = 'sync-badge busy';
      status.textContent = 'Abgleich läuft …';
      status.className = 'sync-status';
      return;
    }

    if (Sync.available && Sync.problem) {
      // Der Server antwortet, speichert aber nicht – das darf nicht wie ein
      // gelungener Abgleich aussehen.
      badge.textContent = '⚠ Abgleich gestört';
      badge.className = 'sync-badge offline';
      status.textContent = `${Sync.problem} Die Sammlung bleibt vorerst nur in diesem ` +
        'Browser. Hinweise dazu stehen in der README unter „Abgleich repariert sich nicht“.';
      status.className = 'sync-status offline';
    } else if (Sync.available) {
      badge.textContent = '☁ synchron';
      badge.className = 'sync-badge';
      status.textContent = `Abgleich mit dem Server aktiv – ${Sync.formatLastSync()}. ` +
        'Alle Geräte im Netz sehen denselben Stand.';
      status.className = 'sync-status ok';
    } else {
      badge.textContent = '⌂ nur dieses Gerät';
      badge.className = 'sync-badge offline';
      status.textContent = 'Kein Server erreichbar – die Daten liegen nur in diesem ' +
        'Browser. Zum Übertragen die Sicherung nutzen.';
      status.className = 'sync-status offline';
    }
    el.syncBtn.disabled = !Sync.available;
  }

  /* ---------- Statusmeldungen ---------- */

  let statusTimer = null;

  function showStatus(type, message, autoHideMs = 0) {
    clearTimeout(statusTimer);
    el.status.className = `status ${type}`;
    el.status.textContent = message;
    if (autoHideMs > 0) {
      statusTimer = setTimeout(hideStatus, autoHideMs);
    }
  }

  function hideStatus() {
    el.status.className = 'status hidden';
  }

  /* ---------- Undo ---------- */

  function pushUndo() {
    state.undoStack.push(
      JSON.stringify({
        points: state.points,
        pois: state.pois,
        stamps: state.stamps,
        parking: state.parking,
        tracks: state.tracks,
        tourSelection: state.tourSelection,
      })
    );
    if (state.undoStack.length > 50) state.undoStack.shift();
    updateButtons();
  }

  function undo() {
    const snapshot = state.undoStack.pop();
    if (!snapshot) return;
    const parsed = JSON.parse(snapshot);
    state.points = parsed.points;
    state.pois = parsed.pois;
    state.stamps = parsed.stamps || [];
    state.parking = parsed.parking || [];
    state.tracks = parsed.tracks || [];
    state.tourSelection = parsed.tourSelection || [];
    persist('stamps');
    persist('parking');
    persist('tracks');
    renderAll();
    scheduleRecalc();
  }

  /* ---------- Routenberechnung ---------- */

  const scheduleRecalc = Utils.debounce(recalcRoute, 400);

  // Hinweis, der erst nach der Neuberechnung stehen bleiben soll. Direkt
  // gesetzt würde ihn das „Berechne Route …“ sofort wieder verdrängen.
  let pendingNote = null;

  async function recalcRoute() {
    const id = ++requestId;

    if (state.points.length < 2) {
      state.geometry = null;
      state.segments = null;
      state.distance = 0;
      state.samples = null;
      state.ascent = null;
      state.descent = null;
      state.alternatives = [];
      state.places = [];
      state.elevations = null;
      drawRoute();
      MapView.renderPlaces(null);
      MapView.setSamples(null);
      el.altSection.hidden = true;
      updateWayTypes();
      updateWarnings();
      updateChart();
      updateStats();
      updateButtons();
      if (state.points.length === 1) {
        showStatus('info', 'Noch einen zweiten Punkt setzen, um die Route zu berechnen.', 4000);
      } else if (isFreshInstall()) {
        // Nur bei einer leeren Sammlung: Wer schon Touren und Stempel hat,
        // weiß, wie es geht, und braucht den Hinweis nicht jedes Mal.
        showStatus('info',
          'Klick auf die Karte öffnet ein Menü – dort „Routenpunkt anhängen“ wählen. ' +
          'Zum zügigen Zeichnen oben auf „✏ Zeichnen“ umschalten.', 12000);
      } else {
        hideStatus();
      }
      return;
    }

    showStatus('info', 'Berechne Route …');
    try {
      const route = await Routing.fetchRoute(state.points, state.routing);
      if (id !== requestId) return; // inzwischen gab es eine neuere Änderung

      state.activeAlternative = 0;
      applyRoute(route);
      updateEngineNote(route.engine);

      if (route.warning) showStatus('warn', route.warning, 10000);
      else if (pendingNote) showStatus('info', pendingNote, 12000);
      else hideStatus();
      pendingNote = null;

      await loadElevationAndFinish(id, route);

      // Varianten im Hintergrund nachladen; sie sind ein Angebot, kein
      // Grund, die Hauptroute zu verzögern.
      loadAlternatives();
    } catch (err) {
      if (id !== requestId) return;
      showStatus('error', `${err.message} Die Route wurde nicht aktualisiert.`);
    }
  }

  function useRouteElevations(elevations) {
    const samples = Elevation.sampleAlongWithElevation(state.geometry, elevations);
    state.samples = samples;
    const { ascent, descent } = Elevation.computeAscentDescent(elevations);
    state.ascent = ascent;
    state.descent = descent;
    MapView.setSamples(samples);
    updateChart();
    updateStats();
  }

  /** Übernimmt eine berechnete Route in den Zustand und zeichnet sie. */
  function applyRoute(route) {
    state.geometry = route.coordinates;
    state.segments = route.segments || null;
    state.elevations = route.elevations || null;
    state.distance = route.distance;
    drawRoute();
    updateWayTypes();
    updateWarnings();
    updateStats();
    updateButtons();
  }

  /** Zeichnet die Route in der gewählten Darstellung samt Legende. */
  function drawRoute() {
    if (!state.geometry) {
      MapView.renderRoute(null, state.points);
      MapView.renderLegend(null, null, null);
      return;
    }
    const styled = RouteStyle.build(
      state.routeStyle, state.geometry, state.elevations, state.segments
    );
    MapView.renderRoute(state.geometry, state.points, styled.sections);
    MapView.renderLegend(styled.legend, styled.note, styled.scale);
  }

  /** Höhen übernehmen (vom Router oder per Dienst) und Anzeige auffrischen. */
  async function loadElevationAndFinish(id, route) {
    if (route.elevations) {
      // BRouter liefert die Höhen bereits mit – keine Extra-Abfrage nötig.
      useRouteElevations(route.elevations);
    } else {
      await loadElevation(id);
    }
  }

  async function loadElevation(id) {
    const samples = Elevation.sampleAlong(state.geometry);
    try {
      const elevations = await Elevation.fetchElevations(samples);
      if (id !== requestId) return;

      samples.forEach((s, i) => { s.ele = elevations[i]; });
      state.samples = samples;
      const { ascent, descent } = Elevation.computeAscentDescent(elevations);
      state.ascent = ascent;
      state.descent = descent;
      MapView.setSamples(samples);
    } catch (err) {
      if (id !== requestId) return;
      console.warn('Höhendaten nicht verfügbar:', err);
      state.samples = null;
      state.ascent = null;
      state.descent = null;
      MapView.setSamples(samples.map((s) => ({ ...s, ele: null })));
      showStatus('warn', 'Höhendienste derzeit nicht erreichbar – Länge und Route bleiben gültig, Höhenprofil folgt bei der nächsten Änderung.', 8000);
    }
    updateChart();
    updateStats();
  }

  /* ---------- Statistiken ---------- */

  function updateStats() {
    el.distance.textContent = state.distance > 0 ? Utils.formatDistance(state.distance) : '0,0 km';
    el.ascent.textContent = state.ascent != null ? '↗ ' + Utils.formatClimb(state.ascent) : '–';
    el.descent.textContent = state.descent != null ? '↘ ' + Utils.formatClimb(state.descent) : '–';
    el.time.textContent = state.distance > 0
      ? Utils.formatDuration(Utils.estimateWalkTime(state.distance, state.ascent, state.descent))
      : '–';
    updateDaylight();
    updateAlongRoute();
    scheduleWeather();
  }

  function updateButtons() {
    el.undo.disabled = state.undoStack.length === 0;
    el.reverse.disabled = state.points.length < 2;
    el.generate.disabled = state.points.length === 0;
    el.placesBtn.disabled = !state.geometry || state.placeCategories.length === 0;
    el.clear.disabled = state.points.length === 0 && state.pois.length === 0;
    el.export.disabled = !state.geometry;
  }

  /* ---------- Höhenprofil (Chart.js) ---------- */

  // Farbe je Stützpunkt des Höhenprofils – null bedeutet einfarbig.
  let profileColors = null;

  const PROFILE_GREEN = '#2f6b3f';

  /**
   * Verlauf für die Fläche unter dem Profil: dieselben Farben wie die Linie,
   * nur blasser. Jeder Abschnitt bekommt zwei Haltepunkte, damit die
   * Übergänge genauso hart sind wie auf der Karte.
   */
  function profileGradient(context) {
    const area = context.chart.chartArea;
    if (!area || !profileColors) return RouteStyle.fade(PROFILE_GREEN, 0.18);

    const samples = state.samples;
    const scale = context.chart.scales.x;
    const gradient = context.chart.ctx.createLinearGradient(area.left, 0, area.right, 0);
    const span = area.right - area.left;

    // Über die x-Achse rechnen statt über den reinen Streckenanteil: nur so
    // liegt der Farbwechsel der Fläche genau unter dem der Linie.
    const at = (dist) => Math.min(1, Math.max(0,
      (scale.getPixelForValue(dist / 1000) - area.left) / span));

    for (let i = 1; i < samples.length; i++) {
      const color = RouteStyle.fade(profileColors[i], 0.35);
      gradient.addColorStop(at(samples[i - 1].dist), color);
      gradient.addColorStop(at(samples[i].dist), color);
    }
    return gradient;
  }

  function initChart() {
    const canvas = document.getElementById('elevation-chart');
    chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Höhe',
          data: [],
          borderColor: PROFILE_GREEN,
          backgroundColor: profileGradient,
          // Jedes Teilstück der Linie trägt die Farbe seines Endpunkts –
          // so passt das Profil zur eingefärbten Route auf der Karte.
          segment: {
            borderColor: (ctx) =>
              (profileColors ? profileColors[ctx.p1DataIndex] : undefined),
          },
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#1d5fbf',
          // Etwas kräftiger als üblich: Bei der Einfärbung nach Steigung
          // sollen auch kurze Abschnitte ihre Farbe zeigen.
          borderWidth: 3,
          tension: 0.25,
        }],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        onHover: (event, elements) => {
          if (elements.length > 0 && state.samples) {
            const s = state.samples[elements[0].index];
            if (s) MapView.setHoverPoint(s.lat, s.lng);
          }
        },
        scales: {
          x: {
            type: 'linear',
            min: 0,
            title: { display: true, text: 'Distanz (km)' },
            ticks: { maxTicksLimit: 12 },
          },
          y: {
            title: { display: true, text: 'Höhe (m)' },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) => `${items[0].parsed.x.toFixed(2)} km`,
              label: (item) => {
                const lines = [`${Math.round(item.parsed.y)} m`];
                // Voraussichtliche Gehzeit bis zu dieser Stelle – hilft bei
                // der Pausen- und Umkehrplanung.
                const reached = timeAt(item.dataIndex);
                if (reached) lines.push(`nach ${reached}`);
                return lines;
              },
            },
          },
        },
      },
    });

    canvas.addEventListener('mouseleave', () => MapView.clearHoverPoint());
  }

  function updateChart() {
    const hasData = state.samples && state.samples.some((s) => s.ele != null);
    chart.data.datasets[0].data = hasData
      ? state.samples.map((s) => ({ x: s.dist / 1000, y: s.ele }))
      : [];
    profileColors = hasData
      ? RouteStyle.sampleColors(
        state.routeStyle, state.samples, state.geometry, state.segments
      )
      : null;
    chart.update('none');
    el.chartEmpty.classList.toggle('hidden', Boolean(hasData));
    // Am Handy nimmt ein leeres Diagramm nur Platz weg; dort verschwindet
    // es, bis eine Route berechnet ist.
    el.profilePanel.classList.toggle('is-empty', !hasData);
    el.chartEmpty.textContent = state.geometry && !hasData
      ? 'Höhenprofil nicht verfügbar'
      : 'Noch keine Route berechnet';
  }

  /**
   * Geschätzte Gehzeit bis zu einem Stützpunkt, mit denselben Annahmen wie
   * die Gesamtzeit (DIN 33466) – dadurch bleiben Teil- und Gesamtzeit
   * zueinander stimmig.
   */
  function timeAt(index) {
    const samples = state.samples;
    if (!samples || index <= 0 || index >= samples.length) return null;

    let ascent = 0;
    let descent = 0;
    if (samples[0].ele != null) {
      for (let i = 1; i <= index; i++) {
        const diff = samples[i].ele - samples[i - 1].ele;
        if (diff > 0) ascent += diff;
        else descent -= diff;
      }
    }
    const hours = Utils.estimateWalkTime(
      samples[index].dist,
      samples[0].ele != null ? ascent : null,
      samples[0].ele != null ? descent : null
    );
    const start = plannedStart();
    const arrival = new Date(start.getTime() + hours * 3600000);
    return `${Utils.formatDuration(hours)} · ${arrival.toLocaleTimeString('de-DE',
      { hour: '2-digit', minute: '2-digit' })} Uhr`;
  }

  function highlightChartIndex(index) {
    if (!chart.data.datasets[0].data.length) return;
    const active = [{ datasetIndex: 0, index }];
    chart.setActiveElements(active);
    chart.tooltip.setActiveElements(active, { x: 0, y: 0 });
    chart.update('none');
  }

  function clearChartHighlight() {
    chart.setActiveElements([]);
    chart.tooltip.setActiveElements([], { x: 0, y: 0 });
    chart.update('none');
  }

  /* ---------- Listen in der Seitenleiste ---------- */

  function renderPointList() {
    el.pointList.innerHTML = '';

    if (state.points.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = 'Noch keine Punkte gesetzt';
      el.pointList.appendChild(li);
      return;
    }

    state.points.forEach((p, i) => {
      const li = document.createElement('li');
      li.draggable = true;
      li.dataset.index = i;
      // Ziehen mit der Maus ist bequem, am Handy aber unmöglich – deshalb
      // zusätzlich zwei Pfeile zum Verschieben.
      li.innerHTML =
        '<span class="drag-handle" title="Zum Sortieren ziehen">≡</span>' +
        `<span class="point-num">${i + 1}</span>` +
        `<span class="item-label" title="Auf der Karte zeigen">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>` +
        `<button class="item-action point-up" title="Nach oben"${i === 0 ? ' disabled' : ''}>▲</button>` +
        `<button class="item-action point-down" title="Nach unten"${i === state.points.length - 1 ? ' disabled' : ''}>▼</button>` +
        '<button class="item-delete" title="Punkt löschen">✕</button>';

      li.querySelector('.item-label').addEventListener('click', () => {
        MapView.setView(p.lat, p.lng, 15);
      });
      li.querySelector('.point-up').addEventListener('click', () => movePointBy(i, -1));
      li.querySelector('.point-down').addEventListener('click', () => movePointBy(i, 1));
      li.querySelector('.item-delete').addEventListener('click', () => deletePoint(p.id));

      li.addEventListener('dragstart', () => {
        dragIndex = i;
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => {
        dragIndex = null;
        li.classList.remove('dragging');
        el.pointList.querySelectorAll('.drag-over')
          .forEach((n) => n.classList.remove('drag-over'));
      });
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        li.classList.add('drag-over');
      });
      li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drag-over');
        if (dragIndex === null || dragIndex === i) return;
        pushUndo();
        const [moved] = state.points.splice(dragIndex, 1);
        state.points.splice(i, 0, moved);
        renderAll();
        scheduleRecalc();
      });

      el.pointList.appendChild(li);
    });
  }

  /** Verschiebt einen Routenpunkt um eine Stelle nach oben oder unten. */
  function movePointBy(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= state.points.length) return;
    pushUndo();
    const [moved] = state.points.splice(index, 1);
    state.points.splice(target, 0, moved);
    renderAll();
    scheduleRecalc();
  }

  function renderPoiList() {
    el.poiList.innerHTML = '';

    if (state.pois.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = 'Noch keine POIs gesetzt';
      el.poiList.appendChild(li);
      return;
    }

    state.pois.forEach((poi) => {
      const li = document.createElement('li');
      const note = poi.note
        ? ` <span class="item-note">· ${Utils.escapeHtml(poi.note)}</span>`
        : '';
      li.innerHTML =
        '<span>⚑</span>' +
        `<span class="item-label">${Utils.escapeHtml(poi.name)}${note}</span>` +
        '<button class="item-delete" title="POI löschen">✕</button>';
      li.querySelector('.item-label').addEventListener('click', () => {
        MapView.setView(poi.lat, poi.lng, 15);
        MapView.openPoiPopup(poi.id);
      });
      li.querySelector('.item-delete').addEventListener('click', () => deletePoi(poi.id));
      el.poiList.appendChild(li);
    });
  }

  /* ---------- Stempelstellen ---------- */

  function renderStampList() {
    const query = el.stampSearch.value.trim().toLowerCase();
    const filter = el.stampFilter.value;
    const selected = new Set(state.tourSelection);

    const all = items('stamps');
    const visible = all
      .filter((s) => {
        if (filter === 'open' && s.collected) return false;
        if (filter === 'collected' && !s.collected) return false;
        return !query || s.name.toLowerCase().includes(query);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));

    el.stampList.innerHTML = '';
    if (all.length === 0) {
      el.stampCounter.textContent = 'Noch keine Stempelstellen importiert';
    } else {
      const collected = all.filter((s) => s.collected).length;
      el.stampCounter.textContent =
        `${collected} von ${all.length} Stempeln erhalten` +
        (visible.length !== all.length
          ? ` · ${visible.length} angezeigt`
          : '');
    }

    if (visible.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = all.length === 0
        ? 'GPX-Datei mit Wegpunkten importieren'
        : 'Keine Treffer';
      el.stampList.appendChild(li);
      return;
    }

    visible.forEach((stamp) => {
      const li = document.createElement('li');
      if (stamp.collected) li.classList.add('collected');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = stamp.collected;
      checkbox.title = stamp.collected
        ? 'Als noch offen markieren'
        : 'Als erhalten markieren';
      checkbox.addEventListener('change', () => toggleStampCollected(stamp.id));

      const label = document.createElement('span');
      label.className = 'item-label';
      label.textContent = stamp.name;
      label.title = stamp.note ? `${stamp.name} – ${stamp.note}` : stamp.name;
      label.addEventListener('click', () => {
        MapView.setView(stamp.lat, stamp.lng, 15);
        MapView.openStampPopup(stamp.id);
      });

      const tourBtn = document.createElement('button');
      tourBtn.className = 'stamp-tour' + (selected.has(stamp.id) ? ' active' : '');
      tourBtn.textContent = selected.has(stamp.id) ? '⊖' : '⊕';
      tourBtn.title = selected.has(stamp.id)
        ? 'Aus der Tour-Auswahl entfernen'
        : 'Für den Routenvorschlag auswählen';
      tourBtn.addEventListener('click', () => toggleStampTour(stamp.id));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'item-delete';
      deleteBtn.textContent = '✕';
      deleteBtn.title = 'Stempelstelle löschen';
      deleteBtn.addEventListener('click', () => deleteStamp(stamp.id));

      li.append(checkbox, label, tourBtn, deleteBtn);
      el.stampList.appendChild(li);
    });
  }

  function updateTourBar() {
    const n = state.tourSelection.length;
    el.tourCount.textContent = `${n} für Tour ausgewählt`;
    el.suggest.disabled = n < 2;
    el.tourClear.disabled = n === 0;
  }

  const IMPORT_HINTS = {
    stempel: 'Wegpunkte (<wpt>) werden als Stempelstellen dauerhaft gespeichert ' +
             'und lassen sich einzeln als „erhalten“ abhaken.',
    parkplatz: 'Wegpunkte (<wpt>) werden als Parkplätze gespeichert. Ein Klick auf ' +
               'den Marker zeigt den QR-Code für die Anfahrt.',
    track: 'Spuren (<trk>) werden als abgeschlossene Tour dauerhaft auf der Karte hinterlegt.',
    poi: 'Wegpunkte (<wpt>) werden als POIs der aktuellen Planung hinzugefügt.',
  };

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`„${file.name}“ konnte nicht gelesen werden.`));
      reader.readAsText(file);
    });
  }

  async function importGpxFiles(files) {
    const kind = el.importType.value;
    const messages = [];
    let hadError = false;

    for (const file of files) {
      try {
        const text = await readFile(file);
        messages.push(importOne(text, kind, file.name));
      } catch (err) {
        hadError = true;
        messages.push(err.message);
      }
    }

    renderAll();
    // Der Import steht im Einstellungsdialog – danach soll man sehen,
    // was angekommen ist.
    setSettingsOpen(false);
    if (kind === 'stempel') el.stampDetails.open = true;
    showStatus(hadError ? 'warn' : 'info', messages.join(' '), 9000);
  }

  /** Importiert eine Datei und liefert die Meldung dazu. */
  function importOne(text, kind, fileName) {
    if (kind === 'track') {
      const tracks = Tracks.parseGpxTracks(text);
      if (tracks.length === 0) {
        return `„${fileName}“ enthält keine Spur (<trk>).`;
      }
      pushUndo();
      tracks.forEach((track) => {
        const prepared = Tracks.prepare(
          { ...track, name: track.name || fileName.replace(/\.gpx$/i, '') },
          items('tracks').length
        );
        state.tracks.push(prepared);
      });
      if (!persist('tracks')) {
        return 'Der Browser-Speicher ist voll – die Tour wurde angezeigt, aber nicht dauerhaft gesichert.';
      }
      MapView.fitTo(Tracks.toLatLngs(state.tracks[state.tracks.length - 1]));
      renderAll();
      return `${tracks.length} abgeschlossene Tour(en) hinterlegt.`;
    }

    const waypoints = PointStore.parseGpxWaypoints(text);
    if (waypoints.length === 0) {
      return `„${fileName}“ enthält keine Wegpunkte (<wpt>).`;
    }
    pushUndo();

    if (kind === 'stempel' || kind === 'parkplatz') {
      const isStamp = kind === 'stempel';
      const store = isStamp ? Stamps : Parking;
      const current = isStamp ? state.stamps : state.parking;
      const result = store.merge(current, waypoints);
      if (isStamp) state.stamps = result.items;
      else state.parking = result.items;
      persist(isStamp ? 'stamps' : 'parking');
      MapView.fitTo(Sync.visible(result.items));
      const label = isStamp ? 'Stempelstelle(n)' : 'Parkplatz/Parkplätze';
      return `${result.added} ${label} importiert` +
        (result.skipped > 0 ? `, ${result.skipped} bereits vorhanden.` : '.');
    }

    waypoints.forEach((w) => {
      state.pois.push({
        id: Utils.uid(),
        lat: w.lat,
        lng: w.lng,
        name: w.name || `POI ${poiCounter++}`,
        note: w.note,
      });
    });
    MapView.fitTo(state.pois);
    return `${waypoints.length} POI(s) importiert.`;
  }

  /* ---------- Parkplätze ---------- */

  function renderParkingList() {
    el.parkingList.innerHTML = '';
    const parking = items('parking');
    if (parking.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = 'Noch keine Parkplätze importiert';
      el.parkingList.appendChild(li);
      return;
    }

    parking
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
      .forEach((place) => {
        const li = document.createElement('li');

        const icon = document.createElement('span');
        icon.className = 'parking-badge';
        icon.textContent = 'P';

        const label = document.createElement('span');
        label.className = 'item-label';
        label.textContent = place.name;
        label.title = 'Auf der Karte zeigen und QR-Code öffnen';
        label.addEventListener('click', () => {
          MapView.setView(place.lat, place.lng, 15);
          MapView.openParkingPopup(place.id);
        });

        const startBtn = document.createElement('button');
        startBtn.className = 'item-action';
        startBtn.textContent = '▶';
        startBtn.title = 'Als Startpunkt der Route setzen';
        startBtn.addEventListener('click', () => parkingAsStart(place.id));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'item-delete';
        deleteBtn.textContent = '✕';
        deleteBtn.title = 'Parkplatz löschen';
        deleteBtn.addEventListener('click', () => deleteParking(place.id));

        li.append(icon, label, startBtn, deleteBtn);
        el.parkingList.appendChild(li);
      });
  }

  /** Setzt den Parkplatz als ersten Routenpunkt. */
  function parkingAsStart(id) {
    const place = state.parking.find((p) => p.id === id && !p.deletedAt);
    if (!place) return;
    pushUndo();
    state.points.unshift({ id: Utils.uid(), lat: place.lat, lng: place.lng });
    if (!state.tourName) {
      el.tourNameInput.value = `Tour ab ${place.name}`;
      state.tourName = el.tourNameInput.value;
    }
    renderAll();
    scheduleRecalc();
    showStatus('info', `„${place.name}“ ist jetzt Startpunkt der Route.`, 5000);
  }

  function deleteParking(id) {
    pushUndo();
    removeItem('parking', id);
    renderAll();
  }

  /* ---------- Hinterlegte (abgeschlossene) Touren ---------- */

  function renderTrackList() {
    el.trackList.innerHTML = '';
    const tracks = items('tracks');
    if (tracks.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = 'Noch keine Touren hinterlegt';
      el.trackList.appendChild(li);
      return;
    }

    tracks.forEach((track) => {
      const li = document.createElement('li');

      const visible = document.createElement('input');
      visible.type = 'checkbox';
      visible.checked = track.visible !== false;
      visible.title = 'Auf der Karte anzeigen';
      visible.addEventListener('change', () => {
        track.visible = visible.checked;
        Sync.touch(track);
        persist('tracks');
        renderAll();
      });

      const swatch = document.createElement('span');
      swatch.className = 'track-swatch';
      swatch.style.background = track.color;

      const label = document.createElement('span');
      label.className = 'item-label';
      label.textContent = `${track.name} · ${Utils.formatDistance(track.length)}`;
      label.title = 'Auf der Karte zeigen · Doppelklick zum Umbenennen';
      label.addEventListener('click', () => MapView.fitTo(Tracks.toLatLngs(track)));
      label.addEventListener('dblclick', () => renameTrack(track.id));

      const adoptBtn = document.createElement('button');
      adoptBtn.className = 'item-action';
      adoptBtn.textContent = '➜';
      adoptBtn.title = 'Als neue Planung übernehmen und neu berechnen';
      adoptBtn.addEventListener('click', () => adoptTrack(track.id));

      const renameBtn = document.createElement('button');
      renameBtn.className = 'item-action';
      renameBtn.textContent = '✎';
      renameBtn.title = 'Umbenennen';
      renameBtn.addEventListener('click', () => renameTrack(track.id));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'item-delete';
      deleteBtn.textContent = '✕';
      deleteBtn.title = 'Hinterlegte Tour löschen';
      deleteBtn.addEventListener('click', () => deleteTrack(track.id));

      li.append(visible, swatch, label, adoptBtn, renameBtn, deleteBtn);
      el.trackList.appendChild(li);
    });
  }

  // So viele Routenpunkte entstehen höchstens aus einer hinterlegten Spur.
  // Mehr würde die Liste unbedienbar machen und dem Router keinen Spielraum
  // mehr lassen, einen sinnvollen Weg zu finden.
  const ADOPT_MAX_POINTS = 25;
  const ADOPT_START_TOLERANCE_M = 120;

  /**
   * Zieht aus einer dichten Spur die charakteristischen Stützpunkte heraus:
   * Douglas-Peucker mit wachsender Toleranz, bis wenige Punkte übrig sind.
   * Ecken und Kehren bleiben dabei erhalten, gerade Stücke fallen weg.
   */
  function adoptPoints(latlngs) {
    let tolerance = ADOPT_START_TOLERANCE_M;
    let points = Tracks.simplify(latlngs, tolerance);
    while (points.length > ADOPT_MAX_POINTS && tolerance < 5000) {
      tolerance *= 1.8;
      points = Tracks.simplify(latlngs, tolerance);
    }
    if (points.length > ADOPT_MAX_POINTS) {
      // Sehr verschlungene Spuren lassen sich nicht weiter ausdünnen,
      // ohne ihre Form zu verlieren – dann gleichmäßig auswählen.
      const step = (points.length - 1) / (ADOPT_MAX_POINTS - 1);
      points = Array.from({ length: ADOPT_MAX_POINTS },
        (_, i) => points[Math.round(i * step)]);
    }
    return points;
  }

  /** Übernimmt eine hinterlegte Spur als neue Planung. */
  function adoptTrack(id) {
    const track = state.tracks.find((t) => t.id === id && !t.deletedAt);
    if (!track) return;

    const latlngs = Tracks.toLatLngs(track);
    if (latlngs.length < 2) {
      showStatus('warn', `„${track.name}“ enthält zu wenige Punkte für eine Planung.`, 6000);
      return;
    }
    if (state.points.length > 0 && !window.confirm(
      `Die aktuelle Planung wird durch „${track.name}“ ersetzt. Fortfahren?`
    )) return;

    pushUndo();
    state.points = adoptPoints(latlngs)
      .map((p) => ({ id: Utils.uid(), lat: p.lat, lng: p.lng }));
    state.tourName = track.name;
    el.tourNameInput.value = track.name;

    setTab('planung');
    renderAll();
    MapView.fitTo(state.points);
    pendingNote =
      `„${track.name}“ als Planung übernommen – ${state.points.length} Stützpunkte. ` +
      'Die Route wurde neu berechnet und kann dabei etwas von der Originalspur ' +
      'abweichen; einzelne Punkte lassen sich verschieben.';
    scheduleRecalc();
  }

  function renameTrack(id) {
    const track = state.tracks.find((t) => t.id === id && !t.deletedAt);
    if (!track) return;
    const name = window.prompt('Name der hinterlegten Tour:', track.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    track.name = trimmed;
    Sync.touch(track);
    persist('tracks');
    renderAll();
  }

  function deleteTrack(id) {
    const track = state.tracks.find((t) => t.id === id && !t.deletedAt);
    if (!track) return;
    if (!window.confirm(`„${track.name}“ wirklich löschen?`)) return;
    pushUndo();
    removeItem('tracks', id);
    renderAll();
  }

  /* ---------- Geplante Touren ---------- */

  function renderTourList() {
    el.tourList.innerHTML = '';
    const tours = items('tours');
    if (tours.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = 'Noch keine Tour geplant';
      el.tourList.appendChild(li);
      return;
    }

    tours.forEach((tour) => {
      const li = document.createElement('li');

      const visible = document.createElement('input');
      visible.type = 'checkbox';
      visible.checked = tour.visible !== false;
      visible.title = 'Auf der Karte anzeigen';
      visible.addEventListener('change', () => {
        tour.visible = visible.checked;
        Sync.touch(tour);
        persist('tours');
        renderAll();
      });

      const swatch = document.createElement('span');
      swatch.className = 'track-swatch planned';
      swatch.style.background = tour.color || '#1d5fbf';

      const label = document.createElement('span');
      label.className = 'item-label';
      const distance = tour.distance ? ` · ${Utils.formatDistance(tour.distance)}` : '';
      label.textContent = `${tour.name}${distance}`;
      label.title = `Geplant am ${Tours.formatSavedAt(tour.savedAt)} · klicken zum Bearbeiten`;
      label.addEventListener('click', () => loadTour(tour.id));

      const doneBtn = document.createElement('button');
      doneBtn.className = 'item-action';
      doneBtn.textContent = '✓';
      doneBtn.title = 'Als abgeschlossen abhaken – die Tour wandert in die andere Liste';
      doneBtn.addEventListener('click', () => completeTour(tour.id));

      const renameBtn = document.createElement('button');
      renameBtn.className = 'item-action';
      renameBtn.textContent = '✎';
      renameBtn.title = 'Umbenennen';
      renameBtn.addEventListener('click', () => renameTour(tour.id));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'item-delete';
      deleteBtn.textContent = '✕';
      deleteBtn.title = 'Geplante Tour löschen';
      deleteBtn.addEventListener('click', () => deleteTour(tour.id));

      li.append(visible, swatch, label, doneBtn, renameBtn, deleteBtn);
      el.tourList.appendChild(li);
    });
  }

  /**
   * Hakt eine geplante Tour als gelaufen ab: Sie verlässt die Planungsliste
   * und erscheint als abgeschlossene Tour – mit dem tatsächlich berechneten
   * Verlauf, nicht nur den Stützpunkten.
   */
  function completeTour(id) {
    const tour = state.savedTours.find((t) => t.id === id && !t.deletedAt);
    if (!tour) return;

    const line = Tours.toLatLngs(tour);
    if (line.length < 2) {
      showStatus('warn',
        `„${tour.name}“ hat noch keinen berechneten Verlauf. Bitte einmal laden, ` +
        'die Berechnung abwarten und erneut speichern.', 9000);
      return;
    }
    if (!window.confirm(`„${tour.name}“ als abgeschlossen abhaken?`)) return;

    pushUndo();
    const round = (v) => Math.round(v * 1e5) / 1e5;
    const existing = items('tracks').length;
    state.tracks.push({
      id: Utils.uid(),
      name: tour.name,
      date: new Date().toISOString().slice(0, 10),
      color: Tracks.COLORS[existing % Tracks.COLORS.length],
      visible: true,
      updatedAt: Date.now(),
      length: tour.distance || Math.round(Tracks.length(line)),
      points: line.map((p) => [round(p.lat), round(p.lng)]),
    });
    persist('tracks');
    removeItem('tours', id);

    renderAll();
    showStatus('info',
      `„${tour.name}“ ist jetzt eine abgeschlossene Tour.`, 6000);
  }

  function saveCurrentTour() {
    const name = el.tourNameInput.value.trim();
    if (!name) {
      showStatus('warn', 'Bitte zuerst einen Namen für die Tour eingeben.', 5000);
      el.tourNameInput.focus();
      return;
    }
    if (state.points.length === 0) {
      showStatus('warn', 'Die Tour enthält noch keine Routenpunkte.', 5000);
      return;
    }

    state.tourName = name;
    const entry = Tours.fromState(name, state, items('tours').length);

    // Gleicher Name überschreibt den bestehenden Eintrag.
    const existing = state.savedTours.findIndex((t) => !t.deletedAt && t.name === name);
    if (existing >= 0) {
      // Farbe und Sichtbarkeit gehören zum Eintrag, nicht zur Planung –
      // sonst springt die Tour beim Speichern auf eine andere Farbe.
      entry.id = state.savedTours[existing].id;
      entry.color = state.savedTours[existing].color || entry.color;
      entry.visible = state.savedTours[existing].visible !== false;
      state.savedTours[existing] = entry;
    } else {
      state.savedTours.push(entry);
    }

    if (persist('tours')) {
      showStatus('info', `Tour „${name}“ gespeichert.`, 5000);
    } else {
      showStatus('error', 'Die Tour konnte nicht gespeichert werden (Speicher voll).');
    }
    renderAll();
  }

  function loadTour(id) {
    const tour = state.savedTours.find((t) => t.id === id && !t.deletedAt);
    if (!tour) return;
    pushUndo();

    state.points = tour.points.map((p) => ({ id: Utils.uid(), lat: p.lat, lng: p.lng }));
    state.pois = (tour.pois || []).map((p) => ({
      id: Utils.uid(), lat: p.lat, lng: p.lng, name: p.name, note: p.note,
    }));
    if (tour.routing) state.routing = { ...Profiles.defaultSettings(), ...tour.routing };
    if (tour.preset) state.preset = tour.preset;
    state.tourName = tour.name;
    el.tourNameInput.value = tour.name;

    syncRoutingUi();
    el.roundTrip.checked = Boolean(state.routing.roundTrip);
    renderAll();
    if (state.points.length > 0) MapView.fitTo(state.points);
    scheduleRecalc();
    showStatus('info', `Tour „${tour.name}“ geladen.`, 5000);
  }

  function renameTour(id) {
    const tour = state.savedTours.find((t) => t.id === id && !t.deletedAt);
    if (!tour) return;
    const name = window.prompt('Name der Tour:', tour.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    if (state.tourName === tour.name) {
      state.tourName = trimmed;
      el.tourNameInput.value = trimmed;
    }
    tour.name = trimmed;
    Sync.touch(tour);
    persist('tours');
    renderAll();
  }

  function deleteTour(id) {
    const tour = state.savedTours.find((t) => t.id === id && !t.deletedAt);
    if (!tour) return;
    if (!window.confirm(`Tour „${tour.name}“ wirklich löschen?`)) return;
    removeItem('tours', id);
    renderAll();
  }

  function toggleStampCollected(id) {
    const stamp = state.stamps.find((s) => s.id === id && !s.deletedAt);
    if (!stamp) return;
    pushUndo();
    stamp.collected = !stamp.collected;
    // Datum festhalten, damit sich später Jahresstatistik und Chronik
    // erzeugen lassen.
    if (stamp.collected) stamp.collectedAt = new Date().toISOString();
    else delete stamp.collectedAt;
    Sync.touch(stamp);
    persist('stamps');
    renderAll();
    updateAlongRoute();
    if (Geo.position) renderNearbyPrompt(Geo.position);
  }

  function toggleStampTour(id) {
    const index = state.tourSelection.indexOf(id);
    if (index >= 0) state.tourSelection.splice(index, 1);
    else state.tourSelection.push(id);
    renderAll();
  }

  function deleteStamp(id) {
    pushUndo();
    removeItem('stamps', id);
    state.tourSelection = state.tourSelection.filter((sid) => sid !== id);
    renderAll();
  }

  function clearTourSelection() {
    state.tourSelection = [];
    renderAll();
  }

  /**
   * Verbindet die für die Tour ausgewählten Stempelstellen in optimierter
   * Reihenfolge zu Routenpunkten; die Route wird dann wie üblich entlang
   * echter Wege berechnet.
   */
  function suggestRoute() {
    const selected = state.tourSelection
      .map((id) => items('stamps').find((s) => s.id === id))
      .filter(Boolean);
    if (selected.length < 2) {
      showStatus('warn', 'Mindestens zwei Stempelstellen für die Tour auswählen.', 5000);
      return;
    }
    pushUndo();
    const ordered = Utils.optimizeOrder(selected);
    state.points = ordered.map((s) => ({ id: Utils.uid(), lat: s.lat, lng: s.lng }));
    renderAll();
    MapView.fitTo(state.points);
    scheduleRecalc();
    showStatus('info', 'Reihenfolge optimiert – Route wird entlang der Wege berechnet …', 5000);
  }

  function renderAll() {
    // Beide Tourenlisten zuerst, damit sie unter der aktiven Route liegen.
    MapView.renderTracks(items('tracks'));
    MapView.renderPlannedTours(items('tours'));
    MapView.renderPoints(state.points);
    MapView.renderPois(state.pois);
    MapView.renderStamps(items('stamps'), state.tourSelection);
    // Sobald ein Startpunkt steht, ist die Parkplatzfrage beantwortet – die
    // Marken würden die Karte beim Planen nur zustellen. Sie kommen zurück,
    // sobald die Route wieder leer ist.
    MapView.renderParking(state.points.length > 0 ? [] : items('parking'));
    renderPointList();
    renderPoiList();
    renderStampList();
    renderParkingList();
    renderTrackList();
    renderTourList();
    renderProgress();
    updateTourBar();
    updateButtons();
  }

  /* ---------- Aktionen ---------- */

  /**
   * Setzt einen Routenpunkt.
   * @param {{lat:number, lng:number}} latlng
   * @param {?number} index Einfügestelle; ohne Angabe ans Ende
   */
  function addPoint(latlng, index) {
    pushUndo();
    const point = { id: Utils.uid(), lat: latlng.lat, lng: latlng.lng };
    if (index == null) state.points.push(point);
    else state.points.splice(index, 0, point);
    renderAll();
    scheduleRecalc();
  }

  function movePoint(id, latlng) {
    const point = state.points.find((p) => p.id === id);
    if (!point) return;
    pushUndo();
    point.lat = latlng.lat;
    point.lng = latlng.lng;
    renderAll();
    scheduleRecalc();
  }

  function deletePoint(id) {
    pushUndo();
    state.points = state.points.filter((p) => p.id !== id);
    renderAll();
    scheduleRecalc();
  }

  function addPoi(latlng) {
    pushUndo();
    const poi = {
      id: Utils.uid(),
      lat: latlng.lat,
      lng: latlng.lng,
      name: `POI ${poiCounter++}`,
      note: '',
    };
    state.pois.push(poi);
    renderAll();
    MapView.openPoiPopup(poi.id);
  }

  function movePoi(id, latlng) {
    const poi = state.pois.find((p) => p.id === id);
    if (!poi) return;
    pushUndo();
    poi.lat = latlng.lat;
    poi.lng = latlng.lng;
    renderAll();
  }

  function editPoi(id, name, note) {
    const poi = state.pois.find((p) => p.id === id);
    if (!poi) return;
    pushUndo();
    poi.name = name;
    poi.note = note;
    renderAll();
  }

  function deletePoi(id) {
    pushUndo();
    state.pois = state.pois.filter((p) => p.id !== id);
    renderAll();
  }

  /** Dreht die Reihenfolge der Routenpunkte um. */
  function reverseRoute() {
    if (state.points.length < 2) return;
    pushUndo();
    state.points.reverse();
    renderAll();
    scheduleRecalc();
    showStatus('info', 'Richtung umgekehrt – Anstieg und Abstieg tauschen die Rollen.', 5000);
  }

  /** Fügt beim Ziehen der Route einen Zwischenpunkt an der passenden Stelle ein. */
  function insertPointAt(latlng, index) {
    pushUndo();
    state.points.splice(index, 0, {
      id: Utils.uid(), lat: latlng.lat, lng: latlng.lng,
    });
    renderAll();
    scheduleRecalc();
  }

  function clearAll() {
    if (state.points.length === 0 && state.pois.length === 0) return;
    pushUndo();
    state.points = [];
    state.pois = [];
    renderAll();
    scheduleRecalc();
  }

  const MODE_HINTS = {
    menu: 'Ein Klick auf die Karte fragt erst nach – versehentliche Punkte ' +
      'gibt es damit nicht. Rechtsklick öffnet das Menü in jedem Modus.',
    route: 'Jeder Klick setzt sofort einen Routenpunkt. Esc führt zurück ins Menü.',
    poi: 'Jeder Klick setzt sofort einen POI. Esc führt zurück ins Menü.',
  };

  /** Noch nichts gesammelt und nichts geplant – vermutlich der erste Start. */
  function isFreshInstall() {
    return state.points.length === 0
      && items('tours').length === 0
      && items('stamps').length === 0
      && items('tracks').length === 0;
  }

  function setMode(mode) {
    state.mode = mode;
    [[el.modeMenu, 'menu'], [el.modeRoute, 'route'], [el.modePoi, 'poi']]
      .forEach(([button, name]) => {
        button.classList.toggle('active', mode === name);
        button.setAttribute('aria-pressed', String(mode === name));
      });
    el.modeHint.textContent = MODE_HINTS[mode] || '';
    localStorage.setItem('wanderplaner.mode', mode);
    MapView.closeMenu();
    // Beim Zeichnen wäre der Doppelklick-Zoom fatal: Er setzt zwei Punkte
    // und springt gleichzeitig eine Zoomstufe weiter.
    MapView.setDoubleClickZoom(mode === 'menu');
  }

  /* ---------- Tastatur ---------- */

  /**
   * Esc räumt der Reihe nach auf: erst offene Dialoge, dann das Kartenmenü,
   * zuletzt der Zeichenmodus. Strg+Z macht rückgängig – beides erwartet man,
   * und beides fehlte bisher.
   */
  function onKeyDown(e) {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(
      (e.target && e.target.tagName) || ''
    );

    if (e.key === 'Escape') {
      if (!el.settings.hidden) return setSettingsOpen(false);
      if (MapView.menuOpen()) return MapView.closeMenu();
      if (state.mode !== 'menu') return setMode('menu');
      return undefined;
    }

    // In einem Eingabefeld gehört Strg+Z dem Feld selbst.
    if (!inField && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (state.undoStack.length === 0) return undefined;
      e.preventDefault();
      undo();
    }
    return undefined;
  }

  /* ---------- Kontextmenü auf der Karte ---------- */

  /** Menü an der angeklickten Stelle – nichts davon passiert ungefragt. */
  function openMapMenu(latlng) {
    const hasRoute = state.points.length > 0;
    MapView.openMenu(latlng, [
      {
        label: '📍 Routenpunkt anhängen',
        hint: hasRoute ? `wird Punkt ${state.points.length + 1}` : 'wird der Startpunkt',
        action: addPoint,
      },
      hasRoute ? {
        label: '↑ Als neuen Startpunkt',
        hint: 'vor den bisherigen Punkt 1',
        action: (ll) => addPoint(ll, 0),
      } : null,
      {
        label: '⚑ POI setzen',
        hint: 'Notiz an dieser Stelle',
        action: addPoi,
      },
      {
        label: '🅿 Als Parkplatz merken',
        hint: 'dauerhaft, mit QR-Code zur Anfahrt',
        action: addParkingAt,
      },
      {
        label: '✏ Hier weiterzeichnen',
        hint: 'setzt den Punkt und schaltet auf Zeichnen um',
        action: (ll) => { addPoint(ll); setMode('route'); },
      },
    ]);
  }

  /** Menü an einem gesetzten Routenpunkt. */
  function openPointMenu(point, index) {
    MapView.openMenu({ lat: point.lat, lng: point.lng }, [
      {
        label: `✕ Punkt ${index + 1} löschen`,
        action: () => deletePoint(point.id),
      },
      index > 0 ? {
        label: '↑ Zum Startpunkt machen',
        hint: 'verschiebt ihn an den Anfang',
        action: () => movePointToStart(point.id),
      } : null,
      index < state.points.length - 1 ? {
        label: '✂ Route hier abschneiden',
        hint: `entfernt die ${state.points.length - index - 1} Punkte danach`,
        action: () => truncateAfter(index),
      } : null,
    ]);
  }

  /** Legt an dieser Stelle einen Parkplatz an – ohne Umweg über den Import. */
  function addParkingAt(latlng) {
    const name = window.prompt('Name des Parkplatzes:', 'Wanderparkplatz');
    if (name === null) return;
    pushUndo();
    state.parking.push({
      id: Utils.uid(),
      lat: latlng.lat,
      lng: latlng.lng,
      name: name.trim() || 'Wanderparkplatz',
      note: '',
      updatedAt: Date.now(),
    });
    persist('parking');
    renderAll();
    showStatus('info', 'Parkplatz gespeichert – ein Klick auf den Marker zeigt den QR-Code.', 6000);
  }

  function movePointToStart(id) {
    const index = state.points.findIndex((p) => p.id === id);
    if (index <= 0) return;
    pushUndo();
    const [point] = state.points.splice(index, 1);
    state.points.unshift(point);
    renderAll();
    scheduleRecalc();
  }

  function truncateAfter(index) {
    if (index >= state.points.length - 1) {
      showStatus('info', 'Hinter diesem Punkt liegt nichts mehr.', 4000);
      return;
    }
    pushUndo();
    state.points = state.points.slice(0, index + 1);
    renderAll();
    scheduleRecalc();
  }

  function exportGpx() {
    if (!state.geometry) return;
    const trackPoints = state.samples && state.samples.some((s) => s.ele != null)
      ? state.samples
      : state.geometry.map((c) => ({ lat: c[1], lng: c[0] }));
    // POIs plus die für die Tour ausgewählten Stempelstellen als Wegpunkte
    const tourStamps = state.tourSelection
      .map((id) => items('stamps').find((s) => s.id === id))
      .filter(Boolean);
    Gpx.download(trackPoints, [...state.pois, ...tourStamps]);
    showStatus('info', 'GPX-Datei wurde heruntergeladen.', 4000);
  }

  /* ---------- Routing-Einstellungen ---------- */

  function initRoutingUi() {
    Object.entries(Profiles.PRESETS).forEach(([key, preset]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = preset.label;
      el.preset.appendChild(option);
    });
    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = 'Eigene Einstellung';
    el.preset.appendChild(custom);

    el.preset.addEventListener('change', () => {
      const preset = Profiles.PRESETS[el.preset.value];
      if (preset) {
        state.preset = el.preset.value;
        // Der Rundkurs gehört zur Tour, nicht zur Wegegewichtung – er bleibt
        // beim Wechsel der Voreinstellung erhalten.
        state.routing = { ...preset.settings, roundTrip: state.routing.roundTrip };
        syncRoutingUi();
        saveRoutingSettings();
        scheduleRecalc();
      }
    });

    SLIDER_KEYS.forEach((key) => {
      const input = document.getElementById(`rs-${key}`);
      input.addEventListener('input', () => {
        state.routing[key] = Number(input.value);
        markCustomPreset();
        syncRoutingUi();
      });
      input.addEventListener('change', () => {
        saveRoutingSettings();
        scheduleRecalc();
      });
    });

    el.sacLimit.addEventListener('change', () => {
      state.routing.sacLimit = Number(el.sacLimit.value);
      markCustomPreset();
      syncRoutingUi();
      saveRoutingSettings();
      scheduleRecalc();
    });

    el.allowSteps.addEventListener('change', () => {
      state.routing.allowSteps = el.allowSteps.checked;
      markCustomPreset();
      syncRoutingUi();
      saveRoutingSettings();
      scheduleRecalc();
    });

    syncRoutingUi();
  }

  /** Wechselt auf "Eigene Einstellung", sobald von einer Vorgabe abgewichen wird. */
  function markCustomPreset() {
    const preset = Profiles.PRESETS[state.preset];
    if (!preset) return;
    const matches = Object.entries(preset.settings).every(
      ([key, value]) => state.routing[key] === value
    );
    if (!matches) state.preset = 'custom';
  }

  function syncRoutingUi() {
    el.preset.value = state.preset;
    const preset = Profiles.PRESETS[state.preset];
    el.presetBadge.textContent = preset ? preset.label : 'Eigene Einstellung';
    el.presetDescription.textContent = preset
      ? preset.description
      : 'Von Hand angepasste Gewichtung.';

    SLIDER_KEYS.forEach((key) => {
      const input = document.getElementById(`rs-${key}`);
      input.value = state.routing[key];
      input.parentElement.querySelector('output').textContent =
        SLIDER_LABELS[state.routing[key]] || state.routing[key];
    });
    el.sacLimit.value = state.routing.sacLimit;
    el.allowSteps.checked = Boolean(state.routing.allowSteps);

    // Bei "Kürzeste Route" wirken die Gewichtungen bewusst nicht.
    const disabled = Boolean(state.routing.shortest);
    SLIDER_KEYS.forEach((key) => {
      document.getElementById(`rs-${key}`).disabled = disabled;
    });
    el.allowSteps.disabled = disabled;
  }

  function updateImportHint() {
    el.importHint.textContent = IMPORT_HINTS[el.importType.value] || '';
  }

  /* ---------- Version und Updates ---------- */

  const RELEASES_URL = 'https://api.github.com/repos/Zendonir/Wanderplaner/releases/latest';

  /** Holt die laufende Version vom Server; ohne Server bleibt sie unbekannt. */
  async function loadVersion() {
    try {
      const response = await Utils.fetchWithTimeout('api/version', {}, 5000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.version = data.version;
      el.appVersion.textContent = `Version ${data.version}`;
    } catch (err) {
      // Ohne Server (Datei direkt geöffnet) gibt es keine Versionsauskunft.
      state.version = null;
      el.appVersion.textContent = 'Version unbekannt (kein Server)';
      el.checkUpdate.disabled = true;
    }
  }

  /**
   * Fragt den Service Worker, welchen Stand der Oberfläche er ausliefert.
   *
   * Nach einem Update ist das die häufigste Verwirrung: Der Container läuft
   * längst in der neuen Fassung – „Version“ zeigt sie an –, während der
   * Browser die alte Oberfläche aus dem Zwischenspeicher nimmt. Dann stimmen
   * die beiden Angaben nicht überein.
   */
  async function loadShellVersion() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    const version = await new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => resolve(e.data);
      navigator.serviceWorker.controller.postMessage('version', [channel.port2]);
      setTimeout(() => resolve(null), 2000);
    });
    if (version) el.shellVersion.textContent = `· Oberfläche ${version}`;
  }

  /**
   * Verwirft den zwischengespeicherten Programmstand und lädt neu. Der
   * Kachelspeicher bleibt erhalten – der ist offline unterwegs wertvoll und
   * hat mit der Programmversion nichts zu tun.
   */
  async function reloadShell() {
    el.reloadShell.disabled = true;
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys
          .filter((k) => k.startsWith('wanderplaner-shell'))
          .map((k) => caches.delete(k)));
      }
    } catch (err) {
      console.warn('Zwischenspeicher ließ sich nicht leeren:', err);
    }
    window.location.reload();
  }

  /** Vergleicht zwei Versionsangaben nach dem Muster 2.3.0. */
  function compareVersions(a, b) {
    const parse = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    const left = parse(a);
    const right = parse(b);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const diff = (left[i] || 0) - (right[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  /**
   * Fragt bei GitHub nach der neuesten Veröffentlichung. Bewusst nur auf
   * Knopfdruck – die App soll nicht ungefragt nach außen funken.
   */
  async function checkForUpdate() {
    el.checkUpdate.disabled = true;
    el.updateNote.hidden = false;
    el.updateNote.className = 'about-note';
    el.updateNote.textContent = 'Sehe bei GitHub nach …';

    try {
      const response = await Utils.fetchWithTimeout(RELEASES_URL, {}, 10000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const latest = String(data.tag_name || '').replace(/^v/, '');

      if (!latest) throw new Error('Keine Versionsangabe erhalten.');

      // Eine aus dem Quellcode gelesene Version trägt einen Zusatz – für den
      // Vergleich zählt nur die Zahl davor.
      const running = String(state.version || '').split(' ')[0];
      const diff = compareVersions(latest, running);

      if (diff > 0) {
        el.updateNote.className = 'about-note update';
        // Ein Neustart allein genügt nicht – dabei läuft dasselbe Image
        // weiter. Der Befehl steht deshalb wörtlich da, zum Kopieren.
        el.updateNote.innerHTML = '';
        const text = document.createElement('span');
        text.textContent =
          `Version ${latest} ist verfügbar (installiert: ${running}). ` +
          'Ein Neustart des Containers genügt nicht – das Image muss neu ' +
          'gezogen werden:';
        const command = document.createElement('code');
        command.className = 'update-command';
        command.textContent = 'docker compose pull && docker compose up -d';
        const hint = document.createElement('span');
        hint.textContent = 'Auf TrueNAS: bei der App „Update“ bzw. „Pull image“ auslösen.';
        el.updateNote.append(text, command, hint);
      } else {
        el.updateNote.className = 'about-note ok';
        el.updateNote.textContent = `Aktuell – ${running} ist die neueste Version.`;
      }
    } catch (err) {
      el.updateNote.className = 'about-note';
      el.updateNote.textContent =
        'GitHub ist gerade nicht erreichbar – die Prüfung braucht Internetzugang.';
    } finally {
      el.checkUpdate.disabled = false;
    }
  }

  /**
   * Fragt den Server, ob er sich selbst aktualisieren darf. Das ist nur der
   * Fall, wenn der Docker-Socket bewusst eingehängt und die Freigabe gesetzt
   * wurde – sonst bleibt der Knopf verborgen.
   */
  async function checkUpdateAbility() {
    try {
      const response = await Utils.fetchWithTimeout('api/update', {}, 5000);
      if (!response.ok) return;
      const data = await response.json();
      el.runUpdate.hidden = !data.available;
      // Ist es nicht freigeschaltet, den Knopf nicht wortlos weglassen,
      // sondern sagen, was fehlt – sonst weiß niemand, dass es ihn gibt.
      el.updateSetup.hidden = Boolean(data.available);
      if (data.available) {
        el.runUpdate.title =
          `Zieht das neue Image und erstellt „${data.container}“ neu. ` +
          'Die App ist dabei kurz nicht erreichbar.';
      } else if (data.reason) {
        el.updateReason.textContent = data.reason;
      }
    } catch (err) {
      // Ohne Server gibt es auch nichts zu aktualisieren.
    }
  }

  /** Stößt die Aktualisierung an und wartet, bis der Server wiederkommt. */
  async function runUpdate() {
    if (!window.confirm(
      'Der Wanderplaner zieht jetzt das neue Image und startet sich neu.\n\n' +
      'Die App ist dabei etwa eine Minute nicht erreichbar. Fortfahren?'
    )) return;

    const before = String(state.version || '');
    el.runUpdate.disabled = true;
    el.checkUpdate.disabled = true;
    el.updateNote.hidden = false;
    el.updateNote.className = 'about-note';
    el.updateNote.textContent = 'Aktualisierung läuft – bitte das Fenster offen lassen …';

    try {
      const response = await Utils.fetchWithTimeout('api/update', { method: 'POST' }, 60000);
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error((detail && detail.error) || `HTTP ${response.status}`);
      }
    } catch (err) {
      // Bricht die Verbindung ab, wurde der Container gerade ersetzt – das
      // ist der Normalfall und kein Fehler.
      console.warn('Antwort während der Aktualisierung verloren:', err);
    }

    await waitForNewVersion(before);
  }

  /** Fragt die Version, bis sie sich ändert oder die Geduld endet. */
  async function waitForNewVersion(before) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      try {
        const response = await Utils.fetchWithTimeout('api/version', {}, 4000);
        if (!response.ok) continue;
        const data = await response.json();
        if (String(data.version) !== before) {
          el.updateNote.className = 'about-note ok';
          el.updateNote.textContent =
            `Fertig – jetzt läuft Version ${data.version}. Die Seite wird neu geladen.`;
          setTimeout(() => window.location.reload(), 2500);
          return;
        }
      } catch (err) {
        // Solange der Container neu startet, ist ein Fehler zu erwarten.
      }
    }

    el.updateNote.className = 'about-note update';
    el.updateNote.textContent =
      'Die neue Version meldet sich nicht innerhalb von drei Minuten. Bitte am ' +
      'Server nachsehen (docker compose logs) und die Seite danach neu laden.';
    el.runUpdate.disabled = false;
    el.checkUpdate.disabled = false;
  }

  /* ---------- Reiter ---------- */

  function setTab(name) {
    el.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    el.panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
    localStorage.setItem('wanderplaner.tab', name);
    // Nach dem Wechsel kann sich die Höhe ändern – Karte neu vermessen.
    setTimeout(() => MapView.invalidateSize(), 60);
  }

  /* ---------- Fortschritt ---------- */

  function renderProgress() {
    const stamps = items('stamps');
    const box = el.progressBox;
    box.innerHTML = '';

    if (stamps.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Noch keine Stempelstellen importiert.';
      box.appendChild(hint);
      return;
    }

    const summary = Progress.summary(stamps);

    const headline = document.createElement('p');
    headline.className = 'progress-headline';
    headline.textContent = `${summary.collected} von ${summary.total} Stempeln`;
    if (summary.current) {
      const badge = document.createElement('span');
      badge.className = 'progress-badge';
      badge.textContent = `${summary.current.icon} ${summary.current.label}`;
      headline.appendChild(badge);
    }
    box.appendChild(headline);

    // Balken bis zur nächsten Stufe, sonst bis zur Gesamtzahl.
    const target = summary.next ? summary.next.at : summary.total;
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    const fill = document.createElement('span');
    fill.style.width = `${Math.min(100, (summary.collected / (target || 1)) * 100)}%`;
    bar.appendChild(fill);
    box.appendChild(bar);

    const note = document.createElement('p');
    note.className = 'progress-note';
    if (summary.next) {
      note.textContent = `Noch ${summary.remaining} bis ${summary.next.icon} ${summary.next.label} (${summary.next.at}).`;
    } else {
      note.textContent = 'Alle Stufen erreicht.';
    }
    box.appendChild(note);

    const facts = document.createElement('ul');
    facts.className = 'progress-facts';
    const add = (text) => {
      const li = document.createElement('li');
      li.textContent = text;
      facts.appendChild(li);
    };
    add(`${new Date().getFullYear()}: ${summary.thisYear} Stempel`);
    if (summary.last) {
      add(`Zuletzt: ${summary.last.name} am ${Progress.formatDate(summary.last.collectedAt)}`);
    }
    if (summary.undated > 0) {
      // Ehrlich bleiben: vor der Einführung des Datums abgehakte Stempel
      // tauchen in der Jahreszählung nicht auf.
      add(`${summary.undated} ohne Datum (vor dieser Version abgehakt)`);
    }
    summary.perYear.slice(0, 3).forEach((entry) => {
      if (entry.year !== new Date().getFullYear()) {
        add(`${entry.year}: ${entry.count} Stempel`);
      }
    });
    box.appendChild(facts);
  }

  /* ---------- Tourenvorschläge aus Stempel-Nestern ---------- */

  function findClusters() {
    const maxKm = Number(el.clusterLength.value);
    state.clusters = Clusters.find(items('stamps'), items('parking'), maxKm);
    renderClusterList();
  }

  function renderClusterList() {
    el.clusterList.innerHTML = '';
    const clusters = state.clusters || [];

    if (clusters.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = state.clusters
        ? 'Keine passende Gruppe gefunden – andere Wunschlänge versuchen.'
        : 'Noch nicht gesucht';
      el.clusterList.appendChild(li);
      return;
    }

    clusters.slice(0, 8).forEach((cluster, index) => {
      const li = document.createElement('li');

      const label = document.createElement('span');
      label.className = 'item-label';
      const km = cluster.lengthKm.toLocaleString('de-DE', { maximumFractionDigits: 1 });
      label.textContent = `${cluster.stamps.length} Stempel · ca. ${km} km`;
      label.title = cluster.stamps.map((s) => s.name).join(', ');

      const where = document.createElement('span');
      where.className = 'cluster-start';
      where.textContent = cluster.start ? `ab ${cluster.start.name}` : 'ohne Parkplatz';

      const useBtn = document.createElement('button');
      useBtn.className = 'item-action';
      useBtn.textContent = '▶';
      useBtn.title = 'Als Route übernehmen';
      useBtn.addEventListener('click', () => useCluster(index));

      li.append(label, where, useBtn);
      li.addEventListener('click', (event) => {
        if (event.target === useBtn) return;
        MapView.fitTo(cluster.stamps);
      });
      el.clusterList.appendChild(li);
    });
  }

  /** Übernimmt einen Vorschlag als Routenpunkte. */
  function useCluster(index) {
    const cluster = (state.clusters || [])[index];
    if (!cluster) return;

    pushUndo();
    const points = [];
    if (cluster.start) points.push({ lat: cluster.start.lat, lng: cluster.start.lng });
    cluster.stamps.forEach((s) => points.push({ lat: s.lat, lng: s.lng }));
    // Zurück zum Ausgangspunkt, damit eine Runde entsteht.
    if (cluster.start) points.push({ lat: cluster.start.lat, lng: cluster.start.lng });

    state.points = points.map((p) => ({ id: Utils.uid(), lat: p.lat, lng: p.lng }));
    state.tourSelection = cluster.stamps.map((s) => s.id);
    if (!el.tourNameInput.value.trim() && cluster.start) {
      el.tourNameInput.value = `Stempelrunde ab ${cluster.start.name}`;
      state.tourName = el.tourNameInput.value;
    }

    renderAll();
    MapView.fitTo(state.points);
    scheduleRecalc();
    setTab('planung');
    showStatus('info',
      `${cluster.stamps.length} Stempelstellen als Route übernommen – die Reihenfolge ist optimiert.`,
      6000);
  }

  /* ---------- Wegebeschaffenheit und Hinweise ---------- */

  function updateWayTypes() {
    const analysis = state.segments ? WayTypes.analyse(state.segments) : null;

    if (!analysis) {
      el.waytypeSection.hidden = true;
      MapView.renderPavedSections(null);
      return;
    }
    el.waytypeSection.hidden = false;
    el.waytypeBars.innerHTML = '';

    const addGroup = (title, entries, footnote) => {
      if (entries.length === 0) return;

      const heading = document.createElement('p');
      heading.className = 'waytype-heading';
      heading.textContent = title;
      el.waytypeBars.appendChild(heading);

      // Ein Balken, in dem die Anteile nebeneinander liegen.
      const bar = document.createElement('div');
      bar.className = 'waytype-bar';
      entries.forEach((entry) => {
        const part = document.createElement('span');
        part.style.width = `${entry.share * 100}%`;
        part.style.background = entry.color;
        part.title = `${entry.label}: ${Math.round(entry.share * 100)} % ` +
          `(${Utils.formatDistance(entry.length)})`;
        bar.appendChild(part);
      });
      el.waytypeBars.appendChild(bar);

      const legend = document.createElement('ul');
      legend.className = 'waytype-legend';
      entries.forEach((entry) => {
        const li = document.createElement('li');
        const dot = document.createElement('span');
        dot.className = 'waytype-dot';
        dot.style.background = entry.color;
        const text = document.createElement('span');
        text.textContent =
          `${entry.label} · ${Math.round(entry.share * 100)} % (${Utils.formatDistance(entry.length)})`;
        li.append(dot, text);
        legend.appendChild(li);
      });
      el.waytypeBars.appendChild(legend);

      if (footnote) {
        const note = document.createElement('p');
        note.className = 'hint';
        note.textContent = footnote;
        el.waytypeBars.appendChild(note);
      }
    };

    addGroup('Wegarten', analysis.types);
    addGroup(
      'Oberfläche',
      analysis.surfaces,
      analysis.unknownSurface > analysis.total * 0.05
        ? `Für ${Utils.formatDistance(analysis.unknownSurface)} ist in OpenStreetMap ` +
          'keine Oberfläche hinterlegt.'
        : null
    );

    updatePavedOverlay();
  }

  function updatePavedOverlay() {
    const show = el.showPaved.checked && state.segments;
    MapView.renderPavedSections(show ? WayTypes.pavedSections(state.segments) : null);
  }

  function updateWarnings() {
    const warnings = state.segments ? WayTypes.warnings(state.segments) : [];

    if (warnings.length === 0) {
      el.warningSection.hidden = true;
      return;
    }
    el.warningSection.hidden = false;
    el.warningList.innerHTML = '';

    warnings.forEach((warning) => {
      const li = document.createElement('li');
      li.className = `warning-${warning.kind}`;

      const label = document.createElement('span');
      label.className = 'item-label';
      label.textContent = warning.label;

      const length = document.createElement('span');
      length.className = 'warning-length';
      length.textContent = Utils.formatDistance(warning.length);

      li.append(label, length);
      if (warning.lat != null) {
        li.title = 'Auf der Karte zeigen';
        li.classList.add('clickable');
        li.addEventListener('click', () => MapView.setView(warning.lat, warning.lng, 16));
      }
      el.warningList.appendChild(li);
    });
  }

  /* ---------- Varianten ---------- */

  async function loadAlternatives() {
    if (state.points.length < 2 || state.routing.roundTrip) {
      el.altSection.hidden = true;
      return;
    }
    const id = requestId;
    let routes;
    try {
      routes = await Routing.fetchAlternatives(state.points, state.routing, 3);
    } catch (err) {
      el.altSection.hidden = true;
      return;
    }
    if (id !== requestId || routes.length < 2) {
      el.altSection.hidden = true;
      return;
    }

    state.alternatives = routes;
    renderAlternativeList();
  }

  function renderAlternativeList() {
    const routes = state.alternatives;
    if (!routes || routes.length < 2) {
      el.altSection.hidden = true;
      return;
    }
    el.altSection.hidden = false;
    el.altList.innerHTML = '';

    routes.forEach((route, index) => {
      const li = document.createElement('li');
      if (index === state.activeAlternative) li.classList.add('active');

      const climb = route.elevations
        ? Elevation.computeAscentDescent(route.elevations)
        : null;

      const label = document.createElement('span');
      label.className = 'item-label';
      label.textContent = index === 0 ? 'Hauptroute' : `Variante ${index}`;

      const stats = document.createElement('span');
      stats.className = 'alternative-stats';
      stats.textContent = Utils.formatDistance(route.distance) +
        (climb ? ` · ↗ ${Math.round(climb.ascent)} Hm` : '');

      li.append(label, stats);
      li.addEventListener('click', () => selectAlternative(index));
      el.altList.appendChild(li);
    });
  }

  function selectAlternative(index) {
    const route = state.alternatives[index];
    if (!route) return;
    state.activeAlternative = index;
    applyRoute(route);
    // Höhen der gewählten Variante übernehmen, sonst zeigt das Profil noch
    // die vorherige Strecke.
    if (route.elevations) useRouteElevations(route.elevations);
    renderAlternativeList();
    renderAll();
  }

  /* ---------- Unterwegs: Einkehr, Wasser, Haltestellen ---------- */

  function renderPlaceFilters() {
    el.placeFilters.innerHTML = '';
    Object.entries(Overpass.CATEGORIES).forEach(([key, category]) => {
      const label = document.createElement('label');
      label.className = 'place-filter';

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = key;
      box.checked = state.placeCategories.includes(key);
      box.addEventListener('change', () => {
        state.placeCategories = [...el.placeFilters.querySelectorAll('input:checked')]
          .map((input) => input.value);
        localStorage.setItem('wanderplaner.places', JSON.stringify(state.placeCategories));
        el.placesBtn.disabled = !state.geometry || state.placeCategories.length === 0;
      });

      const text = document.createElement('span');
      text.textContent = `${category.icon} ${category.label}`;

      label.append(box, text);
      el.placeFilters.appendChild(label);
    });
  }

  async function searchPlaces() {
    if (!state.geometry || state.placeCategories.length === 0) return;

    el.placesBtn.disabled = true;
    el.placeNote.textContent = 'Suche entlang der Route …';
    try {
      const places = await Overpass.search(
        state.geometry,
        state.placeCategories,
        Number(el.placeRadius.value)
      );
      state.places = places;
      renderPlaceList();
      MapView.renderPlaces(places);
    } catch (err) {
      el.placeNote.textContent = err.message ||
        'Die Umgebungssuche ist gerade nicht erreichbar.';
    } finally {
      el.placesBtn.disabled = !state.geometry || state.placeCategories.length === 0;
    }
  }

  function renderPlaceList() {
    el.placeList.innerHTML = '';
    const places = state.places || [];

    if (places.length === 0) {
      el.placeNote.textContent = 'Nichts gefunden – größeren Umkreis versuchen.';
      return;
    }

    // Nach Position entlang der Route ordnen, damit die Liste der Gehrichtung folgt.
    const withPosition = places.map((place) => {
      const { distance, index } = Nearby.distanceToRoute(place, state.geometry);
      return { ...place, detour: distance, order: index };
    }).sort((a, b) => a.order - b.order);

    el.placeNote.textContent = `${places.length} gefunden entlang der Route.`;

    withPosition.forEach((place) => {
      const category = Overpass.CATEGORIES[place.category];
      const li = document.createElement('li');

      const icon = document.createElement('span');
      icon.textContent = category.icon;

      const label = document.createElement('span');
      label.className = 'item-label';
      label.textContent = place.name;
      label.title = place.opening ? `${place.kind} · ${place.opening}` : place.kind;
      label.addEventListener('click', () => MapView.setView(place.lat, place.lng, 16));

      const detour = document.createElement('span');
      detour.className = 'along-detour';
      detour.textContent = place.detour < 30 ? 'am Weg' : `${Math.round(place.detour)} m`;

      li.append(icon, label, detour);
      el.placeList.appendChild(li);
    });
  }

  /* ---------- Rundtour erzeugen ---------- */

  async function generateRoundTrip() {
    if (state.points.length === 0) return;

    const targetKm = Number(el.genLength.value);
    if (!Number.isFinite(targetKm) || targetKm < 2) {
      el.generatorNote.textContent = 'Bitte eine Länge ab 2 km angeben.';
      return;
    }

    el.generate.disabled = true;
    const start = state.points[0];
    try {
      const result = await RoundTrip.generate(
        start,
        targetKm,
        state.routing,
        Number(el.genBearing.value),
        (msg) => { el.generatorNote.textContent = msg; }
      );

      pushUndo();
      state.points = result.points.map((p) => ({ id: Utils.uid(), lat: p.lat, lng: p.lng }));
      // Die Schleife ist bereits geschlossen – der Rundkurs-Modus würde sie
      // ein zweites Mal zurückführen.
      state.routing.roundTrip = false;
      el.roundTrip.checked = false;
      saveRoutingSettings();

      applyRoute(result.route);
      renderAll();
      MapView.fitTo(state.points);
      await loadElevationAndFinish(++requestId, result.route);

      const km = (result.route.distance / 1000).toFixed(1).replace('.', ',');
      // Stichwege entstehen, wenn ein Stützpunkt des gedachten Kreises am
      // Ende einer Sackgasse landet – sie werden herausgerechnet.
      const spurs = result.removedSpurs
        ? ` ${result.removedSpurs} Stichweg(e) wurden entfernt.`
        : '';
      el.generatorNote.textContent =
        `Rundtour über ${km} km gefunden (${result.attempts} Versuch(e)).${spurs} ` +
        'Punkte lassen sich wie gewohnt verschieben.';
    } catch (err) {
      el.generatorNote.textContent = err.message;
    } finally {
      el.generate.disabled = state.points.length === 0;
    }
  }

  /* ---------- Wetter ---------- */

  const scheduleWeather = Utils.debounce(updateWeather, 900);

  async function updateWeather() {
    if (state.points.length === 0 || state.distance === 0) {
      el.weatherNote.hidden = true;
      return;
    }
    const hours = Utils.estimateWalkTime(state.distance, state.ascent, state.descent);
    try {
      const forecast = await Weather.forecast(state.points[0], plannedStart(), hours);
      const text = Weather.describe(forecast);
      if (!text) {
        el.weatherNote.hidden = true;
        return;
      }
      el.weatherNote.hidden = false;
      el.weatherNote.textContent = text;
      // Bei Gewitter oder viel Regen deutlicher hervorheben.
      const rough = forecast.rainChance >= 60 || forecast.rainMm >= 3 ||
        (forecast.icon === '⛈');
      el.weatherNote.className = `weather-note ${rough ? 'rough' : ''}`;
    } catch (err) {
      el.weatherNote.hidden = true;
    }
  }

  /* ---------- Offline-Betrieb ---------- */

  /**
   * Meldet den Service Worker an, der Programmdateien und Kartenkacheln
   * vorhält. Nur bei HTTPS oder localhost möglich; beim Öffnen der Datei
   * per file:// entfällt er ersatzlos.
   */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol === 'file:') return;

    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Offline-Betrieb nicht verfügbar:', err);
    });
  }

  /* ---------- Tageslicht ---------- */

  /** Liest die eingestellte Startzeit; ohne Eingabe „jetzt“. */
  function plannedStart() {
    const value = el.startTime.value;
    if (!value) return new Date();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function setStartTime(date) {
    // datetime-local erwartet lokale Zeit ohne Zeitzone.
    const pad = (n) => String(n).padStart(2, '0');
    el.startTime.value =
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function updateDaylight() {
    const note = el.daylightNote;

    if (state.points.length === 0 || state.distance === 0) {
      note.className = 'daylight-note';
      note.textContent = 'Route zeichnen, um die Gehzeit gegen den Sonnenuntergang zu prüfen.';
      return;
    }

    const hours = Utils.estimateWalkTime(state.distance, state.ascent, state.descent);
    const result = Daylight.check(plannedStart(), hours, state.points[0]);

    note.className = `daylight-note ${result.level}`;
    const icons = { ok: '☀', tight: '⚠', dark: '🌙', unknown: 'ℹ' };
    note.textContent = `${icons[result.level] || ''} ${result.message}`;
  }

  /* ---------- Stempelstellen entlang der Route ---------- */

  function updateAlongRoute() {
    const section = el.alongSection;

    if (!state.geometry) {
      section.hidden = true;
      MapView.highlightStamps([]);
      return;
    }

    const radius = Number(el.alongRadius.value);
    const found = Nearby.alongRoute(items('stamps'), state.geometry, radius);

    section.hidden = false;
    el.alongList.innerHTML = '';

    const open = found.filter((s) => !s.collected).length;
    el.alongCount.textContent = found.length === 0
      ? 'keine gefunden'
      : `${found.length} gefunden, davon ${open} offen`;

    if (found.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = 'Keine Stempelstelle in diesem Umkreis';
      el.alongList.appendChild(li);
      MapView.highlightStamps([]);
      return;
    }

    found.forEach((stamp) => {
      const li = document.createElement('li');
      if (stamp.collected) li.classList.add('collected');

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = Boolean(stamp.collected);
      check.title = stamp.collected ? 'Als offen markieren' : 'Als erhalten markieren';
      check.addEventListener('change', () => toggleStampCollected(stamp.id));

      const label = document.createElement('span');
      label.className = 'item-label';
      label.textContent = stamp.name;
      label.title = 'Auf der Karte zeigen';
      label.addEventListener('click', () => {
        MapView.setView(stamp.lat, stamp.lng, 15);
        MapView.openStampPopup(stamp.id);
      });

      const detour = document.createElement('span');
      detour.className = 'along-detour';
      // Abstand zur Route und Position entlang der Strecke.
      detour.textContent = stamp.detour < 30
        ? 'direkt am Weg'
        : `${Math.round(stamp.detour)} m ab`;
      detour.title = `bei km ${(stamp.at / 1000).toFixed(1)} der Route`;

      li.append(check, label, detour);
      el.alongList.appendChild(li);
    });

    MapView.highlightStamps(found.map((s) => s.id));
  }

  /* ---------- Standort ---------- */

  function toggleLocate() {
    if (Geo.running) {
      Geo.stop();
      MapView.clearPosition();
      el.locate.classList.remove('active');
      el.locate.textContent = '📍 Standort';
      renderNearbyPrompt(null);
      return;
    }

    const started = Geo.start(
      (pos) => {
        MapView.showPosition(pos);
        el.locate.classList.add('active');
        el.locate.textContent = '📍 aktiv';
        renderNearbyPrompt(pos);
      },
      (message) => {
        showStatus('warn', message, 8000);
        el.locate.classList.remove('active');
        el.locate.textContent = '📍 Standort';
      }
    );
    if (started) el.locate.textContent = '📍 suche …';
  }

  /**
   * Zeigt Stempelstellen in Reichweite des aktuellen Standorts als
   * Kartenmeldung mit direktem Haken.
   */
  function renderNearbyPrompt(position) {
    if (!position) {
      MapView.setNearbyPanel(null);
      return;
    }
    const near = Nearby.aroundPosition(items('stamps'), position, 250)
      .filter((s) => !s.collected);
    MapView.setNearbyPanel(near, (id) => toggleStampCollected(id));
  }

  /* ---------- Linke Seitenleiste ---------- */

  function setLibraryOpen(open) {
    el.layout.classList.toggle('library-collapsed', !open);
    el.libraryToggle.setAttribute('aria-expanded', String(open));
    localStorage.setItem('wanderplaner.library', open ? 'open' : 'closed');
    // Leaflet muss die neue Kartengröße erfahren, sonst bleibt sie verzerrt.
    setTimeout(() => MapView.invalidateSize(), 220);
  }

  function toggleLibrary() {
    setLibraryOpen(el.layout.classList.contains('library-collapsed'));
  }

  /* ---------- Blende am unteren Rand (Handy) ---------- */

  // Ab hier wird die Planung zur hochziehbaren Blende statt einer Spalte.
  const PHONE = window.matchMedia('(max-width: 900px)');

  function setSheetOpen(open) {
    el.layout.classList.toggle('sheet-open', open);
    el.sheetHandle.setAttribute('aria-expanded', String(open));
    localStorage.setItem('wanderplaner.sheet', open ? 'open' : 'closed');
    // Zugeklappt bleibt die Blende oben stehen, sonst sieht man beim
    // nächsten Öffnen die Mitte der Liste.
    if (!open) el.sidebar.scrollTop = 0;
    setTimeout(() => MapView.invalidateSize(), 300);
  }

  /** Klappt die Blende zu, wenn sie gerade die Karte verdeckt. */
  function dismissSheet() {
    if (!PHONE.matches || !el.layout.classList.contains('sheet-open')) return false;
    setSheetOpen(false);
    return true;
  }

  /**
   * Am Handy gehört das Höhenprofil in die Blende: Als eigener Streifen
   * würde es ein Drittel des Bildschirms fressen, den die Karte braucht.
   * Auf breiten Bildschirmen bleibt es an seinem Platz unter der Karte.
   */
  function placeProfile() {
    const profile = el.profilePanel;
    if (PHONE.matches) {
      if (profile.parentElement !== el.sidebar) {
        // Direkt hinter die Zahlenreihe, vor die Reiter.
        el.sidebar.insertBefore(profile, el.sidebar.querySelector('.tabs'));
      }
    } else if (profile.parentElement !== el.layout) {
      el.layout.appendChild(profile);
      el.layout.classList.remove('sheet-open');
    }
    // Karte und Diagramm haben jetzt andere Maße.
    setTimeout(() => {
      MapView.invalidateSize();
      if (chart) chart.resize();
    }, 60);
  }

  /* ---------- Einstellungen ---------- */

  function setSettingsOpen(open) {
    el.settings.hidden = !open;
    el.settingsBtn.setAttribute('aria-expanded', String(open));
    if (open) el.settingsClose.focus();
  }

  /* ---------- Sicherung als Datei ---------- */

  function downloadBackup() {
    Backup.download({
      stamps: state.stamps,
      parking: state.parking,
      tracks: state.tracks,
      savedTours: state.savedTours,
    });
    showStatus('info', 'Sicherung heruntergeladen.', 5000);
  }

  async function restoreBackup(file) {
    try {
      const text = await readFile(file);
      const data = Backup.parse(text);

      pushUndo();
      // Zusammenführen statt ersetzen: vorhandene Einträge bleiben erhalten,
      // bei gleicher id gewinnt der neuere Stand.
      state.stamps = Sync.mergeList(state.stamps, data.stamps);
      state.parking = Sync.mergeList(state.parking, data.parking);
      state.tracks = Sync.mergeList(state.tracks, data.tracks);
      state.savedTours = Sync.mergeList(state.savedTours, data.tours);

      ['stamps', 'parking', 'tracks', 'tours'].forEach(persist);
      renderAll();
      setSettingsOpen(false);
      showStatus(
        'info',
        `Sicherung eingelesen: ${items('stamps').length} Stempelstellen, ` +
          `${items('parking').length} Parkplätze, ${items('tracks').length} hinterlegte ` +
          `und ${items('tours').length} gespeicherte Touren.`,
        9000
      );
    } catch (err) {
      showStatus('error', err.message || 'Die Sicherung konnte nicht gelesen werden.');
    }
  }

  function updateEngineNote(engine) {
    if (engine === 'brouter') {
      el.engineNote.className = 'engine-note ok';
      el.engineNote.textContent =
        'Routing über BRouter – die Einstellungen wirken direkt auf die Wegekosten.';
    } else if (engine === 'osrm') {
      el.engineNote.className = 'engine-note warn';
      el.engineNote.textContent =
        'Ersatz-Routing über OSRM: folgt überwiegend Straßen, Einstellungen wirken nicht.';
    } else {
      el.engineNote.className = 'engine-note';
      el.engineNote.textContent = '';
    }
  }

  /* ---------- Ortssuche (Nominatim) ---------- */

  async function searchPlace(query) {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
      encodeURIComponent(query);
    try {
      const response = await Utils.fetchWithTimeout(url, {}, 10000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const results = await response.json();
      if (results.length === 0) {
        showStatus('warn', `Kein Ort für „${query}“ gefunden.`, 5000);
        return;
      }
      MapView.setView(parseFloat(results[0].lat), parseFloat(results[0].lon), 13);
      hideStatus();
    } catch (err) {
      showStatus('error', 'Ortssuche derzeit nicht erreichbar.');
    }
  }

  /* ---------- Initialisierung ---------- */

  function init() {
    MapView.init({
      onMapClick: (latlng) => {
        // Am Handy verdeckt die offene Blende fast die ganze Karte. Wer
        // dorthin tippt, will die Karte – also erst zuklappen.
        if (dismissSheet()) return;
        // Im Menümodus verändert ein Klick nichts, sondern fragt erst nach.
        if (state.mode === 'poi') addPoi(latlng);
        else if (state.mode === 'route') addPoint(latlng);
        else openMapMenu(latlng);
      },
      onMapMenu: (latlng) => {
        if (dismissSheet()) return;
        openMapMenu(latlng);
      },
      onPointMenu: openPointMenu,
      onPointMoved: movePoint,
      onPointDelete: deletePoint,
      onPoiMoved: movePoi,
      onPoiEdit: editPoi,
      onPoiDelete: deletePoi,
      onStampCollectedToggle: toggleStampCollected,
      onStampTourToggle: toggleStampTour,
      onParkingAsStart: parkingAsStart,
      onParkingDelete: deleteParking,
      getStartName: () => state.tourName || 'Startpunkt der Wanderung',
      onRouteDrag: insertPointAt,
      onRouteHover: highlightChartIndex,
      onRouteHoverEnd: clearChartHighlight,
    });

    initChart();
    // Einmal durchlaufen, damit das leere Diagramm von Anfang an als leer
    // markiert ist – am Handy wird es dann gar nicht erst eingeblendet.
    updateChart();
    initRoutingUi();

    el.modeMenu.addEventListener('click', () => setMode('menu'));
    el.modeRoute.addEventListener('click', () => setMode('route'));
    el.modePoi.addEventListener('click', () => setMode('poi'));
    setMode(localStorage.getItem('wanderplaner.mode') || 'menu');
    el.undo.addEventListener('click', undo);
    el.clear.addEventListener('click', clearAll);
    el.export.addEventListener('click', exportGpx);
    // Am Handy zeigt die Kopfzeile erst nur die Lupe; sie klappt das Feld auf.
    el.searchForm.querySelector('button').addEventListener('click', (e) => {
      const bar = el.searchForm.parentElement;
      if (PHONE.matches && !bar.classList.contains('search-open')) {
        e.preventDefault();
        bar.classList.add('search-open');
        el.searchInput.focus();
      }
    });
    el.searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const query = el.searchInput.value.trim();
      if (query) searchPlace(query);
    });

    el.importBtn.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', () => {
      const files = [...el.importFile.files];
      if (files.length > 0) importGpxFiles(files);
      el.importFile.value = ''; // erneuter Import derselben Datei möglich
    });
    el.importType.addEventListener('change', updateImportHint);
    updateImportHint();

    el.tourNameInput.addEventListener('input', () => {
      state.tourName = el.tourNameInput.value.trim();
      // Der Startpunkt-QR trägt den Tournamen – Marker neu zeichnen.
      MapView.renderPoints(state.points);
    });
    el.tourNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveCurrentTour();
    });
    el.saveTour.addEventListener('click', saveCurrentTour);

    el.roundTrip.addEventListener('change', () => {
      state.routing.roundTrip = el.roundTrip.checked;
      saveRoutingSettings();
      scheduleRecalc();
    });
    el.roundTrip.checked = Boolean(state.routing.roundTrip);
    el.stampSearch.addEventListener('input', renderStampList);
    el.stampFilter.addEventListener('change', renderStampList);
    el.suggest.addEventListener('click', suggestRoute);
    el.tourClear.addEventListener('click', clearTourSelection);

    setStartTime(new Date());
    el.startTime.addEventListener('change', () => {
      updateDaylight();
      scheduleWeather();
    });
    el.nowBtn.addEventListener('click', () => {
      setStartTime(new Date());
      updateDaylight();
      scheduleWeather();
    });
    el.alongRadius.addEventListener('change', updateAlongRoute);
    el.reverse.addEventListener('click', reverseRoute);
    el.generate.addEventListener('click', generateRoundTrip);
    el.showPaved.addEventListener('change', updatePavedOverlay);
    el.placesBtn.addEventListener('click', searchPlaces);
    el.placeRadius.addEventListener('change', searchPlaces);
    renderPlaceFilters();
    el.locate.addEventListener('click', toggleLocate);
    if (!Geo.supported) el.locate.hidden = true;

    el.tabs.forEach((tab) => {
      tab.addEventListener('click', () => setTab(tab.dataset.tab));
    });
    setTab(localStorage.getItem('wanderplaner.tab') || 'planung');
    el.clustersBtn.addEventListener('click', findClusters);
    el.clusterLength.addEventListener('change', () => {
      if (state.clusters) findClusters();
    });

    el.routeStyle.value = state.routeStyle;
    el.routeStyle.addEventListener('change', () => {
      state.routeStyle = el.routeStyle.value;
      localStorage.setItem('wanderplaner.routestyle', state.routeStyle);
      drawRoute();
      updateChart(); // das Höhenprofil trägt dieselben Farben
    });

    el.checkUpdate.addEventListener('click', checkForUpdate);
    el.runUpdate.addEventListener('click', runUpdate);
    el.reloadShell.addEventListener('click', reloadShell);
    loadVersion();
    loadShellVersion();
    // Beim ersten Aufruf übernimmt der Service Worker erst kurz nach dem
    // Laden – dann noch einmal nachfragen.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', loadShellVersion);
    }
    checkUpdateAbility();

    el.libraryToggle.addEventListener('click', toggleLibrary);
    // Am Handy überlagert die Sammlung die Karte – dort bleibt sie zu,
    // solange man sie nicht ausdrücklich aufruft.
    setLibraryOpen(PHONE.matches
      ? localStorage.getItem('wanderplaner.library') === 'open'
      : localStorage.getItem('wanderplaner.library') !== 'closed');

    el.sheetHandle.addEventListener('click', () => {
      setSheetOpen(!el.layout.classList.contains('sheet-open'));
    });
    placeProfile();
    PHONE.addEventListener('change', placeProfile);
    setSheetOpen(localStorage.getItem('wanderplaner.sheet') === 'open');

    el.settingsBtn.addEventListener('click', () => setSettingsOpen(true));
    el.settingsClose.addEventListener('click', () => setSettingsOpen(false));
    // Klick neben das Fenster schließt es, Klick darin nicht.
    el.settings.addEventListener('click', (e) => {
      if (e.target === el.settings) setSettingsOpen(false);
    });
    document.addEventListener('keydown', onKeyDown);

    // Die Stempelliste bleibt so, wie der Nutzer sie zuletzt hatte.
    el.stampDetails.open = localStorage.getItem('wanderplaner.stampsopen') === 'open';
    el.stampDetails.addEventListener('toggle', () => {
      localStorage.setItem('wanderplaner.stampsopen',
        el.stampDetails.open ? 'open' : 'closed');
    });

    el.syncBtn.addEventListener('click', async () => {
      // Der Knopf prüft auch erneut, ob der Server inzwischen da ist.
      if (!Sync.available) await Sync.probe();
      await runSync();
    });
    el.backupBtn.addEventListener('click', downloadBackup);
    el.restoreBtn.addEventListener('click', () => el.restoreFile.click());
    el.restoreFile.addEventListener('change', () => {
      const file = el.restoreFile.files[0];
      if (file) restoreBackup(file);
      el.restoreFile.value = '';
    });

    renderAll();
    updateStats();
    if (items('stamps').length > 0) MapView.fitTo(items('stamps'));
    // Beim allerersten Start erklären, wie man anfängt.
    if (isFreshInstall()) {
      showStatus('info',
        'Klick auf die Karte öffnet ein Menü – dort „Routenpunkt anhängen“ wählen. ' +
        'Zum zügigen Zeichnen oben auf „✏ Zeichnen“ umschalten.', 12000);
    }

    // Abgleich im Hintergrund starten – die App ist sofort bedienbar.
    initSync();
    registerServiceWorker();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
