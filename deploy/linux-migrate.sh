#!/bin/bash
set -euo pipefail
umask 077
stage=/root/rehab-migration
archive=/home/ubuntu/rehab-migration/migration.tar.gz
expected=28cad8dbfad736e862b541e68309d97b854f7c30c6be1b16640feec4816a1b9d
test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$expected"
test ! -e /opt/rehab-app/server/index.js
test "$(mariadb -Nse "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='rehab_discharge'")" = 0
install -d -m 700 "$stage"
tar -xzf "$archive" -C "$stage"
timedatectl set-timezone Asia/Shanghai
cat > /etc/mysql/mariadb.conf.d/70-rehab.cnf <<'EOF'
[mysqld]
bind-address=127.0.0.1
max_connections=25
innodb_buffer_pool_size=128M
table_open_cache=128
tmp_table_size=8M
max_heap_table_size=8M
default_time_zone='+08:00'
EOF
systemctl restart mariadb
mariadb < "$stage/database.sql"
mariadb -N -B rehab_discharge -e "SELECT 'system_users', COUNT(*) FROM system_users UNION ALL SELECT 'discharge_records', COUNT(*) FROM discharge_records UNION ALL SELECT 'hospitalization_number_registry', COUNT(*) FROM hospitalization_number_registry UNION ALL SELECT 'discharge_record_shares', COUNT(*) FROM discharge_record_shares" > "$stage/imported-counts.tsv"
diff -u <(tr -d '\r' < "$stage/counts.tsv") "$stage/imported-counts.tsv"
id rehab >/dev/null 2>&1 || useradd --system --home-dir /opt/rehab-app --shell /usr/sbin/nologin rehab
install -d -m 755 /opt/rehab-app
cp -a "$stage/server" /opt/rehab-app/server
python3 - <<'PY'
from pathlib import Path
import secrets, subprocess
envpath=Path('/opt/rehab-app/server/.env')
lines=envpath.read_text(encoding='utf-8-sig').splitlines()
password=secrets.token_hex(32)
updates={'DB_HOST':'127.0.0.1','DB_PORT':'3306','DB_USER':'rehab_app','DB_PASSWORD':password,'DB_NAME':'rehab_discharge','HOST':'127.0.0.1','PORT':'3000','NODE_ENV':'production','SHARE_BASE_URL':'https://gzitwmkfk.cn','DB_POOL_SIZE':'5'}
result=[]
for line in lines:
    key=line.partition('=')[0].strip()
    if key in updates:
        continue
    result.append(line)
result.extend(f'{k}={v}' for k,v in updates.items())
envpath.write_text('\n'.join(result)+'\n',encoding='utf-8')
subprocess.run(['mariadb'],input=f"CREATE USER 'rehab_app'@'127.0.0.1' IDENTIFIED BY '{password}'; GRANT SELECT, INSERT, UPDATE, CREATE, ALTER, INDEX ON rehab_discharge.* TO 'rehab_app'@'127.0.0.1';",text=True,check=True)
PY
cd /opt/rehab-app/server
npm ci --omit=dev --no-audit --no-fund
node --check index.js
chown -R root:rehab /opt/rehab-app
chmod -R u=rwX,g=rX,o= /opt/rehab-app/server
chmod 750 /opt/rehab-app
chmod 640 /opt/rehab-app/server/.env
install -d -o rehab -g rehab -m 750 /opt/rehab-app/server/storage/reports
chown -R rehab:rehab /opt/rehab-app/server/storage
cat > /etc/systemd/system/rehab-web.service <<'EOF'
[Unit]
Description=Rehab discharge H5 and API
After=network.target mariadb.service
Requires=mariadb.service

[Service]
User=rehab
Group=rehab
WorkingDirectory=/opt/rehab-app/server
Environment=NODE_ENV=production
Environment=TZ=Asia/Shanghai
ExecStart=/usr/bin/node --max-old-space-size=192 /opt/rehab-app/server/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/rehab-app/server/storage
UMask=0027

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now rehab-web
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/health; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:3000/api/health
systemctl stop caddy
cp /etc/caddy/Caddyfile "$stage/Caddyfile.before"
install -d -o caddy -g caddy -m 700 /var/lib/caddy/rehab-data
cp -a "$stage/caddy-data/." /var/lib/caddy/rehab-data/
chown -R caddy:caddy /var/lib/caddy/rehab-data
find /var/lib/caddy/rehab-data -type d -exec chmod 700 {} +
find /var/lib/caddy/rehab-data -type f -exec chmod 600 {} +
cat > /etc/caddy/Caddyfile <<'EOF'
{
    admin 127.0.0.1:2019
    storage file_system {
        root /var/lib/caddy/rehab-data
    }
}
gzitwmkfk.cn {
    tls {
        issuer acme {
            dir https://acme-v02.api.letsencrypt.org/directory
            disable_tlsalpn_challenge
        }
    }
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
www.gzitwmkfk.cn {
    tls {
        issuer acme {
            dir https://acme-v02.api.letsencrypt.org/directory
            disable_tlsalpn_challenge
        }
    }
    redir https://gzitwmkfk.cn{uri} permanent
}
http://134.175.42.162 {
    redir https://gzitwmkfk.cn{uri} permanent
}
EOF
chmod 644 /etc/caddy/Caddyfile
install -d -m 755 /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/rehab.conf <<'EOF'
[Service]
Environment=GOMEMLIMIT=128MiB
Environment=GOMAXPROCS=2
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable caddy mariadb
systemctl start caddy
curl --retry 3 --retry-connrefused --retry-delay 1 -fsS --resolve gzitwmkfk.cn:443:127.0.0.1 https://gzitwmkfk.cn/api/health
install -d -m 700 /var/backups/rehab
echo 'Migration import and local TLS health checks passed'
systemctl is-active rehab-web caddy mariadb
