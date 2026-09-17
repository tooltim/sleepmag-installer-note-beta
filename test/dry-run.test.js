import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../src/env.js';
import { main } from '../src/index.js';
import { resolveWorkspaceDir } from '../src/paths.js';
import { ensureWorkspace } from '../src/workspace.js';
import { ensureLauncher, doneLooksLike } from '../src/launcher.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('dry-run / check mode integration', () => {
  it('SLEEPNET_MODE=check exits without throwing and reports path', async () => {
    const result = await main({
      env: { ...process.env, SLEEPNET_MODE: 'check' },
    });
    assert.equal(result.mode, 'check');
    assert.ok(result.dest);
    assert.equal(typeof result.workspacePresent, 'boolean');
    assert.equal(path.basename(result.dest), 'sleep-network');
  });

  it('parseEnv check is orthogonal to dry-run', () => {
    const cfg = parseEnv({ SLEEPNET_MODE: 'check', SLEEPNET_DRY_RUN: '1' });
    assert.equal(cfg.check, true);
    assert.equal(cfg.dryRun, true);
  });
});

describe('ensureWorkspace dry-run', () => {
  it('does not clone when dryRun', () => {
    const dest = path.join(os.tmpdir(), `sn-dry-${Date.now()}`, 'sleep-network');
    ensureWorkspace({ dest, gitExe: 'git', dryRun: true });
    assert.equal(fs.existsSync(dest), false);
  });
});

describe('ensureLauncher dry-run', () => {
  it('returns platform-appropriate hint without requiring sleepmag files', () => {
    const dest = path.join(os.tmpdir(), 'fake-sleep-network');
    const r = ensureLauncher({ dest, dryRun: true });
    assert.ok(r.hint);
    assert.ok(r.kind);
    const expected = doneLooksLike(process.platform);
    assert.ok(expected.action.length > 0);
  });
});

describe('resolveWorkspaceDir stability', () => {
  it('is absolute', () => {
    const d = resolveWorkspaceDir();
    assert.ok(path.isAbsolute(d));
  });
});
