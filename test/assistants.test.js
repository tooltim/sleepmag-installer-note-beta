import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { manualInstallCommand } from '../src/assistants.js';
import { ensureUserPath } from '../src/exec.js';
import { startUiServer } from '../src/ui/server.js';

describe('assistants', () => {
  it('gives a paste-able manual install command per platform', () => {
    assert.match(manualInstallCommand('claude', 'win32'), /claude\.ai\/install\.ps1/);
    assert.match(manualInstallCommand('claude', 'darwin'), /claude\.ai\/install\.sh/);
    assert.match(manualInstallCommand('codex', 'win32'), /@openai\/codex/);
    assert.equal(manualInstallCommand('nope', 'win32'), '');
  });

  it('ensureUserPath is a no-op off Windows and in dry-run', () => {
    assert.deepEqual(ensureUserPath('/x', { platform: 'darwin' }), { added: false });
    assert.deepEqual(ensureUserPath('C:/x', { platform: 'win32', dryRun: true }), { added: false });
  });

  it('the UI reports which assistants are already installed', async () => {
    const ui = await startUiServer({ openBrowser: false, exitWhenDone: false });
    try {
      const meta = await fetch(`${ui.url}api/meta`).then((r) => r.json());
      for (const k of ['claude', 'codex', 'gemini']) {
        assert.ok(k in meta.assistants, `${k} missing from /api/meta`);
        assert.equal(typeof meta.assistants[k].manual, 'string');
      }
      const step = meta.steps.find((s) => s.id === 'assistants');
      assert.equal(step.label, 'AI assistant');
      assert.ok(ui.finished instanceof Promise);
    } finally {
      ui.server.closeAllConnections?.();
      await ui.close();
    }
  });
});
