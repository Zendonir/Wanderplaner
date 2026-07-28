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
- **Farbige Route** – die geplante Strecke lässt sich umschalten zwischen
  *einfarbig*, *nach Steigung* und *nach Wegbedingungen*. Die Steigung wird
  stufenlos eingefärbt (grün eben, über gelb und orange bis rot bergauf,
  in Blautönen bergab); die Legende zeigt dazu einen Farbverlauf mit Skala
  und nennt die Spanne, die auf dieser Tour vorkommt. Die Wahl bleibt
  gespeichert.
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
  auf die Ziellänge ein. Die Stützpunkte liegen zunächst auf einem gedachten
  Kreis; landet einer davon auf einer Lichtung oder am Ende eines Forstwegs,
  entstünde ein Stichweg – die Strecke ginge hin und auf demselben Weg zurück.
  Solche Dornen erkennt die App an der Geometrie (Hin- und Rückweg liegen
  übereinander) und berechnet die Schleife ohne den störenden Punkt neu.
  Wie viele Stichwege entfernt wurden, steht in der Meldung.
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
  und umgekehrt. Linie und Fläche tragen dieselbe Farbgebung wie die Route,
  je nach gewählter Darstellung also nach Steigung oder nach Wegart.
- **GPX-Import mit Art-Auswahl** – beim Import wird gewählt, was die Datei
  enthält: Stempelstellen, Parkplätze, eine abgeschlossene Tour oder POIs.
  Mehrere Dateien auf einmal sind möglich.
- **Stempelstellen** – Wegpunkte (z. B. Harzer Wandernadel) werden dauerhaft
  im Browser gespeichert und können einzeln als „erhalten“ abgehakt werden –
  inklusive Zähler, Suche und Filter (Alle / Offen / Erhalten). Ein erneuter
  Import überspringt bereits vorhandene Einträge, die Markierungen bleiben
  erhalten.
- **Parkplätze mit QR-Code** – importierte Parkplätze bleiben dauerhaft
  gespeichert. Beschreibungen, die in Wahrheit ein Abzug der OSM-Merkmale sind
  (`amenity=parking surface=gravel …`), werden weder gespeichert noch
  angezeigt – im Popup steht der Name, eine echte Notiz wie „3 EUR/Tag“ bleibt
  erhalten. Ein Klick auf den Marker zeigt einen QR-Code: mit der
  Handy-Kamera gescannt öffnet sich die Karten-App am Parkplatz. Wählbar sind
  Apple Karten (iPhone), Google Maps oder ein `geo:`-Link, jeweils als
  „Ort anzeigen“ oder „Route dorthin“. Ein Parkplatz lässt sich mit einem
  Klick als Startpunkt der Route setzen. Die Marken sind bewusst klein –
  es sind meist viele – und verschwinden, sobald ein Startpunkt steht: Dann
  ist die Parkplatzfrage beantwortet. Ist die Route wieder leer, sind sie
  zurück.
- **Startpunkt-QR** – auch der Startpunkt der geplanten Route zeigt beim
  Anklicken denselben QR-Code, beschriftet mit dem Namen der Tour.
- **Geplante und abgeschlossene Touren** – zwei Listen, ein Ablauf: Die
  gespeicherte Planung landet unter *Geplante Touren*. Dort lässt sie sich
  laden und weiterbearbeiten, umbenennen, löschen – oder mit ✓ als
  abgeschlossen abhaken. Dann wandert sie samt tatsächlich berechnetem Verlauf
  in die Liste *Abgeschlossene Touren*. Auch importierte GPX-Spuren (`<trk>`)
  landen dort.
  Auf der Karte sind beide zu sehen und auseinanderzuhalten: geplante Touren
  gestrichelt in Blautönen, abgeschlossene durchgezogen in wärmeren Farben,
  jede mit dunkler Kontur, damit sie sich von der Wanderkarte abheben. Jede
  Tour ist einzeln ein- und ausblendbar. Mit ➜ wird eine abgeschlossene Spur
  zur neuen Planung: Sie wird auf höchstens 25 charakteristische Stützpunkte
  eingedampft und neu berechnet.
