/**
 * The shell script that swaps GP.app after the running copy quits. It runs detached from the
 * app (the app can't replace itself while running):
 *
 *   1. wait for the old GP to exit
 *   2. move the installed GP.app aside as a backup, move the new one into its place
 *   3. launch it and wait for it to write `boot-ok` with its version (it does that once its
 *      windows have loaded and it has run for a few seconds)
 *   4. no boot-ok in time: kill it, put the backup back, launch the old one, write `rolled-back`
 *
 * Everything goes to <updates dir>/update.log.
 */
export const UPDATE_HELPER = `#!/bin/bash
# GP self-update helper. Args: <old pid> <installed GP.app> <new GP.app> <backup path> <updates dir> <version>
set -u
PID="$1"; APP="$2"; NEW="$3"; BACKUP="$4"; DIR="$5"; VERSION="$6"
HEALTH_WAIT="\${GP_UPDATE_HEALTH_WAIT:-90}"
exec >>"$DIR/update.log" 2>&1
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# Test runs pass their data folder and feed through to the new copy; normally none are set.
OPEN_ENV=()
for v in GP_HOME GP_UPDATE_FEED GP_UDP_PORT GP_UPDATE_HEALTH_WAIT GP_E2E_SKIP_HEALTH; do
  if [ -n "\${!v:-}" ]; then OPEN_ENV+=(--env "$v=\${!v}"); fi
done
# (macOS /bin/bash is 3.2: an empty array under set -u needs the +"..." form.)
launch() { open -n \${OPEN_ENV[@]+"\${OPEN_ENV[@]}"} "$1"; }

log "update to $VERSION: waiting for GP (pid $PID) to quit"
for _ in $(seq 120); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
if kill -0 "$PID" 2>/dev/null; then log "GP is still running after 60 s, update cancelled"; exit 1; fi

rm -rf "$BACKUP"
if ! mv "$APP" "$BACKUP"; then
  log "could not move $APP aside, update cancelled"
  launch "$APP"
  exit 1
fi
if ! mv "$NEW" "$APP"; then
  log "could not move the new GP into place, restoring the old one"
  rm -rf "$APP"
  mv "$BACKUP" "$APP"
  echo "$VERSION" > "$DIR/rolled-back"
  launch "$APP"
  exit 1
fi
xattr -cr "$APP"
rm -f "$DIR/boot-ok"
log "installed $VERSION, launching it"
launch "$APP"

for _ in $(seq "$HEALTH_WAIT"); do
  if [ "$(cat "$DIR/boot-ok" 2>/dev/null)" = "$VERSION" ]; then
    log "GP $VERSION is up; previous version kept at $BACKUP"
    exit 0
  fi
  sleep 1
done

log "GP $VERSION did not come up in $HEALTH_WAIT s: rolling back"
pkill -f "$APP/Contents/" 2>/dev/null
sleep 3
pkill -9 -f "$APP/Contents/" 2>/dev/null
rm -rf "$APP"
mv "$BACKUP" "$APP"
echo "$VERSION" > "$DIR/rolled-back"
log "restored the previous GP, launching it"
launch "$APP"
exit 1
`
