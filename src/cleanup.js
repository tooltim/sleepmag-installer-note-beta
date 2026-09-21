/**
 * Get rid of what a previous install left behind.
 *
 * Two jobs, both of which the installer used to skip:
 *   - stale desktop / Start Menu shortcuts, including ones pointing at a
 *     workspace that no longer exists (the "dead icon" everybody ends up with)
 *   - the previous workspace folder itself, when the user installs elsewhere
 *
 * Deleting a folder is guarded hard: it must be named sleep-network, sit under
 * a user folder, and actually look like a workspace. Anything else is refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { joinPath, pathExists, platformInfo } from './platform.js';
import { run } from './exec.js';
import { say, ok } from './say.js';
import { isForbiddenLocation, WORKSPACE_NAME } from './destination.js';

/** Shortcut basenames we own and may delete. */
const SHORTCUT_NAMES = [
  /^Sleep Network Launcher\.(lnk|command|desktop)$/i,
  /^Sleep Network\.(lnk|command|desktop)$/i,
  /^Sleep Magazine\.(lnk|command|desktop)$/i,
  /^sleep-network-launcher\.desktop$/i,
];

/**
 * Every folder a desktop icon of ours could live in.
 * @param {{ env?: Record<string, string|undefined>, platform?: string }} [ctx]
 * @returns {string[]}
 */
export function desktopFolders(ctx = {}) {
  const env = ctx.env || process.env;
  const platform = ctx.platform || process.platform;
  const info = platformInfo(platform, env);
  const dirs = [];
  const add = (p) => {
    if (!p || !pathExists(p)) return;
    let real = p;
    try {
      real = fs.realpathSync(p);
    } catch {
      /* keep the original */
    }
    if (!dirs.some((d) => d.toLowerCase() === real.toLowerCase())) dirs.push(real);
  };

  if (platform === 'win32') {
    const r = run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[Environment]::GetFolderPath('Desktop'); [Environment]::GetFolderPath('CommonDesktopDirectory')",
      ],
      { timeout: 10_000 },
    );
    for (const line of String(r.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      add(line);
    }
    for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
      if (env[key]) add(joinPath(env[key], 'Desktop'));
    }
    add(env.USERPROFILE ? joinPath(env.USERPROFILE, 'Desktop') : joinPath(info.home, 'Desktop'));
  } else {
    add(joinPath(info.home, 'Desktop'));
  }
  return dirs;
}

/**
 * Start Menu / application-entry folders where we may also have written one.
 * @param {{ env?: Record<string, string|undefined>, platform?: string }} [ctx]
 */
export function menuFolders(ctx = {}) {
  const env = ctx.env || process.env;
  const platform = ctx.platform || process.platform;
  const info = platformInfo(platform, env);
  const dirs = [];
  const add = (p) => {
    if (p && pathExists(p) && !dirs.includes(p)) dirs.push(p);
  };
  if (platform === 'win32') {
    if (env.APPDATA) add(joinPath(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  } else if (platform === 'linux') {
    add(joinPath(info.home, '.local', 'share', 'applications'));
  }
  return dirs;
}

/**
 * Is this basename one of ours?
 * @param {string} name
 */
export function isOurShortcutName(name) {
  return SHORTCUT_NAMES.some((re) => re.test(String(name || '')));
}

/**
 * Where does a Windows .lnk point? Empty string when it cannot be read.
 * @param {string} lnkPath
 */
export function shortcutTarget(lnkPath) {
  if (process.platform !== 'win32' || !lnkPath.toLowerCase().endsWith('.lnk')) return '';
  const ps = `$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut(${JSON.stringify(
    lnkPath,
  )}); Write-Output $sc.TargetPath`;
  const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    timeout: 15_000,
  });
  return r.code === 0 ? String(r.stdout || '').trim() : '';
}

/**
 * All Sleep Network shortcuts currently on this machine.
 *
 * @param {{ env?: Record<string, string|undefined>, platform?: string, withTargets?: boolean }} [ctx]
 * @returns {Array<{ path: string, folder: string, target: string, dead: boolean }>}
 */
export function findShortcuts(ctx = {}) {
  const folders = [...desktopFolders(ctx), ...menuFolders(ctx)];
  /** @type {Array<{path:string,folder:string,target:string,dead:boolean}>} */
  const found = [];
  for (const folder of folders) {
    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !isOurShortcutName(e.name)) continue;
      const full = joinPath(folder, e.name);
      const target = ctx.withTargets === false ? '' : shortcutTarget(full);
      found.push({
        path: full,
        folder,
        target,
        dead: Boolean(target) && !pathExists(target),
      });
    }
  }
  return found;
}

/**
 * Delete shortcuts. Never touches anything that is not one of ours.
 *
 * @param {Array<{ path: string }|string>} shortcuts
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ removed: string[], failed: Array<{ path: string, error: string }> }}
 */
export function removeShortcuts(shortcuts, opts = {}) {
  const removed = [];
  const failed = [];
  for (const entry of shortcuts || []) {
    const p = typeof entry === 'string' ? entry : entry.path;
    if (!p || !isOurShortcutName(path.basename(p))) continue;
    if (opts.dryRun) {
      removed.push(p);
      continue;
    }
    try {
      if (pathExists(p)) fs.rmSync(p, { force: true });
      removed.push(p);
    } catch (e) {
      failed.push({ path: p, error: e.message || String(e) });
    }
  }
  return { removed, failed };
}

