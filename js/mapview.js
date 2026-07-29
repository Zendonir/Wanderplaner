'use strict';

/**
 * Kapselt die gesamte Leaflet-Logik: Karte, Routenpunkte, POIs,
 * Routen-Polyline und der Hover-Marker für die Kopplung mit dem Höhenprofil.
 */
const MapView = (function () {
  // Breite der Routenlinie und ihrer Kontur. Die Wanderkarte bringt selbst
  // schon viele farbige Wegmarkierungen mit – die Route muss sich davon
  // deutlich abheben.
  const ROUTE_WEIGHT = 7;
  const ROUTE_CASING_WIDTH = 2.5;
  const ROUTE_CASING_COLOR = '#1c2318';

  // Hinterlegte Touren – geplante wie abgeschlossene. Etwas schmaler als die
  // aktive Route, aber kräftig genug, um auf der Karte zu bestehen.
  const TOUR_WEIGHT = 5;
  const TOUR_CASING_WIDTH = 2;

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
  let plannedLines = new Map();
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
  let routeLines = [];
  let legendControl = null;
  let menuPopup = null;
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

    // Rechtsklick öffnet das Menü unabhängig vom eingestellten Modus –
    // auch mitten im Zeichnen erreichbar.
    map.on('contextmenu', (e) => {
      L.DomEvent.preventDefault(e.originalEvent);
      cbs.onMapMenu(e.latlng);
    });

    // Doppelklick ebenso. Am Touchgerät ist das der einzige Weg zum Menü,
    // dort gibt es keine rechte Maustaste.
    map.on('dblclick', (e) => {
      if (!map.doubleClickZoom.enabled()) L.DomEvent.stop(e);
      cbs.onMapMenu(e.latlng);
    });

    // Große POI-Sammlungen werden nur für den sichtbaren Ausschnitt
    // gezeichnet – der ändert sich beim Schwenken und Zoomen.
    map.on('moveend zoomend', () => refreshPois());
  }

  /* ---------- Kontextmenü auf der Karte ---------- */

  /**
   * Zeigt ein Menü an der angeklickten Stelle. Erst die Auswahl löst etwas
   * aus – ein Klick allein verändert die Planung also nicht mehr.
   * @param {{lat:number, lng:number}} latlng
   * @param {Array<{label:string, hint:?string, action:Function}|null>} entries
   */
  function openMenu(latlng, entries) {
    closeMenu();

    const div = document.createElement('div');
    div.className = 'map-menu';

    const head = document.createElement('div');
    head.className = 'map-menu-head';
    head.textContent = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
    div.appendChild(head);

    entries.filter(Boolean).forEach((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-menu-item';

      const label = document.createElement('span');
      label.textContent = entry.label;
      button.appendChild(label);

      if (entry.hint) {
        const hint = document.createElement('small');
        hint.textContent = entry.hint;
        button.appendChild(hint);
      }

      button.addEventListener('click', () => {
        closeMenu();
        entry.action(latlng);
      });
      div.appendChild(button);
    });

    menuPopup = L.popup({
      closeButton: false,
      className: 'map-menu-popup',
      autoPan: true,
      // Nicht zu weit vom Klickpunkt weg, sonst verliert man den Bezug.
      offset: [0, -4],
    })
      .setLatLng(latlng)
      .setContent(div)
      .openOn(map);
  }

  function closeMenu() {
    if (menuPopup) {
      map.closePopup(menuPopup);
      menuPopup = null;
    }
  }

  function menuOpen() {
    return Boolean(menuPopup);
  }

  /** Doppelklick-Zoom beim Zeichnen abschalten – er setzt sonst Punkte. */
  function setDoubleClickZoom(enabled) {
    if (!map) return;
    if (enabled) map.doubleClickZoom.enable();
    else map.doubleClickZoom.disable();
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
          ? 'Startpunkt · klicken für QR-Code und weitere Optionen'
          : `Punkt ${i + 1} · ziehen zum Verschieben, klicken für Optionen`,
        { direction: 'top', offset: [0, -12] }
      );
      // Der Startpunkt zeigt beim Anklicken den QR-Code für die Anfahrt,
      // jeder andere Punkt sein Menü. Vorher ging Löschen nur per
      // Rechtsklick – auf dem Handy also gar nicht.
      if (isStart) {
        marker.bindPopup(
          () => qrPopupContent({ ...p, name: cbs.getStartName() }, 'start'),
          { maxWidth: 260 }
        );
      } else {
        marker.on('click', (e) => {
          L.DomEvent.stop(e);
          cbs.onPointMenu(p, i);
        });
      }
      marker.on('dragend', (e) => cbs.onPointMoved(p.id, e.target.getLatLng()));
      marker.on('contextmenu', (e) => {
        L.DomEvent.preventDefault(e.originalEvent);
        cbs.onPointDelete(p.id);
      });
      pointMarkers.push(marker);
    });
  }

  /* ---------- POIs ---------- */

  function poiIcon(poi) {
    const type = PoiTypes.typeOf(poi);
    return L.divIcon({
      className: '',
      html: `<div class="poi-marker" style="background:${type.color}" ` +
        `title="${type.label}"><span>${type.icon}</span></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -26],
    });
  }

  /**
   * Ein importierter POI wird gezeigt, nicht bearbeitet.
   *
   * Die Merkmale stammen aus der Quelle; sie in einem Textfeld anzubieten
   * lädt nur dazu ein, sie versehentlich zu zerschießen. Wer doch etwas
   * ändern will, kommt über „Bearbeiten“ an dasselbe Formular wie bei einem
   * selbst gesetzten POI.
   */
  function poiReadOnlyContent(poi, tags, marker) {
    const div = document.createElement('div');
    div.className = 'poi-popup poi-view';
    const type = PoiTypes.classify(tags);

    const head = document.createElement('div');
    head.className = 'poi-head';
    const badge = document.createElement('span');
    badge.className = 'poi-badge';
    badge.style.background = type.color;
    badge.textContent = type.icon;
    const titles = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = PoiTypes.displayName(poi);
    const kind = document.createElement('span');
    kind.className = 'poi-kind';
    kind.textContent = type.label;
    titles.append(title, kind);
    head.append(badge, titles);
    div.appendChild(head);

    const imageUrl = PoiTypes.imageUrl(tags);
    if (imageUrl) {
      const img = document.createElement('img');
      img.className = 'poi-image';
      img.loading = 'lazy';
      img.alt = PoiTypes.displayName(poi);
      img.src = imageUrl;
      // Bilder kommen von außerhalb; ohne Netz oder bei totem Verweis darf
      // kein kaputtes Kästchen stehen bleiben.
      img.addEventListener('error', () => img.remove());
      div.appendChild(img);
    }

    const description = PoiTypes.description(tags);
    if (description) {
      const p = document.createElement('p');
      p.className = 'poi-description';
      p.textContent = description;
      div.appendChild(p);
    }

    const facts = PoiTypes.facts(tags);
    if (facts.length > 0) {
      const list = document.createElement('dl');
      list.className = 'poi-facts';
      facts.forEach((fact) => {
        const dt = document.createElement('dt');
        dt.textContent = fact.label;
        const dd = document.createElement('dd');
        dd.textContent = fact.value;
        list.append(dt, dd);
      });
      div.appendChild(list);
    }

    const links = PoiTypes.links(tags, poi.link);
    if (links.length > 0) {
      const row = document.createElement('div');
      row.className = 'poi-links';
      links.forEach((link) => {
        const a = document.createElement('a');
        a.href = link.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = link.label;
        row.appendChild(a);
      });
      div.appendChild(row);
    }

    const rest = PoiTypes.rest(tags);
    if (rest.length > 0) {
      const details = document.createElement('details');
      details.className = 'poi-tags';
      const summary = document.createElement('summary');
      summary.textContent = `Alle Merkmale (${rest.length})`;
      details.appendChild(summary);
      const table = document.createElement('dl');
      rest.forEach((tag) => {
        const dt = document.createElement('dt');
        dt.textContent = tag.key;
        const dd = document.createElement('dd');
        dd.textContent = tag.value;
        table.append(dt, dd);
      });
      details.appendChild(table);
      div.appendChild(details);
    }

    const buttons = document.createElement('div');
    buttons.className = 'poi-popup-buttons';

    const editBtn = document.createElement('button');
    editBtn.textContent = '✎ Bearbeiten';
    // stopPropagation ist hier nicht kosmetisch: Der Inhaltstausch nimmt den
    // Knopf aus dem Baum. Steigt das Klickereignis danach weiter auf, findet
    // Leaflet über dem gelösten Knoten das Popup nicht mehr, hält den Klick
    // für einen Kartenklick – und schließt das Popup sofort wieder.
    editBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      marker.setPopupContent(poiEditContent(poi, marker));
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Löschen';
    deleteBtn.className = 'danger';
    deleteBtn.addEventListener('click', () => {
      map.closePopup();
      cbs.onPoiDelete(poi.id);
    });

    buttons.append(editBtn, deleteBtn);
    div.appendChild(buttons);
    return div;
  }

  function poiEditContent(poi, marker) {
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

  function poiPopupContent(poi, marker) {
    const tags = PoiTypes.tagsOf(poi);
    // Merkmale aus einem Import: zeigen. Selbst gesetzt: gleich bearbeiten.
    return Object.keys(tags).length > 0
      ? poiReadOnlyContent(poi, tags, marker)
      : poiEditContent(poi, marker);
  }

  /**
   * Zeichnet die POIs.
   *
   * Bestehende Marker werden weiterverwendet und nur nachgeführt, statt alles
   * abzuräumen und neu anzulegen. Der Grund ist handfest: Ein Abgleich mit dem
   * Server löst ein Neuzeichnen aus – und riss damit jedes gerade geöffnete
   * Popup weg, mitten im Lesen.
   */
  // Ab wie vielen POIs nur noch der Kartenausschnitt gezeichnet wird, und ab
  // welcher Zoomstufe überhaupt. Eine importierte Sammlung hat schnell einige
  // tausend Einträge; alle gleichzeitig als Marker zu halten macht schon das
  // Verschieben der Karte zäh (gemessen: acht Sekunden für einen Schwenk).
  const POI_VIEWPORT_LIMIT = 300;
  const POI_MIN_ZOOM = 11;
  const POI_MAX_VISIBLE = 400;

  let allPois = [];

  function renderPois(pois) {
    allPois = pois || [];
    refreshPois();
  }

  /**
   * Wählt aus, was gezeichnet wird: bei kleinen Sammlungen alles, bei großen
   * nur der sichtbare Ausschnitt – und erst ab einer Zoomstufe, auf der
   * einzelne Punkte überhaupt unterscheidbar sind.
   */
  function visiblePois() {
    if (allPois.length <= POI_VIEWPORT_LIMIT) return allPois;
    if (map.getZoom() < POI_MIN_ZOOM) return [];
    // Etwas über den Rand hinaus, damit beim Schwenken nichts nachploppt.
    const bounds = map.getBounds().pad(0.25);
    const inside = allPois.filter((p) => bounds.contains([p.lat, p.lng]));
    return inside.length > POI_MAX_VISIBLE ? inside.slice(0, POI_MAX_VISIBLE) : inside;
  }

  function refreshPois() {
    const shown = visiblePois();
    drawPois(shown);
    if (cbs.onPoiVisibility) {
      cbs.onPoiVisibility({
        total: allPois.length,
        shown: shown.length,
        zoomedOut: allPois.length > POI_VIEWPORT_LIMIT && map.getZoom() < POI_MIN_ZOOM,
      });
    }
  }

  function drawPois(pois) {
    const seen = new Set();

    pois.forEach((poi) => {
      seen.add(poi.id);
      // Importierte Stellen sitzen dort, wo die Quelle sie verortet hat –
      // ein versehentliches Verschieben wäre nur ein stiller Datenverlust.
      const draggable = Object.keys(PoiTypes.tagsOf(poi)).length === 0;
      const iconKey = PoiTypes.typeOf(poi).key;
      let marker = poiMarkers.get(poi.id);

      if (!marker) {
        marker = L.marker([poi.lat, poi.lng], { draggable, icon: poiIcon(poi) }).addTo(map);
        marker._wpIconKey = iconKey;
        marker.on('dragend', (e) => cbs.onPoiMoved(poi.id, e.target.getLatLng()));
        poiMarkers.set(poi.id, marker);
      } else {
        const at = marker.getLatLng();
        if (at.lat !== poi.lat || at.lng !== poi.lng) marker.setLatLng([poi.lat, poi.lng]);
        // Nur bei echtem Wechsel neu setzen – setIcon baut das Element neu auf.
        if (marker._wpIconKey !== iconKey) {
          marker.setIcon(poiIcon(poi));
          marker._wpIconKey = iconKey;
        }
        if (marker.dragging) {
          if (draggable) marker.dragging.enable();
          else marker.dragging.disable();
        }
      }

      // Der Popup-Inhalt hängt am jeweiligen Objekt; nach einer Änderung ist
      // das ein anderes. Neu binden aber nur, solange nichts offen steht –
      // sonst wechselte die Anzeige unter den Fingern.
      if (!marker.isPopupOpen()) {
        marker.unbindPopup();
        marker.bindPopup(() => poiPopupContent(poi, marker));
      }
    });

    [...poiMarkers.keys()].forEach((id) => {
      if (seen.has(id)) return;
      map.removeLayer(poiMarkers.get(id));
      poiMarkers.delete(id);
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

    const stampNote = PointStore.displayNote(stamp.note);
    if (stampNote) {
      const note = document.createElement('p');
      note.textContent = stampNote;
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

    // Bewusst kein Löschen an dieser Stelle: Das Popup öffnet sich beim
    // Planen ständig, und ein danebengegangener Klick würde eine
    // Stempelstelle samt Sammelstand entfernen. Gelöscht wird in der Liste.
    buttons.append(collectedBtn, tourBtn);
    div.appendChild(buttons);
    return div;
  }

  /** Auch hier: nachführen statt neu anlegen, damit Popups offen bleiben. */
  function renderStamps(stamps, selectedIds) {
    lastStamps = stamps;
    lastSelection = selectedIds;

    const selected = new Set(selectedIds);
    const seen = new Set();

    stamps.forEach((stamp) => {
      seen.add(stamp.id);
      const isSelected = selected.has(stamp.id);
      // Das Aussehen hängt an drei Dingen – ändert sich keines, bleibt die
      // Marke unangetastet.
      const look = `${isSelected}|${stamp.collected}|${highlighted.has(stamp.id)}`;
      let marker = stampMarkers.get(stamp.id);

      if (!marker) {
        marker = L.marker([stamp.lat, stamp.lng], {
          icon: stampIcon(stamp, isSelected),
        }).addTo(map);
        marker._wpLook = look;
        stampMarkers.set(stamp.id, marker);
      } else {
        const at = marker.getLatLng();
        if (at.lat !== stamp.lat || at.lng !== stamp.lng) {
          marker.setLatLng([stamp.lat, stamp.lng]);
        }
        if (marker._wpLook !== look) {
          marker.setIcon(stampIcon(stamp, isSelected));
          marker._wpLook = look;
        }
      }

      if (!marker.isPopupOpen()) {
        marker.unbindTooltip();
        marker.bindTooltip(stamp.name, { direction: 'top', offset: [0, -12] });
        marker.unbindPopup();
        marker.bindPopup(() => stampPopupContent(stamp, isSelected));
      }
    });

    [...stampMarkers.keys()].forEach((id) => {
      if (seen.has(id)) return;
      map.removeLayer(stampMarkers.get(id));
      stampMarkers.delete(id);
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
      iconSize: [17, 17],
      iconAnchor: [9, 9],
      popupAnchor: [0, -10],
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

    // Schon importierte Einträge tragen die Merkmalsliste noch im Text –
    // deshalb auch beim Anzeigen filtern, nicht nur beim Import.
    const placeNote = PointStore.displayNote(place.note);
    if (placeNote) {
      const note = document.createElement('p');
      note.textContent = placeNote;
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

  /**
   * Wie bei den POIs werden vorhandene Marken nachgeführt statt neu angelegt.
   * Jeder Abgleich mit dem Server löst ein Neuzeichnen aus; wurden dabei alle
   * Marken abgeräumt, verschwand ein gerade geöffnetes Popup – etwa der
   * QR-Code, den man gerade abfotografieren wollte.
   */
  function renderParking(places) {
    const seen = new Set();

    places.forEach((place) => {
      seen.add(place.id);
      let marker = parkingMarkers.get(place.id);
      if (!marker) {
        marker = L.marker([place.lat, place.lng], { icon: parkingIcon() }).addTo(map);
        parkingMarkers.set(place.id, marker);
      } else {
        const at = marker.getLatLng();
        if (at.lat !== place.lat || at.lng !== place.lng) {
          marker.setLatLng([place.lat, place.lng]);
        }
      }
      if (!marker.isPopupOpen()) {
        marker.unbindTooltip();
        marker.bindTooltip(place.name, { direction: 'top', offset: [0, -12] });
        marker.unbindPopup();
        marker.bindPopup(() => qrPopupContent(place, 'parking'), { maxWidth: 260 });
      }
    });

    [...parkingMarkers.keys()].forEach((id) => {
      if (seen.has(id)) return;
      map.removeLayer(parkingMarkers.get(id));
      parkingMarkers.delete(id);
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
      const group = tourLine(
        Tracks.toLatLngs(track),
        track.color,
        `${track.name} · ${Utils.formatDistance(track.length)}`,
        false
      );
      if (group) trackLines.set(track.id, group);
    });
  }

  /* ---------- Geplante Touren ---------- */

  function renderPlannedTours(tours) {
    plannedLines.forEach((l) => map.removeLayer(l));
    plannedLines = new Map();

    tours.forEach((tour) => {
      if (tour.visible === false) return;
      const latlngs = Tours.toLatLngs(tour);
      const label = tour.distance
        ? `${tour.name} · ${Utils.formatDistance(tour.distance)} (geplant)`
        : `${tour.name} (geplant)`;
      const group = tourLine(latlngs, tour.color || '#1d5fbf', label, true);
      if (group) plannedLines.set(tour.id, group);
    });
  }

  /**
   * Zeichnet eine hinterlegte Tour: dunkle Kontur, darauf die farbige Linie.
   * Ohne die Kontur gehen die Spuren in der bunten Wanderkarte unter.
   * @param {boolean} dashed geplante Touren gestrichelt, abgeschlossene voll
   */
  function tourLine(latlngs, color, label, dashed) {
    if (!latlngs || latlngs.length < 2) return null;
    const path = latlngs.map((p) => [p.lat, p.lng]);

    const group = L.layerGroup([
      L.polyline(path, {
        color: ROUTE_CASING_COLOR,
        weight: TOUR_WEIGHT + 2 * TOUR_CASING_WIDTH,
        opacity: 0.45,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }),
      L.polyline(path, {
        color,
        weight: TOUR_WEIGHT,
        opacity: 0.95,
        dashArray: dashed ? '12 7' : null,
        lineCap: dashed ? 'butt' : 'round',
        lineJoin: 'round',
        className: 'tour-line',
      }),
    ]).addTo(map);

    group.getLayers()[1].bindTooltip(label, { sticky: true });
    // Hinterlegte Touren sollen das Setzen von Punkten nicht blockieren.
    group.getLayers()[1].on('click', (e) => {
      L.DomEvent.stop(e);
      cbs.onMapClick(e.latlng);
    });
    return group;
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

  /**
   * Zeichnet die Route. `sections` sind farbige Teilstücke; ohne Angabe
   * wird die Strecke einfarbig dargestellt.
   */
  function renderRoute(coordinates, points, sections) {
    routeLines.forEach((l) => map.removeLayer(l));
    routeLines = [];
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (hitLine) { map.removeLayer(hitLine); hitLine = null; }
    routeCoords = coordinates;
    routePoints = points || [];
    if (!coordinates || coordinates.length < 2) return;

    const latlngs = coordinates.map((c) => [c[1], c[0]]);
    const parts = sections && sections.length > 0
      ? sections
      : [{ coordinates, color: '#c0392b' }];

    // Dunkle Kontur unter der ganzen Strecke. Die Wanderkarte ist selbst
    // voller bunter Wegmarkierungen; ohne diesen Rand geht die Route darin
    // unter, besonders bei hellen Farben wie Gelb oder Hellgrün.
    routeLines.push(L.polyline(latlngs, {
      color: ROUTE_CASING_COLOR,
      weight: ROUTE_WEIGHT + 2 * ROUTE_CASING_WIDTH,
      opacity: 0.55,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
      className: 'route-casing',
    }).addTo(map));

    parts.forEach((part) => {
      const line = L.polyline(part.coordinates.map((c) => [c[1], c[0]]), {
        color: part.color,
        weight: ROUTE_WEIGHT,
        // Deckend zeichnen: Halbdurchsichtig würde sich die Kartenfarbe
        // untermischen und die Steigungsfarben verfälschen.
        opacity: 1,
        // Abgerundete Enden lassen die Farbwechsel nahtlos wirken.
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
        className: 'route-line',
      }).addTo(map);
      routeLines.push(line);
    });

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

  /**
   * Farblegende in der Kartenecke – entweder als Liste von Farbfeldern
   * (Wegarten) oder als stufenloser Verlauf mit Skala (Steigung).
   */
  function renderLegend(entries, note, scale) {
    if (legendControl) {
      map.removeControl(legendControl);
      legendControl = null;
    }
    if ((!entries || entries.length === 0) && !note && !scale) return;

    const control = L.control({ position: 'bottomright' });
    control.onAdd = () => {
      const div = L.DomUtil.create('div', 'route-legend');
      L.DomEvent.disableClickPropagation(div);

      if (scale) {
        const title = document.createElement('div');
        title.className = 'legend-title';
        title.textContent = scale.title;
        div.appendChild(title);

        const bar = document.createElement('div');
        bar.className = 'legend-gradient';
        bar.style.background = 'linear-gradient(to right, ' +
          scale.stops.map((s) => `${s.color} ${(s.offset * 100).toFixed(0)}%`).join(', ') + ')';
        div.appendChild(bar);

        const axis = document.createElement('div');
        axis.className = 'legend-axis';
        [scale.min, 0, scale.max].forEach((value) => {
          const tick = document.createElement('span');
          tick.textContent = `${value > 0 ? '+' : ''}${value} %`;
          axis.appendChild(tick);
        });
        div.appendChild(axis);

        const range = document.createElement('div');
        range.className = 'legend-range';
        // Was auf dieser Tour tatsächlich vorkommt.
        range.textContent = `Diese Route: ${scale.actualMin.toFixed(1)} % ` +
          `bis ${scale.actualMax > 0 ? '+' : ''}${scale.actualMax.toFixed(1)} %`;
        div.appendChild(range);
      }

      (entries || []).forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'legend-row';
        const swatch = document.createElement('span');
        swatch.className = 'legend-swatch';
        swatch.style.background = entry.color;
        const label = document.createElement('span');
        label.textContent = entry.label;
        row.append(swatch, label);
        div.appendChild(row);
      });

      if (note) {
        const hint = document.createElement('p');
        hint.className = 'legend-note';
        hint.textContent = note;
        div.appendChild(hint);
      }
      return div;
    };
    control.addTo(map);
    legendControl = control;
  }

  /** Hebt die befestigten bzw. Straßenabschnitte der Route hervor. */
  function renderPavedSections(sections) {
    pavedLines.forEach((l) => map.removeLayer(l));
    pavedLines = [];
    if (!sections) return;

    sections.forEach((section) => {
      const line = L.polyline(section.map((c) => [c[1], c[0]]), {
        color: '#2b2b2b',
        // Muss die breitere Routenlinie überdecken, sonst verschwindet die
        // Schraffur darunter.
        weight: ROUTE_WEIGHT - 1,
        opacity: 0.75,
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
    renderLegend,
    openMenu,
    closeMenu,
    menuOpen,
    setDoubleClickZoom,
    renderPavedSections,
    renderPlaces,
    renderStamps,
    renderParking,
    renderTracks,
    renderPlannedTours,
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
