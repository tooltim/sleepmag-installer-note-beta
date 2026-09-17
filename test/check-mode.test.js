import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSetupResult } from '../src/setup.js';
import { buildCheckSnapshot } from '../src/index.js';
import { checkReport } from '../src/tools.js';
import { doneLooksLike } from '../src/launcher.js';
import { normalizeAssistant } from '../src/env.js';

describe('evaluateSetupResult (check / soft-continue)', () => {
  it('accepts exit 0', () => {
    assert.equal(evaluateSetupResult('all good', 0).ok, true);
  });

  it('soft-continues when only optional assistants are missing and required steps ok', () => {
    const text = [
      'passphrase stored securely',
      'platform configured',
      '❌ Command not found: claude',
      'Command not found: codex',
    ].join('\n');
    const v = evaluateSetupResult(text, 1);
    assert.equal(v.ok, true);
    assert.match(v.reason, /optional assistant/);
  });

  it('fails when other hard errors remain after scrubbing assistant misses', () => {
    const text = [
      'passphrase stored',
      'platform ok',
      'Command not found: claude',
      'fatal: something else broke',
    ].join('\n');
    const v = evaluateSetupResult(text, 1);
    assert.equal(v.ok, false);
  });

  it('fails when required markers missing even if only assistant miss', () => {
    const text = 'Command not found: claude';
    assert.equal(evaluateSetupResult(text, 1).ok, false);
  });
});

describe('check-mode snapshot', () => {
  it('reports missing tools and absent workspace', () => {
    const snap = buildCheckSnapshot({
      tools: { git: true, node: false, claude: false, codex: false, python: false },
      dest: '/tmp/Documents/sleep-network',
      markerExists: false,
    });
    assert.equal(snap.ready, false);
    assert.ok(snap.lines.some((l) => l.includes('node missing')));
    assert.ok(snap.lines.some((l) => l.includes('workspace: not installed')));
  });

  it('ready when git+node+workspace present', () => {
    const snap = buildCheckSnapshot({
      tools: { git: true, node: true, claude: true, codex: false, python: true },
      dest: 'D:\\Users\\Ada\\Documents\\sleep-network',
      markerExists: true,
    });
    assert.equal(snap.ready, true);
    assert.ok(snap.lines.some((l) => l.includes('OK  git found')));
  });
});

describe('checkReport formatting', () => {
  it('emits one line per tool', () => {
    const lines = checkReport({
      have: { git: true, node: true, claude: false, codex: false, python: false },
      workspacePresent: true,
    });
    assert.equal(lines.length, 6);
    assert.equal(lines.at(-1), 'workspace: present');
  });
});

describe('doneLooksLike', () => {
  it('documents Windows shortcut', () => {
    const d = doneLooksLike('win32');
    assert.match(d.shortcut, /Sleep Network Launcher\.lnk/);
  });
  it('documents macOS .command', () => {
    const d = doneLooksLike('darwin');
    assert.match(d.shortcut, /Sleep Network Launcher\.command/);
  });
});

describe('assistant env mapping used by check flows', () => {
  it('none skips install intent', () => {
    assert.equal(normalizeAssistant('none'), 'none');
  });
});
