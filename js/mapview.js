'use strict';

/**
 * Kapselt die gesamte Leaflet-Logik: Karte, Routenpunkte, POIs,
 * Routen-Polyline und der Hover-Marker für die Kopplung mit dem Höhenprofil.
 */
const MapView = (function () {
  let map = null;
  let cbs = {};
  let routeLine = null;
  let hitLine = null; // breite, unsichtbare Linie für bequemes Hovern
  let hoverMarker = null;
  let pointMarkers = [];
  let poiMarkers = new Map();
  let stampMarkers = new Map();
  let parkingMarkers = new Map();
  let trackLines = new Map();
  let highlighted = new Set(); // Stempel an der aktuellen Route
  let positionMarker = null;
  let accuracyCircle = null;
  let nearbyControl = null;
  let lastStamps = [];
  let lastSelection = [];
  let routeCoords = null;
  let routePoints = [];
  let pavedLines = [];
  let placeMarkers = [];
  let suppressNextClick = false;
  let samples = null; // Höhen-Stützpunkte für die Hover-Zuordnung

  const OSM_ATTRIB =
    'Kartendaten: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende';

  /** Auswählbare Kartenebenen. */
  const BASE_LAYERS = {
    'OpenTopoMap': () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: `${OSM_ATTRIB}, SRTM | Darstellung: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
    }),
    // Zeigt Wegmarkierungen und Wegweiser – beim Planen entlang markierter
    // Wanderwege deutlich hilfreicher als eine reine Topokarte.
    'Wanderreitkarte': () => L.tileLayer('https://topo.wanderreitkarte.de/topo/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: `${OSM_ATTRIB} | Darstellung: <a href="https://www.wanderreitkarte.de">Wanderreitkarte</a>`,
    }),
    'OpenStreetMap': () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: OSM_ATTRIB,
    }),
    'Luftbild': () => L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 18, attribution: 'Luftbild: &copy; Esri, Maxar, Earthstar Geographics' }
    ),
  };

  function init(callbacks) {
    cbs = callbacks;
    map = L.map('map').setView([51.163, 10.447], 6);

    const saved = localStorage.getItem('wanderplaner.baselayer');
    const layers = {};
    Object.entries(BASE_LAYERS).forEach(([name, create]) => { layers[name] = create(); });

    const initial = layers[saved] ? saved : 'OpenTopoMap';
    layers[initial].addTo(map);
    L.control.layers(layers, null, { position: 'topright' }).addTo(map);
    map.on('baselayerchange', (e) => {
      localStorage.setItem('wanderplaner.baselayer', e.name);
    });

    map.on('click', (e) => {
      // Nach dem Ziehen der Route feuert Leaflet zusätzlich ein click –
      // ohne diese Sperre entstünde neben dem Zwischenpunkt noch ein
      // zweiter Punkt am Ende der Route.
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      cbs.onMapClick(e.latlng);
    });
  }

  /* ---------- Routenpunkte ---------- */

  function routeIcon(number, isStart) {
    return L.divIcon({
      className: '',
      html: `<div class="route-marker${isStart ? ' start' : ''}">${isStart ? '▶' : number}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -14],
    });
  }

  function renderPoints(points) {
    pointMarkers.forEach((m) => map.removeLayer(m));
    pointMarkers = [];

    points.forEach((p, i) => {
      const isStart = i === 0;
      const marker = L.marker([p.lat, p.lng], {
        draggable: true,
        icon: routeIcon(i + 1, isStart),
      }).addTo(map);
      marker.bindTooltip(
        isStart
          ? 'Startpunkt · klicken für QR-Code zur Anfahrt'
          : `Punkt ${i + 1} · ziehen zum Verschieben, Rechtsklick löscht`,
        { direction: 'top', offset: [0, -12] }
      );
      // Der Startpunkt zeigt beim Anklicken den QR-Code für die Anfahrt.
      if (isStart) {
        marker.bindPopup(
          () => qrPopupContent({ ...p, name: cbs.getStartName() }, 'start'),
          { maxWidth: 260 }
        );
      }
      marker.on('dragend', (e) => cbs.onPointMoved(p.id, e.target.getLatLng()));
      marker.on('contextmenu', () => cbs.onPointDelete(p.id));
      pointMarkers.push(marker);
    });
  }

  /* ---------- POIs ---------- */

  function poiIcon() {
    return L.divIcon({
      className: '',
      html: '<div class="poi-marker"><span>⚑</span></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -26],
    });
  }

  function poiPopupContent(poi) {
    const div = document.createElement('div');
    div.className = 'poi-popup';

    const nameInput = document.createElement('input');
    nameInput.value = poi.name;
    nameInput.placeholder = 'Name';

    const noteInput = document.createElement('textarea');
    noteInput.value = poi.note || '';
    noteInput.placeholder = 'Notiz';
    noteInput.rows = 2;

    const buttons = document.createElement('div');
    buttons.className = 'poi-popup-buttons';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Speichern';
    saveBtn.className = 'primary';
    saveBtn.addEventListener('click', () => {
      cbs.onPoiEdit(poi.id, nameInput.value.trim() || poi.name, noteInput.value.trim());
      map.closePopup();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Löschen';
    deleteBtn.className = 'danger';
    deleteBtn.addEventListener('click', () => {
      map.closePopup();
      cbs.onPoiDelete(poi.id);
    });

    buttons.append(saveBtn, deleteBtn);
    div.append(nameInput, noteInput, buttons);
    return div;
  }

  function renderPois(pois) {
    poiMarkers.forEach((m) => map.removeLayer(m));
    poiMarkers = new Map();

    pois.forEach((poi) => {
      const marker = L.marker([poi.lat, poi.lng], {
        draggable: true,
        icon: poiIcon(),
      }).addTo(map);
      marker.bindPopup(() => poiPopupContent(poi));
      marker.on('dragend', (e) => cbs.onPoiMoved(poi.id, e.target.getLatLng()));
      poiMarkers.set(poi.id, marker);
    });
  }

  function openPoiPopup(id) {
    const marker = poiMarkers.get(id);
    if (marker) marker.openPopup();
  }

  /* ---------- Stempelstellen ---------- */

  function stampIcon(stamp, selected) {
    const classes =
      'stamp-marker' +
      (stamp.collected ? ' collected' : '') +
      (selected ? ' selected' : '') +
      (highlighted.has(stamp.id) ? ' along' : '');
    return L.divIcon({
      className: '',
      html: `<div class="${classes}">${stamp.collected ? '✓' : 'S'}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -14],
    });
  }

  function stampPopupContent(stamp, selected) {
    const div = document.createElement('div');
    div.className = 'stamp-popup';

    const title = document.createElement('strong');
    title.textContent = stamp.name;
    div.appendChild(title);

    if (stamp.note) {
      const note = document.createElement('p');
      note.textContent = stamp.note;
      div.appendChild(note);
    }

    const status = document.createElement('p');
    status.className = 'stamp-status';
    status.textContent = stamp.collected ? '✓ Stempel erhalten' : 'Noch offen';
    div.appendChild(status);

    const buttons = document.createElement('div');
    buttons.className = 'poi-popup-buttons';

    const collectedBtn = document.createElement('button');
    collectedBtn.textContent = stamp.collected
      ? '↺ Doch nicht erhalten'
      : '✓ Als erhalten markieren';
    collectedBtn.className = 'primary';
    collectedBtn.addEventListener('click', () => {
      map.closePopup();
      cbs.onStampCollectedToggle(stamp.id);
    });

    const tourBtn = document.createElement('button');
    tourBtn.textContent = selected ? '− Aus Tour entfernen' : '+ Für Tour auswählen';
    tourBtn.addEventListener('click', () => {
      map.closePopup();
      cbs.onStampTourToggle(stamp.id);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Löschen';
    deleteBtn.className = 'danger';
    deleteBtn.addEventListener('click', () => {
      map.closePopup();
      cbs.onStampDelete(stamp.id);
    });

    buttons.append(collectedBtn, tourBtn, deleteBtn);
    div.appendChild(buttons);
    return div;
  }

  function renderStamps(stamps, selectedIds) {
    lastStamps = stamps;
    lastSelection = selectedIds;
    stampMarkers.forEach((m) => map.removeLayer(m));
    stampMarkers = new Map();

    const selected = new Set(selectedIds);
    stamps.forEach((stamp) => {
      const isSelected = selected.has(stamp.id);
      const marker = L.marker([stamp.lat, stamp.lng], {
        icon: stampIcon(stamp, isSelected),
      }).addTo(map);
      marker.bindTooltip(stamp.name, { direction: 'top', offset: [0, -12] });
      marker.bindPopup(() => stampPopupContent(stamp, isSelected));
      stampMarkers.set(stamp.id, marker);
    });
  }

  function openStampPopup(id) {
    const marker = stampMarkers.get(id);
    if (marker) marker.openPopup();
  }

  /** Hebt die Stempelstellen an der aktuellen Route hervor. */
  function highlightStamps(ids) {
    const next = new Set(ids);
    // Nur neu zeichnen, wenn sich die Menge wirklich geändert hat.
    if (next.size === highlighted.size && [...next].every((id) => highlighted.has(id))) {
      return;
    }
    highlighted = next;
    if (lastStamps.length > 0) renderStamps(lastStamps, lastSelection);
  }

  /* ---------- Eigener Standort ---------- */

  function showPosition(pos) {
    const latlng = [pos.lat, pos.lng];
    if (!positionMarker) {
      positionMarker = L.marker(latlng, {
        icon: L.divIcon({
          className: '',
          html: '<div class="position-marker"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(map);
      accuracyCircle = L.circle(latlng, {
        radius: pos.accuracy,
        color: '#1d5fbf',
        weight: 1,
        fillColor: '#1d5fbf',
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map);
      map.setView(latlng, Math.max(map.getZoom(), 15));
    } else {
      positionMarker.setLatLng(latlng);
      accuracyCircle.setLatLng(latlng).setRadius(pos.accuracy);
    }
  }

  function clearPosition() {
    if (positionMarker) { map.removeLayer(positionMarker); positionMarker = null; }
    if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
  }

  /**
   * Feld über der Karte mit Stempelstellen in Reichweite – gedacht für
   * unterwegs am Handy, wo die Seitenleiste zu weit weg ist.
   */
  function setNearbyPanel(stamps, onCollect) {
    if (nearbyControl) {
      map.removeControl(nearbyControl);
      nearbyControl = null;
    }
    if (!stamps || stamps.length === 0) return;

    const control = L.control({ position: 'bottomleft' });
    control.onAdd = () => {
      const div = L.DomUtil.create('div', 'nearby-panel');
      L.DomEvent.disableClickPropagation(div);

      const title = document.createElement('strong');
      title.textContent = stamps.length === 1
        ? 'Eine Stempelstelle in der Nähe'
        : `${stamps.length} Stempelstellen in der Nähe`;
      div.appendChild(title);

      stamps.slice(0, 4).forEach((stamp) => {
        const row = document.createElement('div');
        row.className = 'nearby-row';

        const name = document.createElement('span');
        name.textContent = `${stamp.name} · ${Math.round(stamp.distance)} m`;

        const button = document.createElement('button');
        button.textContent = '✓ erhalten';
        button.addEventListener('click', () => onCollect(stamp.id));

        row.append(name, button);
        div.appendChild(row);
      });
      return div;
    };
    control.addTo(map);
    nearbyControl = control;
  }

  /* ---------- Parkplätze mit QR-Code ---------- */

  function parkingIcon() {
    return L.divIcon({
      className: '',
      html: '<div class="parking-marker">P</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -14],
    });
  }

  /**
   * Popup mit QR-Code: abgescannt öffnet sich die Karten-App des Handys
   * an genau dieser Stelle.
   */
  function qrPopupContent(place, kind) {
    const div = document.createElement('div');
    div.className = 'qr-popup';

    const title = document.createElement('strong');
    title.textContent = place.name;
    div.appendChild(title);

    if (place.note) {
      const note = document.createElement('p');
      note.textContent = place.note;
      div.appendChild(note);
    }

    const coords = document.createElement('p');
    coords.className = 'qr-coords';
    coords.textContent = `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
    div.appendChild(coords);

    const controls = document.createElement('div');
    controls.className = 'qr-controls';

    const serviceSelect = document.createElement('select');
    Object.entries(MapLinks.SERVICES).forEach(([key, s]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = s.label;
      serviceSelect.appendChild(option);
    });

    const modeSelect = document.createElement('select');
    Object.entries(MapLinks.MODES).forEach(([key, m]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = m.label;
      modeSelect.appendChild(option);
    });

    controls.append(serviceSelect, modeSelect);
    div.appendChild(controls);

    const qrBox = document.createElement('div');
    qrBox.className = 'qr-box';
    div.appendChild(qrBox);

    const hint = document.createElement('p');
    hint.className = 'qr-hint';
    hint.textContent = 'Mit der Handy-Kamera scannen, um die Karten-App zu öffnen.';
    div.appendChild(hint);

    const link = document.createElement('a');
    link.className = 'qr-link';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Link hier öffnen';
    div.appendChild(link);

    const render = () => {
      const url = MapLinks.build(place, serviceSelect.value, modeSelect.value);
      qrBox.innerHTML = '';
      try {
        qrBox.appendChild(QRCode.toSvg(url, 170));
      } catch (err) {
        qrBox.textContent = 'QR-Code konnte nicht erzeugt werden.';
      }
      link.href = url;
      // geo:-Links kann der Desktop-Browser meist nicht öffnen.
      link.style.display = serviceSelect.value === 'geo' ? 'none' : '';
      modeSelect.disabled = serviceSelect.value === 'geo';
    };
    serviceSelect.addEventListener('change', render);
    modeSelect.addEventListener('change', render);
    render();

    const buttons = document.createElement('div');
    buttons.className = 'poi-popup-buttons';

    if (kind === 'parking') {
      const startBtn = document.createElement('button');
      startBtn.textContent = '▶ Als Startpunkt';
      startBtn.className = 'primary';
      startBtn.addEventListener('click', () => {
        map.closePopup();
        cbs.onParkingAsStart(place.id);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Löschen';
      deleteBtn.className = 'danger';
      deleteBtn.addEventListener('click', () => {
        map.closePopup();
        cbs.onParkingDelete(place.id);
      });
      buttons.append(startBtn, deleteBtn);
    }

    if (buttons.children.length > 0) div.appendChild(buttons);
    return div;
  }

  function renderParking(places) {
    parkingMarkers.forEach((m) => map.removeLayer(m));
    parkingMarkers = new Map();

    places.forEach((place) => {
      const marker = L.marker([place.lat, place.lng], { icon: parkingIcon() }).addTo(map);
      marker.bindTooltip(place.name, { direction: 'top', offset: [0, -12] });
      marker.bindPopup(() => qrPopupContent(place, 'parking'), { maxWidth: 260 });
      parkingMarkers.set(place.id, marker);
    });
  }

  function openParkingPopup(id) {
    const marker = parkingMarkers.get(id);
    if (marker) marker.openPopup();
  }

  /** QR-Popup für den Startpunkt der geplanten Route. */
  function openStartQr(point) {
    L.popup({ maxWidth: 260 })
      .setLatLng([point.lat, point.lng])
      .setContent(qrPopupContent(point, 'start'))
      .openOn(map);
  }

  /* ---------- Hinterlegte (abgeschlossene) Touren ---------- */

  function renderTracks(tracks) {
    trackLines.forEach((l) => map.removeLayer(l));
    trackLines = new Map();

    tracks.forEach((track) => {
      if (!track.visible) return;
      const line = L.polyline(Tracks.toLatLngs(track).map((p) => [p.lat, p.lng]), {
        color: track.color,
        weight: 3,
        opacity: 0.65,
        dashArray: '6 4',
      }).addTo(map);
      line.bindTooltip(
        `${track.name} · ${Utils.formatDistance(track.length)}`,
        { sticky: true }
      );
      // Hinterlegte Touren sollen das Setzen von Punkten nicht blockieren.
      line.on('click', (e) => {
        L.DomEvent.stop(e);
        cbs.onMapClick(e.latlng);
      });
      trackLines.set(track.id, line);
    });
  }

  /** Karte auf eine Punktmenge zoomen (z. B. nach einem Import). */
  function fitTo(points) {
    if (!points || points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }

  /* ---------- Route ---------- */

  /**
   * Bestimmt, zwischen welchen Routenpunkten eine Stelle der Geometrie liegt.
   * Dafür wird jeder Routenpunkt seinem nächstgelegenen Geometriepunkt
   * zugeordnet; diese Marken teilen die Linie in Abschnitte.
   * @returns {number} Position, an der ein neuer Punkt einzufügen ist
   */
  function insertIndexFor(latlng) {
    if (!routeCoords || routePoints.length < 2) return routePoints.length;

    // Index auf der Geometrie, der der gezogenen Stelle am nächsten liegt.
    let target = 0;
    let bestDist = Infinity;
    const cosLat = Math.cos((latlng.lat * Math.PI) / 180);
    for (let i = 0; i < routeCoords.length; i++) {
      const dLat = routeCoords[i][1] - latlng.lat;
      const dLng = (routeCoords[i][0] - latlng.lng) * cosLat;
      const d = dLat * dLat + dLng * dLng;
      if (d < bestDist) { bestDist = d; target = i; }
    }

    // Geometrie-Index je Routenpunkt.
    const marks = routePoints.map((p) => {
      let best = 0;
      let dist = Infinity;
      for (let i = 0; i < routeCoords.length; i++) {
        const dLat = routeCoords[i][1] - p.lat;
        const dLng = (routeCoords[i][0] - p.lng) * cosLat;
        const d = dLat * dLat + dLng * dLng;
        if (d < dist) { dist = d; best = i; }
      }
      return best;
    });

    for (let k = 0; k < marks.length - 1; k++) {
      if (target >= marks[k] && target <= marks[k + 1]) return k + 1;
    }
    return routePoints.length;
  }

  /** Ziehen der Route: setzt an der gezogenen Stelle einen Zwischenpunkt. */
  function enableRouteDragging() {
    hitLine.on('mousedown', (event) => {
      // Nur linke Maustaste; rechte Taste bleibt fürs Kontextmenü.
      if (event.originalEvent && event.originalEvent.button !== 0) return;
      L.DomEvent.stop(event);

      const index = insertIndexFor(event.latlng);
      map.dragging.disable();

      const ghost = L.marker(event.latlng, {
        icon: L.divIcon({
          className: '',
          html: '<div class="drag-ghost"></div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        interactive: false,
        zIndexOffset: 900,
      }).addTo(map);

      const onMove = (e) => ghost.setLatLng(e.latlng);
      const onUp = (e) => {
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
        map.dragging.enable();
        map.removeLayer(ghost);
        suppressNextClick = true;
        cbs.onRouteDrag(e.latlng, index);
      };
      map.on('mousemove', onMove);
      map.on('mouseup', onUp);
    });
  }

  function renderRoute(coordinates, points) {
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (hitLine) { map.removeLayer(hitLine); hitLine = null; }
    routeCoords = coordinates;
    routePoints = points || [];
    if (!coordinates || coordinates.length < 2) return;

    const latlngs = coordinates.map((c) => [c[1], c[0]]);
    routeLine = L.polyline(latlngs, {
      color: '#c0392b',
      weight: 4,
      opacity: 0.85,
    }).addTo(map);

    // Breite, praktisch unsichtbare Linie: fängt Hover und Ziehen großzügig
    // ab. Bei opacity 0 wird der Pfad nicht gezeichnet und bekommt dann auch
    // keine Mausereignisse – deshalb ein winziger Wert statt echter Null.
    hitLine = L.polyline(latlngs, {
      weight: 20,
      opacity: 0.01,
      interactive: true,
      className: 'route-draggable',
    }).addTo(map);
    enableRouteDragging();

    hitLine.on('mousemove', (e) => {
      const i = nearestSampleIndex(e.latlng);
      if (i >= 0) {
        setHoverPoint(samples[i].lat, samples[i].lng);
        cbs.onRouteHover(i);
      }
    });
    hitLine.on('mouseout', () => {
      clearHoverPoint();
      cbs.onRouteHoverEnd();
    });
  }

  /** Hebt die befestigten bzw. Straßenabschnitte der Route hervor. */
  function renderPavedSections(sections) {
    pavedLines.forEach((l) => map.removeLayer(l));
    pavedLines = [];
    if (!sections) return;

    sections.forEach((section) => {
      const line = L.polyline(section.map((c) => [c[1], c[0]]), {
        color: '#2b2b2b',
        weight: 6,
        opacity: 0.55,
        dashArray: '2 7',
        interactive: false,
      }).addTo(map);
      pavedLines.push(line);
    });
  }

  /* ---------- Orte aus der Umgebungssuche ---------- */

  function renderPlaces(places) {
    placeMarkers.forEach((m) => map.removeLayer(m));
    placeMarkers = [];
    if (!places) return;

    places.forEach((place) => {
      const category = Overpass.CATEGORIES[place.category];
      const marker = L.marker([place.lat, place.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="place-marker" style="background:${category.color}">${category.icon}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
          popupAnchor: [0, -12],
        }),
      }).addTo(map);

      const details = [place.kind];
      if (place.opening) details.push(`Öffnungszeiten: ${place.opening}`);
      if (place.seasonal) details.push('saisonal');
      marker.bindPopup(
        `<strong>${Utils.escapeHtml(place.name)}</strong><br>` +
        `<span class="place-kind">${Utils.escapeHtml(details.join(' · '))}</span>`
      );
      marker.bindTooltip(place.name, { direction: 'top', offset: [0, -12] });
      placeMarkers.push(marker);
    });
  }

  function setSamples(newSamples) {
    samples = newSamples;
  }

  function nearestSampleIndex(latlng) {
    if (!samples || samples.length === 0) return -1;
    const cosLat = Math.cos((latlng.lat * Math.PI) / 180);
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const dLat = samples[i].lat - latlng.lat;
      const dLng = (samples[i].lng - latlng.lng) * cosLat;
      const d = dLat * dLat + dLng * dLng;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /* ---------- Hover-Marker (Kopplung Karte ↔ Höhenprofil) ---------- */

  function setHoverPoint(lat, lng) {
    if (!hoverMarker) {
      hoverMarker = L.circleMarker([lat, lng], {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#1d5fbf',
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
    } else {
      hoverMarker.setLatLng([lat, lng]);
    }
  }

  function clearHoverPoint() {
    if (hoverMarker) {
      map.removeLayer(hoverMarker);
      hoverMarker = null;
    }
  }

  function setView(lat, lng, zoom) {
    map.setView([lat, lng], zoom);
  }

  /** Nach Größenänderung des Kartenbereichs (z. B. Seitenleiste ein-/ausklappen). */
  function invalidateSize() {
    map.invalidateSize();
  }

  return {
    init,
    renderPoints,
    renderPois,
    renderRoute,
    renderPavedSections,
    renderPlaces,
    renderStamps,
    renderParking,
    renderTracks,
    setSamples,
    setHoverPoint,
    clearHoverPoint,
    openPoiPopup,
    openStampPopup,
    openParkingPopup,
    openStartQr,
    highlightStamps,
    showPosition,
    clearPosition,
    setNearbyPanel,
    fitTo,
    setView,
    invalidateSize,
  };
})();
