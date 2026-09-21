# Sleep Network bootstrap (Windows). Idempotent thin wrapper.
# Ensures Node.js is on PATH, then launches the guided installer UI.
# Modes via env (same as the Node installer / legacy install.ps1):
#   SLEEPNET_MODE=check
#   SLEEPNET_NAME / SLEEPNET_EMAIL / SLEEPNET_PASSPHRASE / SLEEPNET_ASSISTANT
#   SLEEPNET_DEST=<folder>        where to install (default: a local, non-synced folder)
#   SLEEPNET_ALLOW_CLOUD=1        allow OneDrive / iCloud / Dropbox anyway
#   SLEEPNET_REMOVE_PREVIOUS=1    delete workspaces found elsewhere
#   SLEEPNET_UI=0   force console CLI instead of browser UI

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
    Say "Node.js not found - installing..."
    if (Have 'winget') {
        # Pin --source winget: msstore often fails with cert error 0x8a15005e
        try {
            winget install --id OpenJS.NodeJS.LTS -e --source winget --silent --accept-package-agreements --accept-source-agreements
        } catch {
            Say "winget reported an error; trying nodejs.org MSI..."
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

# Which branch of the installer to run. A test branch ships a copy of this file
# with SLEEPNET_DEFAULT_BRANCH set to itself, so sharing that branch's raw URL
# runs THAT branch instead of silently falling back to main.
$SLEEPNET_DEFAULT_BRANCH = 'team-test'
$Branch = if ($env:SLEEPNET_BRANCH) { $env:SLEEPNET_BRANCH } else { $SLEEPNET_DEFAULT_BRANCH }
if ($Branch -ne 'main') { Say ("installer branch: " + $Branch) }

$BootstrapDir = Join-Path $env:TEMP ('sleepmag-installer-' + ($Branch -replace '[^A-Za-z0-9._-]', '-'))
$Repo = 'https://github.com/tooltim/sleepmag-installer-note-beta.git'
if (-not (Have 'git')) {
    Say "Git not found - downloading bootstrap zip..."
    $zip = Join-Path $env:TEMP 'sleepmag-installer-note-beta.zip'
    Invoke-WebRequest ('https://github.com/tooltim/sleepmag-installer-note-beta/archive/refs/heads/' + $Branch + '.zip') -OutFile $zip
    $extractRoot = Join-Path $env:TEMP 'sleepmag-installer-note-beta-extract'
    if (Test-Path $extractRoot) { Remove-Item -Recurse -Force $extractRoot }
    if (Test-Path $BootstrapDir) { Remove-Item -Recurse -Force $BootstrapDir }
    New-Item -ItemType Directory -Path $extractRoot | Out-Null
    Expand-Archive -Path $zip -DestinationPath $extractRoot -Force
    $extracted = Get-ChildItem $extractRoot -Directory | Select-Object -First 1
    if (-not $extracted) { throw "Zip extract failed - no folder under $extractRoot" }
    Move-Item -Path $extracted.FullName -Destination $BootstrapDir
    Remove-Item -Recurse -Force $extractRoot -ErrorAction SilentlyContinue
} else {
    if (-not (Test-Path (Join-Path $BootstrapDir '.git'))) {
        if (Test-Path $BootstrapDir) { Remove-Item -Recurse -Force $BootstrapDir }
        git clone -q --branch $Branch --single-branch $Repo $BootstrapDir
    } else {
        git -C $BootstrapDir fetch -q origin $Branch 2>$null
        git -C $BootstrapDir checkout -q -B $Branch ("origin/" + $Branch) 2>$null
    }
}

$entry = Join-Path $BootstrapDir 'bin\install.js'
if (-not (Test-Path $entry)) { throw "Bootstrap entry not found at $entry" }

# Default: guided UI. Pass --cli when SLEEPNET_UI=0 or check mode.
$installArgs = @($entry)
if ($env:SLEEPNET_MODE -eq 'check' -or $env:SLEEPNET_UI -eq '0') {
    $installArgs += '--cli'
} else {
    $installArgs += '--ui'
}

Say "Opening the installer..."
& $node @installArgs
exit $LASTEXITCODE
