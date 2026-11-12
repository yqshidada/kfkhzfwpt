#!/bin/bash
# Correct the reservation doctor name. Preserve all existing records without schema changes.
set -euo pipefail
umask 027
stage=$(realpath "${1:?release staging directory required}")
case "$stage" in /home/ubuntu/rehab-release-*-doctor-name-*) ;; *) echo 'Unexpected staging path'; exit 1;; esac
app=/opt/rehab-app/server
exec 9>/run/rehab-release.lock
flock -n 9 || { echo 'Another release is running'; exit 1; }
cd "$stage"
sha256sum -c SHA256SUMS >/dev/null
modules=(reservation-validation.js)
for file in "${modules[@]}"; do node --check "server/$file"; done
for file in release-support.cjs verify-reservation-release.cjs verify-followup-names.cjs verify-platform-name.cjs verify-login-title.cjs verify-reservation-doctor-tubes.cjs verify-admission-notice.cjs verify-patient-report-title.cjs verify-doctor-name.cjs; do node --check "deploy/$file"; done
test -s server/public/index.html
# Only the shared reservation doctor options change. Require an exact baseline for everything else.
for file in bed-reservations.js index.js discharge-flow.js reservation-identity.js reservation-captcha.js report-images.js image-reader.js image-reader-client.js package.json package-lock.json; do
  cmp "server/$file" "$app/$file" >/dev/null || { echo "Unexpected upstream change in $file; release stopped"; exit 1; }
done
# Refuse to replace a baseline changed since the preflight inspection.
printf '%s\n' 'f1c9a3d2eb87878477cc213bd2011efa9da50803983ac3e022352516225f95cf  /opt/rehab-app/server/reservation-validation.js' | sha256sum -c - >/dev/null
systemctl is-active --quiet rehab-web
systemctl is-active --quiet caddy
systemctl is-active --quiet mariadb
backup=/root/rehab-code-release-$(date +%Y%m%d-%H%M%S)-doctor-name
install -d -m 700 "$backup" "$backup/modules"
timer_active=0
service_touched=0
success=0
finish() {
  result=$?
  trap - EXIT
  set +e
  if [ "$success" != 1 ] && [ "$service_touched" = 1 ]; then
    echo 'Release did not complete; restoring previous code and H5'
    systemctl stop rehab-web
    if [ -d "$backup/old-public" ]; then
      if [ -d "$app/public" ]; then mv "$app/public" "$backup/failed-public"; fi
      mv "$backup/old-public" "$app/public"
    fi
    for file in "${modules[@]}"; do
      if [ -f "$backup/modules/$file" ]; then cp -a "$backup/modules/$file" "$app/$file"; fi
    done
    # Keep all business data; never restore an old database over new writes.
    systemctl start rehab-web
    curl -fsS http://127.0.0.1:3000/api/health || true
    echo "Previous code restored; backup: $backup"
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
# Copy originals before touching the service; every later failure has a recovery path.
for file in "${modules[@]}"; do cp -a "$app/$file" "$backup/modules/$file"; done
service_touched=1
systemctl stop rehab-web
systemctl start rehab-backup.service
systemctl is-active --quiet rehab-web && { echo 'Backup unexpectedly restarted application; aborting'; exit 1; }
tar --exclude=./node_modules --exclude=./storage -czf "$backup/application.tar.gz" -C "$app" .
chmod 600 "$backup/application.tar.gz"
node deploy/release-support.cjs snapshot "$backup/preserved-data.json"
chown -R root:rehab server/public
chmod -R u=rwX,g=rX,o= server/public
for file in "${modules[@]}"; do install -m 640 -o root -g rehab "server/$file" "$app/$file"; done
mv "$app/public" "$backup/old-public"
mv server/public "$app/public"
node deploy/release-support.cjs verify "$backup/preserved-data.json"
systemctl start rehab-web
healthy=0
for attempt in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
test "$healthy" = 1
node deploy/verify-reservation-release.cjs
node deploy/verify-followup-names.cjs
node deploy/verify-platform-name.cjs
node deploy/verify-login-title.cjs
node deploy/verify-reservation-doctor-tubes.cjs
node deploy/verify-admission-notice.cjs
node deploy/verify-patient-report-title.cjs
node deploy/verify-doctor-name.cjs
systemctl is-active --quiet rehab-web
systemctl is-active --quiet caddy
systemctl is-active --quiet mariadb
success=1
printf 'RELEASE_COMPLETE backup=%s stage=%s\n' "$backup" "$stage"
