# Manual test matrix — sleep-network-bootstrap

Status key: **Verified** (ran on real OS) · **Simulated** (unit/dry-run/CI on Linux agent) · **Not run**

| Scenario | Windows | macOS | Linux agent |
|----------|---------|-------|-------------|
| `SLEEPNET_MODE=check` reports tools + workspace path | Simulated (logic) | Simulated (logic) | **Verified** (`npm test` + check run) |
| Documents path: classic `~/Documents` | Simulated | Simulated | **Verified** |
| Documents path: OneDrive redirect | Simulated (pickDocuments + PS API design) | n/a | n/a |
| Documents path: iCloud Desktop & Documents | n/a | Simulated | n/a |
| Documents path: non-ASCII (`Pièces jointes` / XDG) | Simulated | Simulated | Simulated |
| Detect existing Git/Node on PATH before install | Simulated | Simulated | **Verified** (agent has both) |
| Install Node via winget `--source winget` | Not run (needs Win host) | n/a | n/a |
| Node MSI fallback after winget fail | Not run | n/a | n/a |
| Install Node via Homebrew | n/a | Not run | n/a |
| Clone private `sleep-network` (auth prompt) | Not run | Not run | Not run (no private access) |
| Re-run updates workspace (`git pull --ff-only`) | Simulated (dry-run branch) | Simulated | Simulated |
| `tools/sleepmag/cli.mjs setup` with env credentials | Not run | Not run | Not run |
| Soft-continue on missing claude/codex only | **Verified** (unit) | **Verified** (unit) | **Verified** (unit) |
| Optional assistant install failure does not abort | Simulated | Simulated | Simulated |
| Desktop `.lnk` creation | Not run | n/a | n/a |
| Desktop `.command` creation | n/a | Not run | n/a |
| Linux `.desktop` entry | n/a | n/a | Simulated (dry-run) |
| One-liner `irm … bootstrap.ps1 \| iex` | Not run | n/a | n/a |
| One-liner `curl … install.sh \| bash` | n/a | Not run | Partial (script syntax only) |
| Idempotent second run | Not run | Not run | check-mode verified |

## How to verify on a real machine

### Windows

```powershell
$env:SLEEPNET_MODE='check'
irm https://raw.githubusercontent.com/tooltim/sleep-network-bootstrap/main/scripts/bootstrap.ps1 | iex

# Full install (interactive):
irm https://raw.githubusercontent.com/tooltim/sleep-network-bootstrap/main/scripts/bootstrap.ps1 | iex
```

Confirm Desktop **Sleep Network.lnk** and `%USERPROFILE%\Documents\sleep-network` (or OneDrive Documents).

### macOS

```bash
SLEEPNET_MODE=check curl -fsSL https://raw.githubusercontent.com/tooltim/sleep-network-bootstrap/main/scripts/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/tooltim/sleep-network-bootstrap/main/scripts/install.sh | bash
```

Confirm Desktop **Sleep Network.command** and `~/Documents/sleep-network`.

## Residual risks

1. Private repo clone requires each teammate’s GitHub access + auth (browser/credential manager).
2. sleepmag may still exit non-zero on missing assistants until the private CLI softens that; bootstrap soft-continues when passphrase+platform markers are present.
3. Pinned Node `v22.14.0` / Git `v2.47.1` Windows fallback URLs will age.
4. macOS Gatekeeper may block `.command` until right-click → Open.
5. Creating this GitHub repo + granting the Cursor GitHub App access is required before one-liners work in production.
