import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  macCommandScript,
  macPathLine,
  ensureMacShellPath,
  macProfileFile,
  MAC_LOCAL_BIN_LINE,
  opensAsApp,
} from '../src/launcher.js';
import {
  syncedRoots,
  detectCloudSync,
  validateDestination,
  destinationCandidates,
} from '../src/destination.js';

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sleepnet-mac-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('macOS desktop .command', () => {
  const dest = '/Users/ina/sleep-network';
  const entry = '/Users/ina/sleep-network/tools/sleepmag/launcher/run.mjs';

  it('puts Homebrew on PATH before calling node', () => {
    const s = macCommandScript(dest, entry);
    const pathAt = s.indexOf('export PATH="/opt/homebrew/bin:/usr/local/bin:');
    const nodeAt = s.indexOf('exec node');
    assert.ok(pathAt > 0, 'PATH line present');
    assert.ok(pathAt < nodeAt, 'PATH set before node runs');
  });

  it('starts the browser launcher entry, from the workspace', () => {
    const s = macCommandScript(dest, entry);
    assert.match(s, /^#!\/bin\/bash\n/);
    assert.ok(s.includes(`cd '${dest}' || exit 1`));
    assert.ok(s.includes(`exec node '${entry}' "$@"`));
  });

  it('quotes paths with spaces and apostrophes', () => {
    const s = macCommandScript("/Users/l'ina/my stuff/sleep-network", entry);
    assert.ok(s.includes(`cd '/Users/l'\\''ina/my stuff/sleep-network'`));
  });
});

describe('macOS PATH for sleepmag', () => {
  it('appends the workspace to ~/.zprofile once', () => {
    const home = path.join(tmpRoot, 'home-path');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, '.zprofile'), 'eval "$(/opt/homebrew/bin/brew shellenv)"\n');
    const dest = '/Users/ina/sleep-network';

    const first = ensureMacShellPath({ dest, home, shell: '/bin/zsh' });
    assert.equal(first.changed, true);
    const second = ensureMacShellPath({ dest, home, shell: '/bin/zsh' });
    assert.equal(second.changed, false);

    const body = fs.readFileSync(path.join(home, '.zprofile'), 'utf8');
    assert.equal(body.split(macPathLine(dest)).length - 1, 1, 'line written exactly once');
    assert.equal(body.split(MAC_LOCAL_BIN_LINE).length - 1, 1, '~/.local/bin (claude) written exactly once');
    assert.ok(body.startsWith('eval "$(/opt/homebrew/bin/brew shellenv)"'), 'existing profile kept');
  });

  it('creates ~/.zprofile when there is none, and writes nothing in dry-run', () => {
    const home = path.join(tmpRoot, 'home-new');
    fs.mkdirSync(home, { recursive: true });
    const dry = ensureMacShellPath({ dest: '/x/sleep-network', home, shell: '/bin/zsh', dryRun: true });
    assert.equal(dry.changed, true);
    assert.equal(fs.existsSync(path.join(home, '.zprofile')), false);
    ensureMacShellPath({ dest: '/x/sleep-network', home, shell: '/bin/zsh' });
    assert.ok(fs.readFileSync(path.join(home, '.zprofile'), 'utf8').includes("export PATH='/x/sleep-network'"));
  });
});

describe('macOS login profile', () => {
  it('is ~/.zprofile for zsh (the default) and ~/.bash_profile for bash accounts', () => {
    assert.equal(macProfileFile('/Users/ina', '/bin/zsh'), path.join('/Users/ina', '.zprofile'));
    assert.equal(macProfileFile('/Users/ina', ''), path.join('/Users/ina', '.zprofile'));
    assert.equal(macProfileFile('/Users/ina', '/bin/bash'), path.join('/Users/ina', '.bash_profile'));
  });

  it('adds only the line that is missing', () => {
    const home = path.join(tmpRoot, 'home-partial');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, '.bash_profile'), `${MAC_LOCAL_BIN_LINE}\n`);
    ensureMacShellPath({ dest: '/y/sleep-network', home, shell: '/bin/bash' });
    const body = fs.readFileSync(path.join(home, '.bash_profile'), 'utf8');
    assert.equal(body.split(MAC_LOCAL_BIN_LINE).length - 1, 1);
    assert.ok(body.includes(macPathLine('/y/sleep-network')));
    assert.equal(fs.existsSync(path.join(home, '.zprofile')), false);
  });
});

describe('opening the launcher on macOS', () => {
  it('only treats .command / .app as something that opens', () => {
    assert.equal(opensAsApp('/Users/ina/Desktop/Sleep Network Launcher.command', 'darwin'), true);
    assert.equal(opensAsApp('/Users/ina/sleep-network/tools/sleepmag/launcher/run.mjs', 'darwin'), false);
  });

  it('changes nothing on Windows or Linux', () => {
    assert.equal(opensAsApp('C:\\Users\\ina\\sleep-network\\Sleep Network Launcher.cmd', 'win32'), true);
    assert.equal(opensAsApp('C:\\Users\\ina\\Desktop\\Sleep Network Launcher.lnk', 'win32'), true);
    assert.equal(opensAsApp('/home/ina/.local/share/applications/x.desktop', 'linux'), true);
  });
});

describe('iCloud Desktop & Documents', () => {
  const home = '/Users/ina';

  it('is detected even though ~/Documents keeps its usual path', () => {
    const roots = syncedRoots({ platform: 'darwin', home, iCloudDesktopDocuments: true });
    const hit = detectCloudSync('/Users/ina/Documents/sleep-network', { syncedRoots: roots });
    assert.equal(hit?.id, 'icloud');
    assert.equal(detectCloudSync('/Users/ina/sleep-network', { syncedRoots: roots }), null);
  });

  it('is off when iCloud does not sync Documents', () => {
    assert.deepEqual(syncedRoots({ platform: 'darwin', home, iCloudDesktopDocuments: false }), []);
  });

  it('never applies outside macOS', () => {
    assert.deepEqual(syncedRoots({ platform: 'win32', home: 'C:\\Users\\ina', iCloudDesktopDocuments: true }), []);
    assert.deepEqual(syncedRoots({ platform: 'linux', home: '/home/ina', iCloudDesktopDocuments: true }), []);
  });

  it('defaults to the home folder and refuses synced Documents', () => {
    const ctx = {
      platform: 'darwin',
      home,
      env: {},
      documentsDir: '/Users/ina/Documents',
      iCloudDesktopDocuments: true,
      probe: false,
    };
    assert.equal(validateDestination(null, ctx).dest, '/Users/ina/sleep-network');
    const synced = validateDestination('/Users/ina/Documents', ctx);
    assert.equal(synced.ok, false);
    assert.match(synced.errors.join(' '), /iCloud/);
    const docs = destinationCandidates(ctx).find((c) => c.label === 'Documents');
    assert.equal(docs?.cloud?.id, 'icloud');
  });

  it('keeps Documents as the default on a Mac without it', () => {
    const ctx = {
      platform: 'darwin',
      home,
      env: {},
      documentsDir: '/Users/ina/Documents',
      iCloudDesktopDocuments: false,
      probe: false,
    };
    assert.equal(validateDestination(null, ctx).dest, '/Users/ina/Documents/sleep-network');
  });
});
