/**
 * SLEEPNET_* environment parsing.
 *
 * SLEEPNET_MODE=check           — report only, no installs
 * SLEEPNET_NAME / EMAIL / PASSPHRASE — skip prompts
 * SLEEPNET_ASSISTANT=claude|codex|gemini|both|all|none
 * SLEEPNET_DEST=<folder>        — where to install (default: a local folder)
 * SLEEPNET_ALLOW_CLOUD=1        — allow OneDrive/iCloud/Dropbox anyway
 * SLEEPNET_REMOVE_PREVIOUS=1    — delete workspaces found elsewhere
 * SLEEPNET_DRY_RUN=1            — skip mutating side effects (tests / CI)
 */

const ASSISTANTS = new Set(['claude', 'codex', 'gemini', 'both', 'all', 'none']);

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function parseEnv(env = process.env) {
  const mode = String(env.SLEEPNET_MODE || '').trim().toLowerCase();
  const assistantRaw = String(env.SLEEPNET_ASSISTANT || '').trim().toLowerCase();
  const assistant = ASSISTANTS.has(assistantRaw) ? assistantRaw : null;

  return {
    check: mode === 'check',
    dryRun: isOn(env.SLEEPNET_DRY_RUN),
    name: emptyToNull(env.SLEEPNET_NAME),
    email: emptyToNull(env.SLEEPNET_EMAIL),
    passphrase: emptyToNull(env.SLEEPNET_PASSPHRASE),
    assistant,
    dest: emptyToNull(env.SLEEPNET_DEST),
    allowCloud: isOn(env.SLEEPNET_ALLOW_CLOUD),
    removePrevious: isOn(env.SLEEPNET_REMOVE_PREVIOUS),
  };
}

function isOn(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/**
 * Normalize an assistant choice from a prompt digit or keyword.
 * @param {string} raw
 * @returns {'claude'|'codex'|'gemini'|'both'|'all'|'none'}
 */
export function normalizeAssistant(raw) {
  const v = String(raw || '').trim().toLowerCase();
  const map = {
    '1': 'claude',
    claude: 'claude',
    '2': 'codex',
    codex: 'codex',
    '3': 'gemini',
    gemini: 'gemini',
    '4': 'all',
    all: 'all',
    both: 'both', // legacy: Claude + Codex
    '5': 'none',
    none: 'none',
    skip: 'none',
  };
  return map[v] || 'none';
}

/**
 * Which CLI tools a choice should try to install.
 * @param {string} assistant
 * @returns {Array<'claude'|'codex'|'gemini'>}
 */
export function assistantTargets(assistant) {
  switch (assistant) {
    case 'claude':
      return ['claude'];
    case 'codex':
      return ['codex'];
    case 'gemini':
      return ['gemini'];
    case 'both':
      return ['claude', 'codex'];
    case 'all':
      return ['claude', 'codex', 'gemini'];
    default:
      return [];
  }
}

function emptyToNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export { ASSISTANTS };
