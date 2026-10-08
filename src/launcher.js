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
  let howTo = fallbackPath
    ? `Double-click '${LAUNCHER_NAME}' on your desktop, or run ${fallbackPath}`
    : `Double-click '${LAUNCHER_NAME}' on your desktop`;
  // macOS without a Desktop .command: there is nothing to double-click, and the
  // launcher's hint already says how to start it.
  if (process.platform === 'darwin' && !launcher?.path && launcher?.hint) howTo = launcher.hint;

  if (opts.dryRun) {
    say('[dry-run] would open Sleep Network Launcher');
    return { opened: false, evidence: 'dry-run', howTo };
  }

  // Prefer the shortcut (it proves the shortcut itself works); fall back to the stub.
  const candidates = [launcher?.path, launcher?.target].filter(
    (p) => p && pathExists(p) && opensAsApp(p),
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
 * macOS `open` on a .mjs shows it in a text editor and still exits 0, which
 * would be reported as "opened". Only the .command really starts the launcher.
 * Other platforms are unchanged.
 * @param {string} p
 * @param {string} [platform]
 */
export function opensAsApp(p, platform = process.platform) {
  if (platform !== 'darwin') return true;
  return /\.(command|app)$/i.test(String(p));
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
  const script = macCommandScript(opts.dest, cli);

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

  try {
    const p = ensureMacShellPath({ dest: opts.dest });
    if (p.changed) ok(`sleepmag added to your PATH in ${p.file} (open a NEW Terminal window to use it)`);
    else ok('sleepmag is on your PATH');
  } catch (e) {
    say(`could not add sleepmag to PATH (${e.message || e}); run ./sleepmag from ${opts.dest} instead`);
  }

  // Writing to ~/Desktop raises macOS's "Terminal would like to access files in
  // your Desktop folder" prompt; "Don't Allow" leaves no launcher. Say so plainly
  // instead of ending on "Installed" with nothing to double-click.
  const created = pathExists(commandPath);
  const noLauncherHint =
    `Installed, but there is no Desktop launcher (macOS did not allow writing to the Desktop). ` +
    `Start it from a NEW Terminal window with:  sleepmag ui   (or: node ${shellQuote(cli)})`;
  if (!created) say(noLauncherHint);

  return {
    kind: 'command',
    path: created ? commandPath : null,
    target: cli,
    hint: created ? hint : noLauncherHint,
    shortcuts: created ? [commandPath] : [],
  };
}

/**
 * The Desktop .command file. Finder starts it in a fresh Terminal whose PATH may
 * not have Homebrew yet (no ~/.zprofile line on a Mac set up by hand), so the
 * usual install dirs go first: without them `node` is "command not found".
 * @param {string} dest
 * @param {string} entry — launcher/run.mjs, or cli.mjs when the launcher is missing
 */
export function macCommandScript(dest, entry) {
  return `#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
cd ${shellQuote(dest)} || exit 1
if [[ -f ${shellQuote(entry)} ]]; then
  exec node ${shellQuote(entry)} "$@"
elif [[ -x ./sleepmag ]]; then
  exec ./sleepmag "$@"
else
  echo "Sleep Network Launcher not found in ${dest}"
  read -r -p "Press Enter to close…"
  exit 1
fi
`;
}

/**
 * The line that puts the workspace (and so `sleepmag`) on PATH in new Terminal windows.
 * @param {string} dest
 */
export function macPathLine(dest) {
  return `export PATH=${shellQuote(dest)}:"$PATH"`;
}

/** Where native installers (Claude Code's among them) put their commands. */
export const MAC_LOCAL_BIN_LINE = 'export PATH="$HOME/.local/bin:$PATH"';

/**
 * The login profile new Terminal windows read: ~/.zprofile for zsh (the macOS
 * default). Login bash reads only the FIRST of .bash_profile / .bash_login /
 * .profile, so a bash account gets the one it already reads: creating
 * .bash_profile next to an existing .profile would switch that .profile off.
 * @param {string} home
 * @param {string} [shell]
 */
export function macProfileFile(home, shell = process.env.SHELL || '') {
  if (!/bash$/.test(shell)) return joinPath(home, '.zprofile');
  for (const f of ['.bash_profile', '.bash_login', '.profile']) {
    const p = joinPath(home, f);
    if (pathExists(p)) return p;
  }
  return joinPath(home, '.bash_profile');
}

/**
 * Windows gets the workspace on PATH from `sleepmag setup`; on a Mac nothing does,
 * so `sleepmag` would only work as ./sleepmag from inside the folder. And the
 * Claude Code installer puts `claude` in ~/.local/bin without adding it to PATH,
 * so a session Terminal opened by the launcher would not find it. Append both
 * lines to the login profile, each once.
 * @param {{ dest: string, dryRun?: boolean, home?: string, shell?: string }} opts
 * @returns {{ file: string, changed: boolean }}
 */
export function ensureMacShellPath(opts) {
  const home = opts.home || platformInfo().home;
  const file = macProfileFile(home, opts.shell);
  let current = '';
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    /* no profile yet */
  }
  const have = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = [MAC_LOCAL_BIN_LINE, macPathLine(opts.dest)].filter((l) => !have.has(l));
  if (!missing.length) return { file, changed: false };
  if (opts.dryRun) return { file, changed: true };
  const block = ['', '# Sleep Network: the sleepmag and claude commands', ...missing, ''].join('\n');
  fs.appendFileSync(file, block, 'utf8');
  return { file, changed: true };
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