- **Touren benennen und speichern** – die aktuelle Planung lässt sich unter
  einem Namen sichern (inklusive POIs, Routing-Einstellungen und dem
  berechneten Verlauf) und später wieder laden.
- **Rundkurs** – auf Wunsch kehrt die Route zum Start zurück. Für den Rückweg
  werden entlang des Hinwegs Sperrbereiche gesetzt, damit ein anderer Weg
  gewählt wird statt derselben Strecke zurück. Findet sich kein eigenständiger
  Parallelweg, wird der Rückweg ohne Sperren berechnet und darauf hingewiesen.
- **Routenvorschlag** – Stempelstellen für die nächste Tour auswählen
  (⊕ in der Liste unter *Einstellungen → Daten* oder im Karten-Popup). Sobald
  etwas ausgewählt ist, erscheint rechts in der Planung der Abschnitt
  *Stempel-Tour* mit „Route vorschlagen“:
  die Reihenfolge wird automatisch optimiert (Nearest-Neighbor + 2-Opt) und
  die Route entlang echter Wege berechnet. Die ausgewählten Stempelstellen
  landen beim GPX-Export als Wegpunkte mit in der Datei.
- **Klick mit Rückfrage** – **Doppelklick oder Rechtsklick** auf die Karte
  öffnet ein Menü (Routenpunkt anhängen, als neuen Startpunkt einfügen, POI
  setzen, Parkplatz merken, hier weiterzeichnen). Ein einfacher Klick tut
  nichts – versehentliche Punkte gibt es damit nicht. Wer zügig eine Route
  zeichnen will, schaltet auf **✏ Zeichnen** um; dann setzt jeder Klick
  sofort. Rechtsklick öffnet das Menü in jedem Modus, Esc führt zurück.
- **Punkte bearbeiten** – ein Klick auf einen gesetzten Punkt öffnet sein Menü:
  löschen, zum Startpunkt machen oder die Route dort abschneiden. In der Liste
  lassen sich Punkte per Drag & Drop **oder** mit ▲▼ umsortieren – Letzteres
  auch am Handy, wo Ziehen nicht funktioniert.
- **Tastatur** – Esc schließt Dialog, Kartenmenü und Zeichenmodus (in dieser
  Reihenfolge), Strg+Z macht rückgängig.
- **Undo & Route leeren** – die letzte Aktion lässt sich rückgängig machen.
- **GPX-Export** – berechnete Wegstrecke als `<trk>` (inkl. Höhenwerten,
  falls verfügbar) und POIs als `<wpt>`, Download mit Zeitstempel im Namen.
- **Ortssuche** – Sprung zu einem Ort über Nominatim/OpenStreetMap.
- **Karte** – OpenTopoMap-Kacheln, ideal für Wanderungen. Die geplante Route
  wird kräftig und mit dunkler Kontur gezeichnet, damit sie sich von den
  farbigen Wegmarkierungen der Wanderkarte abhebt.

- **Fortschritt und Abzeichen** – Sammelstand mit Stufen (Bronze ab 11,
  Silber 24, Gold 50, Wanderkönig 111, Wanderkaiser 222), Balken bis zur
  nächsten Stufe und Jahresstatistik. Beim Abhaken wird das Datum
  festgehalten.
- **Tourenvorschläge aus Stempel-Nestern** – die App sucht Gruppen offener
  Stempelstellen, die zusammen eine Runde ergeben, schätzt die Länge und
  schlägt den nächstgelegenen Parkplatz als Start vor. Ein Klick übernimmt
  die Gruppe als Route.
- **Drei Reiter** – die rechte Leiste ist in *Planung*, *Analyse* und
  *Unterwegs* gegliedert; der zuletzt gewählte Reiter bleibt geöffnet.
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
- **Eigenes Layout am Handy** – auf schmalen Bildschirmen füllt die Karte das
  Bild, und die Planung liegt als Blende am unteren Rand: Zugeklappt zeigt sie
  Länge, Anstieg, Abstieg und Gehzeit, hochgezogen die vollständige Planung
  samt Höhenprofil. Ein Tipp auf die Karte klappt sie wieder zu. Die Kopfzeile
  schrumpft auf Symbole, das Suchfeld klappt bei Bedarf auf. Auf dem iPhone
  bleibt im Homescreen-Betrieb Platz für Statusleiste und Home-Indikator
  (`viewport-fit=cover` plus `safe-area-inset`), und alle Eingabefelder sind
  mindestens 16 px groß – darunter zoomt iOS beim Antippen ungefragt hinein.
