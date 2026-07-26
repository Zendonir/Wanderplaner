# Wanderplaner – statisches Frontend, ausgeliefert über nginx.
# Kein Build-Schritt nötig (Vanilla JS, Bibliotheken via CDN), daher genügt
# eine einzige schlanke Runtime-Stage. Alle API-Aufrufe (OSRM, Höhendaten,
# Kartenkacheln, Nominatim) laufen clientseitig im Browser – der Container
# selbst braucht keine ausgehenden Verbindungen.
FROM nginx:alpine

COPY index.html /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:80/ || exit 1
