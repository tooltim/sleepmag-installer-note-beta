import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePosixEntry, resolveLauncherTarget, openInstalled } from '../src/launcher.js';

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sleepnet-target-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function makeWorkspace(name, { shippedCmd = false, launcherEntry = false } = {}) {
  const dest = path.join(tmpRoot, name, 'sleep-network');
  fs.mkdirSync(path.join(dest, 'tools', 'sleepmag'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'tools', 'sleepmag', 'cli.mjs'), '// cli\n'.repeat(40));
  if (launcherEntry) {
    fs.mkdirSync(path.join(dest, 'tools', 'sleepmag', 'launcher'), { recursive: true });
    fs.writeFileSync(
      path.join(dest, 'tools', 'sleepmag', 'launcher', 'run.mjs'),
      '// launcher\n'.repeat(10),
    );
  }
  if (shippedCmd) {
    fs.writeFileSync(
      path.join(dest, 'Sleep Network Launcher.cmd'),
      '@echo off\r\nnode "%~dp0tools\\sleepmag\\launcher\\run.mjs" %*\r\n',
    );
  }
  return dest;
}

describe('resolveLauncherTarget', () => {
  it('prefers the launcher cmd the workspace ships (opens the launcher window)', () => {
    const dest = makeWorkspace('shipped', { shippedCmd: true, launcherEntry: true });
    const target = resolveLauncherTarget({ dest });
    assert.equal(target, path.join(dest, 'Sleep Network Launcher.cmd'));
  });

  it('falls back to sleepmag.cmd when the launcher cmd is missing', () => {
    const dest = makeWorkspace('fallback', { shippedCmd: false });
    const target = resolveLauncherTarget({ dest });
    assert.equal(target, path.join(dest, 'sleepmag.cmd'));
    assert.equal(fs.existsSync(target), true);
  });

  it('ignores an empty launcher cmd', () => {
    const dest = makeWorkspace('empty', { shippedCmd: false });
    fs.writeFileSync(path.join(dest, 'Sleep Network Launcher.cmd'), '');
    const target = resolveLauncherTarget({ dest });
    assert.equal(path.basename(target), 'sleepmag.cmd');
  });
});

describe('resolvePosixEntry', () => {
  it('prefers the launcher entry point', () => {
    const dest = makeWorkspace('posix', { launcherEntry: true });
    assert.equal(
      resolvePosixEntry(dest),
      path.join(dest, 'tools', 'sleepmag', 'launcher', 'run.mjs'),
    );
  });

  it('falls back to the CLI', () => {
    const dest = makeWorkspace('posix-nolauncher', { launcherEntry: false });
    assert.equal(resolvePosixEntry(dest), path.join(dest, 'tools', 'sleepmag', 'cli.mjs'));
  });
});

describe('openInstalled honesty', () => {
  it('reports not-opened, with a reason and a how-to, when there is nothing to open', () => {
    const r = openInstalled({ path: null, target: null });
    assert.equal(r.opened, false);
    assert.ok(r.evidence);
    assert.match(r.howTo, /Sleep Network Launcher/);
  });

  it('never claims success in dry-run', () => {
    const r = openInstalled({ path: 'whatever', target: 'whatever' }, { dryRun: true });
    assert.equal(r.opened, false);
    assert.equal(r.evidence, 'dry-run');
  });

  it('reports failure for a path that does not exist', () => {
    const r = openInstalled({ path: path.join(tmpRoot, 'ghost.lnk'), target: null });
    assert.equal(r.opened, false);
    assert.match(r.evidence, /no launcher file on disk/i);
  });
});
