/** Clear, consistent user messaging (mirrors install.ps1 Say/Ok). */

/** @type {{ say?: (m: string) => void, ok?: (m: string) => void } | null} */
let messenger = null;

/**
 * Optional session messenger used by the step runner / UI so module-level
 * say/ok also land in the install log and event stream.
 * @param {{ say?: (m: string) => void, ok?: (m: string) => void } | null} m
 */
export function setMessenger(m) {
  messenger = m;
}

export function say(message) {
  if (messenger?.say) messenger.say(message);
  else console.log(`  ${message}`);
}

export function ok(message) {
  if (messenger?.ok) messenger.ok(message);
  else console.log(`  OK  ${message}`);
}

export function banner() {
  console.log('');
  console.log('Sleep Network installer');
  console.log('');
}

export function done(platformHint) {
  console.log('');
  ok(platformHint);
  say(
    'First time only: the assistant asks you to log in with your own Claude / OpenAI account, and Claude asks you to trust the folder. Say yes to both.',
  );
  console.log('');
}
