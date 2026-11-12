$ErrorActionPreference = 'Stop'
$root = 'C:\rehab-app'
New-Item -ItemType Directory -Path $root,"$root\server","$root\service","$root\logs","$root\backups" -Force | Out-Null
$secrets = 'C:\rehab-deploy\secrets'
if (!(Test-Path "$secrets\app-config.json")) {
    $settings = @{
        databasePassword = [guid]::NewGuid().ToString('N')
        jwtSecret = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
        loginPhone = '13800138000'
        loginPassword = 'Kf' + [guid]::NewGuid().ToString('N').Substring(0,14) + '8'
    }
    [IO.File]::WriteAllText("$secrets\app-config.json", ($settings | ConvertTo-Json))
}
$settings = Get-Content "$secrets\app-config.json" -Raw | ConvertFrom-Json
$ini = 'C:\Program Files\MariaDB 11.4\data\my.ini'
if (!(Test-Path "$ini.pre-rehab")) { Copy-Item -LiteralPath $ini -Destination "$ini.pre-rehab" }
$iniText = Get-Content $ini -Raw
$iniText = $iniText -replace 'innodb_buffer_pool_size=\S+', 'innodb_buffer_pool_size=128M'
if ($iniText -notmatch 'bind-address=127.0.0.1') {
    $iniText = $iniText.Replace('[mysqld]', "[mysqld]`r`nbind-address=127.0.0.1`r`nmax_connections=25`r`ntable_open_cache=128`r`ntmp_table_size=8M`r`nmax_heap_table_size=8M")
}
[IO.File]::WriteAllText($ini, $iniText)
Restart-Service MariaDB
$env:MYSQL_PWD = (Get-Content "$secrets\mariadb-root.txt" -Raw).Trim()
$sql = "CREATE DATABASE IF NOT EXISTS rehab_discharge CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS 'rehab_app'@'127.0.0.1' IDENTIFIED BY '$($settings.databasePassword)'; GRANT SELECT, INSERT, UPDATE, CREATE ON rehab_discharge.* TO 'rehab_app'@'127.0.0.1';"
& 'C:\Program Files\MariaDB 11.4\bin\mariadb.exe' -u root -e $sql
if ($LASTEXITCODE -ne 0) { throw 'Database provisioning failed' }
$env:MYSQL_PWD = $null
$envText = @"
NODE_ENV=production
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=rehab_app
DB_PASSWORD=$($settings.databasePassword)
DB_NAME=rehab_discharge
DB_POOL_SIZE=5
PORT=80
TEST_LOGIN_PHONE=$($settings.loginPhone)
TEST_LOGIN_PASSWORD=$($settings.loginPassword)
JWT_SECRET=$($settings.jwtSecret)
TOKEN_EXPIRES_IN_SECONDS=43200
"@
[IO.File]::WriteAllText("$root\server\.env", $envText)
& icacls "$root\server\.env" /inheritance:r /grant:r '*S-1-5-32-544:(F)' '*S-1-5-18:(F)' '*S-1-5-19:(R)' | Out-Null
& icacls "$root\server" /grant '*S-1-5-19:(OI)(CI)(RX)' | Out-Null
& icacls "$root\logs" /grant '*S-1-5-19:(OI)(CI)(M)' | Out-Null
if (!(Get-NetFirewallRule -Name 'RehabWebHTTP' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'RehabWebHTTP' -DisplayName 'Rehab H5 HTTP' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80 | Out-Null
}
Get-NetTCPConnection -LocalPort 3306 -State Listen | Select-Object LocalAddress,LocalPort | ConvertTo-Json -Compress
Get-ScheduledTask -TaskName RehabMariaDbDownload -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
Write-Output 'Database and application environment configured'
