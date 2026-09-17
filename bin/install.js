#!/usr/bin/env node
/**
 * Sleep Network cross-platform bootstrap entrypoint.
 * Safe to re-run (idempotent).
 *
 * Env:
 *   SLEEPNET_MODE=check
 *   SLEEPNET_NAME / SLEEPNET_EMAIL / SLEEPNET_PASSPHRASE
 *   SLEEPNET_ASSISTANT=claude|codex|both|none
 *   SLEEPNET_DRY_RUN=1
 */

import { main } from '../src/index.js';

main().catch((err) => {
  console.error('');
  console.error(`  ERROR  ${err.message || err}`);
  console.error('');
  process.exitCode = 1;
});
