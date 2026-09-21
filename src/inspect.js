/**
 * What is ACTUALLY installed, and where.
 *
 * The old check was `existsSync(sleepmag.cmd)` — which says "present" for an
 * empty file, a half-finished clone, or a folder someone restored from a backup
 * without .git. Every check here reads the file and looks at its size and its
 * content, and every answer carries the exact path so the user can go and look.
 */

import fs from 'node:fs';
import path from 'node:path';
import { joinPath, pathExists, platformInfo } from './platform.js';
import { run } from './exec.js';
import { detectCloudSync } from './destination.js';

/** A file smaller than this is treated as empty/truncated, not as installed. */
const MIN_BYTES = {
  cli: 200,
  cmd: 20,
  head: 4,
};

/**
 * Read a file, returning null when it does not exist or cannot be read.
 * @param {string} p
 * @returns {{ size: number, text: string } | null}
 */
export function readFileInfo(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return null;
    let text = '';
    if (st.size <= 2_000_000) {
      try {
        text = fs.readFileSync(p, 'utf8');
      } catch {
        text = '';
      }
    }
    return { size: st.size, text };
  } catch {
    return null;
  }
}

/**
 * Decide install status from already-gathered facts. Pure, so it is testable
 * without a filesystem.
 *
 * @param {Array<{ id: string, label: string, required: boolean, ok: boolean, detail: string }>} checks
 * @param {boolean} exists
 * @returns {'installed'|'partial'|'none'}
 */
export function statusFromChecks(checks, exists) {
  if (!exists) return 'none';
  const required = checks.filter((c) => c.required);
  if (required.every((c) => c.ok)) return 'installed';
  if (required.every((c) => !c.ok)) return 'none';
  return 'partial';
}

/**
 * Full inspection of one candidate workspace folder.
 *
 * @param {string} dest
 * @param {{ env?: Record<string, string|undefined>, platform?: string, withGit?: boolean }} [ctx]
 */
