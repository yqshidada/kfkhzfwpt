#!/bin/bash
# Dependency-aware release: preserves users, business data, documents, proxy and secrets.
set -euo pipefail
umask 027
stage=$(realpath "${1:?release staging directory required}")
case "$stage" in /home/ubuntu/rehab-release-*) ;; *) echo 'Unexpected staging path'; exit 1;; esac
app=/opt/rehab-app/server
exec 9>/run/rehab-release.lock
flock -n 9 || { echo 'Another release is running'; exit 1; }
modules=(index.js discharge-flow.js bed-reservations.js reservation-validation.js reservation-identity.js reservation-captcha.js report-images.js image-reader.js image-reader-client.js package.json package-lock.json)
for file in "${modules[@]}"; do
  test -s "$stage/server/$file"
  case "$file" in *.js) node --check "$stage/server/$file";; esac
done
test -s "$stage/server/public/index.html"
test -d "$stage/server/node_modules/svg-captcha"
test -d "$app/public"
test -d "$app/node_modules"
command -v pdfinfo >/dev/null
command -v pdftoppm >/dev/null
systemctl is-active --quiet rehab-web
systemctl is-active --quiet caddy
systemctl is-active --quiet mariadb
backup=/root/rehab-code-release-$(date +%Y%m%d-%H%M%S)-reservations
install -d -m 700 "$backup" "$backup/modules"
service_touched=0
timer_active=0
success=0
finish() {
  result=$?
  trap - EXIT
  set +e
  if [ "$success" != 1 ] && [ "$service_touched" = 1 ]; then
    echo 'Release did not complete; restoring previous application and dependency tree'
    systemctl stop rehab-web
    if [ -d "$backup/old-public" ]; then
      if [ -d "$app/public" ]; then mv "$app/public" "$backup/failed-public"; fi
      mv "$backup/old-public" "$app/public"
    fi
    if [ -d "$backup/old-node_modules" ]; then
      if [ -d "$app/node_modules" ]; then mv "$app/node_modules" "$backup/failed-node_modules"; fi
      mv "$backup/old-node_modules" "$app/node_modules"
    fi
    for file in "${modules[@]}"; do
      if [ -f "$backup/modules/$file" ]; then cp -a "$backup/modules/$file" "$app/$file"; fi
    done
    # Keep any new reservation key and additive schema, never discard new data.
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
systemctl stop rehab-web
service_touched=1
systemctl start rehab-backup.service
# Existing dependency tree is retained by rename below; daily backup covers storage/database.
tar --exclude=./node_modules --exclude=./storage -czf "$backup/application.tar.gz" -C "$app" .
chmod 600 "$backup/application.tar.gz"
for file in "${modules[@]}"; do
  if [ -f "$app/$file" ]; then cp -a "$app/$file" "$backup/modules/$file"; fi
done
node "$stage/deploy/release-support.cjs" ensure-key "$backup"
node "$stage/deploy/release-support.cjs" snapshot "$backup/preserved-data.json"
# Prepare ownership while service is stopped; only code/dependencies/public are replaced.
chown -R root:rehab "$stage/server/node_modules" "$stage/server/public"
chmod -R u=rwX,g=rX,o= "$stage/server/node_modules" "$stage/server/public"
for file in "${modules[@]}"; do install -m 640 -o root -g rehab "$stage/server/$file" "$app/$file"; done
mv "$app/node_modules" "$backup/old-node_modules"
mv "$stage/server/node_modules" "$app/node_modules"
mv "$app/public" "$backup/old-public"
mv "$stage/server/public" "$app/public"
# Validate access and SVG font loading from its final path as the real service account.
runuser -u rehab -- node -e 'const c=require("/opt/rehab-app/server/reservation-captcha").createReservationCaptcha();if(!c.issue("release-preflight").image)throw Error("SVG preflight failed");console.log("Final-path service-account dependency preflight passed")'
node "$stage/deploy/release-support.cjs" migrate
node "$stage/deploy/release-support.cjs" verify "$backup/preserved-data.json"
systemctl start rehab-web
healthy=0
for attempt in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
test "$healthy" = 1
node "$stage/deploy/verify-reservation-release.cjs"
systemctl is-active --quiet rehab-web
systemctl is-active --quiet caddy
systemctl is-active --quiet mariadb
success=1
printf 'RELEASE_COMPLETE backup=%s stage=%s\n' "$backup" "$stage"
