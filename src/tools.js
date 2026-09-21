/**
 * Ensure Git / Node / Python are present. Prefer PATH detection before install.
 * Windows: winget --source winget (avoid msstore cert issues), then direct MSI/EXE.
 * macOS: Homebrew when available; otherwise official pkg / binary hints.
 * Linux: apt/dnf best-effort; otherwise clear manual instructions.
 */

import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import { say, ok } from './say.js';
import { platformInfo, joinPath, pathExists } from './platform.js';
import { refreshPath, resolveExe, waitForExe, run, versionOf } from './exec.js';

const NODE_MSI_URL = 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi';
const GIT_EXE_URL =
  'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe';

/**
 * @param {{ dryRun?: boolean, skipPython?: boolean }} opts
 */
export async function ensureTools(opts = {}) {
  refreshPath();
  const info = platformInfo();

  let git = resolveExe('git');
  if (!git) {
    say('Git not found — installing…');
    if (!opts.dryRun) await installGit(info);
    git = (await waitForExe('git', opts.dryRun ? 0 : 45)) || resolveExe('git');
  }
  if (!git) {
    throw new Error(
      'Git did not install. Install Git from https://git-scm.com (Windows) or `brew install git` (macOS), open a NEW terminal, and re-run.',
    );
  }
  ok(`git ${stripPrefix(versionOf(git) || '', 'git version ')}`);

  let node = resolveExe('node');
  if (!node) {
    say('Node.js not found — installing…');
    if (!opts.dryRun) await installNode(info);
    node = (await waitForExe('node', opts.dryRun ? 0 : 45)) || resolveExe('node');
  }
  if (!node) {
    throw new Error(
      'Node.js did not install. Install Node LTS from https://nodejs.org, open a NEW terminal, and re-run.',
    );
  }
  ok(`node ${versionOf(node) || ''}`.trim());

  // Optional Python (Windows flow had it for IP-allowlist repair)
  if (!opts.skipPython) {
    let py = resolveExe('python') || resolveExe('python3');
    if (!py) {
      say('Python not found — attempting optional install…');
      if (!opts.dryRun) await installPython(info);
      refreshPath();
      py = resolveExe('python') || resolveExe('python3');
    }
    if (py) ok('python present (used to repair the server allowlist)');
    else
      say(
        'python missing: the automatic IP-allowlist repair will not work until Python is installed',
      );
  }

  return { git, node };
}

async function installGit(info) {
  if (info.isWin) {
    if (await wingetInstall('Git.Git', 'git-scm.com')) {
      if (await waitForExe('git', 20)) return;
    }
    say('installing Git from git-scm.com…');
    const exe = joinPath(info.temp, 'git-setup.exe');
    await download(GIT_EXE_URL, exe);
    const r = run(exe, ['/VERYSILENT', '/NORESTART']);
    if (r.code !== 0) {
      say(`Git installer exited with code ${r.code}. Approve UAC or run an elevated shell if needed.`);
    }
    return;
  }
  if (info.isMac) {
    if (resolveExe('brew')) {
      run('brew', ['install', 'git'], { timeout: 600_000 });
      return;
    }
    // Xcode CLT often provides git; try xcode-select
    run('xcode-select', ['--install'], { allowFail: true });
    say('If Git is still missing, install Homebrew (https://brew.sh) then: brew install git');
    return;
  }
  // Linux best-effort
  if (resolveExe('apt-get')) {
    run('sudo', ['apt-get', 'install', '-y', 'git'], { timeout: 600_000 });
  } else if (resolveExe('dnf')) {
    run('sudo', ['dnf', 'install', '-y', 'git'], { timeout: 600_000 });
  } else {
    say('Install git with your package manager, then re-run.');
  }
}

