$service=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $service
& 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe' scripts/verify-cu03-real.mjs *> (Join-Path $service '../../output/cu03-employees/real.log')
$LASTEXITCODE | Out-File (Join-Path $service '../../output/cu03-employees/real.exit')
