/**
 * Desktop launcher / shortcut, and opening it afterwards.
 *
 * Two things this file is strict about, because both used to fail silently:
 *   - the ICON: we resolve a real .ico that lives inside the workspace (so it
 *     survives TEMP cleanup), set it, then read the shortcut back to confirm.
 *   - OPENING: we do not print "opening now" unless a process actually started
 *     and was still alive a moment later.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { joinPath, pathExists, platformInfo } from './platform.js';
import { run } from './exec.js';
import { say, ok } from './say.js';
import { desktopFolders, removeShortcuts, findShortcuts } from './cleanup.js';

const LAUNCHER_NAME = 'Sleep Network Launcher';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_ICO = path.join(__dirname, '..', 'assets', 'sleepmag-logo.ico');
const ICON_PNG = path.join(__dirname, '..', 'assets', 'sleepmag-icon.png');
/** The workspace ships its own icon; preferring it means the .lnk never points into TEMP. */
const WORKSPACE_ICON_NAME = 'Sleep Network Launcher.ico';
/** The workspace's own launcher: opens the browser UI. sleepmag.cmd is only the bare CLI. */
const WORKSPACE_LAUNCHER_CMD = 'Sleep Network Launcher.cmd';
const LAUNCHER_ENTRY = ['tools', 'sleepmag', 'launcher', 'run.mjs'];

/**
 * What the desktop icon should start.
 *
 * The workspace ships "Sleep Network Launcher.cmd", which opens the launcher
 * window. Pointing the shortcut at sleepmag.cmd instead only dumps CLI help,
 * which is what made the icon look broken even when it worked.
 *
 * @param {{ dest: string, dryRun?: boolean }} opts
 * @returns {string}
 */
export function resolveLauncherTarget(opts) {
  const shipped = joinPath(opts.dest, WORKSPACE_LAUNCHER_CMD);
  if (pathExists(shipped)) {
    try {
      if (fs.statSync(shipped).size > 20) return shipped;
    } catch {
      /* fall through to the stub */
    }
  }
  say(`${shipped} not found — falling back to sleepmag.cmd`);
  return ensureSleepmagCmd(opts.dest, opts);
}

/**
 * The posix equivalent: the launcher entry point, or the CLI if it is missing.
 * @param {string} dest
 */
export function resolvePosixEntry(dest) {
  const launcher = joinPath(dest, ...LAUNCHER_ENTRY);
  if (pathExists(launcher)) return launcher;
  return joinPath(dest, 'tools', 'sleepmag', 'cli.mjs');
}

/**
 * @param {{ dest: string, dryRun?: boolean, replaceExisting?: boolean }} opts
 * @returns {{ kind: string, path: string|null, hint: string, target?: string|null, icon?: object, shortcuts?: string[] }}
 */
export function ensureLauncher(opts) {
  const info = platformInfo();
  if (info.isWin) return ensureWindowsShortcut(opts);
  if (info.isMac) return ensureMacLauncher(opts);
  return ensureLinuxDesktopEntry(opts);
}

/**
 * Find an icon file that will still exist tomorrow, and report honestly when
 * there is none. Order: the workspace's own .ico, then a copy of ours placed
 * inside the workspace, then (last resort) the installer's own asset.
 *
 * @param {{ dest: string, dryRun?: boolean }} opts
 * @returns {{ path: string|null, source: string, ok: boolean, error?: string }}
 */
export function resolveIcon(opts) {
  const shipped = joinPath(opts.dest, WORKSPACE_ICON_NAME);
  if (isUsableIcon(shipped)) {
    return { path: shipped, source: 'workspace', ok: true };
  }

  if (!isUsableIcon(ICON_ICO)) {
    return {
      path: null,
      source: 'none',
      ok: false,
      error: `no icon file available (looked for ${shipped} and ${ICON_ICO})`,
    };
  }

  if (opts.dryRun) return { path: shipped, source: 'copy', ok: true };

  try {
    fs.mkdirSync(opts.dest, { recursive: true });
    fs.copyFileSync(ICON_ICO, shipped);
  } catch (e) {
    return {
      path: ICON_ICO,
      source: 'installer',
      ok: true,
      error: `could not copy the icon into the workspace (${e.message || e}); using ${ICON_ICO}, which may be cleaned up later`,
    };
  }

  if (!isUsableIcon(shipped)) {
    return {
      path: ICON_ICO,
      source: 'installer',
      ok: true,
      error: `icon copy at ${shipped} is empty; using ${ICON_ICO}`,
    };
  }
  return { path: shipped, source: 'copy', ok: true };
}

