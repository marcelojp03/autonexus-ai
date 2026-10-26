param([Parameter(Mandatory=$true)][ValidateSet('operations','employees')][string]$Service)

$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$environmentFile = Join-Path $workspaceRoot ('services/' + $Service + '/.env')
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) { throw 'Missing local service .env. Run infra/compose/scripts/init-env.mjs first.' }
$allowedKeys = @('PORT','DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD','OIDC_ISSUER_URI','OIDC_AUDIENCE','WEB_ALLOWED_ORIGINS')
foreach ($line in Get-Content -LiteralPath $environmentFile) {
  if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
  $separator = $line.IndexOf('=')
  if ($separator -lt 1) { throw 'Invalid line in local service environment.' }
  $key = $line.Substring(0, $separator).Trim()
  if ($key -notin $allowedKeys) { throw 'Unexpected key in local service environment.' }
  $value = $line.Substring($separator + 1)
  if ([string]::IsNullOrWhiteSpace($value)) { throw ('Missing value for ' + $key) }
  [Environment]::SetEnvironmentVariable($key, $value, 'Process')
}
Write-Output ('Loaded ' + $Service + ' environment into this process; values were not printed.')
