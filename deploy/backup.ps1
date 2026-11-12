$ErrorActionPreference = 'Stop'
$directory = 'C:\rehab-app\backups'
$output = Join-Path $directory ('rehab-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.sql')
$env:MYSQL_PWD = (Get-Content 'C:\rehab-deploy\secrets\mariadb-root.txt' -Raw).Trim()
try {
    & 'C:\Program Files\MariaDB 11.4\bin\mariadb-dump.exe' --user=root --single-transaction --skip-lock-tables --default-character-set=utf8mb4 "--result-file=$output" rehab_discharge
    if ($LASTEXITCODE -ne 0) { throw 'Database backup failed' }
    Compress-Archive -LiteralPath $output -DestinationPath "$output.zip"
    if (!(Test-Path "$output.zip")) { throw 'Backup archive missing' }
    Remove-Item -LiteralPath $output
    # 仅清理此目录中由本脚本创建且已超过30天的备份。
    Get-ChildItem -LiteralPath $directory -Filter 'rehab-*.sql.zip' -File |
        Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName }
} finally {
    $env:MYSQL_PWD = $null
}