/** A zero-byte .ico is why a shortcut shows the blank-page icon. */
export function isUsableIcon(p) {
  if (!p || !pathExists(p)) return false;
  try {
    return fs.statSync(p).size > 100;
  } catch {
    return false;
  }
}

/**
 * Read a .lnk back and say what it really points at.
 * @param {string} lnkPath
 * @returns {{ ok: boolean, target: string, icon: string, error?: string }}
 */
export function readShortcut(lnkPath) {
  const ps = `
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut(${JSON.stringify(lnkPath)})
Write-Output ("TARGET=" + $sc.TargetPath)
Write-Output ("ICON=" + $sc.IconLocation)
`;
  const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    timeout: 20_000,
  });
  if (r.code !== 0) return { ok: false, target: '', icon: '', error: `exit ${r.code}` };
  const text = String(r.stdout || '');
  const target = (text.match(/TARGET=(.*)/) || [])[1]?.trim() || '';
  const icon = (text.match(/ICON=(.*)/) || [])[1]?.trim() || '';
  return { ok: true, target, icon };
}

/**
 * Windows caches shortcut icons; a fresh profile often shows the generic one
 * until the cache is poked. Best effort, never fatal.
 */
function refreshIconCache() {
  run('ie4uinit.exe', ['-show'], { timeout: 15_000 });
  run('ie4uinit.exe', ['-ClearIconCache'], { timeout: 15_000 });
}

/**
 * Always create sleepmag.cmd so shortcuts work even after soft-continue setup.
 */
export function ensureSleepmagCmd(dest, opts = {}) {
  const cmdPath = joinPath(dest, 'sleepmag.cmd');
  if (pathExists(cmdPath)) {
    let size = 0;
    try {
      size = fs.statSync(cmdPath).size;
    } catch {
      size = 0;
    }
    if (size > 20) return cmdPath;
    say(`${cmdPath} was empty — rewriting it`);
  }
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

function desktopDir(info) {
  const home = info.home;
  if (info.isWin) {
    return process.env.USERPROFILE
      ? joinPath(process.env.USERPROFILE, 'Desktop')
      : joinPath(home, 'Desktop');
  }
  return joinPath(home, 'Desktop');
}

function ensureWindowsShortcut(opts) {
  const info = platformInfo();
  const desks = desktopFolders();
  // Always leave sleepmag.cmd behind (PATH / scripts rely on it), but point the
  // icon at the launcher window.
  ensureSleepmagCmd(opts.dest, opts);
  const target = resolveLauncherTarget(opts);
  const icon = resolveIcon(opts);
  if (icon.error) say(`icon: ${icon.error}`);

  const hint = `Installed. Double-click '${LAUNCHER_NAME}' on your desktop.`;

  if (opts.dryRun) {
    const link = joinPath(desks[0] || desktopDir(info), `${LAUNCHER_NAME}.lnk`);
    return { kind: 'lnk', path: link, target, hint, icon, shortcuts: [link] };
  }

  if (!desks.length) {
    say(
      'No Desktop folder was found (checked Known Folder Desktop, OneDrive Desktop, and %USERPROFILE%\\Desktop).',
    );
    say(`Or run: ${target}`);
    return {
      kind: 'none',
      path: null,
      target,
      icon,
      shortcuts: [],
      hint: `Installed. Run ${target} to start Sleep Network.`,
    };
  }

  // Any shortcut of ours still lying around points at the old install: drop it.
  if (opts.replaceExisting !== false) {
    const stale = findShortcuts({ withTargets: true }).filter(
      (s) => s.path.toLowerCase().endsWith('.lnk'),
    );
    if (stale.length) {
      const r = removeShortcuts(stale);
      for (const p of r.removed) say(`replaced old shortcut: ${p}`);
    }
  }

  const created = [];
  const errors = [];

  for (const desk of desks) {
    const lnkPath = joinPath(desk, `${LAUNCHER_NAME}.lnk`);
    const iconLine = icon.path ? `$sc.IconLocation = ${JSON.stringify(icon.path + ',0')}` : '';
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
      const back = readShortcut(lnkPath);
      if (back.ok && icon.path && !back.icon) {
        say(`shortcut created but Windows did not keep the icon: ${lnkPath}`);
      } else if (back.ok && icon.path) {
        ok(`shortcut: ${lnkPath} (icon: ${icon.path})`);
      } else {
        ok(`shortcut: ${lnkPath}`);
      }
      created.push(lnkPath);
    } else {
      errors.push(`${desk}: exit ${r.code}`);
      say(`could not create shortcut on ${desk}`);
    }
  }

  if (created.length) {
    refreshIconCache();
    for (const lnk of created) say(`Shortcut: ${lnk}`);
    say(`Or run: ${target}`);
    return { kind: 'lnk', path: created[0], target, hint, icon, shortcuts: created };
  }

  for (const e of errors) say(`shortcut error: ${e}`);
  say('Workspace is installed, but no desktop shortcut was created');
  say(`Or run: ${target}`);
  return {
    kind: 'none',
    path: null,
    target,
    icon,
    shortcuts: [],
    hint: `Installed. Run ${target} to start Sleep Network.`,
  };
}

