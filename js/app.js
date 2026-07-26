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
    tourSelection: [],  // Stempel-IDs, die in den Routenvorschlag sollen
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
    chartEmpty: document.getElementById('chart-empty'),
    searchForm: document.getElementById('search-form'),
    searchInput: document.getElementById('search-input'),
  };

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
    state.tourSelection = parsed.tourSelection || [];
    Stamps.save(state.stamps);
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
      const route = await Routing.fetchRoute(state.points);
      if (id !== requestId) return; // inzwischen gab es eine neuere Änderung

      state.geometry = route.coordinates;
      state.distance = route.distance;
      MapView.renderRoute(state.geometry);
      updateStats();
      updateButtons();
      hideStatus();

      await loadElevation(id);
    } catch (err) {
      if (id !== requestId) return;
      showStatus('error', `${err.message} Die Route wurde nicht aktualisiert.`);
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

    const visible = state.stamps
      .filter((s) => {
        if (filter === 'open' && s.collected) return false;
        if (filter === 'collected' && !s.collected) return false;
        return !query || s.name.toLowerCase().includes(query);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));

    el.stampList.innerHTML = '';
    if (state.stamps.length === 0) {
      el.stampCounter.textContent = 'Noch keine Stempelstellen importiert';
    } else {
      const collected = state.stamps.filter((s) => s.collected).length;
      el.stampCounter.textContent =
        `${collected} von ${state.stamps.length} Stempeln erhalten` +
        (visible.length !== state.stamps.length
          ? ` · ${visible.length} angezeigt`
          : '');
    }

    if (visible.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = state.stamps.length === 0
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

  function importGpxFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const waypoints = Stamps.parseGpxWaypoints(reader.result);
        if (waypoints.length === 0) {
          showStatus('warn', 'Die GPX-Datei enthält keine Wegpunkte (<wpt>).', 6000);
          return;
        }
        pushUndo();
        if (el.importType.value === 'stempel') {
          const result = Stamps.merge(state.stamps, waypoints);
          state.stamps = result.stamps;
          Stamps.save(state.stamps);
          showStatus(
            'info',
            `${result.added} Stempelstelle(n) importiert` +
              (result.skipped > 0
                ? `, ${result.skipped} übersprungen (bereits vorhanden).`
                : '.'),
            6000
          );
          MapView.fitTo(state.stamps);
        } else {
          waypoints.forEach((w) => {
            state.pois.push({
              id: Utils.uid(),
              lat: w.lat,
              lng: w.lng,
              name: w.name || `POI ${poiCounter++}`,
              note: w.note,
            });
          });
          showStatus('info', `${waypoints.length} POI(s) importiert.`, 6000);
          MapView.fitTo(state.pois);
        }
        renderAll();
      } catch (err) {
        showStatus('error', err.message);
      }
    };
    reader.onerror = () => showStatus('error', 'Die Datei konnte nicht gelesen werden.');
    reader.readAsText(file);
  }

  function toggleStampCollected(id) {
    const stamp = state.stamps.find((s) => s.id === id);
    if (!stamp) return;
    pushUndo();
    stamp.collected = !stamp.collected;
    Stamps.save(state.stamps);
    renderAll();
  }

  function toggleStampTour(id) {
    const index = state.tourSelection.indexOf(id);
    if (index >= 0) state.tourSelection.splice(index, 1);
    else state.tourSelection.push(id);
    renderAll();
  }

  function deleteStamp(id) {
    pushUndo();
    state.stamps = state.stamps.filter((s) => s.id !== id);
    state.tourSelection = state.tourSelection.filter((sid) => sid !== id);
    Stamps.save(state.stamps);
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
      .map((id) => state.stamps.find((s) => s.id === id))
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
    MapView.renderPoints(state.points);
    MapView.renderPois(state.pois);
    MapView.renderStamps(state.stamps, state.tourSelection);
    renderPointList();
    renderPoiList();
    renderStampList();
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
      .map((id) => state.stamps.find((s) => s.id === id))
      .filter(Boolean);
    Gpx.download(trackPoints, [...state.pois, ...tourStamps]);
    showStatus('info', 'GPX-Datei wurde heruntergeladen.', 4000);
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
      onRouteHover: highlightChartIndex,
      onRouteHoverEnd: clearChartHighlight,
    });

    initChart();

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
      const file = el.importFile.files[0];
      if (file) importGpxFile(file);
      el.importFile.value = ''; // erneuter Import derselben Datei möglich
    });
    el.stampSearch.addEventListener('input', renderStampList);
    el.stampFilter.addEventListener('change', renderStampList);
    el.suggest.addEventListener('click', suggestRoute);
    el.tourClear.addEventListener('click', clearTourSelection);

    renderAll();
    updateStats();
    if (state.stamps.length > 0) MapView.fitTo(state.stamps);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
