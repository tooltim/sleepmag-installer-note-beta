import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { looksLikeAuthFailure, ensureWorkspace, isWorkspaceComplete } from '../src/workspace.js';
import { probeEnv, classifyProbe, signInCommand } from '../src/githubAuth.js';

describe('probeEnv', () => {
  it('turns off every prompt, so a hidden git never waits for a login nobody sees', () => {
    const e = probeEnv({ PATH: '/usr/bin' });
    assert.equal(e.GIT_TERMINAL_PROMPT, '0');
    assert.equal(e.GCM_INTERACTIVE, 'never');
  });

  it('keeps the rest of the environment (stored credentials still work)', () => {
    const e = probeEnv({ PATH: '/usr/bin', HOME: '/home/ina' });
    assert.equal(e.PATH, '/usr/bin');
    assert.equal(e.HOME, '/home/ina');
  });
});

describe('classifyProbe', () => {
  const fail = (combined, extra = {}) => classifyProbe({ code: 128, combined, ...extra });

  it('ok when ls-remote succeeds', () => {
    assert.equal(classifyProbe({ code: 0, combined: 'abc\trefs/heads/master' }), 'ok');
  });

  it('signin when this computer has no GitHub login', () => {
    assert.equal(
      fail("fatal: Cannot prompt because user interactivity has been disabled.\nfatal: could not read Username for 'https://github.com': terminal prompts disabled"),
      'signin',
    );
    assert.equal(fail('fatal: Authentication failed for https://github.com/...'), 'signin');
  });

  it('no-access when signed in with an account that cannot see the repo', () => {
    assert.equal(fail("remote: Repository not found.\nfatal: repository '...' not found"), 'no-access');
  });

  it('network when GitHub cannot be reached', () => {
    assert.equal(fail("fatal: unable to access '...': Could not resolve host: github.com"), 'network');
    assert.equal(classifyProbe({ code: 1, combined: '', error: new Error('spawnSync git ETIMEDOUT') }), 'network');
  });
});

describe('signInCommand', () => {
  it('Windows + Git Credential Manager: opens its own visible window', () => {
    const git = 'C:\\Program Files\\Git\\cmd\\git.exe';
    const c = signInCommand({ platform: 'win32', git, gcm: true, gh: null });
    assert.equal(c.tool, 'Git Credential Manager');
    assert.equal(c.cmd, 'cmd.exe');
    assert.deepEqual(c.args.slice(0, 2), ['/c', 'start']);
    assert.ok(c.args.includes(`"${git}"`), 'git path is quoted');
    assert.deepEqual(c.args.slice(-4), ['credential-manager', 'github', 'login', '--browser']);
  });

  it('Windows without GCM falls back to GitHub CLI', () => {
    const c = signInCommand({ platform: 'win32', git: 'git', gcm: false, gh: 'C:\\gh\\gh.exe' });
    assert.equal(c.tool, 'GitHub CLI');
    assert.ok(c.args.includes('login') && c.args.includes('--web'));
  });

  it('macOS opens Terminal', () => {
    const c = signInCommand({ platform: 'darwin', git: '/usr/bin/git', gcm: false, gh: '/opt/homebrew/bin/gh' });
    assert.equal(c.cmd, 'osascript');
    assert.match(c.args[1], /gh' auth login/);
  });

  it('null when nothing on the machine can sign in', () => {
    assert.equal(signInCommand({ platform: 'win32', git: 'git', gcm: false, gh: null }), null);
    assert.equal(signInCommand({ platform: 'linux', git: 'git', gcm: true, gh: '/usr/bin/gh' }), null);
  });
});

describe('looksLikeAuthFailure', () => {
  it('recognises what GitHub says when you are not invited', () => {
    assert.equal(looksLikeAuthFailure('remote: Repository not found.'), true);
    assert.equal(looksLikeAuthFailure('fatal: Authentication failed for ...'), true);
    assert.equal(
      looksLikeAuthFailure('fatal: could not read Username for https://github.com'),
      true,
    );
    assert.equal(looksLikeAuthFailure('terminal prompts disabled'), true);
  });

  it('does not claim an auth problem for other failures', () => {
    assert.equal(looksLikeAuthFailure('fatal: unable to access: Could not resolve host'), false);
    assert.equal(looksLikeAuthFailure('error: disk full'), false);
    assert.equal(looksLikeAuthFailure(''), false);
  });
});

describe('ensureWorkspace refuses to report success it did not earn', () => {
  it('throws, and leaves no usable workspace, when the repo cannot be read', async () => {
    const dest = path.join(os.tmpdir(), `sleepnet-auth-${Date.now()}`, 'sleep-network');
    await assert.rejects(
      ensureWorkspace({
        dest,
        gitExe: 'git',
        // Same shape as a teammate without an invite: readable URL, no access.
        repoUrl: 'https://github.com/github/private-does-not-exist-xyz.git',
        // Never open a real sign-in window from a test.
        interactiveSignIn: false,
      }),
      /sleep-network|clone|access|sign|GitHub/i,
    );
    assert.equal(isWorkspaceComplete(dest), false);
    try {
      fs.rmSync(path.dirname(dest), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});
