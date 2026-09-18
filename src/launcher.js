/**
 * Desktop launcher / shortcut where the OS allows.
 * sleepmag setup usually creates one; we ensure a fallback exists.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { joinPath, pathExists, platformInfo } from './platform.js';
import { run } from './exec.js';
import { say, ok } from './say.js';

const LAUNCHER_NAME = 'Sleep Network Launcher';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_ICO = path.join(__dirname, '..', 'assets', 'sleepmag-logo.ico');
const ICON_PNG = path.join(__dirname, '..', 'assets', 'sleepmag-icon.png');

/**
 * @param {{ dest: string, dryRun?: boolean }} opts
 * @returns {{ kind: string, path: string|null, hint: string, target?: string|null }}
 */
export function ensureLauncher(opts) {
  const info = platformInfo();
  if (info.isWin) return ensureWindowsShortcut(opts);
  if (info.isMac) return ensureMacLauncher(opts);
  return ensureLinuxDesktopEntry(opts);
}

/**
 * Open the installed launcher (or workspace target) after a successful install.
 * @param {{ path?: string|null, target?: string|null, kind?: string }} launcher
 * @param {{ dryRun?: boolean }} [opts]
 */
export function openInstalled(launcher, opts = {}) {
  if (opts.dryRun) {
    say('[dry-run] would open Sleep Network Launcher');
    return false;
  }
  const openPath = launcher?.path || launcher?.target;
  if (!openPath || !pathExists(openPath)) {
    say('could not open launcher automatically (shortcut missing)');
    return false;
  }
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', openPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [openPath], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [openPath], { detached: true, stdio: 'ignore' }).unref();
    }
    ok(`opened ${LAUNCHER_NAME}`);
    return true;
  } catch (e) {
    say(`could not open launcher: ${e.message || e}`);
    return false;
  }
}

function desktopDir(info) {
  const home = info.home;
  if (info.isWin) {
    return process.env.USERPROFILE
      ? joinPath(process.env.USERPROFILE, 'Desktop')
      : joinPath(home, 'Desktop');
  }
  return joinPath(home, 'Desktop');
}

function getDesktopFolders(info) {
  const dirs = [];
  const add = (p) => {
    if (!p || !pathExists(p)) return;
    try {
      const real = fs.realpathSync(p);
      if (!dirs.includes(real)) dirs.push(real);
    } catch {
      if (!dirs.includes(p)) dirs.push(p);
    }
  };

  if (info.isWin) {
    const fromPs = run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[Environment]::GetFolderPath('Desktop'); [Environment]::GetFolderPath('CommonDesktopDirectory')",
      ],
      { timeout: 10_000 },
    );
    for (const line of String(fromPs.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      add(line);
    }
    for (const root of [
      process.env.OneDrive,
      process.env.OneDriveConsumer,
      process.env.OneDriveCommercial,
    ].filter(Boolean)) {
      add(joinPath(root, 'Desktop'));
    }
    add(
      process.env.USERPROFILE
        ? joinPath(process.env.USERPROFILE, 'Desktop')
        : joinPath(info.home, 'Desktop'),
    );
  } else {
    add(joinPath(info.home, 'Desktop'));
  }
  return dirs;
}

/**
 * Always create sleepmag.cmd so shortcuts work even after soft-continue setup.
 */
export function ensureSleepmagCmd(dest, opts = {}) {
  const cmdPath = joinPath(dest, 'sleepmag.cmd');
  if (pathExists(cmdPath)) return cmdPath;
  if (opts.dryRun) return cmdPath;
  const lines = [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'where node >nul 2>&1',
    'if errorlevel 1 (',
    '  echo Node.js not found on PATH. Re-run the Sleep Network installer.',
    '  pause',
    '  exit /b 1',
    ')',
    'node "tools\\sleepmag\\cli.mjs" %*',
  ];
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(cmdPath, lines.join('\r\n') + '\r\n', 'utf8');
  if (!pathExists(cmdPath)) {
    throw new Error(`Could not create launcher at ${cmdPath}`);
  }
  ok(`launcher stub: ${cmdPath}`);
  return cmdPath;
}

