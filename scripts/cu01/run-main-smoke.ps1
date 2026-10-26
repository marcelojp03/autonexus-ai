$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$node = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$out = Join-Path $root 'output/cu01-main-integration'
Set-Location $root
& $node scripts/verify-cu01-browser.mjs --demo-url http://127.0.0.1:4203 *> (Join-Path $out 'browser-main.log')
$browserExit = $LASTEXITCODE
$browserExit | Out-File (Join-Path $out 'browser-main.exit')
if ($browserExit -ne 0) { exit $browserExit }
& $node infra/compose/scripts/verify-databases.mjs --require-migrations *> (Join-Path $out 'postgres-main.log')
$sqlExit = $LASTEXITCODE
$sqlExit | Out-File (Join-Path $out 'postgres-main.exit')
exit $sqlExit
