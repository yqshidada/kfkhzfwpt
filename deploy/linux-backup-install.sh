#!/bin/bash
set -euo pipefail
install -m 700 /home/ubuntu/rehab-migration/linux-backup.sh /usr/local/sbin/rehab-backup
cat > /etc/systemd/system/rehab-backup.service <<'EOF'
[Unit]
Description=Backup rehabilitation database and PDF files
After=mariadb.service
Requires=mariadb.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/rehab-backup
UMask=0077
EOF
cat > /etc/systemd/system/rehab-backup.timer <<'EOF'
[Unit]
Description=Daily rehab backup at 03:00 Shanghai time
[Timer]
OnCalendar=*-*-* 03:00:00 Asia/Shanghai
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now rehab-backup.timer
systemctl start rehab-backup.service
systemctl is-active rehab-web caddy mariadb
systemctl list-timers rehab-backup.timer --no-pager
