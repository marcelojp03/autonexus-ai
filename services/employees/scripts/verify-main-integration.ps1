$ErrorActionPreference='Stop'
$serviceDir=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$out=Join-Path $serviceDir '../../output/cu03-main-integration'
New-Item -ItemType Directory -Force $out | Out-Null
Set-Location $serviceDir
'RUNNING' | Out-File (Join-Path $out 'live-main.exit')
& 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe' scripts/verify-main-integration.mjs *> (Join-Path $out 'live-main.log')
$code=$LASTEXITCODE
$code | Out-File (Join-Path $out 'live-main.exit')
exit $code