- **Geräteübergreifender Abgleich** – die Sammlung liegt im Container und ist
  auf Laptop, Handy und Tablet gleich. Zusätzlich lässt sich alles als Datei
  sichern und wieder einlesen (siehe unten).
- **Einklappbare Tourenliste** – links stehen ausschließlich die Touren:
  geplante und abgeschlossene. Über ☰ oben links lässt sich die Leiste
  ausblenden, wenn die Karte mehr Platz braucht.
- **Einstellungsseite mit Reitern** – alles, was verwaltet statt geplant wird,
  liegt hinter ⚙ *Einstellungen* oben rechts, gegliedert in vier Reiter:
  *Daten* (GPX-Import, Parkplätze, Stempelstellen samt Suche, Filter und
  Tourauswahl), *Routing* (Gewichtung der Wegetypen), *Abgleich* (Abgleich,
  Sicherung, Doppelte zusammenführen, Alles zurücksetzen) und *Über* (Version,
  Update-Prüfung). Esc oder ein Klick daneben schließt sie wieder.

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

### Warum das Update-Fenster von TrueNAS „No options" zeigt

Der Knopf **Update** in der App-Übersicht gehört zu den Katalog-Apps: Er
bietet die nächste *Chart-Version* an. Eine **Custom App** hat keinen Katalog
und damit keine Versionen zur Auswahl – das Fenster bleibt deshalb leer und
lässt sich nicht abschicken. Das ist kein Fehler der App.

Für eine Custom App führen drei Wege zum Ziel:

1. **Feste Version in der YAML** (empfohlen, weil eindeutig): Statt `:latest`
   eine Nummer eintragen und beim Update hochsetzen. Weil sich das Image-Tag
   ändert, zieht TrueNAS beim Speichern zwangsläufig das neue Image.
2. **„⬆ Jetzt aktualisieren" in der App** – siehe unten, muss einmal
   freigeschaltet werden.
3. **Über die Shell:** `docker compose pull && docker compose up -d` im
   Verzeichnis der App, oder `docker pull ghcr.io/zendonir/wanderplaner:latest`
   und die App danach in der Oberfläche neu starten.

### Wenn TrueNAS „Failed 'up' action" meldet

Die Meldung kommt von `docker compose up` und sagt für sich genommen wenig.
Der eigentliche Grund steht im Log:

```bash
tail -n 40 /var/log/app_lifecycle.log
```

Die beiden häufigsten Ursachen:

