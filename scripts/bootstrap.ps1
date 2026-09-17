# Sleep Network bootstrap (Windows). Idempotent thin wrapper.
# Ensures Node.js is on PATH, then runs the Node installer from this repo.
# Modes via env (same as the Node installer / legacy install.ps1):
#   SLEEPNET_MODE=check
#   SLEEPNET_NAME / SLEEPNET_EMAIL / SLEEPNET_PASSPHRASE / SLEEPNET_ASSISTANT

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Say($m) { Write-Host ("  " + $m) }
function Ok($m) { Write-Host ("  OK  " + $m) -ForegroundColor Green }
function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path
    foreach ($d in @(
        (Join-Path $env:ProgramFiles 'nodejs'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs'),
        (Join-Path $env:ProgramFiles 'Git\cmd'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd')
    )) {
        if ((Test-Path $d) -and ($env:Path -notlike "*$d*")) { $env:Path = "$d;" + $env:Path }
    }
}
function Resolve-Node {
    Refresh-Path
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )) { if (Test-Path $p) { return $p } }
    return $null
}
function Wait-Node([int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    do {
        $n = Resolve-Node
        if ($n) { return $n }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $null
}

Write-Host ""; Write-Host "Sleep Network bootstrap (Windows)" -ForegroundColor Cyan; Write-Host ""

Refresh-Path
$node = Resolve-Node
if (-not $node) {
    Say "Node.js not found — installing…"
    if (Have 'winget') {
        # Pin --source winget: msstore often fails with cert error 0x8a15005e
        try {
            winget install --id OpenJS.NodeJS.LTS -e --source winget --silent --accept-package-agreements --accept-source-agreements
        } catch {
            Say "winget reported an error; trying nodejs.org MSI…"
        }
        $node = Wait-Node 20
    }
    if (-not $node) {
        $msi = Join-Path $env:TEMP 'node-lts.msi'
        Invoke-WebRequest 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile $msi
        $proc = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
        if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
            throw "Node.js MSI failed (exit $($proc.ExitCode)). Run PowerShell as administrator and retry."
        }
        $node = Wait-Node 45
    }
}
if (-not $node) { throw "Node.js is required. Install from https://nodejs.org and re-run." }
Ok ("node " + (& $node --version))

$BootstrapDir = Join-Path $env:TEMP 'sleepmag-installer-note-beta'
$Repo = 'https://github.com/tooltim/sleepmag-installer-note-beta.git'
if (-not (Have 'git')) {
    Say "Git not found — the Node installer will install it; cloning bootstrap via zip…"
    $zip = Join-Path $env:TEMP 'sleepmag-installer-note-beta.zip'
    Invoke-WebRequest 'https://github.com/tooltim/sleepmag-installer-note-beta/archive/refs/heads/main.zip' -OutFile $zip
    if (Test-Path $BootstrapDir) { Remove-Item -Recurse -Force $BootstrapDir }
    Expand-Archive -Path $zip -DestinationPath $env:TEMP -Force
    $extracted = Join-Path $env:TEMP 'sleepmag-installer-note-beta-main'
    if (Test-Path $extracted) {
        Rename-Item $extracted 'sleepmag-installer-note-beta' -ErrorAction SilentlyContinue
        $BootstrapDir = Join-Path $env:TEMP 'sleepmag-installer-note-beta'
        if (-not (Test-Path $BootstrapDir)) { $BootstrapDir = $extracted }
    }
} else {
    if (-not (Test-Path (Join-Path $BootstrapDir '.git'))) {
        if (Test-Path $BootstrapDir) { Remove-Item -Recurse -Force $BootstrapDir }
        git clone -q $Repo $BootstrapDir
    } else {
        git -C $BootstrapDir pull -q --ff-only 2>$null
    }
}

$entry = Join-Path $BootstrapDir 'bin\install.js'
if (-not (Test-Path $entry)) { throw "Bootstrap entry not found at $entry" }
& $node $entry
exit $LASTEXITCODE
