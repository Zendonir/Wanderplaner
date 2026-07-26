# 🥾 Wanderplaner

Interaktive Web-App zur Planung von Wanderrouten – mit Routing entlang echter
Wege, Live-Höhenprofil, POIs und GPX-Export. Läuft komplett im Browser, ohne
Build-Schritt und ohne eigenes Backend.

## Funktionen

- **Interaktive Tourenplanung** – Klick auf die Karte setzt Routenpunkte,
  die Route wird automatisch entlang echter Wege berechnet (OSRM,
  Fußgänger-Profil). Punkte lassen sich auf der Karte verschieben, in der
  Seitenleiste per Drag & Drop umsortieren und per Rechtsklick bzw. ✕ löschen.
- **POIs** – eigener Modus zum Setzen von Markierungen mit Name und Notiz,
  verschiebbar und löschbar.
- **Live-Statistiken** – Streckenlänge (echte Wegstrecke, keine Luftlinie),
  Gesamtanstieg/-abstieg und geschätzte Gehzeit nach DIN 33466
  (4 km/h horizontal, 300 Hm/h bergauf, 500 Hm/h bergab).
- **Höhenprofil** – bis zu 100 Stützpunkte entlang der Route werden per
  Open-Elevation abgefragt (Fallback: Open-Topo-Data) und als Diagramm
  angezeigt. Hovern über das Profil markiert die Stelle auf der Karte –
  und umgekehrt.
- **Undo & Route leeren** – die letzte Aktion lässt sich rückgängig machen.
- **GPX-Export** – berechnete Wegstrecke als `<trk>` (inkl. Höhenwerten,
  falls verfügbar) und POIs als `<wpt>`, Download mit Zeitstempel im Namen.
- **Ortssuche** – Sprung zu einem Ort über Nominatim/OpenStreetMap.
- **Karte** – OpenTopoMap-Kacheln, ideal für Wanderungen.

Alle API-Aufrufe laufen clientseitig im Browser; die App braucht keinen
eigenen Server außer zum Ausliefern der statischen Dateien.

## Lokal starten

```bash
# Variante 1: Datei direkt im Browser öffnen
open index.html

# Variante 2: lokaler Webserver
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

## Installation auf TrueNAS SCALE

Zu jedem Release wird ein fertiges Docker-Image auf GHCR veröffentlicht
(amd64 und arm64) – es muss nichts selbst gebaut werden:

```
ghcr.io/zendonir/wanderplaner:latest
```

**Als Custom App:**

1. **Apps → Discover Apps → Custom App** (bzw. **⋮ → Install via YAML**)
2. Einstellungen:
   - **Image Repository:** `ghcr.io/zendonir/wanderplaner`
   - **Image Tag:** `latest` (oder eine feste Version wie `1.0.0`)
   - **Ports:** Container-Port `80` → Host-Port z. B. `8080`
3. App starten – danach ist der Wanderplaner unter
   `http://<truenas-ip>:8080` erreichbar.

**Als YAML (Install via YAML / Dockge / Portainer):**

```yaml
services:
  wanderplaner:
    image: ghcr.io/zendonir/wanderplaner:latest
    ports:
      - "8080:80"
    restart: unless-stopped
```

Die App speichert nichts auf dem Server – es sind keine Volumes oder
Datasets nötig. Updates: einfach das neue Image ziehen und den Container
neu starten.

## Mit Docker betreiben

Für den Dauerbetrieb (z. B. auf einem Heimserver/NAS):

```bash
docker compose up -d          # nutzt das fertige Image von GHCR
docker compose up -d --build  # oder: lokal aus dem Repo bauen
```

Die App ist dann unter `http://<host>:8080` erreichbar.

**Port anpassen:** `.env.example` als `.env` kopieren und den Port ändern:

```bash
cp .env.example .env
# in .env z. B. WANDERPLANER_PORT=9090 setzen
docker compose up -d
```

**Reverse Proxy:** Hinter einem Reverse Proxy (z. B. Nginx Proxy Manager)
genügt eine einfache HTTP-Weiterleitung auf den gemappten Port – es ist keine
spezielle Proxy-Konfiguration nötig, da die App rein statisch ausgeliefert
wird und alle API-Aufrufe direkt aus dem Browser erfolgen. Der Container
selbst braucht keine ausgehenden Verbindungen.

## Verwendete Dienste

| Dienst | Zweck |
| --- | --- |
| [OpenTopoMap](https://opentopomap.org) | Kartenkacheln |
| [OSRM Demo-Server](https://project-osrm.org) | Routing entlang echter Wege (Foot-Profil) |
| [Open-Elevation](https://open-elevation.com) | Höhendaten (primär) |
| [Open-Topo-Data](https://www.opentopodata.org) | Höhendaten (Fallback) |
| [Nominatim](https://nominatim.org) | Ortssuche |

Alle Dienste sind öffentliche Demo-Instanzen mit Fair-Use-Limits – für
intensive Nutzung ggf. eigene Instanzen betreiben.

## Projektstruktur

```
index.html          – Markup und Layout
css/style.css       – Gestaltung
js/utils.js         – Hilfsfunktionen (Debounce, Distanz, Formatierung, …)
js/routing.js       – OSRM-Anbindung
js/elevation.js     – Höhen-Stützpunkte, Open-Elevation + Fallback, Hm-Berechnung
js/gpx.js           – GPX-Erzeugung und Download
js/mapview.js       – gesamte Leaflet-/Kartenlogik
js/app.js           – Zustand, UI-Rendering, Orchestrierung
Dockerfile          – nginx:alpine mit den statischen Dateien
docker-compose.yml  – Betrieb inkl. Healthcheck und Restart-Policy
```

## Technik

- Vanilla JavaScript, HTML und CSS – kein Build-Schritt, keine npm-Abhängigkeiten
- [Leaflet](https://leafletjs.com/) für die Karte, [Chart.js](https://www.chartjs.org/) für das Höhenprofil (beide via CDN)
