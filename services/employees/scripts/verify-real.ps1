param([ValidateSet('full','cleanup','functional')][string]$Mode='full')
$service=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $service
$label=@{full='real';cleanup='cleanup';functional='functional-final'}[$Mode]
$arguments=@('scripts/verify-cu03-real.mjs')
if($Mode -eq 'cleanup'){$arguments+='--cleanup-only'}
if($Mode -eq 'functional'){$arguments+='--skip-recovery'}
'RUNNING' | Out-File (Join-Path $service ('../../output/cu03-employees/'+$label+'.exit'))
& 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe' @arguments *> (Join-Path $service ('../../output/cu03-employees/'+$label+'.log'))
$LASTEXITCODE | Out-File (Join-Path $service ('../../output/cu03-employees/'+$label+'.exit'))