export function inspectInstall(dest, ctx = {}) {
  const env = ctx.env || process.env;
  const platform = ctx.platform || process.platform;
  const isWin = platform === 'win32';

  const result = {
    dest,
    exists: false,
    status: /** @type {'installed'|'partial'|'none'} */ ('none'),
    checks: /** @type {Array<{id:string,label:string,required:boolean,ok:boolean,detail:string}>} */ ([]),
    problems: /** @type {string[]} */ ([]),
    git: { isRepo: false, remote: '', branch: '', commit: '' },
    cloud: detectCloudSync(dest, { env }),
    summary: '',
  };

  const add = (id, label, required, ok, detail) => {
    result.checks.push({ id, label, required, ok, detail });
    if (required && !ok) result.problems.push(`${label}: ${detail}`);
    return ok;
  };

  let dirStat = null;
  try {
    dirStat = fs.statSync(dest);
  } catch {
    dirStat = null;
  }
  result.exists = Boolean(dirStat && dirStat.isDirectory());

  if (!result.exists) {
    result.status = 'none';
    result.summary = `Not installed (nothing at ${dest})`;
    return result;
  }

  // 1. A real git checkout, not a copied folder.
  const gitDir = joinPath(dest, '.git');
  const headInfo = readFileInfo(joinPath(gitDir, 'HEAD'));
  const gitOk = pathExists(gitDir) && Boolean(headInfo) && headInfo.size >= MIN_BYTES.head;
  add(
    'git',
    'Git checkout',
    true,
    gitOk,
    gitOk ? `${gitDir}` : pathExists(gitDir) ? `${gitDir} exists but .git/HEAD is empty` : 'no .git folder — this is a copy, not a clone',
  );
  result.git.isRepo = gitOk;

  // 2. The CLI the launcher actually runs, with real content in it.
  const cliPath = joinPath(dest, 'tools', 'sleepmag', 'cli.mjs');
  const cliInfo = readFileInfo(cliPath);
  const cliOk = Boolean(cliInfo) && cliInfo.size >= MIN_BYTES.cli;
  add(
    'cli',
    'sleepmag CLI',
    true,
    cliOk,
    cliInfo
      ? cliOk
        ? `${cliPath} (${formatBytes(cliInfo.size)})`
        : `${cliPath} is only ${formatBytes(cliInfo.size)} — truncated or empty`
      : `missing ${cliPath}`,
  );

  // 3. The launcher stub the desktop shortcut points at.
  const cmdPath = joinPath(dest, 'sleepmag.cmd');
  const cmdInfo = readFileInfo(cmdPath);
  const cmdOk =
    Boolean(cmdInfo) && cmdInfo.size >= MIN_BYTES.cmd && /cli\.mjs/i.test(cmdInfo.text || '');
  add(
    'stub',
    'Launcher stub',
    isWin,
    cmdOk,
    cmdInfo
      ? cmdOk
        ? `${cmdPath} (${formatBytes(cmdInfo.size)})`
        : `${cmdPath} is empty or does not call cli.mjs`
      : `missing ${cmdPath}`,
  );

  // 4. Workspace content: the router and at least one site folder.
  const claudeMd = readFileInfo(joinPath(dest, 'CLAUDE.md'));
  add(
    'router',
    'Workspace files',
    false,
    Boolean(claudeMd) && claudeMd.size > 100,
    claudeMd ? `CLAUDE.md (${formatBytes(claudeMd.size)})` : 'CLAUDE.md missing',
  );

  const sitesDir = joinPath(dest, 'sites');
  let siteCount = 0;
  try {
    siteCount = fs
      .readdirSync(sitesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_')).length;
  } catch {
    siteCount = 0;
  }
  add(
    'sites',
    'Sites',
    false,
    siteCount > 0,
    siteCount > 0 ? `${siteCount} site folder${siteCount === 1 ? '' : 's'}` : 'no sites/ folders',
  );

  // 5. Git identity, only when we already know it is a repo (cheap, no network).
  if (gitOk && ctx.withGit !== false) {
    const r = run('git', ['-C', dest, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 10_000 });
    if (r.code === 0) result.git.branch = String(r.stdout || '').trim();
    const rc = run('git', ['-C', dest, 'rev-parse', '--short', 'HEAD'], { timeout: 10_000 });
    if (rc.code === 0) result.git.commit = String(rc.stdout || '').trim();
    const ru = run('git', ['-C', dest, 'remote', 'get-url', 'origin'], { timeout: 10_000 });
    if (ru.code === 0) result.git.remote = String(ru.stdout || '').trim();
    if (result.git.remote && !/sleep-network/i.test(result.git.remote)) {
      result.problems.push(`origin points at ${result.git.remote}, not tooltim/sleep-network`);
    }
  }

  result.status = statusFromChecks(result.checks, result.exists);
  result.summary = summarize(result);
  return result;
}

/**
 * One-line, path-first summary.
 * @param {ReturnType<typeof inspectInstall>} r
 */
export function summarize(r) {
  if (r.status === 'installed') {
    const bits = [r.dest];
    if (r.git.branch) bits.push(`branch ${r.git.branch}`);
    if (r.git.commit) bits.push(r.git.commit);
    return `Installed at ${bits.join(' · ')}`;
  }
  if (r.status === 'partial') {
    return `Incomplete install at ${r.dest} — ${r.problems[0] || 'missing required files'}`;
  }
  return `Not installed (nothing usable at ${r.dest})`;
}

/**
 * Look for workspaces anywhere we plausibly put one, so a second install and
 * an old leftover both show up instead of hiding.
 *
 * @param {{ env?: Record<string, string|undefined>, platform?: string, extra?: string[] }} [ctx]
 * @returns {Array<ReturnType<typeof inspectInstall>>}
 */
export function findInstalls(ctx = {}) {
  const env = ctx.env || process.env;
  const platform = ctx.platform || process.platform;
  const info = platformInfo(platform, env);
  const home = info.home;

  const roots = new Set();
  const addRoot = (p) => {
    if (p) roots.add(joinPath(p, 'sleep-network'));
  };

  addRoot(home);
  addRoot(joinPath(home, 'Documents'));
  addRoot(joinPath(home, 'Desktop'));
  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    if (env[key]) {
      addRoot(env[key]);
      addRoot(joinPath(env[key], 'Documents'));
    }
  }
  if (env.USERPROFILE && env.USERPROFILE !== home) {
    addRoot(env.USERPROFILE);
    addRoot(joinPath(env.USERPROFILE, 'Documents'));
  }
  for (const e of ctx.extra || []) {
    if (e) roots.add(e);
  }

  /** @type {Array<ReturnType<typeof inspectInstall>>} */
  const found = [];
  const seen = new Set();
  for (const r of roots) {
    const key = path.normalize(r).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!pathExists(r)) continue;
    const info2 = inspectInstall(r, { env, platform });
    if (info2.status !== 'none') found.push(info2);
  }
  return found;
}

function formatBytes(n) {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export { MIN_BYTES };
