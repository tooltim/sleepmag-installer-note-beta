import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseEnv, normalizeAssistant, assistantTargets } from '../src/env.js';

describe('parseEnv', () => {
  it('detects check mode', () => {
    const cfg = parseEnv({ SLEEPNET_MODE: 'check' });
    assert.equal(cfg.check, true);
  });

  it('is case-insensitive for mode', () => {
    assert.equal(parseEnv({ SLEEPNET_MODE: 'CHECK' }).check, true);
  });

  it('reads identity fields and trims', () => {
    const cfg = parseEnv({
      SLEEPNET_NAME: '  Ada  ',
      SLEEPNET_EMAIL: 'ada@example.com',
      SLEEPNET_PASSPHRASE: ' secret ',
    });
    assert.equal(cfg.name, 'Ada');
    assert.equal(cfg.email, 'ada@example.com');
    assert.equal(cfg.passphrase, 'secret');
  });

  it('treats empty strings as null', () => {
    const cfg = parseEnv({ SLEEPNET_NAME: '  ', SLEEPNET_EMAIL: '' });
    assert.equal(cfg.name, null);
    assert.equal(cfg.email, null);
  });

  it('accepts valid assistants and rejects unknown', () => {
    assert.equal(parseEnv({ SLEEPNET_ASSISTANT: 'claude' }).assistant, 'claude');
    assert.equal(parseEnv({ SLEEPNET_ASSISTANT: 'gemini' }).assistant, 'gemini');
    assert.equal(parseEnv({ SLEEPNET_ASSISTANT: 'all' }).assistant, 'all');
    assert.equal(parseEnv({ SLEEPNET_ASSISTANT: 'both' }).assistant, 'both');
    assert.equal(parseEnv({ SLEEPNET_ASSISTANT: 'nope' }).assistant, null);
  });

  it('detects dry-run', () => {
    assert.equal(parseEnv({ SLEEPNET_DRY_RUN: '1' }).dryRun, true);
    assert.equal(parseEnv({ SLEEPNET_DRY_RUN: 'true' }).dryRun, true);
    assert.equal(parseEnv({}).dryRun, false);
  });
});

describe('normalizeAssistant', () => {
  it('maps digits and keywords', () => {
    assert.equal(normalizeAssistant('1'), 'claude');
    assert.equal(normalizeAssistant('2'), 'codex');
    assert.equal(normalizeAssistant('3'), 'gemini');
    assert.equal(normalizeAssistant('4'), 'all');
    assert.equal(normalizeAssistant('5'), 'none');
    assert.equal(normalizeAssistant('Claude'), 'claude');
    assert.equal(normalizeAssistant('gemini'), 'gemini');
    assert.equal(normalizeAssistant('both'), 'both');
    assert.equal(normalizeAssistant('skip'), 'none');
    assert.equal(normalizeAssistant('garbage'), 'none');
  });
});

describe('assistantTargets', () => {
  it('expands choices to installable CLIs', () => {
    assert.deepEqual(assistantTargets('gemini'), ['gemini']);
    assert.deepEqual(assistantTargets('both'), ['claude', 'codex']);
    assert.deepEqual(assistantTargets('all'), ['claude', 'codex', 'gemini']);
    assert.deepEqual(assistantTargets('none'), []);
  });
});

void path;
