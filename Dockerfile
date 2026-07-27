# Wanderplaner – statisches Frontend plus schlanker Sync-Dienst, damit alle
# Geräte denselben Datenstand sehen.
#
# Kein Build-Schritt nötig (Vanilla JS im Frontend, der Server nutzt nur
# Node-Bordmittel ohne Abhängigkeiten). Alle Karten- und Routing-Aufrufe
# laufen weiterhin clientseitig im Browser – der Container selbst braucht
# keine ausgehenden Verbindungen.
FROM node:22-alpine

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
    DATA_DIR=/data

# Die Sammlung liegt im Volume, damit sie Updates des Containers übersteht.
VOLUME ["/data"]
EXPOSE 8080

# Als unprivilegierter Nutzer laufen; /data muss ihm gehören.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:8080/api/health || exit 1

CMD ["node", "server/server.js"]