function ensureWindowsShortcut(opts) {
  const info = platformInfo();
  const desks = getDesktopFolders(info);
  const primaryDesk = desks[0] || desktopDir(info);
  const link = joinPath(primaryDesk, `${LAUNCHER_NAME}.lnk`);
  const target = ensureSleepmagCmd(opts.dest, opts);

  // Prefer an icon copied into the workspace so the shortcut survives TEMP cleanup
  let icon = null;
  if (pathExists(ICON_ICO)) {
    try {
      const destIcon = joinPath(opts.dest, 'Sleep Network Launcher.ico');
      if (!opts.dryRun) {
        fs.mkdirSync(opts.dest, { recursive: true });
        fs.copyFileSync(ICON_ICO, destIcon);
      }
      icon = destIcon;
    } catch {
      icon = ICON_ICO;
    }
  }

  const hint = `Installed. Double-click '${LAUNCHER_NAME}' on your desktop.`;

  if (opts.dryRun) {
    return { kind: 'lnk', path: link, target, hint };
  }

  if (!desks.length) {
    say('No Desktop folder was found (checked Known Folder Desktop, OneDrive Desktop, and %USERPROFILE%\\Desktop).');
    say(`Or run: ${target}`);
    return { kind: 'none', path: null, target, hint: `Installed. Run ${target} to start Sleep Network.` };
  }

  const iconLine = icon ? `$sc.IconLocation = ${JSON.stringify(icon + ',0')}` : '';
  const created = [];
  const errors = [];

  for (const desk of desks) {
    const lnkPath = joinPath(desk, `${LAUNCHER_NAME}.lnk`);
    const legacyLink = joinPath(desk, 'Sleep Network.lnk');
    if (pathExists(legacyLink) && !pathExists(lnkPath)) {
      try {
        fs.renameSync(legacyLink, lnkPath);
      } catch {
        try {
          fs.unlinkSync(legacyLink);
        } catch {
          /* ignore */
        }
      }
    }

    const ps = `
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut(${JSON.stringify(lnkPath)})
$sc.TargetPath = ${JSON.stringify(target)}
$sc.WorkingDirectory = ${JSON.stringify(opts.dest)}
$sc.Description = ${JSON.stringify(LAUNCHER_NAME)}
${iconLine}
$sc.Save()
`;
    const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    if (r.code === 0 && pathExists(lnkPath)) {
      created.push(lnkPath);
      ok(`shortcut: ${lnkPath}`);
    } else {
      errors.push(`${desk}: exit ${r.code}`);
      say(`could not create shortcut on ${desk}`);
    }
  }

  if (created.length) {
    for (const lnk of created) say(`Shortcut: ${lnk}`);
    say(`Or run: ${target}`);
    return { kind: 'lnk', path: created[0], target, hint };
  }

  for (const e of errors) say(`shortcut error: ${e}`);
  say('Workspace is installed, but no desktop shortcut was created');
  say(`Or run: ${target}`);
  return {
    kind: 'none',
    path: null,
    target,
    hint: `Installed. Run ${target} to start Sleep Network.`,
  };
}

function ensureMacLauncher(opts) {
  const info = platformInfo();
  const desktop = desktopDir(info);
  const commandPath = joinPath(desktop, `${LAUNCHER_NAME}.command`);
  const legacyPath = joinPath(desktop, 'Sleep Network.command');
  const cli = joinPath(opts.dest, 'tools', 'sleepmag', 'cli.mjs');

  const script = `#!/bin/bash
cd ${shellQuote(opts.dest)} || exit 1
if [[ -x ./sleepmag ]]; then
  exec ./sleepmag "$@"
elif [[ -f ${shellQuote(cli)} ]]; then
  exec node ${shellQuote(cli)} "$@"
else
  echo "Sleep Network Launcher not found in ${opts.dest}"
  read -r -p "Press Enter to close…"
  exit 1
fi
`;

  const hint = `Installed. Double-click '${LAUNCHER_NAME}.command' on your Desktop (right-click → Open the first time if macOS blocks it).`;

  if (opts.dryRun) {
    return { kind: 'command', path: commandPath, target: cli, hint };
  }

  try {
    fs.mkdirSync(desktop, { recursive: true });
    if (pathExists(legacyPath) && !pathExists(commandPath)) {
      try {
        fs.renameSync(legacyPath, commandPath);
      } catch {
        /* ignore */
      }
    }
    fs.writeFileSync(commandPath, script, { encoding: 'utf8', mode: 0o755 });
    fs.chmodSync(commandPath, 0o755);
    run('xattr', ['-d', 'com.apple.quarantine', commandPath], { timeout: 5_000 });
    // Best-effort custom icon via PNG (macOS file icon); ignore failures
    if (pathExists(ICON_PNG)) {
      trySetMacIcon(commandPath, ICON_PNG);
    }
    ok(`desktop launcher: ${commandPath}`);
  } catch (e) {
    say(`macOS launcher: ${e.message || e}`);
  }

  return {
    kind: 'command',
    path: pathExists(commandPath) ? commandPath : null,
    target: cli,
    hint,
  };
}

