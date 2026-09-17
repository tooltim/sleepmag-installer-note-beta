import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateInstallInputs } from '../src/validate.js';
import { createLogger, defaultLogPath } from '../src/log.js';
import { STEPS, runInstall } from '../src/runInstall.js';

describe('validateInstallInputs', () => {
  it('requires name, email, passphrase', () => {
    const v = validateInstallInputs({});
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /name/i.test(e)));
    assert.ok(v.errors.some((e) => /e-mail|email/i.test(e)));
    assert.ok(v.errors.some((e) => /passphrase/i.test(e)));
  });

  it('rejects invalid email', () => {
    const v = validateInstallInputs({
      name: 'Ada',
      email: 'not-an-email',
      passphrase: 'secret',
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /invalid/i.test(e)));
  });

  it('accepts valid inputs and defaults assistant to none', () => {
    const v = validateInstallInputs({
      name: '  Ada ',
      email: 'ada@example.com',
      passphrase: 'team-secret',
    });
    assert.equal(v.ok, true);
    assert.equal(v.name, 'Ada');
    assert.equal(v.email, 'ada@example.com');
    assert.equal(v.passphrase, 'team-secret');
    assert.equal(v.assistant, 'none');
  });

  it('keeps known assistants', () => {
    const v = validateInstallInputs({
      name: 'Ada',
      email: 'ada@example.com',
      passphrase: 'x',
      assistant: 'both',
    });
    assert.equal(v.ok, true);
    assert.equal(v.assistant, 'both');
  });
});

describe('logger', () => {
  it('writes a log file and records step events', () => {
    const logPath = path.join(os.tmpdir(), `sleepnet-test-${Date.now()}.log`);
    const logger = createLogger({ logPath });
    logger.step('tools', 'running', 'Install tools');
    logger.ok('git found');
    logger.step('tools', 'ok');
    assert.equal(fs.existsSync(logPath), true);
    const text = fs.readFileSync(logPath, 'utf8');
    assert.match(text, /STEP tools running/);
    assert.match(text, /OK {2}git found/);
    assert.ok(logger.events.some((e) => e.type === 'step' && e.step === 'tools'));
  });

  it('defaultLogPath ends with sleepnet-install.log', () => {
    assert.ok(defaultLogPath().endsWith('sleepnet-install.log'));
  });
});

describe('runInstall step order (dry-run)', () => {
  it('emits tools → workspace → setup → assistants → launcher → open', async () => {
    const seen = [];
    const logPath = path.join(os.tmpdir(), `sleepnet-order-${Date.now()}.log`);
    const logger = createLogger({ logPath });
    logger.onEvent((e) => {
      if (e.type === 'step' && e.status === 'running') seen.push(e.step);
    });

    const result = await runInstall({
      dryRun: true,
      promptIfMissing: false,
      name: 'Ada',
      email: 'ada@example.com',
      passphrase: 'secret',
      assistant: 'none',
      logger,
      env: { ...process.env, SLEEPNET_DRY_RUN: '1' },
    });

    assert.equal(result.mode, 'install');
    assert.deepEqual(seen, STEPS.map((s) => s.id));
    assert.ok(result.logPath);
    assert.equal(typeof result.opened, 'boolean');
  });

  it('fails validation before any install step when inputs missing', async () => {
    const seen = [];
    const logger = createLogger({
      logPath: path.join(os.tmpdir(), `sleepnet-val-${Date.now()}.log`),
    });
    logger.onEvent((e) => {
      if (e.type === 'step') seen.push(e.step);
    });

    await assert.rejects(
      () =>
        runInstall({
          dryRun: true,
          promptIfMissing: false,
          name: '',
          email: '',
          passphrase: '',
          logger,
        }),
      /required|e-mail|passphrase|name/i,
    );
    assert.equal(seen.length, 0);
  });
});
