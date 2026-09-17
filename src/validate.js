/**
 * Validate installer identity inputs before setup runs.
 */

/**
 * @param {{ name?: string|null, email?: string|null, passphrase?: string|null, assistant?: string|null }} input
 * @returns {{ ok: true, name: string, email: string, passphrase: string, assistant: string } | { ok: false, errors: string[] }}
 */
export function validateInstallInputs(input = {}) {
  const errors = [];
  const name = String(input.name ?? '').trim();
  const email = String(input.email ?? '').trim();
  const passphrase = String(input.passphrase ?? '').trim();
  let assistant = String(input.assistant ?? 'none').trim().toLowerCase();

  if (!name) errors.push('First name is required.');
  if (!email) errors.push('Work e-mail is required.');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Work e-mail looks invalid (need something like you@company.com).');
  }
  if (!passphrase) errors.push('Team passphrase is required (Tim gives it to you).');

  const allowed = new Set(['claude', 'codex', 'both', 'none']);
  if (!allowed.has(assistant)) assistant = 'none';

  if (errors.length) return { ok: false, errors };
  return { ok: true, name, email, passphrase, assistant };
}