async function installNode(info) {
  if (info.isWin) {
    if (await wingetInstall('OpenJS.NodeJS.LTS', 'nodejs.org')) {
      if (await waitForExe('node', 20)) return;
    }
    say('installing Node.js from nodejs.org…');
    const msi = joinPath(info.temp, 'node-lts.msi');
    await download(NODE_MSI_URL, msi);
    const r = run('msiexec.exe', ['/i', msi, '/qn', '/norestart']);
    if (r.code !== 0 && r.code !== 3010) {
      say(
        `Node.js MSI exited with code ${r.code}. Quiet MSI usually needs an elevated PowerShell (Run as administrator).`,
      );
    }
    return;
  }
  if (info.isMac) {
    if (resolveExe('brew')) {
      run('brew', ['install', 'node@22'], { timeout: 600_000 });
      // Also try unversioned formula
      if (!resolveExe('node')) run('brew', ['install', 'node'], { timeout: 600_000 });
      return;
    }
    say('Homebrew not found. Install Node LTS from https://nodejs.org (macOS pkg), then re-run.');
    return;
  }
  if (resolveExe('apt-get')) {
    // NodeSource is heavy; prefer distro node if recent enough, else nodesource hint
    run('sudo', ['apt-get', 'install', '-y', 'nodejs', 'npm'], { timeout: 600_000 });
  } else {
    say('Install Node 18+ from https://nodejs.org, then re-run.');
  }
}

async function installPython(info) {
  if (info.isWin) {
    await wingetInstall('Python.Python.3.12', 'python.org');
    return;
  }
  if (info.isMac && resolveExe('brew')) {
    run('brew', ['install', 'python@3.12'], { timeout: 600_000 });
    return;
  }
  if (info.isLinux && resolveExe('apt-get')) {
    run('sudo', ['apt-get', 'install', '-y', 'python3'], { timeout: 600_000 });
  }
}

/**
 * Pin --source winget to avoid msstore cert failures (0x8a15005e).
 */
async function wingetInstall(id, label) {
  refreshPath();
  if (!resolveExe('winget') && !whichLoose('winget')) {
    return false;
  }
  say(`installing ${label} via winget (a Windows admin prompt may appear: accept it)…`);
  const r = run(
    'winget',
    [
      'install',
      '--id',
      id,
      '-e',
      '--source',
      'winget',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ],
    { timeout: 600_000 },
  );
  if (r.code !== 0) {
    say(`winget install of ${label} reported exit ${r.code}; will try a direct download if needed`);
  }
  refreshPath();
  return true;
}

function whichLoose(name) {
  const r = run(process.platform === 'win32' ? 'where.exe' : 'which', [name], { timeout: 5_000 });
  return r.code === 0;
}

function stripPrefix(s, prefix) {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = url.startsWith('https') ? https.get : http.get;
    const req = get(url, { headers: { 'User-Agent': 'sleepmag-installer-note-beta' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`download ${url} failed: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close((err) => (err ? reject(err) : resolve(dest))));
    });
    req.on('error', reject);
  });
}

/**
 * Check-mode report lines (pure-ish for tests).
 */
/**
 * @param {{
 *   have: Record<string, boolean>,
 *   workspacePresent: boolean,
 *   install?: import('./inspect.js').inspectInstall extends never ? any : any,
 *   others?: Array<{ dest: string, status: string }>,
 *   shortcuts?: Array<{ path: string, target?: string, dead?: boolean }>,
 * }} args
 * @returns {string[]}
 */
export function checkReport({ have, workspacePresent, install, others, shortcuts }) {
  const lines = [];
  for (const c of ['git', 'node', 'claude', 'codex', 'gemini', 'python']) {
    lines.push(have[c] ? `OK  ${c} found` : `${c} missing`);
  }
  lines.push(`workspace: ${workspacePresent ? 'present' : 'not installed'}`);

  // Everything below is the detail the old one-word answer never gave.
  if (install) {
    lines.push(install.status === 'installed' ? `OK  ${install.summary}` : install.summary);
    for (const c of install.checks || []) {
      lines.push(c.ok ? `OK  ${c.label}: ${c.detail}` : `${c.label}: ${c.detail}`);
    }
    if (install.cloud) {
      lines.push(`warning: this folder is synced by ${install.cloud.label}`);
    }
  }
  for (const other of others || []) {
    lines.push(`another install: ${other.dest} (${other.status})`);
  }
  for (const s of shortcuts || []) {
    lines.push(
      `shortcut: ${s.path}${s.target ? ` -> ${s.target}` : ''}${s.dead ? ' (TARGET MISSING)' : ''}`,
    );
  }
  return lines;
}

export { NODE_MSI_URL, GIT_EXE_URL };
