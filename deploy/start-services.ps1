$ErrorActionPreference = 'Stop'
Set-Location 'C:\rehab-app\server'
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
& 'C:\Program Files\nodejs\npm.cmd' ci --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
& 'C:\Program Files\nodejs\node.exe' --check index.js
if ($LASTEXITCODE -ne 0) { throw 'Backend syntax check failed' }
$serviceExe = 'C:\rehab-app\service\RehabWeb.exe'
if (!(Get-Service RehabWeb -ErrorAction SilentlyContinue)) {
    & $serviceExe install
    if ($LASTEXITCODE -ne 0) { throw 'Service installation failed' }
}
# 显式设置 SCM 中的运行账户，避免已有服务沿用 LocalSystem。
if ((Get-Service RehabProxy -ErrorAction SilentlyContinue).Status -eq 'Running') { Stop-Service RehabProxy }
if ((Get-Service RehabWeb).Status -ne 'Stopped') { Stop-Service RehabWeb }
& sc.exe config RehabWeb obj= 'NT AUTHORITY\LocalService'
if ($LASTEXITCODE -ne 0) { throw 'Service account configuration failed' }
Start-Service RehabWeb
if (Get-Service RehabProxy -ErrorAction SilentlyContinue) { Start-Service RehabProxy }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -File C:\rehab-app\service\backup.ps1'
$trigger = New-ScheduledTaskTrigger -Daily -At '03:00'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'RehabDailyBackup' -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
& 'C:\rehab-app\service\backup.ps1'
Get-Service RehabWeb,MariaDB | Select-Object Name,Status,StartType | ConvertTo-Json -Compress
