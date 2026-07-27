#!/bin/sh
# Sorgt dafür, dass das Datenverzeichnis dem Dienstnutzer gehört, und startet
# den Server anschließend unprivilegiert.
#
# Warum überhaupt nötig: Docker legt ein neues Volume mit den Rechten an, die
# das Verzeichnis im Image hat. Ein `chown` im Dockerfile hilft nicht, wenn es
# nach der VOLUME-Anweisung steht – solche Änderungen verwirft Docker. Ein
# bereits angelegtes Volume lässt sich ohnehin nur zur Laufzeit geradeziehen.
set -e

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR" || true
  exec su-exec node "$@"
fi

# Läuft der Container bereits unter einer festen Nutzer-ID (etwa weil die
# Umgebung das erzwingt), bleibt es dabei. Ob dann geschrieben werden kann,
# meldet der Server selbst über /api/health.
exec "$@"
