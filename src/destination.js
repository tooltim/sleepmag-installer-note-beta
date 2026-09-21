/**
 * Where the workspace goes.
 *
 * The user picks the folder. We default to a LOCAL one, because cloud-synced
 * folders (OneDrive, iCloud Drive, Dropbox, Google Drive) break a git checkout:
 * files become on-demand placeholders, .git gets locked mid-operation, and the
 * sleepmag launcher then reads half a workspace. OneDrive is the usual culprit
 * on Windows because it silently redirects the Documents known folder.
 */

import fs from 'node:fs';
import path from 'node:path';
import { platformInfo, joinPath, pathExists } from './platform.js';

export const WORKSPACE_NAME = 'sleep-network';

/** Cloud-sync roots we refuse by default, with the label we show the user. */
const CLOUD_PATTERNS = [
  { id: 'onedrive', label: 'OneDrive', re: /(^|[\\/])OneDrive([ -][^\\/]*)?([\\/]|$)/i },
  {
    id: 'icloud',
    label: 'iCloud Drive',
    re: /(^|[\\/])(Mobile Documents|com~apple~CloudDocs)([\\/]|$)/i,
  },
  { id: 'dropbox', label: 'Dropbox', re: /(^|[\\/])Dropbox([ -][^\\/]*)?([\\/]|$)/i },
  {
    id: 'gdrive',
    label: 'Google Drive',
    re: /(^|[\\/])(Google Drive|GoogleDrive|My Drive)([\\/]|$)/i,
  },
];

/** Folders nobody should clone a workspace into. */
const FORBIDDEN_WIN = [
  /^[a-z]:[\\/]?$/i,
  /^[a-z]:[\\/]windows([\\/]|$)/i,
  /^[a-z]:[\\/]program files( \(x86\))?([\\/]|$)/i,
  /^[a-z]:[\\/]programdata([\\/]|$)/i,
];
const FORBIDDEN_POSIX = [
  /^\/$/,
  /^\/(etc|bin|sbin|usr|var|boot|dev|proc|sys|System|Library)([\\/]|$)/,
];

/**
 * Which cloud service (if any) syncs this path.
 * @param {string} p
 * @param {{ env?: Record<string, string|undefined> }} [ctx]
 * @returns {{ id: string, label: string } | null}
 */
export function detectCloudSync(p, ctx = {}) {
  if (!p) return null;
  const s = String(p);
  const env = ctx.env || {};

  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const root = env[key];
    if (root && isInside(root, s)) return { id: 'onedrive', label: 'OneDrive' };
  }
  for (const pat of CLOUD_PATTERNS) {
    if (pat.re.test(s)) return { id: pat.id, label: pat.label };
  }
  return null;
}

/** True when `child` is the same as, or below, `parent`. */
export function isInside(parent, child) {
  if (!parent || !child) return false;
  const norm = (v) => path.resolve(String(v)).replace(/[\\/]+$/, '').toLowerCase();
  const a = norm(parent);
  const b = norm(child);
  if (a === b) return true;
  return b.startsWith(a + path.sep.toLowerCase()) || b.startsWith(a + '/') || b.startsWith(a + '\\');
}

/**
 * The destination choices we offer, best first.
 * Pure: pass in the resolved Documents folder so this stays testable.
 *
 * @param {{ platform?: string, env?: Record<string, string|undefined>, home?: string, documentsDir?: string|null }} [ctx]
 * @returns {Array<{ path: string, label: string, note: string, cloud: {id:string,label:string}|null, recommended: boolean }>}
 */
export function destinationCandidates(ctx = {}) {
  const platform = ctx.platform || process.platform;
  const env = ctx.env || process.env;
  const info = platformInfo(platform, env);
  const home = ctx.home || info.home;
  const docs = ctx.documentsDir || null;

  /** @type {Array<{path:string,label:string,note:string,cloud:any,recommended:boolean}>} */
  const out = [];
  const seen = new Set();
  const push = (dir, label, note) => {
    if (!dir) return;
    const full = joinPath(dir, WORKSPACE_NAME);
    const key = path.normalize(full).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const cloud = detectCloudSync(full, { env });
    out.push({
      path: full,
      label,
      note: cloud ? `synced by ${cloud.label} — not recommended` : note,
      cloud,
      recommended: false,
    });
  };

  if (docs) push(docs, 'Documents', 'your usual Documents folder');
  if (platform === 'win32') {
    push(joinPath(home, 'Documents'), 'Local Documents', 'the real Documents folder on this PC');
  }
  push(home, 'Home folder', 'always local, never cloud-synced');

  const firstLocal = out.find((c) => !c.cloud);
  if (firstLocal) firstLocal.recommended = true;
  else if (out.length) out[0].recommended = true;

  return out;
}

/**
 * The folder we pre-fill in the form: the first candidate that is not cloud-synced.
 * @param {Parameters<typeof destinationCandidates>[0]} [ctx]
 * @returns {string}
 */