/**
 * Open the installed launcher and PROVE it started.
 *
 * Windows: Start-Process -PassThru, then check the process is still alive.
 * macOS/Linux: the opener's exit code.
 *
 * @param {{ path?: string|null, target?: string|null, kind?: string }} launcher
 * @param {{ dryRun?: boolean, dest?: string, waitMs?: number }} [opts]
 * @returns {{ opened: boolean, evidence: string, openedPath?: string, howTo: string }}
 */
export function openInstalled(launcher, opts = {}) {
  const fallbackPath = launcher?.target || launcher?.path || '';
  const howTo = fallbackPath
    ? `Double-click '${LAUNCHER_NAME}' on your desktop, or run ${fallbackPath}`
    : `Double-click '${LAUNCHER_NAME}' on your desktop`;

  if (opts.dryRun) {
    say('[dry-run] would open Sleep Network Launcher');
    return { opened: false, evidence: 'dry-run', howTo };
  }

  // Prefer the shortcut (it proves the shortcut itself works); fall back to the stub.
  const candidates = [launcher?.path, launcher?.target].filter(
    (p) => p && pathExists(p),
  );
  if (!candidates.length) {
    say('could not open the launcher automatically: nothing to open');
    return { opened: false, evidence: 'no launcher file on disk', howTo };
  }

  for (const openPath of candidates) {
    const res = launchAndVerify(openPath, opts);
    if (res.opened) {
      ok(`opened ${LAUNCHER_NAME} (${res.evidence})`);
      return { ...res, openedPath: openPath, howTo };
    }
    say(`could not start ${openPath}: ${res.evidence}`);
  }

  return { opened: false, evidence: 'every launch attempt failed', howTo };
}

/**
 * Start one file and wait long enough to know whether it survived.
 * @param {string} openPath
 * @param {{ dest?: string, waitMs?: number }} opts
 * @returns {{ opened: boolean, evidence: string }}
 */
