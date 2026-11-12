"""Run as root on the server to restore the HTTPS domain entrance."""
from pathlib import Path
from datetime import datetime
import re
import shutil
import subprocess
import time

env = Path('/opt/rehab-app/server/.env')
proxy = Path('/etc/caddy/Caddyfile')
env_old, proxy_old = env.read_bytes(), proxy.read_bytes()
updated_env, n = re.subn(rb'^SHARE_BASE_URL=.*$', b'SHARE_BASE_URL=https://gzitwmkfk.cn', env_old, flags=re.M)
assert n == 1, 'Expected exactly one share URL setting'
updated_proxy, n = re.subn(
    rb'http://134\.175\.42\.162\s*\{\s*encode gzip\s*reverse_proxy 127\.0\.0\.1:3000\s*\}',
    b'http://134.175.42.162 {\n\tredir https://gzitwmkfk.cn{uri} 308\n}', proxy_old)
assert n == 1, 'Expected IP proxy configuration not found'
backup = Path('/root/rehab-domain-switch-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
backup.mkdir(mode=0o700)
shutil.copy2(env, backup / 'app.env')
shutil.copy2(proxy, backup / 'Caddyfile')

def run(*args):
    return subprocess.run(args, check=True, capture_output=True)

try:
    env.write_bytes(updated_env)
    proxy.write_bytes(updated_proxy)
    run('caddy', 'validate', '--config', str(proxy), '--adapter', 'caddyfile')
    run('systemctl', 'restart', 'rehab-web')
    for attempt in range(25):
        try:
            run('curl', '-fsS', '--max-time', '3', 'http://127.0.0.1:3000/api/health')
            break
        except subprocess.CalledProcessError:
            time.sleep(1)
    else:
        raise RuntimeError('Backend health check failed')
    run('systemctl', 'reload', 'caddy')
    run('curl', '-fsS', '--max-time', '10', '--resolve', 'gzitwmkfk.cn:443:127.0.0.1', 'https://gzitwmkfk.cn/api/health')
except Exception:
    env.write_bytes(env_old)
    proxy.write_bytes(proxy_old)
    run('systemctl', 'restart', 'rehab-web')
    run('systemctl', 'reload', 'caddy')
    raise
print('Domain restored; previous configuration saved at ' + str(backup))
