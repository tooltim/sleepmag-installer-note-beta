/**
 * SLEEPNET_* environment parsing.
 *
 * SLEEPNET_MODE=check           — report only, no installs
 * SLEEPNET_NAME / EMAIL / PASSPHRASE — skip prompts
 * SLEEPNET_ASSISTANT=claude|codex|both|none
 * SLEEPNET_DRY_RUN=1            — skip mutating side effects (tests / CI)
 */

const ASSISTANTS = new Set(['claude', 'codex', 'both', 'none']);

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function parseEnv(env = process.env) {
  const mode = String(env.SLEEPNET_MODE || '').trim().toLowerCase();
  const assistantRaw = String(env.SLEEPNET_ASSISTANT || '').trim().toLowerCase();
  const assistant = ASSISTANTS.has(assistantRaw) ? assistantRaw : null;

  return {
    check: mode === 'check',
    dryRun: env.SLEEPNET_DRY_RUN === '1' || env.SLEEPNET_DRY_RUN === 'true',
    name: emptyToNull(env.SLEEPNET_NAME),
    email: emptyToNull(env.SLEEPNET_EMAIL),
    passphrase: emptyToNull(env.SLEEPNET_PASSPHRASE),
    assistant,
  };
}

/**
 * Normalize an assistant choice from a prompt digit or keyword.
 * @param {string} raw
 * @returns {'claude'|'codex'|'both'|'none'}
 */
export function normalizeAssistant(raw) {
  const v = String(raw || '').trim().toLowerCase();
  const map = {
    '1': 'claude',
    claude: 'claude',
    '2': 'codex',
    codex: 'codex',
    '3': 'both',
    both: 'both',
    '4': 'none',
    none: 'none',
    skip: 'none',
  };
  return map[v] || 'none';
}

function emptyToNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export { ASSISTANTS };
