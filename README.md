# 🥾 Wanderplaner

Interaktive Web-App zur Planung von Wanderrouten – mit Routing entlang echter
Wanderwege, Live-Höhenprofil, Stempelstellen, POIs und GPX-Export. Kein
Build-Schritt; im Container sorgt ein schlanker Dienst dafür, dass alle Geräte
denselben Datenstand sehen.

## Funktionen

- **Interaktive Tourenplanung** – Klick auf die Karte setzt Routenpunkte,
  die Route wird automatisch entlang echter Wanderwege berechnet (BRouter).
  Punkte lassen sich auf der Karte verschieben, in der Seitenleiste per
  Drag & Drop umsortieren und per Rechtsklick bzw. ✕ löschen.
- **Wander-Routing mit einstellbarer Gewichtung** – Pfade, Fußwege, Forstwege,
  Treppen und markierte Wanderwege werden bevorzugt, Straßen nur genutzt, wenn
  sie sinnvoll verbinden. Die Gewichtung ist über Voreinstellungen und neun
  Regler steuerbar (siehe unten).
- **Route per Ziehen bearbeiten** – die berechnete Linie an einer beliebigen
  Stelle greifen und ziehen: dort entsteht ein Zwischenpunkt an der richtigen
  Position in der Reihenfolge, die Route rechnet sofort neu.
- **Wegebeschaffenheit** – nach jeder Berechnung wird aufgeschlüsselt, woraus
  die Route besteht: Anteile von markierten Wanderwegen, Pfaden, Forstwegen
  und Straßen sowie die Oberflächen. Damit lässt sich prüfen, ob die
  eingestellte Gewichtung tatsächlich greift. Asphalt- und Straßenabschnitte
  lassen sich auf der Karte hervorheben.
- **Hinweise zur Strecke** – Abschnitte mit anspruchsvollem Gelände
  (`sac_scale`), kaum erkennbaren Pfaden (`trail_visibility`), Straßen ohne
  Gehweg oder Furten werden mit Länge aufgelistet und auf Klick angesteuert.
- **Varianten** – BRouter bietet zu vielen Strecken Alternativen an; sie
  werden mit Länge und Höhenmetern zur Auswahl gestellt.
- **Unterwegs** – Einkehr (auch Berghütten), Trinkwasser, Toiletten,
  Schutzhütten und Haltestellen entlang der Route, gefunden über
  OpenStreetMap und in Gehrichtung sortiert.
- **Rundtour vorschlagen** – Wunschlänge und Richtung angeben, und die App
  erzeugt eine Schleife ab dem Startpunkt und regelt sie in wenigen Schritten
  auf die Ziellänge ein.
- **Wetter** – Vorhersage für den Startpunkt zur geplanten Zeit
  (Open-Meteo), zusammengefasst auf das ungünstigste Wetter der Tour.
- **Route umkehren** – ein Knopf dreht die Richtung; bei Rundkursen
  entscheidet das, ob der steile Teil Auf- oder Abstieg wird.
- **Zeitmarken** – im Höhenprofil zeigt der Tooltip neben der Höhe auch die
  Gehzeit bis dorthin und die voraussichtliche Uhrzeit.
- **Kartenauswahl** – OpenTopoMap, Wanderreitkarte (mit Wegmarkierungen),
  OpenStreetMap und Luftbild; die Wahl wird gemerkt.
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

- **Stempelstellen an der Route** – sobald eine Route berechnet ist, listet
  die App alle Stempelstellen im wählbaren Umkreis (200 m bis 2 km) auf,
  sortiert in Gehrichtung und mit Abstand zum Weg. Sie lassen sich direkt
  dort abhaken und sind auf der Karte hervorgehoben.
- **Standort und Abhaken vor Ort** – der eigene Standort erscheint mit
  Genauigkeitskreis auf der Karte; Stempelstellen in Reichweite werden über
  der Karte eingeblendet und lassen sich mit einem Tipp als erhalten
  markieren. Gedacht für unterwegs am Handy.
- **Tageslicht-Warnung** – aus Startzeit, Gehzeit und Sonnenuntergang am
  Startpunkt wird berechnet, ob die Tour im Hellen zu schaffen ist. Die
  Berechnung läuft ohne Netz.
- **Offline nutzbar (PWA)** – die App lässt sich auf dem Homescreen
  installieren und startet ohne Netz. Programmdateien und bereits
  betrachtete Kartenkacheln bleiben gespeichert.
- **Geräteübergreifender Abgleich** – die Sammlung liegt im Container und ist
  auf Laptop, Handy und Tablet gleich. Zusätzlich lässt sich alles als Datei
  sichern und wieder einlesen (siehe unten).
- **Einklappbare Sammlung** – links liegen Import, Touren, Parkplätze und
  Stempelstellen, rechts die aktuelle Planung. Über ☰ oben links lässt sich
  die linke Leiste ausblenden, wenn die Karte mehr Platz braucht.

Alle Karten-, Routing- und Höhenabfragen laufen clientseitig im Browser – der
Container braucht dafür keine ausgehenden Verbindungen.

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
   - **Ports:** Container-Port `8080` → Host-Port z. B. `8080`
   - **Storage:** Host-Pfad oder Dataset auf `/data` einhängen
3. App starten – danach ist der Wanderplaner unter
   `http://<truenas-ip>:8080` erreichbar.

**Als YAML (Install via YAML / Dockge / Portainer):**

```yaml
services:
  wanderplaner:
    image: ghcr.io/zendonir/wanderplaner:latest
    ports:
      - "8080:8080"
    volumes:
      # Ohne dieses Volume gehen Stempelstellen und Touren beim Neustart verloren.
      - /mnt/tank/wanderplaner:/data
    restart: unless-stopped
```

