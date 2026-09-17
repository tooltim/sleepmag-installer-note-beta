#!/usr/bin/env node
/**
 * Sleep Network cross-platform bootstrap entrypoint.
 * Safe to re-run (idempotent).
 *
 * Default: guided local UI (browser).
 *   node bin/install.js
 *   node bin/install.js --ui
 *
 * Console / automation:
 *   node bin/install.js --cli
 *   SLEEPNET_MODE=check node bin/install.js
 *
 * Env:
 *   SLEEPNET_MODE=check
 *   SLEEPNET_NAME / SLEEPNET_EMAIL / SLEEPNET_PASSPHRASE
 *   SLEEPNET_ASSISTANT=claude|codex|both|none
 *   SLEEPNET_DRY_RUN=1
 *   SLEEPNET_UI=0   force CLI
 */

import { main } from '../src/index.js';
import { startUiServer } from '../src/ui/server.js';
import { createLogger } from '../src/log.js';
import { parseEnv } from '../src/env.js';

const args = new Set(process.argv.slice(2));
const cfg = parseEnv(process.env);

function wantUi() {
  if (args.has('--cli') || args.has('--no-ui')) return false;
  if (args.has('--ui')) return true;
  if (process.env.SLEEPNET_UI === '0' || process.env.SLEEPNET_UI === 'false') return false;
  if (process.env.SLEEPNET_UI === '1' || process.env.SLEEPNET_UI === 'true') return true;
  // Check / dry-run / fully-env-driven automation → CLI
  if (cfg.check) return false;
  if (cfg.dryRun) return false;
  if (cfg.name && cfg.email && cfg.passphrase) return false;
  return true;
}

async function run() {
  if (wantUi()) {
    await startUiServer({ openBrowser: true });
    // Keep process alive for the UI server until the user closes it.
    await new Promise(() => {});
    return;
  }

  try {
    await main({
      promptIfMissing: true,
    });
  } catch (err) {
    const logPath = err?.logPath || createLogger().logPath;
    console.error('');
    console.error(`  ERROR  ${err.message || err}`);
    if (err?.stepLabel || err?.step) {
      console.error(`  STEP   ${err.stepLabel || err.step}`);
    }
    console.error(`  LOG    ${err?.logPath || logPath}`);
    console.error('');
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('');
  console.error(`  ERROR  ${err.message || err}`);
  console.error('');
  process.exitCode = 1;
});
