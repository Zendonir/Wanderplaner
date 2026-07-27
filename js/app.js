'use strict';

/**
 * Anwendungslogik: Zustand, UI-Rendering und Orchestrierung von
 * Karte, Routing, Höhenprofil und Export.
 */
(function () {
  const state = {
    mode: 'route',      // 'route' | 'poi'
    points: [],         // [{id, lat, lng}]
    pois: [],           // [{id, lat, lng, name, note}]
    stamps: Stamps.load(), // [{id, lat, lng, name, note, collected}] – persistent
    parking: Parking.load(), // Parkplätze – persistent
    tracks: Tracks.load(),   // abgeschlossene Touren als Spur – persistent
    savedTours: Tours.load(), // benannte Planungen – persistent
    tourName: '',
    tourSelection: [],  // Stempel-IDs, die in den Routenvorschlag sollen
    routing: loadRoutingSettings(), // Gewichtung der Wegetypen
    preset: localStorage.getItem('wanderplaner.preset') || 'wander',
    geometry: null,     // [[lng, lat], ...] der berechneten Route
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
    modeRoute: document.getElementById('mode-route'),
    modePoi: document.getElementById('mode-poi'),
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

    if (Sync.available) {
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

  async function recalcRoute() {
    const id = ++requestId;

    if (state.points.length < 2) {
      state.geometry = null;
      state.distance = 0;
      state.samples = null;
      state.ascent = null;
      state.descent = null;
      MapView.renderRoute(null);
      MapView.setSamples(null);
      updateChart();
      updateStats();
      updateButtons();
      if (state.points.length === 1) {
        showStatus('info', 'Noch einen zweiten Punkt setzen, um die Route zu berechnen.', 4000);
      } else {
        hideStatus();
      }
      return;
    }

    showStatus('info', 'Berechne Route …');
    try {
      const route = await Routing.fetchRoute(state.points, state.routing);
      if (id !== requestId) return; // inzwischen gab es eine neuere Änderung

      state.geometry = route.coordinates;
      state.distance = route.distance;
      MapView.renderRoute(state.geometry);
      updateStats();
      updateButtons();
      updateEngineNote(route.engine);

      if (route.warning) showStatus('warn', route.warning, 10000);
      else hideStatus();

      if (route.elevations) {
        // BRouter liefert die Höhen bereits mit – keine Extra-Abfrage nötig.
        useRouteElevations(route.elevations);
      } else {
        await loadElevation(id);
      }
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
  }

  function updateButtons() {
    el.undo.disabled = state.undoStack.length === 0;
    el.clear.disabled = state.points.length === 0 && state.pois.length === 0;
    el.export.disabled = !state.geometry;
  }

  /* ---------- Höhenprofil (Chart.js) ---------- */

  function initChart() {
    const canvas = document.getElementById('elevation-chart');
    chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Höhe',
          data: [],
          borderColor: '#2f6b3f',
          backgroundColor: 'rgba(47, 107, 63, 0.18)',
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#1d5fbf',
          borderWidth: 2,
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
              label: (item) => `${Math.round(item.parsed.y)} m`,
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
    chart.update('none');
    el.chartEmpty.classList.toggle('hidden', Boolean(hasData));
    el.chartEmpty.textContent = state.geometry && !hasData
      ? 'Höhenprofil nicht verfügbar'
      : 'Noch keine Route berechnet';
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
      li.innerHTML =
        '<span class="drag-handle" title="Zum Sortieren ziehen">≡</span>' +
        `<span class="point-num">${i + 1}</span>` +
        `<span class="item-label">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>` +
        '<button class="item-delete" title="Punkt löschen">✕</button>';

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

      li.append(visible, swatch, label, renameBtn, deleteBtn);
      el.trackList.appendChild(li);
    });
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

  /* ---------- Gespeicherte Planungen ---------- */

  function renderTourList() {
    el.tourList.innerHTML = '';
    const tours = items('tours');
    if (tours.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = 'Noch keine Tour gespeichert';
      el.tourList.appendChild(li);
      return;
    }

    tours.forEach((tour) => {
      const li = document.createElement('li');

      const label = document.createElement('span');
      label.className = 'item-label';
      const distance = tour.distance ? ` · ${Utils.formatDistance(tour.distance)}` : '';
      label.textContent = `${tour.name}${distance}`;
      label.title = `Gespeichert am ${Tours.formatSavedAt(tour.savedAt)} · klicken zum Laden`;
      label.addEventListener('click', () => loadTour(tour.id));

      const renameBtn = document.createElement('button');
      renameBtn.className = 'item-action';
      renameBtn.textContent = '✎';
      renameBtn.title = 'Umbenennen';
      renameBtn.addEventListener('click', () => renameTour(tour.id));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'item-delete';
      deleteBtn.textContent = '✕';
      deleteBtn.title = 'Tour löschen';
      deleteBtn.addEventListener('click', () => deleteTour(tour.id));

      li.append(label, renameBtn, deleteBtn);
      el.tourList.appendChild(li);
    });
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
    const entry = Tours.fromState(name, state);

    // Gleicher Name überschreibt den bestehenden Eintrag.
    const existing = state.savedTours.findIndex((t) => !t.deletedAt && t.name === name);
    if (existing >= 0) {
      entry.id = state.savedTours[existing].id;
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
    MapView.renderTracks(items('tracks')); // zuerst, damit sie unter der Route liegen
    MapView.renderPoints(state.points);
    MapView.renderPois(state.pois);
    MapView.renderStamps(items('stamps'), state.tourSelection);
    MapView.renderParking(items('parking'));
    renderPointList();
    renderPoiList();
    renderStampList();
    renderParkingList();
    renderTrackList();
    renderTourList();
    updateTourBar();
    updateButtons();
  }

  /* ---------- Aktionen ---------- */

  function addPoint(latlng) {
    pushUndo();
    state.points.push({ id: Utils.uid(), lat: latlng.lat, lng: latlng.lng });
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

  function clearAll() {
    if (state.points.length === 0 && state.pois.length === 0) return;
    pushUndo();
    state.points = [];
    state.pois = [];
    renderAll();
    scheduleRecalc();
  }

  function setMode(mode) {
    state.mode = mode;
    el.modeRoute.classList.toggle('active', mode === 'route');
    el.modePoi.classList.toggle('active', mode === 'poi');
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
        if (state.mode === 'poi') addPoi(latlng);
        else addPoint(latlng);
      },
      onPointMoved: movePoint,
      onPointDelete: deletePoint,
      onPoiMoved: movePoi,
      onPoiEdit: editPoi,
      onPoiDelete: deletePoi,
      onStampCollectedToggle: toggleStampCollected,
      onStampTourToggle: toggleStampTour,
      onStampDelete: deleteStamp,
      onParkingAsStart: parkingAsStart,
      onParkingDelete: deleteParking,
      getStartName: () => state.tourName || 'Startpunkt der Wanderung',
      onRouteHover: highlightChartIndex,
      onRouteHoverEnd: clearChartHighlight,
    });

    initChart();
    initRoutingUi();

    el.modeRoute.addEventListener('click', () => setMode('route'));
    el.modePoi.addEventListener('click', () => setMode('poi'));
    el.undo.addEventListener('click', undo);
    el.clear.addEventListener('click', clearAll);
    el.export.addEventListener('click', exportGpx);
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
    el.startTime.addEventListener('change', updateDaylight);
    el.nowBtn.addEventListener('click', () => {
      setStartTime(new Date());
      updateDaylight();
    });
    el.alongRadius.addEventListener('change', updateAlongRoute);
    el.locate.addEventListener('click', toggleLocate);
    if (!Geo.supported) el.locate.hidden = true;

    el.libraryToggle.addEventListener('click', toggleLibrary);
    setLibraryOpen(localStorage.getItem('wanderplaner.library') !== 'closed');

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

    // Abgleich im Hintergrund starten – die App ist sofort bedienbar.
    initSync();
    registerServiceWorker();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
