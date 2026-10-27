param([switch]$Restart)
$ErrorActionPreference='Stop'
$serviceDir=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot=(Resolve-Path (Join-Path $serviceDir '../..')).Path
$commonDir=& git -C $runtimeRoot rev-parse --path-format=absolute --git-common-dir
if($LASTEXITCODE -ne 0){throw 'Cannot resolve repository ownership'}
$primaryRoot=Split-Path $commonDir
function Canonical([string]$value){
  $value=$value.Trim().Replace([char]92,'/').ToLowerInvariant()
  while($value.Contains('//')){$value=$value.Replace('//','/')}
  return $value.TrimEnd('/')
}
if((Canonical $runtimeRoot) -ne (Canonical $primaryRoot)){throw 'Run only from the primary repository, never from a linked worktree'}
$branch=& git -C $runtimeRoot branch --show-current
if($branch -ne 'main'){throw 'Primary runtime requires main'}
$node='C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$artifact=Join-Path $serviceDir 'dist/main.js'
$clientFile=Join-Path $runtimeRoot 'infra/keycloak/.local/employees-client.json'
foreach($file in @($node,$artifact,(Join-Path $serviceDir '.env'),$clientFile)){if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw 'Missing runtime prerequisite; do not regenerate private configuration'}}
foreach($file in @((Join-Path $serviceDir '.env'),$clientFile)){
  & git -C $runtimeRoot check-ignore --quiet -- $file
  if($LASTEXITCODE -ne 0){throw 'Private configuration is not ignored'}
}
$artifacts=@(& git -C $runtimeRoot worktree list --porcelain | Where-Object {$_.StartsWith('worktree ')} | ForEach-Object {Canonical (Join-Path $_.Substring(9) 'services/employees/dist/main.js')})
if($LASTEXITCODE -ne 0){throw 'Cannot enumerate repository worktrees; no process was stopped'}
$allNodes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'")
$owned=@()
foreach($process in $allNodes){
  if((Canonical $process.ExecutablePath) -ne (Canonical $node)){continue}
  foreach($file in $artifacts){
    $pattern='^"?'+[regex]::Escape((Canonical $node))+'"?[ ]+"?'+[regex]::Escape($file)+'"?([ ]|$)'
    if((Canonical $process.CommandLine) -match $pattern){$owned+=$process;break}
  }
}
$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -in @(3002,3003))
foreach($listener in $listeners){
  if($listener.LocalPort -eq 3002 -and $listener.OwningProcess -notin $owned.ProcessId){throw 'Port3002 has an unverified owner; no process was stopped'}
  $candidate=$allNodes | Where-Object ProcessId -eq $listener.OwningProcess
  if($listener.LocalPort -eq 3003 -and $candidate -and $listener.OwningProcess -notin $owned.ProcessId -and (Canonical $candidate.CommandLine).Contains('dist/main.js')){throw 'Ambiguous Node owner on3003; inspect before replacing Employees'}
}
if($owned.Count -gt 0 -and -not $Restart){
  $rootOwner=@($owned | Where-Object {(Canonical $_.CommandLine).Contains((Canonical $artifact))})
  if($owned.Count -eq 1 -and $rootOwner.Count -eq 1 -and 3002 -in $listeners.LocalPort){Write-Output ('Preserved owned root Employees PID='+$owned[0].ProcessId+'; use -Restart after rebuilding');return}
  throw 'Employees already runs elsewhere or is starting; use explicit -Restart after inspection'
}
$keys=@('PORT','DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD','OIDC_ISSUER_URI','OIDC_AUDIENCE','WEB_ALLOWED_ORIGINS','EMPLOYEES_IDP_CLIENT_FILE')
$previous=@{}
foreach($key in $keys){$previous[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
try{
  . (Join-Path $runtimeRoot 'infra/compose/scripts/load-service-env.ps1') -Service employees
  $env:PORT='3002'
  $env:EMPLOYEES_IDP_CLIENT_FILE=$clientFile
  $out=Join-Path $runtimeRoot 'output/cu03-main-integration'
  New-Item -ItemType Directory -Force $out | Out-Null
  # All owners and configuration are validated before any process is stopped.
  foreach($process in $owned){Stop-Process -Id $process.ProcessId -ErrorAction Stop}
  $started=Start-Process -FilePath $node -ArgumentList @(([char]34+$artifact+[char]34)) -WorkingDirectory $serviceDir -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $out 'employees-runtime.log') -RedirectStandardError (Join-Path $out 'employees-runtime-error.log')
  Write-Output ('Started root Employees PID='+$started.Id+' port=3002; no Compose/private files changed')
}finally{foreach($key in $keys){[Environment]::SetEnvironmentVariable($key,$previous[$key],'Process')}}
