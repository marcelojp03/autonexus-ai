param([ValidateSet('build','test','test:e2e','lint')][string[]]$Checks=@('build','test','test:e2e','lint'))
$ErrorActionPreference='Stop'
$service=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node='C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$pnpm='C:/Users/marcelo/AppData/Local/node/corepack/v1/pnpm/12.6.0/bin/pnpm.mjs'
$env:Path='C:/Users/marcelo/AppData/Local/nvm/v22.22.3;' + $env:Path
$out=Join-Path $service '../../output/cu03-employees'
New-Item -ItemType Directory -Force $out | Out-Null
Set-Location $service
foreach($command in $Checks){
  $label=$command.Replace(':','-')
  if($command -eq 'test:e2e'){ & $node $pnpm run $command --no-file-parallelism *> (Join-Path $out ($label+'.log')) } else { & $node $pnpm run $command *> (Join-Path $out ($label+'.log')) }
  $code=$LASTEXITCODE
  $code | Out-File (Join-Path $out ($label+'.exit'))
  if($code -ne 0){exit $code}
}
& $node $pnpm exec tsc --noEmit *> (Join-Path $out 'types.log')
$LASTEXITCODE | Out-File (Join-Path $out 'types.exit')
