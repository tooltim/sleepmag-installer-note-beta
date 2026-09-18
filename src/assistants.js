/**
 * Optional Claude Code / Codex / Gemini CLI install.
 * Missing assistants must NEVER fail setup.
 */

import { createRequire } from 'node:module';
import { say } from './say.js';
import { refreshPath, resolveExe, run } from './exec.js';
import { platformInfo } from './platform.js';
import { normalizeAssistant, assistantTargets } from './env.js';

const require = createRequire(import.meta.url);

/**
 * @param {{ assistant: string|null, dryRun?: boolean, prompt?: () => Promise<string>|string }} opts
 * @returns {Promise<'claude'|'codex'|'gemini'|'both'|'all'|'none'>}
 */
export async function resolveAndInstallAssistants(opts) {
  let assistant = opts.assistant;
  if (!assistant) {
    let answer;
    if (typeof opts.prompt === 'function') answer = await opts.prompt();
    else if (opts.prompt != null) answer = opts.prompt;
    else {
      answer = await promptLine(
        'Which assistant do you use? [1] Claude Code  [2] Codex  [3] Gemini CLI  [4] all  [5] already installed / skip',
      );
    }
    assistant = normalizeAssistant(answer);
  }
  if (!['claude', 'codex', 'gemini', 'both', 'all', 'none'].includes(assistant)) {
    assistant = 'none';
  }

  if (opts.dryRun) return assistant;

  const targets = assistantTargets(assistant);

  if (targets.includes('claude') && !resolveExe('claude')) {
    say('installing Claude Code…');
    try {
      await installClaude();
    } catch (e) {
      say(`Claude install skipped (${e.message || e})`);
    }
    refreshPath();
  }

  if (targets.includes('codex') && !resolveExe('codex')) {
    say('installing Codex…');
    try {
      const npm = resolveExe('npm') || 'npm';
      const r = run(npm, ['install', '-g', '@openai/codex'], { timeout: 600_000 });
      if (r.code !== 0) say(`Codex install skipped (exit ${r.code})`);
    } catch (e) {
      say(`Codex install skipped (${e.message || e})`);
    }
    refreshPath();
  }

  if (targets.includes('gemini') && !resolveExe('gemini')) {
    say('installing Gemini CLI…');
    try {
      await installGemini();
    } catch (e) {
      say(`Gemini install skipped (${e.message || e})`);
    }
    refreshPath();
  }

  if (targets.includes('claude') && !resolveExe('claude')) {
    say('claude not on PATH yet (optional — continuing)');
  }
  if (targets.includes('codex') && !resolveExe('codex')) {
    say('codex not on PATH yet (optional — continuing)');
  }
  if (targets.includes('gemini') && !resolveExe('gemini')) {
    say('gemini not on PATH yet (optional — continuing)');
  }

  return assistant;
}

async function installClaude() {
  const info = platformInfo();
  if (info.isWin) {
    const r = run(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression',
      ],
      { timeout: 600_000 },
    );
    if (r.code !== 0) throw new Error(`exit ${r.code}`);
    return;
  }

  const r = run('bash', ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'], {
    timeout: 600_000,
  });
  if (r.code !== 0) {
    const npm = resolveExe('npm') || 'npm';
    const r2 = run(npm, ['install', '-g', '@anthropic-ai/claude-code'], { timeout: 600_000 });
    if (r2.code !== 0) throw new Error(`claude install exit ${r.code}/${r2.code}`);
  }
}

async function installGemini() {
  const info = platformInfo();
  if ((info.isMac || info.isLinux) && resolveExe('brew')) {
    const brew = run('brew', ['install', 'gemini-cli'], { timeout: 600_000 });
    if (brew.code === 0 && resolveExe('gemini')) return;
  }
  const npm = resolveExe('npm') || 'npm';
  const r = run(npm, ['install', '-g', '@google/gemini-cli'], { timeout: 600_000 });
  if (r.code !== 0) throw new Error(`exit ${r.code}`);
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
