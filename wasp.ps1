<#
.SYNOPSIS
  Arranca (o apaga) todo WASP en este PC, cada proceso en su propia ventana, y te dice qué abrir.

.EXAMPLE
  .\wasp.ps1                 # todo real: hub, GREEN, ORANGE (Docker real si está, si no fake), MAGENTA, caras, CYAN escuchando
  .\wasp.ps1 -Stubs          # sin MAGENTA/ORANGE reales: usa los stubs del hub (ensayo rápido)
  .\wasp.ps1 -Request "WASP, create a two-hour beginner network reconnaissance workshop."   # CYAN arranca con esa orden
  .\wasp.ps1 -NoBrowser      # no abre la cara CYAN automáticamente
  .\wasp.ps1 -DryRun         # solo muestra lo que haría
  .\wasp.ps1 -Stop           # apaga todos los procesos node de este repo

.NOTES
  Cada proceso carga .env solo (los scripts raíz usan node --env-file-if-exists=.env).
  En la demo de 4 PCs: en los otros PCs pon WASP_HUB_URL=ws://<ip-de-este-pc>:7331 en su .env y arranca solo su agente
  (npm run researcher / operator / security) y su cara.
#>
[CmdletBinding()]
param(
  [switch]$Stop,
  [switch]$Stubs,
  [switch]$NoBrowser,
  [switch]$DryRun,
  [string]$Request
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
Set-Location $root

function Say($text, $color = 'Cyan') { Write-Host $text -ForegroundColor $color }

# ------------------------------------------------------------------ stop
if ($Stop) {
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$root*" -or $_.CommandLine -match 'apps[\\/](hub|architect|researcher|operator|security)|vite') }
  # The launcher windows may live inside Windows Terminal, so find the shells by the command we started them with.
  $shells = Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'pwsh.exe' -or $_.Name -eq 'powershell.exe') -and $_.CommandLine -like "*WindowTitle = 'WASP *" }
  if (-not $procs -and -not $shells) { Say 'WASP: no había procesos corriendo.' 'Yellow'; exit 0 }
  foreach ($p in $procs) {
    Say "  stop $($p.ProcessId)  $($p.CommandLine.Substring(0, [Math]::Min(90, $p.CommandLine.Length)))" 'DarkGray'
    if (-not $DryRun) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  foreach ($s in $shells) {
    $title = if ($s.CommandLine -match "WindowTitle = '([^']+)'") { $Matches[1] } else { $s.ProcessId }
    Say "  close window '$title'" 'DarkGray'
    if (-not $DryRun) { Stop-Process -Id $s.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  Say 'WASP apagado.' 'Green'
  exit 0
}

# ------------------------------------------------------------------ checks
if (-not (Test-Path (Join-Path $root 'node_modules'))) { Say 'Falta node_modules: corre  npm install  primero.' 'Red'; exit 1 }
if (-not (Test-Path (Join-Path $root '.env'))) {
  Say 'No hay .env: CYAN correrá sin Claude (flujo fijo) y MAGENTA sin búsqueda web.' 'Yellow'
  Say '  Copy-Item .env.example .env   y pon ANTHROPIC_API_KEY=sk-ant-...' 'Yellow'
} else {
  $envLines = Get-Content (Join-Path $root '.env')
  if (-not ($envLines -match '^ANTHROPIC_API_KEY=sk-ant-')) { Say '.env sin ANTHROPIC_API_KEY válida: CYAN correrá sin Claude (flujo fijo).' 'Yellow' }
  $model = ($envLines -match '^WASP_CLAUDE_MODEL=') -replace '^WASP_CLAUDE_MODEL=', ''
  if ($model -and $model -notmatch '^claude-(fable|opus|sonnet|haiku)-[0-9]') { Say "WASP_CLAUDE_MODEL='$model' no parece un id válido (ej. claude-fable-5-1, claude-opus-5)." 'Yellow' }
}

$dockerUp = $false
if (-not $Stubs) {
  try { $null = & docker info --format '{{.ServerVersion}}' 2>$null; $dockerUp = ($LASTEXITCODE -eq 0) } catch { $dockerUp = $false }
}

# ------------------------------------------------------------------ what to launch
$shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell' }
$windows = @()
$windows += @{ title = 'WASP HUB';            cmd = 'npm run hub';                                         wait = 3 }
$windows += @{ title = 'WASP GREEN security'; cmd = 'npm run security';                                    wait = 0 }
$windows += @{ title = 'WASP GREEN face';     cmd = 'npm run security:ui';                                 wait = 0 }
if ($Stubs) {
  $windows += @{ title = 'WASP STUBS (researcher, operator)'; cmd = 'npm run stubs -- researcher operator'; wait = 0 }
} else {
  $windows += @{ title = 'WASP ORANGE operator'; cmd = $(if ($dockerUp) { 'npm run operator' } else { 'npm run operator -- --fake-docker' }); wait = 0 }
  $windows += @{ title = 'WASP MAGENTA researcher'; cmd = 'npm run researcher';                             wait = 0 }
  $windows += @{ title = 'WASP MAGENTA face';       cmd = 'npm run researcher:ui';                          wait = 0 }
}
$windows += @{ title = 'WASP ORANGE face';    cmd = 'npm run operator:ui';                                 wait = 0 }
$windows += @{ title = 'WASP CYAN face';   cmd = 'npm run architect:ui';                                    wait = 2 }
$archCmd = if ($Request) { "npm run architect -- `"$($Request.Replace('"','\"'))`"" } else { 'npm run architect' }
$windows += @{ title = 'WASP CYAN architect'; cmd = $archCmd;                                               wait = 0 }

Say ''
Say '==============================  WASP  ==============================' 'Cyan'
Say ("  Docker: " + $(if ($Stubs) { 'no aplica (stubs)' } elseif ($dockerUp) { 'REAL' } else { 'no disponible -> ORANGE en modo fake (nada se ejecuta de verdad, el lab nunca se valida)' })) $(if ($dockerUp -or $Stubs) { 'Green' } else { 'Yellow' })
Say ''

$logDir = Join-Path $root 'logs'
if (-not $DryRun) { New-Item -ItemType Directory -Force $logDir | Out-Null }

foreach ($w in $windows) {
  $logName = ($w.title -replace '^WASP ', '' -replace '[^A-Za-z0-9]+', '-').Trim('-').ToLower() + '.log'
  Say ("  > " + $w.title.PadRight(34) + $w.cmd.PadRight(40) + "  logs\$logName") 'DarkGray'
  if (-not $DryRun) {
    # Every window also writes its output to logs\<name>.log so it can be read after the fact.
    $inner = "`$host.UI.RawUI.WindowTitle = '$($w.title)'; Set-Location '$root'; $($w.cmd) 2>&1 | Tee-Object -FilePath 'logs\$logName'"
    Start-Process $shell -ArgumentList '-NoExit', '-Command', $inner | Out-Null
    if ($w.wait -gt 0) { Start-Sleep -Seconds $w.wait }
  }
}

if (-not $DryRun) {
  # wait for the hub
  $ok = $false
  Write-Host '  esperando al hub en :7331 ' -NoNewline -ForegroundColor DarkGray
  for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
    try { $null = Invoke-RestMethod http://localhost:7331/health -TimeoutSec 2; $ok = $true } catch { Write-Host '.' -NoNewline -ForegroundColor DarkGray; Start-Sleep -Milliseconds 1000 }
  }
  Write-Host ''
  if ($ok) { Say '  hub OK' 'Green' } else { Say 'El hub no respondió en :7331 tras 60 s. Mira la ventana "WASP HUB".' 'Red' }
}

Say ''
Say '------------------------------ ABRE ESTO ------------------------------' 'Cyan'
Say '  CYAN    (tú hablas aquí)   http://localhost:5173   <- SOLO Chrome o Edge (Brave/Firefox bloquean el micrófono). Pulsa ENABLE VOICE y MIC.' 'Cyan'
if (-not $Stubs) { Say '  MAGENTA                    http://localhost:5174' 'Magenta' }
Say '  ORANGE                     http://localhost:7003' 'DarkYellow'
Say '  GREEN   (botones SÍ/NO)    http://localhost:7004' 'Green'
Say ''
Say '  Cómo va la demo:' 'White'
if ($Request) {
  Say "  1. CYAN ya arrancó con: `"$Request`"" 'White'
} else {
  Say '  1. En la cara CYAN pulsa MIC y di: "WASP, necesito un workshop de reconocimiento de red para principiantes."' 'White'
  Say '     (o escríbelo en la caja de texto y SEND; o tecléalo en la ventana "WASP CYAN architect")' 'DarkGray'
}
Say '  2. Cuando GREEN pida permiso, di "sí" en el MIC de CYAN, o pulsa SÍ en la cara GREEN.' 'White'
Say '  3. Al terminar, para otra ronda: cierra la ventana "WASP CYAN architect" y corre  npm run architect  otra vez.' 'White'
Say ''
Say '  Logs de cada proceso:  logs\*.log        Apagar todo:  .\wasp.ps1 -Stop' 'DarkGray'
Say '=======================================================================' 'Cyan'

if (-not $DryRun -and -not $NoBrowser) {
  # The CYAN face needs the browser's speech recognition: Chrome or Edge. Brave/Firefox block it
  # (the mic level moves but no text ever arrives). Open CYAN there even if the default browser is Brave.
  $browser = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($browser) {
    Say "  abriendo la cara CYAN en $([IO.Path]::GetFileNameWithoutExtension($browser)) (el micrófono no funciona en Brave/Firefox)" 'DarkGray'
    Start-Process $browser -ArgumentList '--new-window', 'http://localhost:5173'
  } else {
    Say '  Chrome/Edge no encontrados: abriendo en el navegador por defecto. El MIC solo funciona en Chrome o Edge.' 'Yellow'
    Start-Process 'http://localhost:5173'
  }
}
