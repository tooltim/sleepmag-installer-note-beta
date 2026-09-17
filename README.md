# Sleep Network bootstrap

Cross-platform **Node.js** installer for the private [`tooltim/sleep-network`](https://github.com/tooltim/sleep-network) workspace.

Public on purpose: teammates can download it before they have access to anything else. It contains **no secrets**. It installs Git / Node / (optional) Python if missing, clones the private workspace (GitHub asks you to log in), runs `tools/sleepmag/cli.mjs setup`, and creates a desktop launcher where the OS allows.

> The older Windows-only PowerShell installer lives in [`sleep-network-install`](https://github.com/tooltim/sleep-network-install) and is **unchanged**. Use this repo for Windows **and** macOS (Linux best-effort).

## Install

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/main/scripts/bootstrap.ps1 | iex
```

Or download and double-click [`Install-SleepNetwork.cmd`](https://github.com/tooltim/sleepmag-installer-note-beta/raw/main/Install-SleepNetwork.cmd).

### macOS (Terminal)

```bash
curl -fsSL https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/main/scripts/install.sh | bash
```

### Linux (best-effort)

Same as macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/main/scripts/install.sh | bash
```

### Already have Node 18+?

```bash
npx --yes github:tooltim/sleepmag-installer-note-beta
```

Or clone and run:

```bash
git clone https://github.com/tooltim/sleepmag-installer-note-beta.git
node sleepmag-installer-note-beta/bin/install.js
```

## What “done” looks like

| OS | When it finishes |
|----|------------------|
| **Windows** | A **Sleep Network** shortcut (`.lnk`) on your Desktop. Double-click it. |
| **macOS** | A **Sleep Network.command** file on your Desktop. Double-click it (first time: right-click → **Open** if Gatekeeper warns). |
| **Linux** | A `sleep-network.desktop` entry under `~/.local/share/applications` (and on Desktop when that folder exists). Or run `node ~/Documents/sleep-network/tools/sleepmag/cli.mjs`. |

Workspace location: your OS **Documents** folder `/ sleep-network` (follows OneDrive / iCloud redirects when the OS reports them).

## Environment variables (unattended / CI)

| Variable | Purpose |
|----------|---------|
| `SLEEPNET_MODE=check` | Report what is installed; change nothing |
| `SLEEPNET_NAME` | Skip name prompt |
| `SLEEPNET_EMAIL` | Skip email prompt |
| `SLEEPNET_PASSPHRASE` | Skip passphrase prompt |
| `SLEEPNET_ASSISTANT` | `claude` \| `codex` \| `both` \| `none` |
| `SLEEPNET_DRY_RUN=1` | Skip mutating side effects (tests) |

Example check:

```powershell
$env:SLEEPNET_MODE='check'; irm https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/main/scripts/bootstrap.ps1 | iex
```

```bash
SLEEPNET_MODE=check curl -fsSL https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/main/scripts/install.sh | bash
```

## Design notes

- **Idempotent** — safe to re-run.
- Detects Git/Node/Python on `PATH` (and common install dirs) **before** installing.
- Windows winget calls use `--source winget` to avoid Microsoft Store cert failures (`0x8a15005e`).
- Optional Claude Code / Codex installs never abort setup if they fail or stay off `PATH`.
- sleepmag exit codes that only complain about missing `claude`/`codex` soft-continue when passphrase + platform steps succeeded (same idea as the PowerShell installer).

## Development

```bash
npm test
SLEEPNET_MODE=check node bin/install.js
```

See [`docs/MANUAL-TEST-MATRIX.md`](docs/MANUAL-TEST-MATRIX.md) for Windows/macOS verification status.
