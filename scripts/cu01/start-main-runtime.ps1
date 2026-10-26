$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$oldRoot = Join-Path $root '.worktrees/cu01-keycloak'
$node = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$java = 'C:/Program Files/Java/jdk-21/bin/java.exe'
$out = Join-Path $root 'output/cu01-main-integration'
$env:Path = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3;' + $env:Path
New-Item -ItemType Directory -Force $out | Out-Null
function Normalized([string]$value) { return $value.Replace([char]92, '/').ToLowerInvariant() }
$apps = @(
  @{ Name='operations'; Port=8081; Dir='services/operations'; Exe=$java; Args=@('-jar', ('"' + (Join-Path $root 'services/operations/target/operations-0.0.1-SNAPSHOT.jar') + '"')) },
  @{ Name='employees'; Port=3002; Dir='services/employees'; Exe=$node; Args=@(('"' + (Join-Path $root 'services/employees/dist/main.js') + '"')) },
  @{ Name='shell'; Port=4200; Dir='web/shell'; OutDir='web/shell/dist'; Exe=$node },
  @{ Name='mf-employees'; Port=4201; Dir='web/mf-employees'; OutDir='web/mf-employees/dist/ng-alain/browser'; Exe=$node },
  @{ Name='mf-operations'; Port=4202; Dir='web/mf-operations'; OutDir='web/mf-operations/dist/ng-alain/browser'; Exe=$node },
  @{ Name='demo'; Port=4203; Dir='web/mf-employees'; OutDir='web/mf-employees/dist/demo/browser'; Exe=$node }
)
# Resolve every target before stopping any process. Never kill arbitrary port owners.
foreach ($app in $apps) {
  $listeners = @(Get-NetTCPConnection -LocalPort $app.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($listeners.Count -gt 1) { throw 'Ambiguous application ownership' }
  if ($listeners.Count -eq 1) {
    $proc = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listeners[0])
    $command = Normalized $proc.CommandLine
    if ((Normalized $proc.ExecutablePath) -ne (Normalized $app.Exe)) { throw 'Unexpected executable' }
    if ($command.Contains((Normalized $oldRoot) + '/')) { $app.OldPid = $listeners[0] }
    else {
      $artifact = if ($app.Name -eq 'operations') { 'services/operations/target/operations-0.0.1-SNAPSHOT.jar' } elseif ($app.Name -eq 'employees') { 'services/employees/dist/main.js' } else { 'web/shell/node_modules/vite/bin/vite.js' }
      if (-not $command.Contains((Normalized (Join-Path $root $artifact)))) { throw 'Unexpected port owner; no process was stopped' }
      $app.AlreadyRoot = $true
    }
  }
  if ($app.OutDir) {
    if (-not (Test-Path (Join-Path $root ($app.OutDir + '/index.html')))) { throw 'Missing compiled web entry' }
    $app.Args = @(('"' + (Join-Path $root 'web/shell/node_modules/vite/bin/vite.js') + '"'), 'preview', '--host', '127.0.0.1', '--port', $app.Port, '--strictPort', '--outDir', ('"' + (Join-Path $root $app.OutDir) + '"'))
  } elseif ($app.Name -eq 'operations') {
    if (-not (Test-Path (Join-Path $root 'services/operations/target/operations-0.0.1-SNAPSHOT.jar'))) { throw 'Missing Operations build' }
  } elseif (-not (Test-Path (Join-Path $root 'services/employees/dist/main.js'))) { throw 'Missing Employees build' }
}
foreach ($app in $apps) { if ($app.OldPid) { Stop-Process -Id $app.OldPid -ErrorAction Stop } }
foreach ($app in $apps) {
  if ($app.AlreadyRoot) { Write-Output ('Preserved existing main process ' + $app.Name); continue }
  if ($app.Name -eq 'operations') { . (Join-Path $root 'infra/compose/scripts/load-service-env.ps1') -Service operations }
  $started = Start-Process -FilePath $app.Exe -ArgumentList $app.Args -WorkingDirectory (Join-Path $root $app.Dir) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $out ($app.Name + '-runtime.log')) -RedirectStandardError (Join-Path $out ($app.Name + '-runtime-error.log'))
  Write-Output ('Started ' + $app.Name + ' PID=' + $started.Id + ' from main')
  if ($app.Name -eq 'operations') {
    foreach ($key in @('PORT','DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD','OIDC_ISSUER_URI','OIDC_AUDIENCE','WEB_ALLOWED_ORIGINS')) { Remove-Item ('Env:' + $key) -ErrorAction SilentlyContinue }
  }
}
