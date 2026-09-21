# Sleep Network bootstrap

Cross-platform **Node.js** installer for the private [`tooltim/sleep-network`](https://github.com/tooltim/sleep-network) workspace.

Public on purpose: teammates can download it before they have access to anything else. It contains **no secrets**. It installs Git / Node / (optional) Python if missing, clones the private workspace (GitHub asks you to log in), runs `tools/sleepmag/cli.mjs setup`, and creates a desktop launcher where the OS allows.

The default experience is a **guided browser UI**: enter name / e-mail / passphrase, watch each step, and if something fails the page stays open with the failed step and a full error log (also saved under your temp folder as `sleepnet-install.log`).

> **This repo is the installer.** It is what the launcher's Team tab hands out, and the only one that
> gets fixes. The older Windows-only PowerShell installer in
> [`sleep-network-install`](https://github.com/tooltim/sleep-network-install) is superseded — do not
> send people there.

## Install

### Windows (recommended)

Download and double-click [`Install-SleepNetwork.cmd`](https://github.com/tooltim/sleepmag-installer-note-beta/raw/main/Install-SleepNetwork.cmd). Your browser opens the installer — no need to paste commands into CMD.

Or from PowerShell:

```powershell
irm https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/main/scripts/bootstrap.ps1 | iex
```

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
node sleepmag-installer-note-beta/bin/install.js --ui
```

Console / automation mode:

```bash
node sleepmag-installer-note-beta/bin/install.js --cli
```

## What “done” looks like

| OS | When it finishes |
|----|------------------|
| **Windows** | A **Sleep Network Launcher** shortcut (`.lnk`, with the Sleep Magazine icon) on your Desktop, pointing at `Sleep Network Launcher.cmd` in the workspace. |
| **macOS** | A **Sleep Network Launcher.command** file on your Desktop. Double-click it (first time: right-click → **Open** if Gatekeeper warns). |
| **Linux** | A `sleep-network-launcher.desktop` entry under `~/.local/share/applications` (and on Desktop when that folder exists). |

The final screen prints the **exact paths**: workspace, shortcut, what the shortcut starts, and the
icon file. When the launcher could not be opened automatically, it says so and why, instead of
claiming it opened.

### Where it installs

You choose the folder. The installer pre-fills a **local** one and offers the alternatives as
one-click chips.

Cloud-synced folders (**OneDrive**, iCloud Drive, Dropbox, Google Drive) are **refused by default**:
sync turns files into on-demand placeholders and locks `.git` mid-operation, which is how a
workspace ends up half-broken. On Windows this matters because OneDrive silently redirects the
Documents known folder — so "Documents" is offered only when it is genuinely local. A tick box lets
you override the refusal if you really want it.

### What it checks

Before and after installing, the installer reads the files rather than trusting that a name exists:

- `.git/` **and** a non-empty `.git/HEAD` (a copied folder is not an install)
- `tools/sleepmag/cli.mjs` present and not truncated
- `sleepmag.cmd` present, non-empty, and actually calling `cli.mjs`
- `CLAUDE.md` and the `sites/` folders
- every desktop / Start Menu shortcut, where it points, and whether that target still exists

Each result is shown with its full path and size. The install fails loudly if the workspace is
incomplete afterwards, instead of finishing with a green tick over a broken folder.

### What it removes

Shortcuts of ours (including dead ones pointing at a deleted workspace) are deleted and recreated on
every run. When a workspace exists somewhere else, the installer lists it and offers to delete it;
deletion is guarded — the folder must be named `sleep-network`, sit outside system locations, and
contain workspace files, or it is left alone.

## If something fails

1. The installer UI shows **which step** failed.
2. Use **Copy log** (or open the path shown, usually `%TEMP%\sleepnet-install.log` on Windows).
3. Send that log to Tim.

## Environment variables (unattended / CI)

| Variable | Purpose |
|----------|---------|
| `SLEEPNET_MODE=check` | Report what is installed; change nothing |
| `SLEEPNET_NAME` | Skip name prompt |
| `SLEEPNET_EMAIL` | Skip email prompt |
| `SLEEPNET_PASSPHRASE` | Skip passphrase prompt |
| `SLEEPNET_ASSISTANT` | `claude` \| `codex` \| `gemini` \| `both` \| `all` \| `none` |
| `SLEEPNET_DEST` | Install folder (`sleep-network` is appended when missing) |
| `SLEEPNET_ALLOW_CLOUD=1` | Install into a OneDrive / iCloud / Dropbox folder anyway |
| `SLEEPNET_REMOVE_PREVIOUS=1` | Delete workspaces found in other locations |
| `SLEEPNET_DRY_RUN=1` | Skip mutating side effects (tests) |
| `SLEEPNET_UI=0` | Force console CLI instead of browser UI |

When name, e-mail, and passphrase are all set via env, the installer runs in CLI mode (no browser).

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
- sleepmag exit codes that only complain about missing `claude`/`codex`/`gemini` soft-continue when passphrase + platform steps succeeded.
- Step order: tools → clean up → workspace → assistants → setup → verify → launcher → open.
- The destination is decided and probed for write access **before** anything is downloaded or deleted.
- The desktop icon starts `Sleep Network Launcher.cmd` (the launcher window), not `sleepmag.cmd` (the bare CLI).
- The `.ico` is taken from the workspace itself, so the shortcut never points into a temp folder that gets cleaned.
- "Opened" is only reported when a process actually started and was still alive a moment later.

## Development

```bash
npm test
npm start          # UI
npm run start:cli  # console
SLEEPNET_MODE=check npm run check
```

See [`docs/MANUAL-TEST-MATRIX.md`](docs/MANUAL-TEST-MATRIX.md) for Windows/macOS verification status.
