# 🥾 Wanderplaner

Interaktive Web-App zur Planung von Wanderrouten – mit Routing entlang echter
Wege, Live-Höhenprofil, POIs und GPX-Export. Läuft komplett im Browser, ohne
Build-Schritt und ohne eigenes Backend.

## Funktionen

- **Interaktive Tourenplanung** – Klick auf die Karte setzt Routenpunkte,
  die Route wird automatisch entlang echter Wanderwege berechnet (BRouter).
  Punkte lassen sich auf der Karte verschieben, in der Seitenleiste per
  Drag & Drop umsortieren und per Rechtsklick bzw. ✕ löschen.
- **Wander-Routing mit einstellbarer Gewichtung** – Pfade, Fußwege, Forstwege,
  Treppen und markierte Wanderwege werden bevorzugt, Straßen nur genutzt, wenn
  sie sinnvoll verbinden. Die Gewichtung ist über Voreinstellungen und neun
  Regler steuerbar (siehe unten).
- **POIs** – eigener Modus zum Setzen von Markierungen mit Name und Notiz,
  verschiebbar und löschbar.
- **Live-Statistiken** – Streckenlänge (echte Wegstrecke, keine Luftlinie),
  Gesamtanstieg/-abstieg und geschätzte Gehzeit nach DIN 33466
  (4 km/h horizontal, 300 Hm/h bergauf, 500 Hm/h bergab).
- **Höhenprofil** – bis zu 100 Stützpunkte entlang der Route werden per
  Open-Elevation abgefragt (Fallback: Open-Topo-Data) und als Diagramm
  angezeigt. Hovern über das Profil markiert die Stelle auf der Karte –
  und umgekehrt.
- **GPX-Import mit Art-Auswahl** – beim Import wird gewählt, was die Datei
  enthält: Stempelstellen, Parkplätze, eine abgeschlossene Tour oder POIs.
  Mehrere Dateien auf einmal sind möglich.
- **Stempelstellen** – Wegpunkte (z. B. Harzer Wandernadel) werden dauerhaft
  im Browser gespeichert und können einzeln als „erhalten“ abgehakt werden –
  inklusive Zähler, Suche und Filter (Alle / Offen / Erhalten). Ein erneuter
  Import überspringt bereits vorhandene Einträge, die Markierungen bleiben
  erhalten.
- **Parkplätze mit QR-Code** – importierte Parkplätze bleiben dauerhaft
  gespeichert. Ein Klick auf den Marker zeigt einen QR-Code: mit der
  Handy-Kamera gescannt öffnet sich die Karten-App am Parkplatz. Wählbar sind
  Apple Karten (iPhone), Google Maps oder ein `geo:`-Link, jeweils als
  „Ort anzeigen“ oder „Route dorthin“. Ein Parkplatz lässt sich mit einem
  Klick als Startpunkt der Route setzen.
- **Startpunkt-QR** – auch der Startpunkt der geplanten Route zeigt beim
  Anklicken denselben QR-Code, beschriftet mit dem Namen der Tour.
- **Abgeschlossene Touren hinterlegen** – GPX-Spuren (`<trk>`) werden dauerhaft
  auf der Karte hinterlegt, je Tour in eigener Farbe, einzeln ein- und
  ausblendbar, umbenennbar und löschbar. Die Geometrie wird beim Import
  ausgedünnt, damit auch viele Touren in den Browser-Speicher passen.
- **Touren benennen und speichern** – die aktuelle Planung lässt sich unter
  einem Namen sichern (inklusive POIs und Routing-Einstellungen), später
  wieder laden, umbenennen und löschen.
- **Rundkurs** – auf Wunsch kehrt die Route zum Start zurück. Für den Rückweg
  werden entlang des Hinwegs Sperrbereiche gesetzt, damit ein anderer Weg
  gewählt wird statt derselben Strecke zurück. Findet sich kein eigenständiger
  Parallelweg, wird der Rückweg ohne Sperren berechnet und darauf hingewiesen.
- **Routenvorschlag** – Stempelstellen für die nächste Tour auswählen
  (⊕ in der Liste oder im Karten-Popup) und „Route vorschlagen“ klicken:
  die Reihenfolge wird automatisch optimiert (Nearest-Neighbor + 2-Opt) und
  die Route entlang echter Wege berechnet. Die ausgewählten Stempelstellen
  landen beim GPX-Export als Wegpunkte mit in der Datei.
- **Undo & Route leeren** – die letzte Aktion lässt sich rückgängig machen.
- **GPX-Export** – berechnete Wegstrecke als `<trk>` (inkl. Höhenwerten,
  falls verfügbar) und POIs als `<wpt>`, Download mit Zeitstempel im Namen.
- **Ortssuche** – Sprung zu einem Ort über Nominatim/OpenStreetMap.
- **Karte** – OpenTopoMap-Kacheln, ideal für Wanderungen.

Alle API-Aufrufe laufen clientseitig im Browser; die App braucht keinen
eigenen Server außer zum Ausliefern der statischen Dateien.

## Wander-Routing und Gewichtung

Die Route wird über **BRouter** berechnet. Anders als bei OSRM lässt sich dort
ein eigenes Profil übergeben, sodass die Einstellungen der App tatsächlich die
Wegekosten verändern und nicht nur die Anzeige filtern.

**Kostenmodell:** Ein Weg mit Faktor 1,0 kostet genau seine Länge. Ein idealer
Weg (bevorzugte Wegart, markiert, guter Untergrund) liegt bei 1,0; alles andere
wird teurer. Gesperrte Wege bekommen sehr hohe Kosten statt eines harten
Verbots – sie bleiben als letzte Verbindung nutzbar, werden aber praktisch nie
gewählt.