/**
 * May we delete this folder? Guards against a mistyped path wiping a home folder.
 *
 * @param {string} dest
 * @param {{ platform?: string, env?: Record<string, string|undefined> }} [ctx]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function isRemovableWorkspace(dest, ctx = {}) {
  const platform = ctx.platform || process.platform;
  const env = ctx.env || process.env;
  const info = platformInfo(platform, env);
  if (!dest) return { ok: false, reason: 'no path given' };

  // Judge the path with the rules of the platform it belongs to, not ours.
  const P = platform === 'win32' ? path.win32 : path.posix;
  const full = P.isAbsolute(String(dest)) ? P.normalize(String(dest)) : path.resolve(String(dest));
  const base = P.basename(full);
  if (base.toLowerCase() !== WORKSPACE_NAME) {
    return { ok: false, reason: `not a workspace folder name (${base})` };
  }
  if (isForbiddenLocation(full, platform)) {
    return { ok: false, reason: 'system location' };
  }
  const root = P.parse(full).root;
  if (full === root || P.dirname(full) === full) {
    return { ok: false, reason: 'drive root' };
  }
  const sameAsHome =
    info.home &&
    String(info.home).replace(/[\\/]+$/, '').toLowerCase() ===
      full.replace(/[\\/]+$/, '').toLowerCase();
  if (sameAsHome) {
    return { ok: false, reason: 'that is your home folder' };
  }
  if (!pathExists(full)) return { ok: false, reason: 'nothing there' };

  const looksLikeWorkspace = [
    joinPath(full, '.git'),
    joinPath(full, 'sleepmag.cmd'),
    joinPath(full, 'CLAUDE.md'),
    joinPath(full, 'tools', 'sleepmag'),
  ].some((p) => pathExists(p));
  if (!looksLikeWorkspace) {
    return { ok: false, reason: 'folder does not look like a Sleep Network workspace' };
  }
  return { ok: true };
}

/**
 * Remove a previous workspace folder.
 *
 * @param {string} dest
 * @param {{ dryRun?: boolean, platform?: string, env?: Record<string, string|undefined> }} [opts]
 * @returns {{ ok: boolean, removed: boolean, path: string, reason?: string }}
 */
export function removeInstall(dest, opts = {}) {
  const guard = isRemovableWorkspace(dest, opts);
  if (!guard.ok) {
    return { ok: false, removed: false, path: dest, reason: guard.reason };
  }
  if (opts.dryRun) {
    say(`[dry-run] would delete the previous workspace at ${dest}`);
    return { ok: true, removed: false, path: dest, reason: 'dry-run' };
  }
  try {
    fs.rmSync(dest, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (e) {
    return {
      ok: false,
      removed: false,
      path: dest,
      reason: `could not delete ${dest}: ${e.message || e}. Close any window or editor using it and retry.`,
    };
  }
  if (pathExists(dest)) {
    return {
      ok: false,
      removed: false,
      path: dest,
      reason: `${dest} is still there after delete — a file in it is locked by another program.`,
    };
  }
  ok(`removed previous workspace: ${dest}`);
  return { ok: true, removed: true, path: dest };
}

/**
 * The whole tidy-up before we install: drop stale shortcuts, and optionally the
 * old workspace folders that are not where we are about to install.
 *
 * @param {{
 *   keepDest: string,
 *   previous?: Array<{ dest: string }>,
 *   removePrevious?: boolean,
 *   dryRun?: boolean,
 *   env?: Record<string, string|undefined>,
 *   platform?: string,
 * }} opts
 */
export function cleanPreviousInstall(opts) {
  const keep = path.resolve(opts.keepDest || '');
  const report = {
    shortcutsRemoved: /** @type {string[]} */ ([]),
    shortcutsFailed: /** @type {Array<{path:string,error:string}>} */ ([]),
    workspacesRemoved: /** @type {string[]} */ ([]),
    workspacesSkipped: /** @type {Array<{path:string,reason:string}>} */ ([]),
  };

  const shortcuts = findShortcuts(opts);
  if (shortcuts.length) {
    say(`found ${shortcuts.length} existing Sleep Network shortcut(s); replacing them`);
    for (const s of shortcuts) {
      say(`  ${s.path}${s.target ? ` → ${s.target}` : ''}${s.dead ? ' (target missing)' : ''}`);
    }
    const r = removeShortcuts(shortcuts, { dryRun: opts.dryRun });
    report.shortcutsRemoved = r.removed;
    report.shortcutsFailed = r.failed;
    for (const f of r.failed) say(`could not remove ${f.path}: ${f.error}`);
  }

  if (opts.removePrevious) {
    for (const prev of opts.previous || []) {
      const p = path.resolve(prev.dest || '');
      if (!p || p.toLowerCase() === keep.toLowerCase()) continue;
      const r = removeInstall(p, opts);
      if (r.removed) report.workspacesRemoved.push(p);
      else if (!r.ok) {
        report.workspacesSkipped.push({ path: p, reason: r.reason || 'refused' });
        say(`left ${p} in place: ${r.reason}`);
      }
    }
  }

  return report;
}
