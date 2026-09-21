import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectInstall, statusFromChecks, readFileInfo, MIN_BYTES } from '../src/inspect.js';

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sleepnet-inspect-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/**
 * @param {string} name
 * @param {{ git?: boolean, emptyHead?: boolean, cli?: 'full'|'empty'|'none', cmd?: 'full'|'empty'|'none', extras?: boolean }} shape
 */
function makeWorkspace(name, shape) {
  const dest = path.join(tmpRoot, name, 'sleep-network');
  fs.mkdirSync(dest, { recursive: true });

  if (shape.git) {
    fs.mkdirSync(path.join(dest, '.git'), { recursive: true });
    fs.writeFileSync(
      path.join(dest, '.git', 'HEAD'),
      shape.emptyHead ? '' : 'ref: refs/heads/master\n',
    );
  }

  const cliPath = path.join(dest, 'tools', 'sleepmag', 'cli.mjs');
  if (shape.cli && shape.cli !== 'none') {
    fs.mkdirSync(path.dirname(cliPath), { recursive: true });
    fs.writeFileSync(cliPath, shape.cli === 'empty' ? '' : 'x'.repeat(MIN_BYTES.cli + 50));
  }

  const cmdPath = path.join(dest, 'sleepmag.cmd');
  if (shape.cmd && shape.cmd !== 'none') {
    fs.writeFileSync(
      cmdPath,
      shape.cmd === 'empty' ? '' : '@echo off\r\nnode "tools\\sleepmag\\cli.mjs" %*\r\n',
    );
  }

  if (shape.extras) {
    fs.writeFileSync(path.join(dest, 'CLAUDE.md'), '# Sleep Network\n'.repeat(20));
    fs.mkdirSync(path.join(dest, 'sites', 'de'), { recursive: true });
  }
  return dest;
}

describe('readFileInfo', () => {
  it('returns null for a missing file', () => {
    assert.equal(readFileInfo(path.join(tmpRoot, 'nope.txt')), null);
  });

  it('reports the real size', () => {
    const p = path.join(tmpRoot, 'size.txt');
    fs.writeFileSync(p, 'hello');
    assert.equal(readFileInfo(p)?.size, 5);
  });
});

describe('statusFromChecks', () => {
  it('none when the folder does not exist', () => {
    assert.equal(statusFromChecks([{ required: true, ok: true }], false), 'none');
  });
  it('installed when every required check passes', () => {
    assert.equal(
      statusFromChecks([{ required: true, ok: true }, { required: false, ok: false }], true),
      'installed',
    );
  });
  it('partial when some required checks fail', () => {
    assert.equal(
      statusFromChecks([{ required: true, ok: true }, { required: true, ok: false }], true),
      'partial',
    );
  });
});

describe('inspectInstall', () => {
  it('reports "none" and names the path when nothing is there', () => {
    const dest = path.join(tmpRoot, 'missing', 'sleep-network');
    const r = inspectInstall(dest, { platform: 'linux', withGit: false });
    assert.equal(r.status, 'none');
    assert.equal(r.exists, false);
    assert.ok(r.summary.includes(dest), 'the summary must name the exact path');
  });

  it('is NOT installed when sleepmag.cmd is an empty file', () => {
    const dest = makeWorkspace('empty-cmd', {
      git: true,
      cli: 'full',
      cmd: 'empty',
      extras: true,
    });
    const r = inspectInstall(dest, { platform: 'win32', withGit: false });
    assert.equal(r.status, 'partial');
    assert.match(r.problems.join(' '), /empty|does not call/i);
  });

  it('is NOT installed when cli.mjs is empty', () => {
    const dest = makeWorkspace('empty-cli', { git: true, cli: 'empty', cmd: 'full', extras: true });
    const r = inspectInstall(dest, { platform: 'linux', withGit: false });
    assert.equal(r.status, 'partial');
    assert.match(r.problems.join(' '), /truncated or empty/i);
  });

  it('is NOT installed when .git is missing (a copied folder)', () => {
    const dest = makeWorkspace('no-git', { cli: 'full', cmd: 'full', extras: true });
    const r = inspectInstall(dest, { platform: 'linux', withGit: false });
    assert.equal(r.status, 'partial');
    assert.match(r.problems.join(' '), /copy, not a clone/i);
  });

  it('is NOT installed when .git/HEAD is empty', () => {
    const dest = makeWorkspace('empty-head', {
      git: true,
      emptyHead: true,
      cli: 'full',
      cmd: 'full',
      extras: true,
    });
    const r = inspectInstall(dest, { platform: 'linux', withGit: false });
    assert.equal(r.status, 'partial');
  });

  it('reports installed, with the exact path, for a complete workspace', () => {
    const dest = makeWorkspace('good', { git: true, cli: 'full', cmd: 'full', extras: true });
    const r = inspectInstall(dest, { platform: 'win32', withGit: false });
    assert.equal(r.status, 'installed');
    assert.equal(r.problems.length, 0);
    assert.ok(r.summary.startsWith('Installed at '));
    assert.ok(r.summary.includes(dest));
  });

  it('every check carries a path or a concrete detail', () => {
    const dest = makeWorkspace('details', { git: true, cli: 'full', cmd: 'full', extras: true });
    const r = inspectInstall(dest, { platform: 'win32', withGit: false });
    for (const c of r.checks) {
      assert.ok(c.detail && c.detail.length > 3, `check ${c.id} must explain itself`);
    }
    const cli = r.checks.find((c) => c.id === 'cli');
    assert.ok(cli.detail.includes(path.join(dest, 'tools', 'sleepmag', 'cli.mjs')));
  });

  it('flags a workspace sitting in OneDrive', () => {
    const dest = makeWorkspace('od', { git: true, cli: 'full', cmd: 'full', extras: true });
    const r = inspectInstall(dest, {
      platform: 'win32',
      withGit: false,
      env: { OneDrive: path.join(tmpRoot, 'od') },
    });
    assert.equal(r.cloud?.id, 'onedrive');
  });
});
