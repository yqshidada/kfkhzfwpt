param(
    [string]$HBuilderXPath = $env:HBUILDERX_HOME,
    [switch]$BackendOnly
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$logs = Join-Path $root 'tmp'
New-Item -ItemType Directory -Path $logs -Force | Out-Null

function Test-LocalPort([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $Port); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}
function Test-Health([int]$Port) {
    try { return (Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2).ok -eq $true }
    catch { return $false }
}
function Wait-Health([int]$Port, [int]$Attempts, $Process) {
    for ($i = 0; $i -lt $Attempts; $i++) {
        if (Test-Health $Port) { return }
        if ($Process.HasExited) { throw "Service exited. Check logs in $logs" }
        Start-Sleep -Seconds 1
    }
    throw "Service on port $Port did not become ready. Check logs in $logs"
}
function Start-LocalProcess($Exe, $Arguments, $Directory, $Name) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $process = Start-Process -FilePath $Exe -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs "$Name-$stamp.stdout.log") -RedirectStandardError (Join-Path $logs "$Name-$stamp.stderr.log") -PassThru
    Write-Host "$Name started (PID $($process.Id))."
    return $process
}

if (-not $HBuilderXPath) {
    $hx = Get-Process HBuilderX -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hx -and $hx.Path) { $HBuilderXPath = Split-Path $hx.Path -Parent }
}
if (-not $HBuilderXPath -or -not (Test-Path (Join-Path $HBuilderXPath 'plugins/node/node.exe'))) {
    throw 'Open HBuilderX first, or pass -HBuilderXPath with its installation directory.'
}
$node = Join-Path $HBuilderXPath 'plugins/node/node.exe'
$cli = Join-Path $HBuilderXPath 'plugins/uniapp-cli'
if (-not $BackendOnly -and -not (Test-Path (Join-Path $cli 'bin/uniapp-cli.js'))) {
    throw 'Install the uni-app compiler in HBuilderX first.'
}
$settings = @{}
Get-Content (Join-Path $root 'server/.env') -Encoding UTF8 | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim() }
}
if ($settings.DB_HOST -ne '127.0.0.1' -or $settings.DB_PORT -ne '3306' -or $settings.PORT -ne '3000' -or $settings.HOST -ne '127.0.0.1') {
    throw 'This launcher requires local-only settings: DB_HOST/HOST=127.0.0.1, DB_PORT=3306, PORT=3000.'
}
if (-not (Test-LocalPort 3306)) {
    $databaseExe = Join-Path $root 'tmp/mariadb-local/MariaDB 11.4/bin/mysqld.exe'
    $databaseConfig = Join-Path $root 'tmp/mariadb-data/my.ini'
    if (-not (Test-Path $databaseExe) -or -not (Test-Path $databaseConfig)) {
        throw 'Local MariaDB runtime or data directory is missing. Restore them before starting; do not overwrite existing data.'
    }
    $db = Start-LocalProcess $databaseExe @("--defaults-file=`"$databaseConfig`"", '--bind-address=127.0.0.1', '--console') $root 'local-db'
    for ($i = 0; $i -lt 30 -and -not (Test-LocalPort 3306); $i++) {
        if ($db.HasExited) { throw 'Local database failed to start. Check tmp logs.' }
        Start-Sleep -Seconds 1
    }
    if (-not (Test-LocalPort 3306)) { throw 'Local database did not become ready.' }
}
if (-not (Test-Health 3000)) {
    if (Test-LocalPort 3000) { throw 'Port 3000 is occupied by an unhealthy or different service.' }
    $backend = Start-LocalProcess $node @('--watch', 'index.js') (Join-Path $root 'server') 'local-backend'
    Wait-Health 3000 30 $backend
}
Write-Host 'Backend ready: http://127.0.0.1:3000/api/health'
if (-not $settings.PDFINFO_PATH -or -not $settings.PDFTOPPM_PATH) {
    Write-Warning 'PDF image reading requires Poppler. Configure PDFINFO_PATH/PDFTOPPM_PATH in server/.env and restart the backend.'
}
if ($BackendOnly) { return }
if (-not (Test-Health 8081)) {
    if (Test-LocalPort 8081) { throw 'Port 8081 is occupied. Stop its old H5 process before restarting.' }
    $variables = @{
        NODE_ENV = 'development'
        UNI_PLATFORM = 'h5'
        UNI_INPUT_DIR = $root
        UNI_OUTPUT_DIR = (Join-Path $root 'unpackage/dist/dev/h5')
        UNI_HBUILDERX_PLUGINS = (Join-Path $HBuilderXPath 'plugins')
        VUE_CLI_CONTEXT = $cli
    }
    $previous = @{}
    try {
        foreach ($key in $variables.Keys) {
            $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, $variables[$key], 'Process')
        }
        $h5 = Start-LocalProcess $node @('bin/uniapp-cli.js') $cli 'local-h5'
    } finally {
        foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    }
    Wait-Health 8081 120 $h5
}
Write-Host 'H5 ready: http://127.0.0.1:8081/'
Write-Host 'Services run in the background until stopped or Windows restarts.'