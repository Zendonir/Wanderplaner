# Wanderplaner – statisches Frontend plus schlanker Sync-Dienst, damit alle
# Geräte denselben Datenstand sehen.
#
# Kein Build-Schritt nötig (Vanilla JS im Frontend, der Server nutzt nur
# Node-Bordmittel ohne Abhängigkeiten). Alle Karten- und Routing-Aufrufe
# laufen weiterhin clientseitig im Browser – der Container selbst braucht
# keine ausgehenden Verbindungen.
FROM node:22-alpine

# Wird vom Release-Workflow gesetzt; beim lokalen Bauen bleibt "dev".
ARG APP_VERSION=dev

LABEL org.opencontainers.image.title="Wanderplaner" \
      org.opencontainers.image.description="Interaktive Planung von Wanderrouten" \
      org.opencontainers.image.source="https://github.com/Zendonir/Wanderplaner" \
      org.opencontainers.image.version="${APP_VERSION}"

WORKDIR /app

# Frontend
COPY index.html /app/public/
COPY css /app/public/css
COPY js /app/public/js
COPY vendor /app/public/vendor
COPY icons /app/public/icons
COPY manifest.webmanifest sw.js /app/public/

# Sync-Dienst
COPY server /app/server

ENV NODE_ENV=production \
    PORT=8080 \
    PUBLIC_DIR=/app/public \
    DATA_DIR=/data \
    APP_VERSION=${APP_VERSION}

# su-exec, um im Startskript die Rechte abzugeben.
RUN apk add --no-cache su-exec

# Rechte VOR der VOLUME-Anweisung setzen: Änderungen an einem bereits
# deklarierten Volume verwirft Docker beim Bauen.
RUN mkdir -p /data && chown -R node:node /data /app

# Die Sammlung liegt im Volume, damit sie Updates des Containers übersteht.
VOLUME ["/data"]
EXPOSE 8080

# Der Container startet als root, zieht die Rechte am Datenverzeichnis gerade
# und gibt sie dann ab. Nur so lässt sich auch ein schon vorhandenes, root
# gehörendes Volume noch retten.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:8080/api/health || exit 1

CMD ["node", "server/server.js"]
