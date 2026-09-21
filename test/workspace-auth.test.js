import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitEnv, looksLikeAuthFailure, ensureWorkspace, isWorkspaceComplete } from '../src/workspace.js';

describe('gitEnv', () => {
  it('disables terminal prompting so a missing invite fails instead of hanging', () => {
    assert.equal(gitEnv({ PATH: '/usr/bin' }).GIT_TERMINAL_PROMPT, '0');
  });

  it('keeps the rest of the environment (credential helpers still work)', () => {
    const e = gitEnv({ PATH: '/usr/bin', HOME: '/home/ina' });
    assert.equal(e.PATH, '/usr/bin');
    assert.equal(e.HOME, '/home/ina');
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
  it('throws, and leaves no usable workspace, when the repo cannot be read', () => {
    const dest = path.join(os.tmpdir(), `sleepnet-auth-${Date.now()}`, 'sleep-network');
    assert.throws(
      () =>
        ensureWorkspace({
          dest,
          gitExe: 'git',
          // Same shape as a teammate without an invite: readable URL, no access.
          repoUrl: 'https://github.com/github/private-does-not-exist-xyz.git',
        }),
      /sleep-network|clone|access/i,
    );
    assert.equal(isWorkspaceComplete(dest), false);
    try {
      fs.rmSync(path.dirname(dest), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});