function launchAndVerify(openPath, opts = {}) {
  const waitMs = opts.waitMs ?? 2500;

  if (process.platform === 'win32') {
    const workDir = opts.dest || path.dirname(openPath);
    const ps = `
$ErrorActionPreference = 'Stop'
try {
  $p = Start-Process -FilePath ${JSON.stringify(openPath)} -WorkingDirectory ${JSON.stringify(workDir)} -PassThru
} catch {
  Write-Output ("FAILED=" + $_.Exception.Message)
  exit 0
}
if (-not $p) { Write-Output 'FAILED=no process returned'; exit 0 }
Start-Sleep -Milliseconds ${Math.max(300, waitMs)}
if ($p.HasExited) { Write-Output ("EXITED=" + $p.ExitCode) } else { Write-Output ("ALIVE=" + $p.Id) }
`;
    const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: Math.max(30_000, waitMs + 20_000),
    });
    const out = String(r.stdout || '').trim();
    const alive = out.match(/ALIVE=(\d+)/);
    if (alive) return { opened: true, evidence: `process ${alive[1]} running` };
    const exited = out.match(/EXITED=(-?\d+)/);
    if (exited) {
      // A launcher that exits instantly did not really open for the user.
      return exited[1] === '0'
        ? { opened: true, evidence: 'process finished immediately with success' }
        : { opened: false, evidence: `process exited with code ${exited[1]}` };
    }
    const failed = out.match(/FAILED=(.*)/);
    return { opened: false, evidence: failed ? failed[1] : `powershell exit ${r.code}` };
  }

  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    const r = run(cmd, [openPath], { timeout: 20_000 });
    if (r.code === 0) return { opened: true, evidence: `${cmd} accepted it` };
    return { opened: false, evidence: `${cmd} exit ${r.code}` };
  } catch (e) {
    return { opened: false, evidence: e.message || String(e) };
  }
}

function ensureMacLauncher(opts) {
  const info = platformInfo();
  const desktop = desktopDir(info);
  const commandPath = joinPath(desktop, `${LAUNCHER_NAME}.command`);
  const cli = resolvePosixEntry(opts.dest);

  const script = `#!/bin/bash
cd ${shellQuote(opts.dest)} || exit 1
if [[ -f ${shellQuote(cli)} ]]; then
  exec node ${shellQuote(cli)} "$@"
elif [[ -x ./sleepmag ]]; then
  exec ./sleepmag "$@"
else
  echo "Sleep Network Launcher not found in ${opts.dest}"
  read -r -p "Press Enter to close…"
  exit 1
fi
`;

  const hint = `Installed. Double-click '${LAUNCHER_NAME}.command' on your Desktop (right-click → Open the first time if macOS blocks it).`;

  if (opts.dryRun) {
    return { kind: 'command', path: commandPath, target: cli, hint, shortcuts: [commandPath] };
  }

  if (opts.replaceExisting !== false) {
    const stale = findShortcuts({ withTargets: false }).filter((s) =>
      s.path.toLowerCase().endsWith('.command'),
    );
    const r = removeShortcuts(stale);
    for (const p of r.removed) say(`replaced old launcher: ${p}`);
  }

  try {
    fs.mkdirSync(desktop, { recursive: true });
    fs.writeFileSync(commandPath, script, { encoding: 'utf8', mode: 0o755 });
    fs.chmodSync(commandPath, 0o755);
    run('xattr', ['-d', 'com.apple.quarantine', commandPath], { timeout: 5_000 });
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
    shortcuts: pathExists(commandPath) ? [commandPath] : [],
  };
}

function trySetMacIcon(filePath, pngPath) {
  const tmpIcns = joinPath(platformInfo().temp, 'sleepnet-launcher.icns');
  const tmpIconset = joinPath(platformInfo().temp, 'sleepnet-launcher.iconset');
  run('mkdir', ['-p', tmpIconset], { timeout: 5_000 });
  run('sips', ['-z', '128', '128', pngPath, '--out', joinPath(tmpIconset, 'icon_128x128.png')], {
    timeout: 15_000,
  });
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
  const cli = resolvePosixEntry(opts.dest);
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
      shortcuts: [desktopFile],
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
    shortcuts: [desktopFile],
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

export { LAUNCHER_NAME, WORKSPACE_ICON_NAME };
