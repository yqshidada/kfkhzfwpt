#!/bin/bash
# Frontend-only release: corrected follow-up names; preserve all server code and business data.
set -euo pipefail
umask 027
stage=$(realpath "${1:?release staging directory required}")
case "$stage" in /home/ubuntu/rehab-release-*-followup-names-*) ;; *) echo 'Unexpected staging path'; exit 1;; esac
app=/opt/rehab-app/server
exec 9>/run/rehab-release.lock
flock -n 9 || { echo 'Another release is running'; exit 1; }
cd "$stage"
sha256sum -c SHA256SUMS >/dev/null
node --check server/reservation-captcha.js
node --check deploy/verify-followup-names.cjs
node --check deploy/release-support.cjs
node --check deploy/verify-reservation-release.cjs
test -s server/public/index.html
# This patch is deliberately restricted to H5 only. Abort on server-code drift.
for file in reservation-captcha.js index.js bed-reservations.js reservation-validation.js reservation-identity.js discharge-flow.js report-images.js image-reader.js image-reader-client.js package.json package-lock.json; do
  cmp "$stage/server/$file" "$app/$file" >/dev/null || { echo "Unexpected upstream change in $file; release stopped"; exit 1; }
done
systemctl is-active --quiet rehab-web
systemctl is-active --quiet caddy
systemctl is-active --quiet mariadb
backup=/root/rehab-code-release-$(date +%Y%m%d-%H%M%S)-followup-names
install -d -m 700 "$backup"
timer_active=0
service_touched=0
success=0
finish() {
  result=$?
  trap - EXIT
  set +e
  if [ "$success" != 1 ] && [ "$service_touched" = 1 ]; then
    echo 'Release did not complete; restoring previous H5'
    systemctl stop rehab-web
    if [ -d "$backup/old-public" ]; then
      if [ -d "$app/public" ]; then mv "$app/public" "$backup/failed-public"; fi
      mv "$backup/old-public" "$app/public"
    fi
    systemctl start rehab-web
    echo "Previous code restored; preserved all business data and encryption keys. Backup: $backup"
  fi
  if [ "$timer_active" = 1 ]; then systemctl start rehab-backup.timer; fi
  exit "$result"
}
trap finish EXIT
if systemctl is-active --quiet rehab-backup.timer; then timer_active=1; systemctl stop rehab-backup.timer; fi
for attempt in $(seq 1 60); do
  if ! systemctl is-active --quiet rehab-backup.service; then break; fi
  sleep 1
done
if systemctl is-active --quiet rehab-backup.service; then echo 'Backup already running; aborting release'; exit 1; fi
systemctl stop rehab-web
service_touched=1
systemctl start rehab-backup.service
# Backup includes old code/config/public; normal backup covers the database and storage.
tar --exclude=./node_modules --exclude=./storage -czf "$backup/application.tar.gz" -C "$app" .
chmod 600 "$backup/application.tar.gz"
node "$stage/deploy/release-support.cjs" snapshot "$backup/preserved-data.json"
chown -R root:rehab "$stage/server/public"
chmod -R u=rwX,g=rX,o= "$stage/server/public"
mv "$app/public" "$backup/old-public"
mv "$stage/server/public" "$app/public"
# Verify original data, account hashes, documents, keys and proxy before accepting traffic.
node "$stage/deploy/release-support.cjs" verify "$backup/preserved-data.json"
systemctl start rehab-web
healthy=0
for attempt in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
test "$healthy" = 1
node "$stage/deploy/verify-followup-names.cjs"
node "$stage/deploy/verify-reservation-release.cjs"
systemctl is-active --quiet rehab-web
systemctl is-active --quiet caddy
systemctl is-active --quiet mariadb
success=1
printf 'RELEASE_COMPLETE backup=%s stage=%s\n' "$backup" "$stage"
