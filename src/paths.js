/**
 * Robust Documents + workspace path resolution.
 *
 * Handles:
 * - Spaces and non-ASCII folder names (e.g. "Pièces jointes")
 * - Windows OneDrive Known Folder redirection
 * - macOS iCloud Desktop & Documents
 * - Linux xdg-user-dir DOCUMENTS
 *
 * Prefer OS APIs over naive ~/Documents when available.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { joinPath, pathExists, platformInfo } from './platform.js';

const WORKSPACE_NAME = 'sleep-network';

/**
 * Resolve the user's Documents directory for the current OS.
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, home?: string }} [opts]
 * @returns {string}
 */
export function resolveDocumentsDir(opts = {}) {
  const info = platformInfo(opts.platform || process.platform, opts.env || process.env);
  const home = opts.home || info.home;

  if (info.isWin) {
    return resolveWindowsDocuments(home, opts.env || process.env);
  }
  if (info.isMac) {
    return resolveMacDocuments(home);
  }
  return resolveLinuxDocuments(home, opts.env || process.env);
}

/**
 * Full path to the sleep-network workspace under Documents.
 */
export function resolveWorkspaceDir(opts = {}) {
  return joinPath(resolveDocumentsDir(opts), WORKSPACE_NAME);
}

function resolveWindowsDocuments(home, env) {
  // 1) PowerShell Known Folder API (follows OneDrive redirects correctly)
  const fromPs = tryExec(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Environment]::GetFolderPath('MyDocuments')",
    ],
    { timeout: 15_000 },
  );
  if (fromPs && looksLikeDir(fromPs)) return normalizePath(fromPs);

  // 2) Common OneDrive redirects
  const userProfile = env.USERPROFILE || home;
  const oneDriveCandidates = [
    env.OneDrive,
    env.OneDriveConsumer,
    env.OneDriveCommercial,
    joinPath(userProfile, 'OneDrive'),
    joinPath(userProfile, 'OneDrive - Personal'),
  ].filter(Boolean);

  for (const root of oneDriveCandidates) {
    const docs = joinPath(root, 'Documents');
    if (pathExists(docs)) return docs;
  }

  // 3) Classic path
  const classic = joinPath(userProfile, 'Documents');
  if (pathExists(classic)) return classic;

  // 4) Fall back to creating classic under profile
  return classic;
}

function resolveMacDocuments(home) {
  const classic = joinPath(home, 'Documents');

  // iCloud Desktop & Documents: ~/Documents may be a symlink into Mobile Documents
  try {
    const real = fs.realpathSync(classic);
    if (real) return real;
  } catch {
    /* ignore */
  }

  const iCloud = joinPath(
    home,
    'Library',
    'Mobile Documents',
    'com~apple~CloudDocs',
    'Documents',
  );
  if (pathExists(iCloud)) {
    // Prefer classic if it exists (even as symlink); else iCloud path
    if (pathExists(classic)) return classic;
    return iCloud;
  }

  return classic;
}

function resolveLinuxDocuments(home, env) {
  // xdg-user-dir respects translated names (Documents / Documents / Pièces jointes, etc.)
  const xdg = tryExec('xdg-user-dir', ['DOCUMENTS'], { timeout: 5_000 });
  if (xdg && looksLikeDir(xdg) && xdg !== joinPath(home, 'Desktop')) {
    return normalizePath(xdg);
  }

  if (env.XDG_DOCUMENTS_DIR && looksLikeDir(env.XDG_DOCUMENTS_DIR)) {
    return normalizePath(env.XDG_DOCUMENTS_DIR);
  }

  const classic = joinPath(home, 'Documents');
  if (pathExists(classic)) return classic;

  // Some locales use a translated folder; scan home for a writable Documents-like dir
  // Prefer creating ~/Documents for predictability.
  return classic;
}

function tryExec(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: opts.timeout || 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    return String(out || '').trim();
  } catch {
    return null;
  }
}

function looksLikeDir(p) {
  if (!p || p.length < 2) return false;
  // Reject obvious garbage / multi-line
  if (/\r|\n/.test(p)) return false;
  return true;
}

function normalizePath(p) {
  // Strip wrapping quotes PowerShell sometimes adds; keep unicode intact
  let s = p.trim().replace(/^['"]|['"]$/g, '');
  return path.normalize(s);
}

/**
 * Marker that workspace setup produced the Windows launcher stub.
 */
export function workspaceMarkerPath(dest, platform = process.platform) {
  if (platform === 'win32') return joinPath(dest, 'sleepmag.cmd');
  return joinPath(dest, 'tools', 'sleepmag', 'cli.mjs');
}

/**
 * Pure helper for tests: pick best Documents candidate from a list of existing paths.
 * @param {string[]} existingPaths — paths that "exist"
 * @param {{ platform: string, home: string, env?: Record<string,string>, psResult?: string|null }} ctx
 */
export function pickDocumentsFromCandidates(existingPaths, ctx) {
  const set = new Set(existingPaths.map((p) => path.normalize(p)));
  const exists = (p) => set.has(path.normalize(p));
  const home = ctx.home;
  const env = ctx.env || {};

  if (ctx.platform === 'win32') {
    if (ctx.psResult && looksLikeDir(ctx.psResult)) return normalizePath(ctx.psResult);
    for (const root of [env.OneDrive, joinPath(home, 'OneDrive')].filter(Boolean)) {
      const docs = joinPath(root, 'Documents');
      if (exists(docs)) return docs;
    }
    return joinPath(home, 'Documents');
  }

  if (ctx.platform === 'darwin') {
    const classic = joinPath(home, 'Documents');
    const iCloud = joinPath(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Documents');
    if (exists(classic)) return classic;
    if (exists(iCloud)) return iCloud;
    return classic;
  }

  if (env.XDG_DOCUMENTS_DIR && exists(env.XDG_DOCUMENTS_DIR)) {
    return normalizePath(env.XDG_DOCUMENTS_DIR);
  }
  return joinPath(home, 'Documents');
}

export { WORKSPACE_NAME };
