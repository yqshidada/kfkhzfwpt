#!/bin/bash
# Explicit patient-data reset with backup; leaves users and site configuration unchanged.
set -euo pipefail
umask 077
stage=$(realpath "${1:?release staging directory required}")
test "${2:-}" = --clear-all
case "$stage" in /home/ubuntu/rehab-release-*) ;; *) echo 'Unexpected staging path'; exit 1;; esac
test -f "$stage/deploy/clear-patient-data.cjs"
backup=/root/rehab-patient-reset-$(date +%Y%m%d-%H%M%S)
install -d -m 700 "$backup"
timer_active=0
if systemctl is-active --quiet rehab-backup.timer; then timer_active=1; systemctl stop rehab-backup.timer; fi
restart_web=0
cleanup() {
  if [ "$restart_web" = 1 ]; then systemctl start rehab-web; fi
  if [ "$timer_active" = 1 ]; then systemctl start rehab-backup.timer; fi
}
trap cleanup EXIT
systemctl stop rehab-web
restart_web=1
systemctl start rehab-backup.service
node "$stage/deploy/verify-preserved-data.cjs" snapshot "$backup/before.json"
node "$stage/deploy/clear-patient-data.cjs" --clear-all | tee "$backup/cleanup-result.json"
systemctl start rehab-web
for attempt in $(seq 1 25); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:3000/api/health
node "$stage/deploy/verify-preserved-data.cjs" snapshot "$backup/after.json"
node - "$backup" <<'NODE'
const fs = require('fs')
const assert = require('assert/strict')
const root = process.argv[2]
const before = JSON.parse(fs.readFileSync(root + '/before.json'))
const after = JSON.parse(fs.readFileSync(root + '/after.json'))
assert.deepEqual(after.tables.system_users, before.tables.system_users)
assert.equal(after.env, before.env)
assert.equal(after.proxy, before.proxy)
for (const [name, value] of Object.entries(after.tables)) if (name !== 'system_users') assert.equal(value.count, 0)
assert.equal(Object.keys(after.files).length, 0)
console.log('PASS: all patient data and reports cleared; user rows, passwords and site configuration unchanged')
NODE
printf '\nCleanup audit: %s\n' "$backup"
