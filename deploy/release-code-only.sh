#!/bin/bash
# Code-only release. Never clears business data or changes access configuration.
set -euo pipefail
umask 027
stage=$(realpath "${1:?release staging directory required}")
case "$stage" in /home/ubuntu/rehab-release-*) ;; *) echo 'Unexpected staging path'; exit 1;; esac
app=/opt/rehab-app/server
test -s "$stage/server/public/index.html"
test -s "$stage/server/documents/admission-flow.pdf"
node --check "$stage/server/index.js"
node --check "$stage/server/discharge-flow.js"
for file in bed-reservations.js reservation-validation.js reservation-identity.js reservation-captcha.js report-images.js image-reader.js image-reader-client.js; do node --check "$stage/server/$file"; done
# Image reading requires Poppler; provision it and CJK fonts before releasing.
command -v pdfinfo >/dev/null
command -v pdftoppm >/dev/null
if ! cmp "$stage/server/package-lock.json" "$app/package-lock.json"; then
  echo "Dependencies changed (including svg-captcha). Code-only release stopped before service changes; prepare a dependency-aware release first."
  exit 1
fi
backup=/root/rehab-code-release-$(date +%Y%m%d-%H%M%S)
install -d -m 700 "$backup"
timer_active=0
if systemctl is-active --quiet rehab-backup.timer; then timer_active=1; systemctl stop rehab-backup.timer; fi
trap 'if [ "$timer_active" = 1 ]; then systemctl start rehab-backup.timer; fi' EXIT
systemctl stop rehab-web
systemctl start rehab-backup.service
tar --exclude=node_modules --exclude=storage -czf "$backup/application.tar.gz" -C "$app" .
chmod 600 "$backup/application.tar.gz"
node "$stage/deploy/verify-preserved-data.cjs" snapshot "$backup/preserved-data.json"
cp -a "$stage/server/public" "$backup/new-public"
cp -a "$stage/server/documents" "$backup/new-documents"
chown -R root:rehab "$backup/new-public" "$backup/new-documents"
chmod -R u=rwX,g=rX,o= "$backup/new-public" "$backup/new-documents"
for file in index.js discharge-flow.js bed-reservations.js reservation-validation.js reservation-identity.js reservation-captcha.js report-images.js image-reader.js image-reader-client.js package.json package-lock.json; do
  if [ -f "$app/$file" ]; then cp -a "$app/$file" "$backup/$file"; fi
  install -m 640 -o root -g rehab "$stage/server/$file" "$app/$file"
done
mv "$app/public" "$backup/old-public"
mv "$backup/new-public" "$app/public"
mv "$app/documents" "$backup/old-documents"
mv "$backup/new-documents" "$app/documents"
node "$stage/deploy/verify-preserved-data.cjs" verify "$backup/preserved-data.json"
systemctl start rehab-web
healthy=0
for attempt in $(seq 1 25); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
if [ "$healthy" != 1 ]; then
  systemctl stop rehab-web
  mv "$app/public" "$backup/failed-public"
  mv "$backup/old-public" "$app/public"
  mv "$app/documents" "$backup/failed-documents"
  mv "$backup/old-documents" "$app/documents"
  for file in index.js discharge-flow.js bed-reservations.js reservation-validation.js reservation-identity.js reservation-captcha.js report-images.js image-reader.js image-reader-client.js package.json package-lock.json; do
    if [ -f "$backup/$file" ]; then cp -a "$backup/$file" "$app/$file"; else rm -f "$app/$file"; fi
  done
  systemctl start rehab-web
  echo "Release failed; previous code restored. Backup: $backup"
  exit 1
fi
curl -fsS -H 'Host: 134.175.42.162' http://127.0.0.1/api/health
printf '\nCode-only release complete. Backup: %s\n' "$backup"
