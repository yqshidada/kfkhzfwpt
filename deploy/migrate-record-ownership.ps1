$ErrorActionPreference = 'Stop'
$env:MYSQL_PWD = (Get-Content 'C:\rehab-deploy\secrets\mariadb-root.txt' -Raw).Trim()
try {
	$db = 'rehab_discharge'
	$mysql = 'C:\Program Files\MariaDB 11.4\bin\mariadb.exe'
	$hasOwnerColumn = (& $mysql -N -B -u root $db -e "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$db' AND TABLE_NAME='discharge_records' AND COLUMN_NAME='created_by_user_id';").Trim()
	if ($hasOwnerColumn -eq '0') {
		& $mysql -u root $db -e 'ALTER TABLE discharge_records ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL AFTER request_id, ADD KEY idx_discharge_records_created_by_user_id (created_by_user_id);'
		if ($LASTEXITCODE -ne 0) { throw 'Unable to add record ownership column' }
	}
	$sql = @"
CREATE TABLE IF NOT EXISTS hospitalization_number_registry (
  hospitalization_number VARCHAR(64) NOT NULL,
  first_record_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hospitalization_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO hospitalization_number_registry (hospitalization_number, first_record_id)
SELECT hospitalization_number, MIN(id) FROM discharge_records GROUP BY hospitalization_number;
"@
	& $mysql -u root $db -e $sql
	if ($LASTEXITCODE -ne 0) { throw 'Unable to initialize hospitalization number registry' }
	& $mysql -u root $db -e "SELECT COUNT(*) AS historical_records_without_owner FROM discharge_records WHERE created_by_user_id IS NULL; SELECT COUNT(*) AS registered_hospitalization_numbers FROM hospitalization_number_registry;"
	if ($LASTEXITCODE -ne 0) { throw 'Migration verification failed' }
} finally { $env:MYSQL_PWD = $null }
