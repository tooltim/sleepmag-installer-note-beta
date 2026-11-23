/**
 * Process helpers: which, run, refresh PATH awareness.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { joinPath, pathExists, platformInfo } from './platform.js';

/**
 * Find an executable on PATH (cross-platform which).
 * @param {string} name
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {string|null}
 */
export function which(name, opts = {}) {
  const env = opts.env || process.env;
  const info = platformInfo(process.platform, env);
  const pathVar = env.PATH || env.Path || '';
  const sep = info.isWin ? ';' : ':';
  const exts = info.isWin
    ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];

  for (const dir of pathVar.split(sep).filter(Boolean)) {
    if (info.isWin) {
      if (path.extname(name)) {
        const t = joinPath(dir, name);
        if (pathExists(t) && isExecutable(t, true)) return t;
      } else {
        for (const ext of exts) {
          const t = joinPath(dir, name + ext);
          if (pathExists(t) && isExecutable(t, true)) return t;
        }
      }
    } else {
      const t = joinPath(dir, name);
      if (pathExists(t) && isExecutable(t, false)) return t;
    }
  }
  return null;
}

function isExecutable(file, isWin) {
  try {
    fs.accessSync(file, fs.constants.F_OK);
    if (isWin) return true;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prepend known install dirs onto process.env.PATH for this process.
 */
export function refreshPath(env = process.env) {
  const info = platformInfo(process.platform, env);
  const extras = [];

  if (info.isWin) {
    const pf = info.programFiles || 'C:\\Program Files';
    const la = info.localAppData || joinPath(info.home, 'AppData', 'Local');
    extras.push(
      joinPath(pf, 'nodejs'),
      joinPath(la, 'Programs', 'nodejs'),
      joinPath(pf, 'Git', 'cmd'),
      joinPath(la, 'Programs', 'Git', 'cmd'),
      joinPath(la, 'Programs', 'Python', 'Python312'),
      joinPath(la, 'Microsoft', 'WindowsApps'),
      joinPath(info.home, '.local', 'bin'),
      joinPath(info.appData || joinPath(info.home, 'AppData', 'Roaming'), 'npm'),
    );
  } else {
    extras.push(
      '/usr/local/bin',
      '/opt/homebrew/bin',
      joinPath(info.home, '.local', 'bin'),
      joinPath(info.home, '.nvm', 'current', 'bin'),
    );
  }

  const sep = info.isWin ? ';' : ':';
  const current = env.PATH || env.Path || '';
  const parts = current.split(sep).filter(Boolean);
  for (const d of extras) {
    if (pathExists(d) && !parts.includes(d)) parts.unshift(d);
  }
  const merged = parts.join(sep);
  env.PATH = merged;
  if (info.isWin) env.Path = merged;
  return merged;
}

/**
 * Resolve exe: PATH first, then known install locations.
 * @param {string} name
 */
export function resolveExe(name, opts = {}) {
  refreshPath(opts.env || process.env);
  const found = which(name, opts);
  if (found) return found;

  const info = platformInfo(process.platform, opts.env || process.env);
  const candidates = knownLocations(name, info);
  for (const c of candidates) {
    if (pathExists(c)) return c;
  }
  return null;
}

function knownLocations(name, info) {
  if (!info.isWin) {
    if (name === 'node') {
      return ['/usr/local/bin/node', '/opt/homebrew/bin/node'];
    }
    if (name === 'git') {
      return ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
    }
    return [];
  }
  const pf = info.programFiles || 'C:\\Program Files';
  const la = info.localAppData || joinPath(info.home, 'AppData', 'Local');
  if (name === 'node') {
    return [joinPath(pf, 'nodejs', 'node.exe'), joinPath(la, 'Programs', 'nodejs', 'node.exe')];
  }
  if (name === 'git') {
    return [joinPath(pf, 'Git', 'cmd', 'git.exe'), joinPath(la, 'Programs', 'Git', 'cmd', 'git.exe')];
  }
  if (name === 'claude' || name === 'codex' || name === 'gemini') {
    // Native installer (claude.exe in ~/.local/bin) and npm global (%APPDATA%\npm\<name>.cmd).
    // Missing these made a working Claude look absent, so the installer reinstalled over it.
    const npmDir = joinPath(info.appData || joinPath(info.home, 'AppData', 'Roaming'), 'npm');
    return [
      joinPath(info.home, '.local', 'bin', `${name}.exe`),
      joinPath(npmDir, `${name}.cmd`),
      joinPath(npmDir, `${name}.ps1`),
    ];
  }
  if (name === 'python' || name === 'python3') {
    return [
      joinPath(la, 'Programs', 'Python', 'Python312', 'python.exe'),
      joinPath(pf, 'Python312', 'python.exe'),
    ];
  }
  return [];
}

/**
 * Wait until resolveExe succeeds or timeout.
 */
export async function waitForExe(name, seconds, opts = {}) {
  const deadline = Date.now() + seconds * 1000;
  do {
    const found = resolveExe(name, opts);
    if (found) return found;
    if (seconds <= 0) break;
    await sleep(500);
  } while (Date.now() < deadline);
  return null;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run a command; return { code, stdout, stderr, combined }.
 */
export function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    // No child may wait on a keyboard nobody is looking at (the UI runs us in a hidden console):
    // a prompt there sat until someone pressed Ctrl+C.
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeout || 300_000,
    env: opts.env || process.env,
    cwd: opts.cwd,
    shell: Boolean(opts.shell),
    windowsHide: true,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  return {
    code: result.status == null ? (result.error ? 1 : 0) : result.status,
    stdout,
    stderr,
    combined: `${stdout}${stderr}`,
    error: result.error || null,
  };
}

/**
 * Put a folder on the user's PATH for good (Windows; HKCU, no admin), so a NEW terminal finds
 * what was installed there. The raw registry value is read and written so %USERPROFILE%-style
 * entries stay unexpanded; the change is then broadcast so Explorer and new consoles see it.
 * @param {string} dir
 * @param {{ platform?: string, dryRun?: boolean }} [opts]
 * @returns {{ added: boolean, error?: string }}
 */
export function ensureUserPath(dir, opts = {}) {
  const platform = opts.platform || process.platform;
  if (platform !== 'win32' || !dir || opts.dryRun) return { added: false };
  const ps = [
    `$dir = ${psQuote(dir)}`,
    "function Norm($p) { ([Environment]::ExpandEnvironmentVariables($p)).TrimEnd([char]92).ToLowerInvariant() }",
    "$raw = [string](Get-Item -Path 'HKCU:\\Environment').GetValue('Path', '', 'DoNotExpandEnvironmentNames')",
    "$machine = [string][Environment]::GetEnvironmentVariable('Path', 'Machine')",
    '$all = @(($raw + [char]59 + $machine) -split [char]59 | Where-Object { $_ } | ForEach-Object { Norm $_ })',
    "if ($all -contains (Norm $dir)) { 'present'; exit 0 }",
    '$next = if ($raw.Trim()) { $raw.TrimEnd([char]59) + [char]59 + $dir } else { $dir }',
    "Set-ItemProperty -Path 'HKCU:\\Environment' -Name 'Path' -Value $next -Type ExpandString",
    // Deleting a dummy user variable makes .NET broadcast WM_SETTINGCHANGE for us.
    "[Environment]::SetEnvironmentVariable('SLEEPMAG_PATH_TOUCH', $null, 'User')",
    "'added'",
  ].join('\n');
  const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    timeout: 30_000,
  });
  const out = String(r.stdout || '');
  if (/\badded\b/.test(out)) {
    // This process too, so the steps after this one find it.
    const cur = process.env.PATH || process.env.Path || '';
    if (!cur.toLowerCase().split(';').includes(String(dir).toLowerCase())) {
      process.env.PATH = `${dir};${cur}`;
      process.env.Path = process.env.PATH;
    }
    return { added: true };
  }
  if (/\bpresent\b/.test(out)) return { added: false };
  const why = (r.stderr || r.combined || '').trim().split(/\r?\n/)[0];
  return { added: false, error: why || `powershell exit ${r.code}` };
}

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

export function versionOf(exe, args = ['--version']) {
  try {
    const out = execFileSync(exe, args, {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return String(out || '').trim().split('\n')[0];
  } catch {
    return null;
  }
}
