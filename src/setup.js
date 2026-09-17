/**
 * Run tools/sleepmag/cli.mjs setup and soft-continue when only optional assistants are missing.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { joinPath, pathExists, platformInfo } from './platform.js';
import { run } from './exec.js';
import { say } from './say.js';

const require = createRequire(import.meta.url);

/**
 * Decide whether a non-zero sleepmag exit is acceptable.
 * Mirrors install.ps1 soft-continue logic.
 *
 * @param {string} setupText
 * @param {number} setupExit
 * @returns {{ ok: boolean, reason?: string }}
 */
export function evaluateSetupResult(setupText, setupExit) {
  if (setupExit === 0) return { ok: true };

  const text = setupText || '';
  const assistantMissOnly = [...text.matchAll(/Command not found:\s*(claude|codex)\b/gi)];
  const scrubbed = text.replace(/^.*Command not found:\s*(claude|codex)\b.*\r?\n?/gim, '');
  const otherHardFail = /(Command not found:|❌|✖|\bfatal\b|\berror\b)/i.test(scrubbed);
  const requiredOk = /passphrase stored/i.test(text) && /platform/i.test(text);

  if (assistantMissOnly.length > 0 && !otherHardFail && requiredOk) {
    const missed = [...new Set(assistantMissOnly.map((m) => m[1].toLowerCase()))].join(', ');
    return { ok: true, reason: `optional assistant CLI missing (${missed})` };
  }
  return { ok: false, reason: 'setup failed' };
}

/**
 * @param {{
 *   dest: string,
 *   nodeExe: string,
 *   name: string|null,
 *   email: string|null,
 *   passphrase: string|null,
 *   dryRun?: boolean,
 *   promptIfMissing?: boolean,
 * }} opts
 */
export async function runSleepmagSetup(opts) {
  let { name, email, passphrase } = opts;
  const promptIfMissing = opts.promptIfMissing !== false;

  if (promptIfMissing) {
    const { promptLine } = await import('./assistants.js');
    if (!name) name = (await promptLine('Your first name')) || '';
    if (!email) email = (await promptLine('Your work e-mail')) || '';
    if (!passphrase) {
      passphrase = await promptPassphrase(
        'Team passphrase (Tim gives it to you; typing is hidden)',
      );
    }
  }

  if (!name || !String(name).trim()) {
    throw new Error('First name is required for setup.');
  }
  if (!email || !String(email).trim()) {
    throw new Error('Work e-mail is required for setup.');
  }
  if (!passphrase || !String(passphrase).trim()) {
    throw new Error('Team passphrase is required for setup.');
  }

  const setupCli = joinPath(opts.dest, 'tools', 'sleepmag', 'cli.mjs');
  if (!opts.dryRun && !pathExists(setupCli)) {
    throw new Error(`sleepmag CLI not found at ${setupCli}`);
  }

  const setupArgs = [
    'setup',
    '--name',
    String(name).trim(),
    '--email',
    String(email).trim(),
    '--passphrase',
    String(passphrase),
  ];

  if (opts.dryRun) {
    say(`[dry-run] would run: node ${setupCli} setup --name … --email … --passphrase …`);
    return { ok: true, dryRun: true };
  }

  const r = run(opts.nodeExe, [setupCli, ...setupArgs], { timeout: 600_000 });
  const setupText = r.combined;
  process.stdout.write(setupText.endsWith('\n') || !setupText ? setupText : setupText + '\n');

  const info = platformInfo();
  const logPath = joinPath(info.temp, 'sleepnet-setup.log');
  try {
    fs.writeFileSync(logPath, setupText, 'utf8');
  } catch {
    /* ignore */
  }
  say(`setup output also saved to ${logPath}`);

  const verdict = evaluateSetupResult(setupText, r.code);
  if (!verdict.ok) {
    throw new Error(
      `${verdict.reason || 'setup failed'} (see ${logPath} and the install log)`,
    );
  }
  if (verdict.reason) {
    say(`${verdict.reason} — continuing (not required for setup)`);
    const marker =
      process.platform === 'win32'
        ? joinPath(opts.dest, 'sleepmag.cmd')
        : joinPath(opts.dest, 'tools', 'sleepmag', 'cli.mjs');
    if (process.platform === 'win32' && !pathExists(marker)) {
      say(
        'note: sleepmag may have stopped before finishing the desktop shortcut/PATH; re-run after the sleepmag optional-assistant fix if the shortcut is missing',
      );
    }
  }
  return { ok: true, setupText, exit: r.code, setupLogPath: logPath };
}

/**
 * Hidden passphrase prompt for CLI mode. Prefer the UI form when possible.
 * @param {string} question
 */
export async function promptPassphrase(question) {
  if (!process.stdin.isTTY) {
    throw new Error('SLEEPNET_PASSPHRASE is required in non-interactive mode');
  }
  const readline = require('node:readline');
  const stdin = process.stdin;
  const stdout = process.stdout;
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });

  return await new Promise((resolve, reject) => {
    let muted = false;
    const onData = (char) => {
      if (!muted) return;
      const s = String(char);
      // Ctrl+C
      if (s === '\u0003') {
        cleanup();
        reject(new Error('cancelled'));
        return;
      }
      // suppress echo of typed chars (readline still collects them)
      stdout.clearLine?.(0);
      stdout.cursorTo?.(0);
      stdout.write(`  ${question} ` + '*'.repeat(rl.line?.length || 0));
    };

    function cleanup() {
      muted = false;
      stdin.removeListener('data', onData);
      try {
        stdin.setRawMode?.(false);
      } catch {
        /* ignore */
      }
    }

    muted = true;
    stdin.on('data', onData);
    try {
      stdin.setRawMode?.(true);
    } catch {
      /* ignore — still collect input */
    }

    rl.question(`  ${question} `, (answer) => {
      cleanup();
      stdout.write('\n');
      rl.close();
      resolve(answer);
    });
    rl.on('SIGINT', () => {
      cleanup();
      rl.close();
      reject(new Error('cancelled'));
    });
  });
}