export function defaultDestination(ctx = {}) {
  const candidates = destinationCandidates(ctx);
  const local = candidates.find((c) => !c.cloud);
  if (local) return local.path;
  if (candidates.length) return candidates[0].path;
  const info = platformInfo(ctx.platform || process.platform, ctx.env || process.env);
  return joinPath(ctx.home || info.home, WORKSPACE_NAME);
}

/**
 * Turn whatever the user typed into a full workspace path.
 * A folder that is not already called sleep-network gets sleep-network appended,
 * so "C:\Users\ina\Documents" never becomes the workspace itself.
 *
 * @param {string} input
 * @param {{ home?: string, platform?: string, env?: Record<string, string|undefined> }} [ctx]
 * @returns {string}
 */
export function normalizeDestination(input, ctx = {}) {
  const platform = ctx.platform || process.platform;
  const env = ctx.env || process.env;
  const info = platformInfo(platform, env);
  const home = ctx.home || info.home;

  let s = String(input || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!s) return '';
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) {
    s = joinPath(home, s.slice(1));
  }
  s = s.replace(/[\\/]+$/, '');
  if (!s) return '';

  const base = path.basename(s);
  if (base.toLowerCase() !== WORKSPACE_NAME) {
    s = joinPath(s, WORKSPACE_NAME);
  }
  return path.normalize(s);
}

/**
 * Is this path one we refuse outright (drive root, system folder)?
 * @param {string} p
 * @param {string} [platform]
 */
export function isForbiddenLocation(p, platform = process.platform) {
  const raw = String(p || '').trim();
  if (!raw) return false;

  // Do the splitting by hand: a Windows path must still be judged correctly
  // when the check runs on Linux (CI), where path.dirname ignores backslashes.
  if (platform === 'win32') {
    const s = raw.replace(/\//g, '\\').replace(/\\+$/, '');
    const cut = s.lastIndexOf('\\');
    const parent = cut > 0 ? s.slice(0, cut + 1) : s;
    return FORBIDDEN_WIN.some((re) => re.test(s) || re.test(parent));
  }

  const s = raw.replace(/\/+$/, '') || '/';
  const cut = s.lastIndexOf('/');
  const parent = cut > 0 ? s.slice(0, cut) : '/';
  return FORBIDDEN_POSIX.some((re) => re.test(s) || re.test(parent));
}

/**
 * Full check of a chosen destination.
 * Pure decisions; the only I/O is an optional writability probe.
 *
 * @param {string|null} input — what the user typed (or null for the default)
 * @param {{
 *   env?: Record<string, string|undefined>,
 *   platform?: string,
 *   home?: string,
 *   documentsDir?: string|null,
 *   allowCloud?: boolean,
 *   probe?: boolean,
 * }} [ctx]
 * @returns {{ ok: boolean, dest: string, cloud: {id:string,label:string}|null, errors: string[], warnings: string[] }}
 */
export function validateDestination(input, ctx = {}) {
  const platform = ctx.platform || process.platform;
  const env = ctx.env || process.env;
  const errors = [];
  const warnings = [];

  const dest = input
    ? normalizeDestination(input, { ...ctx, platform, env })
    : defaultDestination({ ...ctx, platform, env });

  if (!dest) {
    return {
      ok: false,
      dest: '',
      cloud: null,
      errors: ['Choose a folder for the workspace.'],
      warnings,
    };
  }
  if (!path.isAbsolute(dest)) {
    errors.push(
      `Use a full path, like ${platform === 'win32' ? 'C:\\Users\\you\\sleep-network' : '/Users/you/sleep-network'}.`,
    );
  }
  if (isForbiddenLocation(dest, platform)) {
    errors.push('That is a system folder. Pick somewhere under your own user folder.');
  }

  const cloud = detectCloudSync(dest, { env });
  if (cloud && !ctx.allowCloud) {
    errors.push(
      `${cloud.label} breaks the workspace: it turns files into placeholders and locks .git while syncing. Pick a local folder instead.`,
    );
  } else if (cloud) {
    warnings.push(
      `${cloud.label} syncs this folder. Git may fail or hang; you chose to continue anyway.`,
    );
  }

  if (!errors.length && ctx.probe !== false) {
    const probe = probeWritable(dest);
    if (!probe.ok) errors.push(probe.error);
  }

  return { ok: errors.length === 0, dest, cloud, errors, warnings };
}

/**
 * Can we create the workspace here? Walks up to the nearest folder that exists
 * and tries a real write, because "looks fine" is how the old installer lied.
 * @param {string} dest
 * @returns {{ ok: boolean, error?: string }}
 */
export function probeWritable(dest) {
  let dir = path.resolve(dest);
  const root = path.parse(dir).root;
  while (!pathExists(dir) && dir !== root) {
    dir = path.dirname(dir);
  }
  if (!pathExists(dir)) {
    return { ok: false, error: `Cannot reach ${dir}. Is the drive connected?` };
  }
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) {
      return { ok: false, error: `${dir} is a file, not a folder.` };
    }
  } catch (e) {
    return { ok: false, error: `Cannot read ${dir}: ${e.message || e}` };
  }
  const probe = path.join(dir, `.sleepnet-write-test-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `No permission to write in ${dir} (${e.code || e.message || e}). Pick another folder.`,
    };
  }
}
