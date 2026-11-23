/**
 * Claude Code / Codex / Gemini CLI install.
 * A missing assistant must NEVER fail setup, but it must never fail SILENTLY either:
 * every chosen assistant ends up in the report (found / installed / failed + why), the UI shows it,
 * and on Windows its folder is put on the user's PATH for good (the native Claude installer only
 * prints "add ~/.local/bin to your PATH" and leaves it to the user).
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { say, ok } from './say.js';
import { refreshPath, resolveExe, run, ensureUserPath } from './exec.js';
import { platformInfo } from './platform.js';
import { normalizeAssistant, assistantTargets } from './env.js';

const require = createRequire(import.meta.url);

const LABEL = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' };
const MANUAL = {
  claude: {
    win: 'irm https://claude.ai/install.ps1 | iex',
    posix: 'curl -fsSL https://claude.ai/install.sh | bash',
  },
  codex: { win: 'npm install -g @openai/codex', posix: 'npm install -g @openai/codex' },
  gemini: { win: 'npm install -g @google/gemini-cli', posix: 'npm install -g @google/gemini-cli' },
};

/** The command a person can paste to install one assistant by hand. */
export function manualInstallCommand(name, platform = process.platform) {
  const m = MANUAL[name];
  if (!m) return '';
  return platform === 'win32' ? m.win : m.posix;
}

/** Where each assistant is right now (null = not found on PATH nor in its usual folder). */
export function detectAssistants() {
  return {
    claude: resolveExe('claude'),
    codex: resolveExe('codex'),
    gemini: resolveExe('gemini'),
  };
}

/**
 * @typedef {{ name: string, label: string, status: 'found'|'installed'|'failed', path: string|null,
 *   detail: string, manual: string, pathAdded?: string|null }} AssistantReport
 */

/**
 * @param {{ assistant: string|null, dryRun?: boolean, prompt?: () => Promise<string>|string }} opts
 * @returns {Promise<{ assistant: string, report: AssistantReport[] }>}
 */
export async function resolveAndInstallAssistants(opts) {
  let assistant = opts.assistant;
  if (!assistant) {
    let answer;
    if (typeof opts.prompt === 'function') answer = await opts.prompt();
    else if (opts.prompt != null) answer = opts.prompt;
    else {
      answer = await promptLine(
        'Which assistant do you use? [1] Claude Code  [2] Codex  [3] Gemini CLI  [4] all  [5] none',
      );
    }
    assistant = normalizeAssistant(answer);
  }
  if (!['claude', 'codex', 'gemini', 'both', 'all', 'none'].includes(assistant)) {
    assistant = 'none';
  }

  if (opts.dryRun) return { assistant, report: [] };

  /** @type {AssistantReport[]} */
  const report = [];
  for (const name of assistantTargets(assistant)) {
    report.push(await ensureAssistant(name));
  }
  return { assistant, report };
}

/**
 * Find one assistant, install it only when it is missing (never over a working copy: that deleted
 * Claude twice on a teammate's PC), then make sure a new terminal will find it.
 * @param {'claude'|'codex'|'gemini'} name
 * @returns {Promise<AssistantReport>}
 */
async function ensureAssistant(name) {
  const label = LABEL[name];
  const manual = manualInstallCommand(name);
  let found = resolveExe(name);
  let status = 'found';
  let detail = '';

  if (found) {
    ok(`${label} already installed: ${found}`);
  } else {
    say(`installing ${label}…`);
    let failure = '';
    try {
      if (name === 'claude') await installClaude();
      else if (name === 'gemini') await installGemini();
      else installNpm('@openai/codex');
    } catch (e) {
      failure = e?.message || String(e);
    }
    refreshPath();
    found = resolveExe(name);
    if (found) {
      status = 'installed';
      ok(`${label} installed: ${found}`);
    } else {
      status = 'failed';
      detail = failure || 'the installer finished but the program is not where it should be';
      say(`${label} did NOT install: ${detail}`);
      say(`Install it yourself in a terminal:  ${manual}`);
    }
  }

  // A program a new terminal cannot find looks uninstalled to the launcher and to the person.
  let pathAdded = null;
  if (found) {
    const dir = path.dirname(found);
    const r = ensureUserPath(dir);
    if (r.added) {
      pathAdded = dir;
      ok(`added ${dir} to your PATH (new terminals will find ${name})`);
    } else if (r.error) {
      say(`could not add ${dir} to your PATH: ${r.error}`);
      detail = detail || `not on PATH: add ${dir} to your PATH`;
    }
  }

  return { name, label, status, path: found, detail, manual, pathAdded };
}

/** Last lines of a failed install, for the log: "exit 1" alone explains nothing. */
function tail(text, lines = 8) {
  return String(text || '').trim().split(/\r?\n/).slice(-lines).join(' | ');
}

async function installClaude() {
  const info = platformInfo();
  if (info.isWin) {
    const r = run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression',
      ],
      { timeout: 600_000 },
    );
    if (r.code !== 0 || r.error) {
      throw new Error(`claude.ai/install.ps1 exit ${r.code}${r.error ? ` (${r.error.message})` : ''}: ${tail(r.combined)}`);
    }
    return;
  }

  const r = run('bash', ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'], {
    timeout: 600_000,
  });
  if (r.code !== 0) {
    say(`claude.ai/install.sh failed (${tail(r.combined, 3)}); trying npm…`);
    installNpm('@anthropic-ai/claude-code');
  }
}

function installNpm(pkg) {
  const npm = resolveExe('npm') || 'npm';
  // npm is a .cmd on Windows, and Node refuses to spawn a .cmd without a shell (EINVAL since the
  // 2024 batch-file fix). Through the shell its path needs quotes: it lives in "Program Files".
  const win = process.platform === 'win32';
  const r = run(win ? `"${npm}"` : npm, ['install', '-g', pkg], { timeout: 600_000, shell: win });
  if (r.code !== 0) throw new Error(`npm install -g ${pkg} exit ${r.code}: ${tail(r.combined)}`);
}

async function installGemini() {
  const info = platformInfo();
  if ((info.isMac || info.isLinux) && resolveExe('brew')) {
    const brew = run('brew', ['install', 'gemini-cli'], { timeout: 600_000 });
    if (brew.code === 0 && resolveExe('gemini')) return;
  }
  installNpm('@google/gemini-cli');
}

export async function promptLine(question) {
  if (!process.stdin.isTTY) return '';
  const readline = require('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolve) => {
      rl.question(`  ${question} `, (answer) => resolve(answer));
    });
  } finally {
    rl.close();
  }
}
