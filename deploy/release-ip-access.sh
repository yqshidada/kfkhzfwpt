#!/bin/bash
set -euo pipefail
umask 027
stage=$(realpath "${1:?release staging directory required}")
case "$stage" in /home/ubuntu/rehab-release-*) ;; *) echo 'Unexpected staging path'; exit 1;; esac
app=/opt/rehab-app/server
test -s "$stage/server/index.js"
test -s "$stage/server/public/index.html"
test -s "$stage/server/documents/admission-flow.pdf"
node --check "$stage/server/index.js"
node --check "$stage/server/discharge-flow.js"
cmp "$stage/server/package-lock.json" "$app/package-lock.json"
backup=/root/rehab-release-$(date +%Y%m%d-%H%M%S)
install -d -m 700 "$backup"
systemctl stop rehab-backup.timer
trap 'systemctl start rehab-backup.timer' EXIT
systemctl stop rehab-web
systemctl start rehab-backup.service
tar --exclude=node_modules --exclude=storage -czf "$backup/application.tar.gz" -C "$app" .
cp /etc/caddy/Caddyfile "$backup/Caddyfile"
chmod 600 "$backup/"*
printf 'Rollback application/config saved: %s\n' "$backup"
node "$stage/deploy/clear-patient-data.cjs" --clear-all
install -m 640 -o root -g rehab "$stage/server/index.js" "$stage/server/discharge-flow.js" "$stage/server/package.json" "$stage/server/package-lock.json" "$app/"
install -d -m 750 -o root -g rehab "$app/documents"
install -m 640 -o root -g rehab "$stage/server/documents/"* "$app/documents/"
mv "$app/public" "$backup/public"
cp -a "$stage/server/public" "$app/public"
chown -R root:rehab "$app/public"
chmod -R u=rwX,g=rX,o= "$app/public"
python3 - <<'PY'
from pathlib import Path
import re
env = Path('/opt/rehab-app/server/.env')
text = env.read_text()
line = 'SHARE_BASE_URL=http://134.175.42.162'
text = re.sub(r'^SHARE_BASE_URL=.*$', line, text, flags=re.M) if re.search(r'^SHARE_BASE_URL=', text, re.M) else text.rstrip() + '\n' + line + '\n'
env.write_text(text)
config = Path('/etc/caddy/Caddyfile')
text = config.read_text()
replacement = 'http://134.175.42.162 {\n\tencode gzip\n\treverse_proxy 127.0.0.1:3000\n}'
text, count = re.subn(r'http://134\.175\.42\.162\s*\{\s*redir https://gzitwmkfk\.cn\{uri\} permanent\s*\}', lambda _: replacement, text)
if count != 1:
    raise RuntimeError('Expected IP redirect not found; inspect Caddy configuration')
config.write_text(text)
PY
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl start rehab-web
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:3000/api/health
systemctl reload caddy
curl -fsS -H 'Host: 134.175.42.162' http://127.0.0.1/api/health
printf '\nRelease and IP access configuration applied.\n'
