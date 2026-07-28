#!/bin/sh
# Richtet die Rechte ein und startet den Server anschließend unprivilegiert.
#
# Zwei Dinge sind zur Laufzeit zu erledigen, weil sie sich beim Bauen des
# Images nicht festlegen lassen:
#
#  1. Das Datenverzeichnis. Docker legt ein neues Volume mit den Rechten an,
#     die das Verzeichnis im Image hat; ein `chown` im Dockerfile hinter der
#     VOLUME-Anweisung verwirft Docker. Ein bereits vorhandenes Volume lässt
#     sich ohnehin nur hier geradeziehen.
#
#  2. Der Docker-Socket, falls er für "Jetzt aktualisieren" eingehängt wurde.
#     Er gehört auf dem Host root und einer Gruppe, deren Nummer von Rechner
#     zu Rechner verschieden ist. Ohne Mitgliedschaft in genau dieser Gruppe
#     scheitert der Dienst mit EACCES.
set -e

DATA_DIR="${DATA_DIR:-/data}"
DOCKER_SOCKET="${DOCKER_SOCKET:-/var/run/docker.sock}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR" || true

  if [ -S "$DOCKER_SOCKET" ]; then
    SOCKET_GID="$(stat -c %g "$DOCKER_SOCKET" 2>/dev/null || echo '')"
    if [ -n "$SOCKET_GID" ]; then
      # Gruppe mit dieser Nummer anlegen, falls es sie im Container nicht
      # gibt, und den Dienstnutzer aufnehmen.
      if ! getent group "$SOCKET_GID" >/dev/null 2>&1; then
        addgroup -g "$SOCKET_GID" dockersock 2>/dev/null || true
      fi
      SOCKET_GROUP="$(getent group "$SOCKET_GID" | cut -d: -f1)"
      if [ -n "$SOCKET_GROUP" ]; then
        addgroup node "$SOCKET_GROUP" 2>/dev/null || true
        echo "Docker-Socket gefunden – node der Gruppe $SOCKET_GROUP ($SOCKET_GID) zugeordnet"
      fi
    fi
  fi

  exec su-exec node "$@"
fi

# Läuft der Container bereits unter einer festen Nutzer-ID (etwa weil die
# Umgebung das erzwingt), bleibt es dabei. Ob dann geschrieben werden kann,
# meldet der Server selbst über /api/health.
exec "$@"