Typische Faktoren mit der Voreinstellung „Wanderfreundlich“:

| Wegetyp | Faktor |
| --- | --- |
| markierter Pfad (`route=hiking`) | 1,0 |
| Pfad / Fußweg / Forstweg | 1,5 |
| Treppen, Fußgängerzone | 1,65 |
| Wohnstraße / Servicestraße | 3,3–3,7 |
| Landstraße (`tertiary`) | 5,8 |
| `secondary` / `primary` | 8,5 / 12,8 |
| `foot=no`, `access=no`, zu schwierig | 10 000 |
| Autobahn / Schnellstraße | 100 000 |

**Berücksichtigte OSM-Tags:** `highway`, `surface`, `tracktype`, `smoothness`,
`sac_scale`, `trail_visibility`, `incline`, `foot`, `access` sowie die
Wanderweg-Relationen `route=hiking` bzw. `route_hiking_iwn/nwn/rwn/lwn` und
`route_foot_*`. Zusätzlich fließen echte Höhenmeter über BRouters SRTM-Daten in
die Kosten ein, sobald „Steile Wege meiden“ aktiv ist.

**Voreinstellungen:** Wanderfreundlich (Standard), Markierte Wanderwege,
Schmale Pfade, Forst- und Feldwege, Leicht und sicher, Kürzeste Route.
Sobald ein Regler von Hand verändert wird, wechselt die Auswahl auf
„Eigene Einstellung“. Die Einstellungen bleiben im Browser gespeichert.

**Regler (jeweils aus / leicht / mittel / stark):** Straßen meiden,
Wanderwege bevorzugen, Markierte Wanderwege, Pfade bevorzugen, Forstwege
bevorzugen, Asphalt meiden, Schlechte Oberfläche meiden, Steile Wege meiden,
Schlecht sichtbare Pfade meiden. Dazu die maximale Schwierigkeit nach
`sac_scale` (T1–T6) und ein Schalter für Treppen.

**Falls BRouter ausfällt** weicht die App auf OSRM aus und weist deutlich
darauf hin: Dieser Dienst folgt überwiegend Straßen und ignoriert die
Gewichtung. Der Hinweis erscheint als Warnung und im Einstellungs-Panel.

Ein Hinweis zur Vollständigkeit: Das ebenfalls gewünschte Tag `width`
(Wegbreite) wertet BRouter nicht aus – es steht in seinem Tag-Katalog nicht zur
Verfügung und kann deshalb nicht in die Kosten einfließen. Die Wegbreite wird
indirekt über `highway=path` gegenüber `highway=track` und über `tracktype`
abgebildet.

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
| [BRouter](https://brouter.de) | Wander-Routing mit eigenem Profil (primär) |
| [OSRM Demo-Server](https://project-osrm.org) | Routing-Fallback (folgt Straßen) |
| [Open-Elevation](https://open-elevation.com) | Höhendaten, wenn der Router keine liefert |
| [Open-Topo-Data](https://www.opentopodata.org) | Höhendaten (Fallback) |
| [Nominatim](https://nominatim.org) | Ortssuche |

Alle Dienste sind öffentliche Demo-Instanzen mit Fair-Use-Limits – für
intensive Nutzung ggf. eigene Instanzen betreiben.

## Projektstruktur

```
index.html          – Markup und Layout
css/style.css       – Gestaltung
js/utils.js         – Hilfsfunktionen (Debounce, Distanz, Formatierung, …)
js/profiles.js      – Wanderprofil für BRouter, Voreinstellungen und Gewichtung
js/routing.js       – BRouter-Anbindung mit OSRM-Fallback
js/elevation.js     – Höhen-Stützpunkte, Open-Elevation + Fallback, Hm-Berechnung
js/gpx.js           – GPX-Erzeugung und Download
js/qrcode.js        – eigener QR-Encoder (Byte-Modus, Level M, Versionen 1–10)
js/maplinks.js      – Links für Apple Karten / Google Maps / geo:
js/places.js        – Stempelstellen und Parkplätze: GPX-Import, localStorage
js/tracks.js        – hinterlegte Touren: GPX-Spuren, Ausdünnung, Speicherung
js/tours.js         – benannte Planungen speichern und laden
js/mapview.js       – gesamte Leaflet-/Kartenlogik
js/app.js           – Zustand, UI-Rendering, Orchestrierung
Dockerfile          – nginx:alpine mit den statischen Dateien
docker-compose.yml  – Betrieb inkl. Healthcheck und Restart-Policy
```

## Technik

- Vanilla JavaScript, HTML und CSS – kein Build-Schritt, keine npm-Abhängigkeiten
- [Leaflet](https://leafletjs.com/) für die Karte, [Chart.js](https://www.chartjs.org/) für das Höhenprofil (beide via CDN)
- QR-Codes werden ohne Bibliothek erzeugt, damit sie auch offline funktionieren

## Wo die Daten liegen

Stempelstellen, Parkplätze, hinterlegte Touren, gespeicherte Planungen und die
Routing-Einstellungen liegen im `localStorage` des Browsers – also auf dem
Gerät, mit dem die App geöffnet wird, nicht auf dem Server. Ein anderer Browser
oder ein anderes Gerät sieht sie nicht, und wer die Browserdaten löscht,
verliert sie. Der Container selbst speichert nichts und braucht kein Volume.
