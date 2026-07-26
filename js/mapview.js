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
  let samples = null; // Höhen-Stützpunkte für die Hover-Zuordnung

  function init(callbacks) {
    cbs = callbacks;
    map = L.map('map').setView([51.163, 10.447], 6);

    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution:
        'Kartendaten: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM | ' +
        'Kartendarstellung: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    }).addTo(map);

    map.on('click', (e) => cbs.onMapClick(e.latlng));
  }

  /* ---------- Routenpunkte ---------- */

  function routeIcon(number) {
    return L.divIcon({
      className: '',
      html: `<div class="route-marker">${number}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
  }

  function renderPoints(points) {
    pointMarkers.forEach((m) => map.removeLayer(m));
    pointMarkers = [];

    points.forEach((p, i) => {
      const marker = L.marker([p.lat, p.lng], {
        draggable: true,
        icon: routeIcon(i + 1),
      }).addTo(map);
      marker.bindTooltip(`Punkt ${i + 1} · ziehen zum Verschieben, Rechtsklick löscht`, {
        direction: 'top',
        offset: [0, -12],
      });
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

  /* ---------- Route ---------- */

  function renderRoute(coordinates) {
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (hitLine) { map.removeLayer(hitLine); hitLine = null; }
    if (!coordinates || coordinates.length < 2) return;

    const latlngs = coordinates.map((c) => [c[1], c[0]]);
    routeLine = L.polyline(latlngs, {
      color: '#c0392b',
      weight: 4,
      opacity: 0.85,
    }).addTo(map);

    // Unsichtbare, breite Linie: fängt Hover-Events großzügig ab.
    hitLine = L.polyline(latlngs, { weight: 18, opacity: 0 }).addTo(map);
    // Klicks auf die Route sollen trotzdem Punkte setzen können.
    hitLine.on('click', (e) => {
      L.DomEvent.stop(e);
      cbs.onMapClick(e.latlng);
    });
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

  return {
    init,
    renderPoints,
    renderPois,
    renderRoute,
    setSamples,
    setHoverPoint,
    clearHoverPoint,
    openPoiPopup,
    setView,
  };
})();
