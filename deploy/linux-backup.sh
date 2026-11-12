#!/bin/bash
set -euo pipefail
umask 077
exec 9>/run/rehab-backup.lock
flock -n 9 || exit 0
destination=/var/backups/rehab
install -d -m 700 "$destination"
work=$(mktemp -d "$destination/.staging-XXXXXXXX")
running=0
cleanup() {
    if [ "$running" = 1 ]; then systemctl start rehab-web; fi
    case "$work" in /var/backups/rehab/.staging-*) rm -rf -- "$work" ;; esac
}
trap cleanup EXIT
if systemctl is-active --quiet rehab-web; then
    running=1
    systemctl stop rehab-web
fi
mariadb-dump --single-transaction --routines --events --triggers --hex-blob --databases rehab_discharge > "$work/database.sql"
cp -a /opt/rehab-app/server/storage "$work/storage"
cp -a /opt/rehab-app/server/.env "$work/app.env"
if [ "$running" = 1 ]; then systemctl start rehab-web; running=0; fi
target="$destination/rehab-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$target.partial" -C "$work" .
mv "$target.partial" "$target"
find "$destination" -maxdepth 1 -type f -name 'rehab-*.tar.gz' -mtime +30 -delete
printf 'Backup created: %s\n' "$target"
