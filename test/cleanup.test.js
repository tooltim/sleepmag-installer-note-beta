import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isOurShortcutName,
  isRemovableWorkspace,
  removeShortcuts,
  removeInstall,
} from '../src/cleanup.js';
import { resolveIcon, isUsableIcon } from '../src/launcher.js';

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sleepnet-cleanup-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function makeWorkspace(name) {
  const dest = path.join(tmpRoot, name, 'sleep-network');
  fs.mkdirSync(path.join(dest, 'tools', 'sleepmag'), { recursive: true });
  fs.mkdirSync(path.join(dest, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dest, '.git', 'HEAD'), 'ref: refs/heads/master\n');
  fs.writeFileSync(path.join(dest, 'sleepmag.cmd'), 'node "tools\\sleepmag\\cli.mjs" %*\r\n');
  return dest;
}

describe('isOurShortcutName', () => {
  it('matches the shortcuts we create', () => {
    assert.equal(isOurShortcutName('Sleep Network Launcher.lnk'), true);
    assert.equal(isOurShortcutName('Sleep Network Launcher.command'), true);
    assert.equal(isOurShortcutName('sleep-network-launcher.desktop'), true);
    assert.equal(isOurShortcutName('Sleep Network.lnk'), true);
  });

  it('does not match anything else on the desktop', () => {
    assert.equal(isOurShortcutName('Budget 2026.lnk'), false);
    assert.equal(isOurShortcutName('Sleep Network Notes.docx'), false);
    assert.equal(isOurShortcutName(''), false);
  });
});

describe('isRemovableWorkspace', () => {
  it('accepts a real workspace folder', () => {
    const dest = makeWorkspace('ok');
    assert.equal(isRemovableWorkspace(dest, { platform: process.platform }).ok, true);
  });

  it('refuses a folder that is not named sleep-network', () => {
    const dir = path.join(tmpRoot, 'random-folder');
    fs.mkdirSync(dir, { recursive: true });
    const r = isRemovableWorkspace(dir, { platform: process.platform });
    assert.equal(r.ok, false);
    assert.match(r.reason, /workspace folder name/);
  });

  it('refuses a sleep-network folder with nothing of ours in it', () => {
    const dir = path.join(tmpRoot, 'decoy', 'sleep-network');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'holiday-photos.txt'), 'not ours');
    const r = isRemovableWorkspace(dir, { platform: process.platform });
    assert.equal(r.ok, false);
    assert.match(r.reason, /does not look like/);
  });

  it('refuses a system location', () => {
    const r = isRemovableWorkspace('C:\\Windows\\sleep-network', { platform: 'win32' });
    assert.equal(r.ok, false);
  });

  it('refuses the home folder itself', () => {
    const r = isRemovableWorkspace(os.homedir(), { platform: process.platform });
    assert.equal(r.ok, false);
  });

  it('refuses a path that is not there', () => {
    const r = isRemovableWorkspace(path.join(tmpRoot, 'ghost', 'sleep-network'), {
      platform: process.platform,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /nothing there/);
  });
});

describe('removeInstall', () => {
  it('deletes a real workspace', () => {
    const dest = makeWorkspace('to-delete');
    const r = removeInstall(dest, { platform: process.platform });
    assert.equal(r.ok, true);
    assert.equal(r.removed, true);
    assert.equal(fs.existsSync(dest), false);
  });

  it('does not delete in dry-run', () => {
    const dest = makeWorkspace('dry');
    const r = removeInstall(dest, { dryRun: true, platform: process.platform });
    assert.equal(r.removed, false);
    assert.equal(fs.existsSync(dest), true);
  });

  it('refuses anything that fails the guard', () => {
    const dir = path.join(tmpRoot, 'not-ours');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'keep-me.txt'), 'important');
    const r = removeInstall(dir, { platform: process.platform });
    assert.equal(r.ok, false);
    assert.equal(fs.existsSync(path.join(dir, 'keep-me.txt')), true);
  });
});

describe('removeShortcuts', () => {
  it('removes ours and leaves other files alone', () => {
    const desk = path.join(tmpRoot, 'Desktop');
    fs.mkdirSync(desk, { recursive: true });
    const ours = path.join(desk, 'Sleep Network Launcher.lnk');
    const theirs = path.join(desk, 'Budget.lnk');
    fs.writeFileSync(ours, 'x');
    fs.writeFileSync(theirs, 'x');

    const r = removeShortcuts([{ path: ours }, { path: theirs }]);
    assert.deepEqual(r.removed, [ours]);
    assert.equal(fs.existsSync(ours), false);
    assert.equal(fs.existsSync(theirs), true);
  });

  it('dry-run deletes nothing', () => {
    const desk = path.join(tmpRoot, 'Desktop2');
    fs.mkdirSync(desk, { recursive: true });
    const ours = path.join(desk, 'Sleep Network Launcher.lnk');
    fs.writeFileSync(ours, 'x');
    const r = removeShortcuts([ours], { dryRun: true });
    assert.equal(r.removed.length, 1);
    assert.equal(fs.existsSync(ours), true);
  });
});

describe('icon resolution', () => {
  it('treats a zero-byte .ico as unusable', () => {
    const p = path.join(tmpRoot, 'empty.ico');
    fs.writeFileSync(p, '');
    assert.equal(isUsableIcon(p), false);
  });

  it('prefers the icon shipped inside the workspace', () => {
    const dest = makeWorkspace('with-icon');
    const shipped = path.join(dest, 'Sleep Network Launcher.ico');
    fs.writeFileSync(shipped, Buffer.alloc(2048, 1));
    const icon = resolveIcon({ dest });
    assert.equal(icon.ok, true);
    assert.equal(icon.source, 'workspace');
    assert.equal(icon.path, shipped);
  });

  it('copies the installer icon into the workspace when none is shipped', () => {
    const dest = makeWorkspace('no-icon');
    const icon = resolveIcon({ dest });
    assert.equal(icon.ok, true);
    // The repo ships assets/sleepmag-logo.ico, so we expect a copy inside the workspace.
    assert.equal(icon.source, 'copy');
    assert.ok(icon.path.startsWith(dest), 'the icon must live inside the workspace');
    assert.equal(isUsableIcon(icon.path), true);
  });
});
