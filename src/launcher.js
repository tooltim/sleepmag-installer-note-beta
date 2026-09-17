/**
 * Desktop launcher / shortcut where the OS allows.
 * sleepmag setup usually creates one; we ensure a fallback exists.
 */

import fs from 'node:fs';
import path from 'node:path';
import { joinPath, pathExists, platformInfo } from './platform.js';
import { run } from './exec.js';
import { say, ok } from './say.js';

/**
 * @param {{ dest: string, dryRun?: boolean }} opts
 * @returns {{ kind: string, path: string|null, hint: string }}
 */
export function ensureLauncher(opts) {
  const info = platformInfo();
  if (info.isWin) return ensureWindowsShortcut(opts);
  if (info.isMac) return ensureMacLauncher(opts);
  return ensureLinuxDesktopEntry(opts);
}

function desktopDir(info) {
  const home = info.home;
  if (info.isWin) {
    return (
      process.env.USERPROFILE
        ? joinPath(process.env.USERPROFILE, 'Desktop')
        : joinPath(home, 'Desktop')
    );
  }
  return joinPath(home, 'Desktop');
}

function ensureWindowsShortcut(opts) {
  const info = platformInfo();
  const link = joinPath(desktopDir(info), 'Sleep Network.lnk');
  const targetCmd = joinPath(opts.dest, 'sleepmag.cmd');
  const targetPs1 = joinPath(opts.dest, 'sleepmag.ps1');
  const target = pathExists(targetCmd) ? targetCmd : pathExists(targetPs1) ? targetPs1 : null;

  if (pathExists(link)) {
    return {
      kind: 'lnk',
      path: link,
      hint: "Installed. Double-click 'Sleep Network' on your desktop.",
    };
  }

  if (!target) {
    say('desktop shortcut: sleepmag launcher not found yet — open the workspace folder after setup');
    return {
      kind: 'none',
      path: null,
      hint: `Installed. Open ${opts.dest} and run sleepmag from there.`,
    };
  }

  if (opts.dryRun) {
    return {
      kind: 'lnk',
      path: link,
      hint: "Installed. Double-click 'Sleep Network' on your desktop.",
    };
  }

  const ps = `
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut(${JSON.stringify(link)})
$sc.TargetPath = ${JSON.stringify(target)}
$sc.WorkingDirectory = ${JSON.stringify(opts.dest)}
$sc.Description = 'Sleep Network'
$sc.Save()
`;
  const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  if (r.code === 0 && pathExists(link)) {
    ok(`desktop shortcut: ${link}`);
    return {
      kind: 'lnk',
      path: link,
      hint: "Installed. Double-click 'Sleep Network' on your desktop.",
    };
  }
  say('could not create desktop shortcut automatically');
  return {
    kind: 'none',
    path: null,
    hint: `Installed. Run ${target} to start Sleep Network.`,
  };
}

function ensureMacLauncher(opts) {
  const info = platformInfo();
  const desktop = desktopDir(info);
  const commandPath = joinPath(desktop, 'Sleep Network.command');
  const cli = joinPath(opts.dest, 'tools', 'sleepmag', 'cli.mjs');

  const script = `#!/bin/bash
cd ${shellQuote(opts.dest)} || exit 1
if [[ -x ./sleepmag ]]; then
  exec ./sleepmag "$@"
elif [[ -f ${shellQuote(cli)} ]]; then
  exec node ${shellQuote(cli)} "$@"
else
  echo "Sleep Network launcher not found in ${opts.dest}"
  read -r -p "Press Enter to close…"
  exit 1
fi
`;

  if (opts.dryRun) {
    return {
      kind: 'command',
      path: commandPath,
      hint: "Installed. Double-click 'Sleep Network.command' on your Desktop (or run it from Terminal).",
    };
  }

  try {
    fs.mkdirSync(desktop, { recursive: true });
    fs.writeFileSync(commandPath, script, { encoding: 'utf8', mode: 0o755 });
    fs.chmodSync(commandPath, 0o755);
    // Clear quarantine if present so double-click works
    run('xattr', ['-d', 'com.apple.quarantine', commandPath], { timeout: 5_000 });
    ok(`desktop launcher: ${commandPath}`);
  } catch (e) {
    say(`macOS launcher: ${e.message || e}`);
  }

  // Also drop a convenience alias in /usr/local/bin if writable — skip; Desktop is enough.
  return {
    kind: 'command',
    path: pathExists(commandPath) ? commandPath : null,
    hint: "Installed. Double-click 'Sleep Network.command' on your Desktop (right-click → Open the first time if macOS blocks it).",
  };
}

function ensureLinuxDesktopEntry(opts) {
  const info = platformInfo();
  const apps = joinPath(info.home, '.local', 'share', 'applications');
  const desktopFile = joinPath(apps, 'sleep-network.desktop');
  const cli = joinPath(opts.dest, 'tools', 'sleepmag', 'cli.mjs');
  const body = `[Desktop Entry]
Type=Application
Name=Sleep Network
Comment=Sleep Network workspace
Exec=node ${cli}
Path=${opts.dest}
Terminal=true
Categories=Development;
`;

  if (opts.dryRun) {
    return {
      kind: 'desktop',
      path: desktopFile,
      hint: `Installed. Launch via ${desktopFile} or: node ${cli}`,
    };
  }

  try {
    fs.mkdirSync(apps, { recursive: true });
    fs.writeFileSync(desktopFile, body, 'utf8');
    // Copy to Desktop if it exists
    const desk = desktopDir(info);
    if (pathExists(desk)) {
      fs.copyFileSync(desktopFile, joinPath(desk, 'Sleep Network.desktop'));
    }
    ok(`launcher entry: ${desktopFile}`);
  } catch (e) {
    say(`Linux launcher: ${e.message || e}`);
  }

  return {
    kind: 'desktop',
    path: desktopFile,
    hint: `Installed. Run: node ${cli}   (or use the Sleep Network app entry if your desktop picked it up)`,
  };
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Human-facing "what done looks like" blurb per OS (for docs/tests).
 */
export function doneLooksLike(platform = process.platform) {
  if (platform === 'win32') {
    return {
      shortcut: 'Desktop / Sleep Network.lnk',
      action: "Double-click the Sleep Network icon on your desktop",
    };
  }
  if (platform === 'darwin') {
    return {
      shortcut: 'Desktop / Sleep Network.command',
      action:
        "Double-click Sleep Network.command on your Desktop (right-click → Open the first time if Gatekeeper warns)",
    };
  }
  return {
    shortcut: '~/.local/share/applications/sleep-network.desktop',
    action: 'Use the Sleep Network app entry, or run node ~/Documents/sleep-network/tools/sleepmag/cli.mjs',
  };
}