**Wichtig:** Ab Version 2.0 braucht die App ein Volume für den
geräteübergreifenden Abgleich. Bei *Custom App* unter **Storage** einen
Host-Pfad oder ein Dataset auf **`/data`** einhängen – sonst gehen die
Daten beim Neustart des Containers verloren.

Updates: das neue Image ziehen und den Container neu starten.

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
| [Overpass](https://overpass-api.de) | Einkehr, Wasser, Haltestellen entlang der Route |
| [Open-Meteo](https://open-meteo.com) | Wettervorhersage |
| [Wanderreitkarte](https://www.wanderreitkarte.de) | Karte mit Wegmarkierungen |

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
js/sync.js          – Abgleich mit dem Server, Sicherung als Datei
js/daylight.js      – Sonnenauf-/untergang (NOAA), Tageslicht-Prüfung
js/nearby.js        – Punkte entlang einer Route bzw. um eine Position
js/geo.js           – eigener Standort über die Geolocation-Schnittstelle
js/waytypes.js      – Auswertung der Wegabschnitte, Warnungen, Asphaltstrecken
js/overpass.js      – Suche nach Einkehr, Wasser und Haltestellen (OpenStreetMap)
js/roundtrip.js     – Rundtour nach Wunschlänge erzeugen
js/weather.js       – Wettervorhersage über Open-Meteo
sw.js               – Service Worker für den Offline-Betrieb
manifest.webmanifest– Angaben zur Installation als App
vendor/             – Leaflet und Chart.js (lokal, damit offline nutzbar)
icons/              – App-Symbole
tools/make-icons.js – erzeugt die Symbole neu (nur bei Änderungen nötig)
server/server.js    – Sync-Dienst und Auslieferung der Dateien (ohne Abhängigkeiten)
js/mapview.js       – gesamte Leaflet-/Kartenlogik
js/app.js           – Zustand, UI-Rendering, Orchestrierung
Dockerfile          – nginx:alpine mit den statischen Dateien
docker-compose.yml  – Betrieb inkl. Healthcheck und Restart-Policy
```

## Technik

- Vanilla JavaScript, HTML und CSS – kein Build-Schritt, keine npm-Abhängigkeiten
- [Leaflet](https://leafletjs.com/) für die Karte, [Chart.js](https://www.chartjs.org/) für
  das Höhenprofil – beide liegen unter `vendor/` im Repository statt bei einem CDN,
  damit die App auch ohne Internetzugang startet
- QR-Codes und Sonnenzeiten werden ohne Bibliothek berechnet

## Unterwegs nutzen

**Als App installieren:** Die Seite im Browser öffnen und „Zum Home-Bildschirm“
(iPhone: Teilen-Menü) bzw. „App installieren“ (Android/Chrome) wählen. Danach
startet der Wanderplaner wie eine eigene App im Vollbild.

**Offline:** Programmdateien und bereits angezeigte Kartenkacheln bleiben
gespeichert – wer die Tourgegend vorher einmal auf der Karte betrachtet hat,
sieht sie später auch ohne Empfang. Neue Routen berechnen und Höhenprofile
abrufen geht offline naturgemäß nicht; die gespeicherten Stempelstellen lassen
sich aber abhaken, und der Abgleich holt das nach, sobald wieder Netz da ist.

**Standort:** Der Knopf „📍 Standort“ zeigt die eigene Position. Das setzt eine
verschlüsselte Verbindung voraus (HTTPS) – hinter einem Reverse Proxy mit
Zertifikat ist das gegeben, bei direktem Zugriff über `http://<ip>:8080`
verweigern die Browser den Zugriff. Die App sagt es, wenn das der Fall ist.

## Geräteübergreifender Abgleich

Läuft die App im Container, hält ein schlanker Dienst die Sammlung
(Stempelstellen, Parkplätze, hinterlegte und gespeicherte Touren) in einer
JSON-Datei im Volume `/data`. Alle Geräte, die dieselbe Adresse aufrufen,
sehen denselben Stand: Laptop, Handy und Tablet.

- Änderungen werden kurz nach jeder Aktion übertragen, zusätzlich alle
  30 Sekunden und beim Zurückwechseln auf den Tab.
- Zusammengeführt wird **eintragsweise**: hakst du unterwegs am Handy einen
  Stempel ab, während am Laptop eine Tour gespeichert wird, bleibt beides
  erhalten. Bei gleichzeitiger Änderung desselben Eintrags gewinnt die
  jüngere.
- Gelöschte Einträge bleiben als Markierung erhalten, damit sie nicht vom
  nächsten Gerät wieder eingespielt werden.
- Oben rechts zeigt ein Abzeichen den Zustand: **☁ synchron** oder
  **⌂ nur dieses Gerät**.

Die Routing-Einstellungen und die aktuell offene Planung bleiben absichtlich
lokal – sie gehören zum Gerät, an dem gerade geplant wird.

**Ohne Server** (Datei direkt im Browser geöffnet) arbeitet die App
unverändert weiter, dann eben nur mit dem Speicher des jeweiligen Browsers.

### Sicherung

Über **Sichern** lädst du die gesamte Sammlung als JSON-Datei herunter,
über **Laden** spielst du sie wieder ein. Beim Einlesen wird zusammengeführt,
nicht ersetzt – vorhandene Einträge bleiben also erhalten. Das eignet sich
als Backup und um Daten auf ein Gerät außerhalb des Heimnetzes zu bringen.
