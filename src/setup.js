/**
 * Run tools/sleepmag/cli.mjs setup and soft-continue when only optional assistants are missing.
 */

import fs from 'node:fs';
import { joinPath, pathExists, platformInfo } from './platform.js';
import { run } from './exec.js';
import { say } from './say.js';
import { promptLine } from './assistants.js';

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
  const requiredOk =
    /passphrase stored/i.test(text) && /platform/i.test(text);

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
 * }} opts
 */
export async function runSleepmagSetup(opts) {
  let { name, email, passphrase } = opts;
  if (!name) name = (await promptLine('Your first name')) || 'User';
  if (!email) email = (await promptLine('Your work e-mail')) || '';
  if (!passphrase) {
    passphrase = await promptPassphrase(
      'Team passphrase (Tim gives it to you; typing is hidden)',
    );
  }

  const setupCli = joinPath(opts.dest, 'tools', 'sleepmag', 'cli.mjs');
  if (!opts.dryRun && !pathExists(setupCli)) {
    throw new Error(`sleepmag CLI not found at ${setupCli}`);
  }

  const setupArgs = ['setup', '--name', name, '--email', email, '--passphrase', passphrase];

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

  const verdict = evaluateSetupResult(setupText, r.code);
  if (!verdict.ok) {
    throw new Error(verdict.reason || 'setup failed');
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
  return { ok: true, setupText, exit: r.code };
}

async function promptPassphrase(question) {
  if (!process.stdin.isTTY) {
    throw new Error('SLEEPNET_PASSPHRASE is required in non-interactive mode');
  }
  // Best-effort hidden input via readline mute
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const readline = req('node:readline');
  const stdin = process.stdin;
  const rl = readline.createInterface({ input: stdin, output: process.stdout, terminal: true });
  return await new Promise((resolve, reject) => {
    stdin.on('data', onData);
    rl.question(`  ${question} `, (answer) => {
      stdin.removeListener('data', onData);
      try {
        stdin.setRawMode?.(false);
      } catch {
        /* ignore */
      }
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
    function onData() {
      // Mask: move back and write *
      try {
        readline.moveCursor(process.stdout, -1, 0);
        readline.clearLine(process.stdout, 1);
        process.stdout.write('*');
      } catch {
        /* ignore */
      }
    }
    rl.on('SIGINT', () => {
      rl.close();
      reject(new Error('cancelled'));
    });
  });
}
