#!/usr/bin/env node
/**
 * After a real end-to-end install on a CI machine: prove every step left what a
 * person would rely on. Fails (exit 1) on the first missing piece, listing all.
 *
 * Usage: node test/e2e/assert-install.mjs <workspace dir> <expected e-mail>
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dest = path.resolve(process.argv[2]);
const email = process.argv[3];
const problems = [];
const okLines = [];
const check = (cond, good, bad) => (cond ? okLines.push(good) : problems.push(bad));
const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

// 1. Workspace: a real clone with the CLI in it.
check(fs.existsSync(path.join(dest, '.git', 'HEAD')), `git clone at ${dest}`, `no git clone at ${dest}`);
check(fs.existsSync(path.join(dest, 'tools', 'sleepmag', 'cli.mjs')), 'sleepmag CLI present', 'sleepmag CLI missing');

// 2. Setup ran with what the person typed.
const setup = JSON.parse(read(path.join(dest, '.e2e', 'setup.json')) || 'null');
check(setup && setup.email === email && setup.passphraseLength > 0, `setup ran for ${email}`, `setup did not run with the e-mail (${JSON.stringify(setup)})`);

// 3. Desktop launcher + PATH, per platform.
const desktop = path.join(os.homedir(), 'Desktop');
if (process.platform === 'win32') {
  const lnk = path.join(desktop, 'Sleep Network Launcher.lnk');
  check(fs.existsSync(lnk), `desktop shortcut ${lnk}`, `no desktop shortcut at ${lnk}`);
} else if (process.platform === 'darwin') {
  const cmd = path.join(desktop, 'Sleep Network Launcher.command');
  const body = read(cmd) || '';
  let exec = false;
  try {
    fs.accessSync(cmd, fs.constants.X_OK);
    exec = true;
  } catch {
    /* not executable */
  }
  check(exec, `desktop launcher ${cmd} (executable)`, `no executable launcher at ${cmd}`);
  check(body.includes('export PATH="/opt/homebrew/bin'), 'launcher puts Homebrew on PATH', 'launcher has no PATH line');
  check(body.includes('launcher/run.mjs'), 'launcher starts launcher/run.mjs', 'launcher does not start run.mjs');
  const profiles = ['.zprofile', '.bash_profile', '.bash_login', '.profile'].map((f) => read(path.join(os.homedir(), f)) || '');
  check(profiles.some((p) => p.includes(dest)), 'workspace on PATH in the login profile', 'workspace not added to any login profile');
  check(profiles.some((p) => p.includes('$HOME/.local/bin')), '~/.local/bin on PATH in the login profile', '~/.local/bin not in any login profile');
}

// 4. The launcher really started from the shortcut (the stand-in writes this file).
const marker = path.join(dest, '.e2e', 'launcher-opened');
const deadline = Date.now() + 45_000;
while (!fs.existsSync(marker) && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
}
check(fs.existsSync(marker), `launcher started from the shortcut (${read(marker)})`, 'the launcher never started from the desktop shortcut');

for (const l of okLines) console.log(`  OK  ${l}`);
for (const p of problems) console.log(`  FAIL  ${p}`);
process.exit(problems.length ? 1 : 0);
