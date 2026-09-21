# Testing this branch

`team-test` is the branch the team tests from. It is the same installer as `main`; the only
difference is that its bootstrap pins itself to this branch, so the link below always runs
**this** branch's code even after `main` moves on.

## Run it

Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/team-test/scripts/bootstrap.ps1 | iex
```

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/team-test/scripts/install.sh | bash
```

Look at what is installed, change nothing:

```powershell
$env:SLEEPNET_MODE='check'; irm https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/team-test/scripts/bootstrap.ps1 | iex
```

## Before you start

You need a GitHub invite to the private `tooltim/sleep-network` workspace, and the team
passphrase. Without the invite the installer stops at **Download workspace** and says so.

## What we want to know

1. **The folder.** It suggests one; is it somewhere sensible on your machine? Try typing a OneDrive
   path: it should refuse and explain, with a tick box to override.
2. **The end screen.** It prints the workspace path, the shortcut path, what the shortcut starts and
   the icon file. Are they all right?
3. **The icon.** Does the desktop shortcut show the Sleep Magazine image, or a blank page?
4. **Opening.** Does the launcher window open by itself? If it does not, does the page admit it and
   tell you what to double-click?
5. **Running it twice.** Run it again. It should report what is really installed, clear the old
   shortcut, and not duplicate anything.

## If something goes wrong

The page shows which step failed and has a **Copy log** button. Send Tim that log; it is also saved
at `%TEMP%\sleepnet-install.log` (Windows) or `$TMPDIR/sleepnet-install.log`.
