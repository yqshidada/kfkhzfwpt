param([Parameter(Mandatory=$true)][string]$ScriptPath)
$ErrorActionPreference = 'Stop'
$script = "$" + "ProgressPreference='SilentlyContinue';" + [IO.File]::ReadAllText((Resolve-Path $ScriptPath))
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
& ssh -i 'C:\Users\Lenovo\.ssh\kfkxcx-tencent-deploy' -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 Administrator@193.112.28.250 "powershell.exe -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand $encoded"
if ($LASTEXITCODE -ne 0) { throw "SSH exited with code $LASTEXITCODE" }
