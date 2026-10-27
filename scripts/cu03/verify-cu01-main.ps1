$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'output/cu03-main-integration'
$node='C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
New-Item -ItemType Directory -Force $out | Out-Null
Set-Location $root
'RUNNING' | Out-File (Join-Path $out 'cu01-main.exit')
& $node scripts/verify-cu01-browser.mjs --demo-url http://127.0.0.1:4203 --reuse-captures *> (Join-Path $out 'cu01-main.log')
$code=$LASTEXITCODE
$code | Out-File (Join-Path $out 'cu01-main.exit')
if($code -ne 0){exit $code}
& $node infra/compose/scripts/verify-databases.mjs --require-migrations *> (Join-Path $out 'postgres-main.log')
$code=$LASTEXITCODE
$code | Out-File (Join-Path $out 'postgres-main.exit')
exit $code