- **Das Image-Tag gibt es (noch) nicht.** Ein Tippfehler in der Version oder
  eine Version, die gerade erst gebaut wird, führt zu `manifest unknown`.
  Welche Versionen es gibt, steht unter
  [Releases](https://github.com/Zendonir/Wanderplaner/releases); zur Not
  `:latest` eintragen.
- **Der Docker-Socket wird abgelehnt.** Je nach TrueNAS-Version sind
  Host-Pfade außerhalb der Pools nicht erlaubt, dann scheitert die Zeile
  `- /var/run/docker.sock:/var/run/docker.sock`. Sie ist nur für den
  Update-Knopf nötig – ohne sie läuft alles andere unverändert.

Im Zweifel erst die abgespeckte Fassung deployen (nur Image, Port, Volume)
und die Zusätze einzeln wieder hinzunehmen.

### Aktualisieren – warum ein Neustart nicht reicht

Ein Neustart startet **dasselbe Image** noch einmal. Damit eine neue Version
ankommt, muss das Image neu **gezogen** und der Container **neu erstellt**
werden:

```bash
docker compose pull && docker compose up -d
```

Auf TrueNAS SCALE:

- **Apps → Installed → Wanderplaner → Update** – erscheint, sobald zum
  eingetragenen Tag ein neues Image vorliegt. Bei `latest` sieht TrueNAS die
  Änderung nicht immer sofort; dann hilft **⋮ → Edit → Update** (speichern
  erstellt den Container neu) oder unter **Apps → Installed → ⋮ → Pull
  images**.
- Bei *Install via YAML* / Dockge / Portainer: erst **Pull**, dann
  **Re-deploy** bzw. **Recreate**.

Danach im Browser einmal neu laden.

**Alte Oberfläche trotz neuem Container?** Der Service Worker hält die
Programmdateien zwischengespeichert – das ist der Preis für den
Offline-Betrieb. In **Einstellungen → Über** steht deshalb neben der Version
des Containers auch der Stand der Oberfläche im Browser (`Oberfläche v14`).
Passen die nicht zusammen, hilft der Knopf **„⟳ Oberfläche neu laden"**: Er
verwirft den zwischengespeicherten Programmstand und lädt neu. Die
gespeicherten Kartenkacheln bleiben erhalten. Die App bringt einen Service Worker mit,
der die neue Fassung selbst übernimmt (`skipWaiting`); bleibt trotzdem die
alte Oberfläche stehen, hilft ein harter Reload (Strg+Umschalt+R) oder – auf
dem Homescreen-Symbol am Handy – die App einmal ganz schließen.

#### Aus der Oberfläche heraus („Jetzt aktualisieren")

In den **Einstellungen → Über** kann ein Knopf **„⬆ Jetzt aktualisieren"**
erscheinen, der genau das erledigt: neues Image ziehen, Container neu
erstellen, Seite neu laden. Er ist **standardmäßig aus**; solange er fehlt,
steht an seiner Stelle ein aufklappbarer Hinweis mit dem Grund und dieser
Anleitung. Freigeschaltet wird er, wenn beides zutrifft:

```yaml
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      ALLOW_SELF_UPDATE: "1"
      CONTAINER_NAME: wanderplaner   # nur nötig, wenn der Hostname abweicht
```

**Was das bedeutet:** Wer den Docker-Socket erreicht, kann auf dem Host
praktisch alles tun – Container starten, Dateisysteme einhängen, Rootrechte
erlangen. Der Wanderplaner ist eine Web-App; ist sie aus dem Netz erreichbar,
hängt diese Macht an ihrer Erreichbarkeit. Für ein Heimnetz hinter der
Firewall ist das vertretbar, für eine ins Internet veröffentlichte Instanz
nicht. Ohne diese beiden Zeilen bleibt der Knopf unsichtbar und der Endpunkt
antwortet abschlägig.

**Auf TrueNAS als *Custom App*:** unter **Storage** einen Host-Pfad
`/var/run/docker.sock` auf `/var/run/docker.sock` einhängen, unter
**Environment Variables** `ALLOW_SELF_UPDATE=1` und `CONTAINER_NAME` mit dem
Namen der App setzen, dann speichern. Danach steht der Knopf in den
Einstellungen. Zu beachten: Der Container wird dabei am App-Verwalter von
TrueNAS vorbei ersetzt – die Oberfläche zeigt danach unter Umständen weiter
die alte Version an, bis die App dort einmal bearbeitet und gespeichert wird.
Wer das nicht will, bleibt bei **Apps → Installed → Update**.

**„Docker nicht erreichbar: connect EACCES"?** Dann ist der Socket zwar
eingehängt, der Dienst darf ihn aber nicht lesen. Auf dem Host gehört er root
und einer Gruppe, deren Nummer von Rechner zu Rechner verschieden ist. Der
Container ordnet sich dieser Gruppe beim Start selbst zu – dafür muss er als
root starten dürfen. In der App-Konfiguration also **keine feste Nutzer-ID**
(`user:` in der YAML bzw. *Run As* in der TrueNAS-Oberfläche) vorgeben; der
Dienst selbst läuft ohnehin unprivilegiert weiter.

**Wie es abläuft:** Ein Container kann sich nicht selbst ersetzen – beim
Austausch stirbt genau der Prozess, der die Arbeit machen müsste. Der
Wanderplaner startet deshalb einen kurzlebigen Watchtower-Container
(`--run-once --cleanup`), der von außen zusieht: Image ziehen, Container neu
erstellen, sich selbst wegräumen. Die Oberfläche wartet solange und lädt neu,
sobald sich `/api/version` meldet.

**Automatisch aktualisieren** geht mit Watchtower, wenn das gewünscht ist:

```yaml
  watchtower:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --cleanup --interval 86400 wanderplaner
    restart: unless-stopped
```

Watchtower braucht Zugriff auf den Docker-Socket – das ist eine bewusste
Entscheidung, denn wer den Socket erreicht, hat faktisch Rootrechte auf dem
Host. Der Wanderplaner selbst bekommt diesen Zugriff absichtlich nicht.

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

## Welche Version läuft?

Unten links in der Sammlung steht die laufende Version, daneben ein Knopf
**„Auf Updates prüfen“** – der sieht bei GitHub nach, ob es eine neuere
Veröffentlichung gibt. Die Abfrage passiert nur auf Knopfdruck, die App
funkt nicht von sich aus nach außen.

Ohne die Oberfläche geht es auch:

```bash
# Über die App selbst
curl http://<truenas-ip>:8080/api/version

# Direkt am Image (zeigt die eingebaute Version)
docker inspect ghcr.io/zendonir/wanderplaner:latest \
  --format '{{index .Config.Labels "org.opencontainers.image.version"}}'
```

Im Log steht sie beim Start ebenfalls: `Wanderplaner 2.4.0 läuft auf Port 8080`.

**Aktualisieren:**

```bash
docker compose pull && docker compose up -d
```

Auf TrueNAS: bei der App **Update** wählen bzw. das Image neu ziehen und den
Container neu starten. Bei `latest` bekommst du dabei automatisch die neueste
Version; wer bei einer festen Version bleiben will, trägt sie als Tag ein
(z. B. `2.4.0`).

## Tests

Die App wird mit einer eigenen Testsammlung abgesichert: reine Rechenlogik
sowie Browsertests gegen den echten Sync-Dienst. Routing, Höhen,
Umgebungssuche und Wetter werden dabei durch feste Antworten ersetzt – so
sind die Läufe schnell, wiederholbar und belasten keine öffentlichen Dienste.

```bash
npm install                 # einmalig
npx playwright install chromium
npm test                    # alle Suiten
npm test -- logik           # nur passende Suiten
```

Der Testlauf umfasst über 100 Prüfungen, unter anderem:

- QR-Codes werden mit einem unabhängigen Decoder (jsQR) wieder ausgelesen
- Sonnenzeiten werden gegen die Bibliothek SunCalc gehalten
- ein auf einem Gerät gelöschter Eintrag darf beim Abgleich nicht zurückkehren
- die App startet ohne Netz, der Datenabgleich landet nie im Zwischenspeicher
- jedes eingebundene Skript steht auch in der Offline-Liste des Service Workers

Bei jedem Push laufen die Tests über GitHub Actions; ein Release wird nur
gebaut, wenn sie durchlaufen.

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
js/progress.js      – Sammelfortschritt, Stufen, Jahresstatistik
js/clusters.js      – Gruppen offener Stempelstellen für Tourenvorschläge
js/routestyle.js    – farbige Abschnitte der Route nach Steigung bzw. Wegart
tests/              – Testsuiten (siehe unten)
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
- Oben rechts zeigt ein Abzeichen den Zustand: **☁ synchron**,
  **⚠ Abgleich gestört** oder **⌂ nur dieses Gerät**.

Die Routing-Einstellungen und die aktuell offene Planung bleiben absichtlich
lokal – sie gehören zum Gerät, an dem gerade geplant wird.

**Ohne Server** (Datei direkt im Browser geöffnet) arbeitet die App
unverändert weiter, dann eben nur mit dem Speicher des jeweiligen Browsers.

### Abgleich repariert sich nicht

Zeigt das Abzeichen **⚠ Abgleich gestört**, antwortet der Server zwar, kann
seine Datei aber nicht schreiben. In aller Regel gehört das Verzeichnis unter
`/data` dem falschen Nutzer: Der Dienst läuft als `node` (UID 1000), das
Volume aber root.

Nachsehen:

```bash
curl http://<truenas-ip>:8080/api/health
# {"status":"readonly","storage":{"path":"/data","writable":false,"reason":"EACCES"}}

docker compose logs wanderplaner | grep -i speichern
```

Geradeziehen:

```bash
docker compose exec -u root wanderplaner chown -R node:node /data
# oder direkt am Host-Pfad:
chown -R 1000:1000 /mnt/tank/wanderplaner
```

Ab Version 2.7.1 erledigt das der Container beim Start selbst – er startet als
root, korrigiert die Rechte am Datenverzeichnis und gibt sie dann ab. Wer den
Container mit einer festen Nutzer-ID startet (`user:` in der YAML, bei TrueNAS
auch über die Oberfläche einstellbar), muss die Rechte am Host-Pfad passend
setzen; der Server sagt dann über `/api/health`, woran es liegt.

> Hintergrund für den Fall, dass es jemanden interessiert: Bis 2.7.0 stand das
> `chown` im Dockerfile **hinter** der `VOLUME`-Anweisung. Docker verwirft
> Änderungen an einem bereits deklarierten Volume beim Bauen – das Verzeichnis
> blieb dadurch root, und der Dienst konnte nie schreiben. Weil der Server den
> Schreibfehler nur ins Log geschrieben und trotzdem `200 OK` geantwortet hat,
> sah es in der App nach einem gelungenen Abgleich aus.

### Doppelte Einträge

Der Abgleich führt Einträge über ihre `id` zusammen. Wer dieselbe GPX-Datei
auf zwei Geräten importiert hat – etwa weil der Abgleich damals noch nicht
lief –, hat für jede Stelle zwei verschiedene `id`s. Beim ersten gemeinsamen
Abgleich taucht dann alles doppelt auf.

Die App räumt das beim Start und nach jedem Abgleich selbst auf: Einträge
werden zusammengefasst, wenn ihr Name übereinstimmt (Groß-/Kleinschreibung und
Zeichensetzung zählen nicht), wenn sie praktisch an derselben Stelle liegen
(unter 30 m) oder wenn ein Name im anderen steckt und die Stellen weniger als
250 m auseinanderliegen – letzteres für Fälle wie „HWN143 Köte Schindelkopf“
gegenüber „Köte Schindelkopf“. Dabei
gewinnt der informationsreichere Eintrag – ein abgehakter Stempel schlägt
einen offenen –, und Notiz wie Abhak-Datum des anderen ziehen mit um. Der
unterlegene Eintrag bleibt als Markierung erhalten, damit ihn das nächste
Gerät nicht zurückholt. Wie viele zusammengefasst wurden, steht kurz in der
Statuszeile. Von Hand anstoßen lässt es sich über **Einstellungen → Abgleich
und Sicherung → ⧉ Doppelte zusammenführen**; der Knopf meldet auch, wenn er
nichts gefunden hat, samt Zahl der geprüften Einträge.

### Alles zurücksetzen

In **Einstellungen → Abgleich und Sicherung** steht ganz unten **⟲ Alles
zurücksetzen**. Das löscht Stempelstellen, Parkplätze, geplante und
abgeschlossene Touren sowie sämtliche Einstellungen – und zwar über den
Abgleich auch auf allen anderen Geräten. Vorher wird automatisch eine
Sicherung heruntergeladen.

Gelöscht wird über dieselben Markierungen wie sonst auch; bloßes Leeren würde
ein anderes Gerät beim nächsten Abgleich wieder rückgängig machen.

### Sicherung

Über **Sichern** lädst du die gesamte Sammlung als JSON-Datei herunter,
über **Laden** spielst du sie wieder ein. Beim Einlesen wird zusammengeführt,
nicht ersetzt – vorhandene Einträge bleiben also erhalten. Das eignet sich
als Backup und um Daten auf ein Gerät außerhalb des Heimnetzes zu bringen.