function trySetMacIcon(filePath, pngPath) {
  // Uses sips + AppleScript file icon; soft-fail on locked-down Macs
  const tmpIcns = joinPath(platformInfo().temp, 'sleepnet-launcher.icns');
  const tmpIconset = joinPath(platformInfo().temp, 'sleepnet-launcher.iconset');
  run('mkdir', ['-p', tmpIconset], { timeout: 5_000 });
  run(
    'sips',
    ['-z', '128', '128', pngPath, '--out', joinPath(tmpIconset, 'icon_128x128.png')],
    { timeout: 15_000 },
  );
  run('iconutil', ['-c', 'icns', tmpIconset, '-o', tmpIcns], { timeout: 15_000 });
  if (!pathExists(tmpIcns)) return;
  const as = `
use framework "AppKit"
set iconImage to current application's NSImage's alloc()'s initWithContentsOfFile:${JSON.stringify(tmpIcns)}
current application's NSWorkspace's sharedWorkspace()'s setIcon:iconImage forFile:${JSON.stringify(filePath)} options:0
`;
  run('osascript', ['-e', as], { timeout: 15_000 });
}

function ensureLinuxDesktopEntry(opts) {
  const info = platformInfo();
  const apps = joinPath(info.home, '.local', 'share', 'applications');
  const desktopFile = joinPath(apps, 'sleep-network-launcher.desktop');
  const cli = joinPath(opts.dest, 'tools', 'sleepmag', 'cli.mjs');
  const iconLine = pathExists(ICON_PNG) ? `Icon=${ICON_PNG}` : '';
  const body = `[Desktop Entry]
Type=Application
Name=${LAUNCHER_NAME}
Comment=Sleep Network workspace
Exec=node ${cli}
Path=${opts.dest}
Terminal=true
Categories=Development;
${iconLine}
`;

  if (opts.dryRun) {
    return {
      kind: 'desktop',
      path: desktopFile,
      target: cli,
      hint: `Installed. Launch via ${desktopFile} or: node ${cli}`,
    };
  }

  try {
    fs.mkdirSync(apps, { recursive: true });
    fs.writeFileSync(desktopFile, body, 'utf8');
    const desk = desktopDir(info);
    if (pathExists(desk)) {
      fs.copyFileSync(desktopFile, joinPath(desk, `${LAUNCHER_NAME}.desktop`));
    }
    ok(`launcher entry: ${desktopFile}`);
  } catch (e) {
    say(`Linux launcher: ${e.message || e}`);
  }

  return {
    kind: 'desktop',
    path: desktopFile,
    target: cli,
    hint: `Installed. Run: node ${cli}   (or use the ${LAUNCHER_NAME} app entry if your desktop picked it up)`,
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
      shortcut: `Desktop / ${LAUNCHER_NAME}.lnk`,
      action: `Double-click the ${LAUNCHER_NAME} icon on your desktop`,
    };
  }
  if (platform === 'darwin') {
    return {
      shortcut: `Desktop / ${LAUNCHER_NAME}.command`,
      action: `Double-click ${LAUNCHER_NAME}.command on your Desktop (right-click → Open the first time if Gatekeeper warns)`,
    };
  }
  return {
    shortcut: '~/.local/share/applications/sleep-network-launcher.desktop',
    action: `Use the ${LAUNCHER_NAME} app entry, or run node ~/Documents/sleep-network/tools/sleepmag/cli.mjs`,
  };
}

export { LAUNCHER_NAME };
