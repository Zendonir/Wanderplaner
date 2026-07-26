'use strict';

/**
 * Erzeugt aus den Routing-Einstellungen ein BRouter-Profil.
 *
 * Anders als bei OSRM (dessen Profile serverseitige Lua-Skripte sind und sich
 * vom Browser aus nicht beeinflussen lassen) werden BRouter-Profile als Text
 * an den Router übergeben. Die Einstellungen wirken damit wirklich auf die
 * Routingkosten und nicht nur auf die Darstellung.
 *
 * Kostenmodell: Ein Weg mit costfactor 1.0 kostet genau seine Länge. Bevorzugte
 * Wege bleiben deshalb bei 1.0; "bevorzugen" bedeutet, dass alle *anderen* Wege
 * teurer werden. Gesperrte Wege bekommen sehr hohe Kosten statt eines harten
 * Verbots, damit sie als letzte Verbindung noch nutzbar bleiben.
 */
const Profiles = {
  /** Voreinstellungen; `custom` entsteht, sobald etwas von Hand geändert wird. */
  PRESETS: {
    wander: {
      label: 'Wanderfreundlich',
      description: 'Ausgewogen: Pfade und Wanderwege bevorzugt, Straßen gemieden',
      settings: {
        avoidRoads: 2, preferHiking: 2, preferMarked: 2, preferPaths: 2,
        preferTracks: 1, avoidPaved: 2, avoidSteep: 1, avoidBadVisibility: 2,
        avoidRoughSurface: 1, sacLimit: 2, allowSteps: true, shortest: false,
      },
    },
    markiert: {
      label: 'Markierte Wanderwege',
      description: 'Folgt so weit wie möglich ausgeschilderten Wanderwegen',
      settings: {
        avoidRoads: 2, preferHiking: 2, preferMarked: 3, preferPaths: 1,
        preferTracks: 1, avoidPaved: 1, avoidSteep: 1, avoidBadVisibility: 2,
        avoidRoughSurface: 1, sacLimit: 2, allowSteps: true, shortest: false,
      },
    },
    pfade: {
      label: 'Schmale Pfade',
      description: 'Bevorzugt schmale Pfade, nimmt dafür Umwege in Kauf',
      settings: {
        avoidRoads: 3, preferHiking: 2, preferMarked: 1, preferPaths: 3,
        preferTracks: 0, avoidPaved: 3, avoidSteep: 0, avoidBadVisibility: 1,
        avoidRoughSurface: 0, sacLimit: 3, allowSteps: true, shortest: false,
      },
    },
    forstwege: {
      label: 'Forst- und Feldwege',
      description: 'Breite, gut begehbare Wege – auch bei Nässe angenehm',
      settings: {
        avoidRoads: 2, preferHiking: 1, preferMarked: 1, preferPaths: 0,
        preferTracks: 3, avoidPaved: 2, avoidSteep: 1, avoidBadVisibility: 3,
        avoidRoughSurface: 2, sacLimit: 1, allowSteps: false, shortest: false,
      },
    },
    einfach: {
      label: 'Leicht und sicher',
      description: 'Meidet steile, schwierige und schlecht sichtbare Wege',
      settings: {
        avoidRoads: 1, preferHiking: 2, preferMarked: 2, preferPaths: 0,
        preferTracks: 2, avoidPaved: 0, avoidSteep: 3, avoidBadVisibility: 3,
        avoidRoughSurface: 3, sacLimit: 1, allowSteps: false, shortest: false,
      },
    },
    kurz: {
      label: 'Kürzeste Route',
      description: 'Kürzeste begehbare Verbindung, ohne Bewertung der Wegart',
      settings: {
        avoidRoads: 0, preferHiking: 0, preferMarked: 0, preferPaths: 0,
        preferTracks: 0, avoidPaved: 0, avoidSteep: 0, avoidBadVisibility: 0,
        avoidRoughSurface: 0, sacLimit: 3, allowSteps: true, shortest: true,
      },
    },
  },

  defaultSettings() {
    // roundTrip gehört zur Tour, nicht zur Wegegewichtung, wirkt also nicht
    // auf den Profiltext – steht aber der Einfachheit halber mit im Objekt.
    return { ...this.PRESETS.wander.settings, roundTrip: false };
  },

  /**
   * Baut den BRouter-Profiltext.
   * @param {object} s Einstellungen (siehe PRESETS)
   * @returns {string}
   */
  build(s) {
    const n = (v, min, max) => {
      const num = Number(v);
      if (!Number.isFinite(num)) return min;
      return Math.min(max, Math.max(min, num));
    };
    const avoidRoads = n(s.avoidRoads, 0, 3);
    const preferHiking = n(s.preferHiking, 0, 3);
    const preferMarked = n(s.preferMarked, 0, 3);
    const preferPaths = n(s.preferPaths, 0, 3);
    const preferTracks = n(s.preferTracks, 0, 3);
    const avoidPaved = n(s.avoidPaved, 0, 3);
    const avoidSteep = n(s.avoidSteep, 0, 3);
    const avoidBadVis = n(s.avoidBadVisibility, 0, 3);
    const avoidRough = n(s.avoidRoughSurface, 0, 3);
    const sacLimit = n(s.sacLimit, 1, 6);
    const allowSteps = s.allowSteps ? 'true' : 'false';
    const shortest = s.shortest ? 'true' : 'false';

    // Höhenkosten: Kosten je Höhenmeter zusätzlich zur Strecke.
    const uphillCost = (6 * avoidSteep).toFixed(1);
    const downhillCost = (3 * avoidSteep).toFixed(1);

    return `# Wanderplaner – automatisch erzeugtes Wanderprofil
# Die Werte stammen aus den Routing-Einstellungen der App.

---context:global

assign w_avoid_roads      ${avoidRoads}
assign w_prefer_hiking    ${preferHiking}
assign w_prefer_marked    ${preferMarked}
assign w_prefer_paths     ${preferPaths}
assign w_prefer_tracks    ${preferTracks}
assign w_avoid_paved      ${avoidPaved}
assign w_avoid_steep      ${avoidSteep}
assign w_avoid_badvis     ${avoidBadVis}
assign w_avoid_rough      ${avoidRough}
assign sac_limit          ${sacLimit}
assign allow_steps        ${allowSteps}
assign shortest_way       ${shortest}

assign turnInstructionMode 0
assign processUnusedTags   0

# Höhenmeter kosten extra, sobald "steile Wege vermeiden" aktiv ist.
assign uphillcost      ${uphillCost}
assign downhillcost    ${downhillCost}
assign uphillcutoff    1.5
assign downhillcutoff  1.5

# Pfad, Forstweg und "wandertauglich" sind Alternativen zueinander: ein Weg
# wird nach der am besten passenden Kategorie bewertet, nicht für jede
# nicht erfüllte Kategorie einzeln bestraft. type_max ist das Rabattniveau,
# das die beste Wegart erreicht – wer es erreicht, zahlt keinen Aufschlag.
assign type_max     max w_prefer_paths max w_prefer_tracks w_prefer_hiking

---context:way

# --- Wegkategorien -------------------------------------------------------

# Markierte Wanderwege: Relationen route=hiking / route=foot in allen Ebenen
# (international, national, regional, lokal).
assign any_hiking_route
  or route=hiking
  or route_hiking_iwn=yes   or route_hiking_nwn=yes
  or route_hiking_rwn=yes   or route_hiking_lwn=yes
  or route_hiking_=yes      or route_foot_=yes
  or route_foot_nwn=yes     or route_foot_rwn=yes
  route_foot_lwn=yes

# Schmaler Pfad / Fußweg
assign is_path      highway=path|footway|steps|bridleway

# Forst- und Feldweg
assign is_track     highway=track

# Alles, was als Wanderuntergrund taugt
assign is_hikeable  or is_path or is_track highway=pedestrian

assign is_paved
  or surface=asphalt      or surface=paved
  or surface=concrete     or surface=paving_stones
  or surface=sett         surface=cobblestone

# --- Zugang / Sperrungen -------------------------------------------------

assign defaultaccess
  switch access=
         1
         switch or access=private access=no 0 1

assign footaccess
  switch foot=
         defaultaccess
         not or foot=private or foot=no foot=use_sidepath

# Gesperrt heißt sehr teuer, nicht unmöglich: als einzige Verbindung
# darf ein gesperrter Weg noch genutzt werden.
assign access_penalty switch footaccess 0 10000

# --- Schwierigkeit (sac_scale) -------------------------------------------

assign sac_level
  if      sac_scale=hiking|T1-hiking             then 1
  else if sac_scale=mountain_hiking              then 2
  else if sac_scale=demanding_mountain_hiking    then 3
  else if sac_scale=alpine_hiking                then 4
  else if sac_scale=demanding_alpine_hiking      then 5
  else if sac_scale=difficult_alpine_hiking      then 6
  else 0

assign sac_penalty
  if greater sac_level sac_limit then 10000
  else if greater sac_level 1    then multiply 0.6 sub sac_level 1
  else 0

# --- Sichtbarkeit des Pfads ----------------------------------------------

# Hinweis: BRouter kennt nur die Hauptwerte aus lookups.dat, Aliase wie
# "poor" oder "very_bad" werden vorher auf "bad" bzw. "horrible" abgebildet.
assign visibility_penalty
  multiply w_avoid_badvis
  if      trail_visibility=excellent|good  then 0.0
  else if trail_visibility=intermediate    then 0.15
  else if trail_visibility=bad             then 0.5
  else if trail_visibility=horrible        then 1.0
  else if trail_visibility=no              then 1.6
  else 0.0

# --- Oberfläche ----------------------------------------------------------

# Asphalt/Pflaster kostet mehr, je stärker "befestigte Wege meiden" steht.
assign paved_penalty
  multiply w_avoid_paved
  if      surface=asphalt|concrete            then 0.25
  else if surface=paved|paving_stones         then 0.22
  else if surface=sett|cobblestone            then 0.30
  else 0.0

# Grobe oder aufweichende Oberflächen kosten mehr, je stärker
# "schlechte Wegoberfläche meiden" steht.
assign rough_penalty
  multiply w_avoid_rough
  if      surface=mud|sand                    then 0.6
  else if surface=rock|stone                  then 0.5
  else if surface=pebblestone                 then 0.25
  else if surface=grass|earth|dirt|ground     then 0.1
  else 0.0

assign smoothness_penalty
  if      smoothness=impassable                        then 10000
  else if smoothness=very_horrible                     then multiply w_avoid_rough 0.9
  else if smoothness=horrible                          then multiply w_avoid_rough 0.6
  else if smoothness=very_bad                          then multiply w_avoid_rough 0.4
  else if smoothness=bad|poor                          then multiply w_avoid_rough 0.2
  else if smoothness=intermediate|medium|rough         then multiply w_avoid_rough 0.1
  else 0.0

# Qualität von Forst- und Feldwegen: grade1 ist meist betoniert,
# grade2/3 sind die angenehmen Schotter- und Waldwege, grade5 verwächst.
assign tracktype_penalty
  if      tracktype=grade1 then add 0.10 multiply w_avoid_paved 0.15
  else if tracktype=grade2 then 0.0
  else if tracktype=grade3 then 0.05
  else if tracktype=grade4 then add 0.15 multiply w_avoid_rough 0.15
  else if tracktype=grade5 then add 0.35 multiply w_avoid_rough 0.35
  else 0.0

# --- Steigung ------------------------------------------------------------

# Zusätzlich zu uphillcost/downhillcost (die aus den Höhendaten kommen)
# wird ein ausgewiesen steiler Weg direkt bestraft.
assign incline_penalty
  multiply w_avoid_steep
  if      incline=steep                     then 1.0
  else if incline=30%|-30%                  then 1.2
  else if incline=25%|-25%                  then 0.8
  else if incline=20%|-20%                  then 0.5
  else if incline=15%|-15%                  then 0.25
  else 0.0

# --- Harte Ausschlüsse ---------------------------------------------------

# Wege, auf denen zu Fuß nichts verloren ist. Gilt in jedem Modus, also
# auch bei "kürzeste Route".
assign forbidden_penalty
  if      highway=              then 100000
  else if highway=motorway|motorway_link|trunk|trunk_link then 100000
  else if highway=steps         then switch allow_steps 0 10000
  else 0

# --- Grundkosten je Wegetyp ----------------------------------------------

# Pfade, Fußwege und Forstwege liegen bei 1.0 (= Kosten entsprechen der
# Länge). Straßen steigen mit ihrer Größe und mit "Straßen vermeiden".

assign base_cost
  if      highway=              then 1.0
  else if highway=motorway|motorway_link|trunk|trunk_link then 1.0
  else if highway=steps         then 1.15
  else if highway=path|footway  then 1.0
  else if highway=track         then 1.0
  else if highway=bridleway     then 1.1
  else if highway=pedestrian    then add 1.05 multiply w_avoid_roads 0.05
  else if highway=cycleway      then add 1.15 multiply w_avoid_roads 0.10
  else if highway=living_street then add 1.20 multiply w_avoid_roads 0.50
  else if highway=service       then add 1.30 multiply w_avoid_roads 0.60
  else if highway=residential   then add 1.30 multiply w_avoid_roads 0.80
  else if highway=unclassified  then add 1.35 multiply w_avoid_roads 1.00
  else if highway=road          then add 1.50 multiply w_avoid_roads 1.00
  else if highway=tertiary      then add 1.80 multiply w_avoid_roads 1.60
  else if highway=secondary     then add 2.50 multiply w_avoid_roads 2.60
  else if highway=primary       then add 4.00 multiply w_avoid_roads 4.00
  else if highway=construction|proposed then 20.0
  else 2.5

# --- Aufschläge für nicht bevorzugte Wegarten ----------------------------

# Rabattstufe, die dieser Weg erreicht (beste passende Kategorie).
assign type_score
  max switch is_path     w_prefer_paths  0
  max switch is_track    w_prefer_tracks 0
      switch is_hikeable w_prefer_hiking 0

assign type_malus multiply 0.15 max 0.0 sub type_max type_score

# Markierung ist unabhängig von der Wegart: auch ein Pfad kann unmarkiert sein.
assign marked_malus multiply 0.25 switch any_hiking_route 0 w_prefer_marked

# --- Gesamtkosten --------------------------------------------------------

assign rawcost
  add base_cost
  add tracktype_penalty
  add paved_penalty
  add rough_penalty
  add smoothness_penalty
  add sac_penalty
  add visibility_penalty
  incline_penalty

# Ein idealer Weg (bevorzugte Wegart, markiert, guter Untergrund) landet
# bei 1.0 und kostet damit genau seine Länge.
assign costfactor
  add forbidden_penalty
  add access_penalty
  if shortest_way then max 1.0 add 1.0 sac_penalty
  else
    max 1.0
    add rawcost
    add type_malus
    marked_malus

assign initialcost 0
assign turncost    0

---context:node

assign defaultaccess
  switch access=
         1
         switch or access=private access=no 0 1

assign footaccess
  switch foot=
         defaultaccess
         switch or foot=private foot=no 0 1

assign initialcost switch footaccess 0 10000
`;
  },
};
