/** Clear, consistent user messaging (mirrors install.ps1 Say/Ok). */

export function say(message) {
  console.log(`  ${message}`);
}

export function ok(message) {
  console.log(`  OK  ${message}`);
}

export function banner() {
  console.log('');
  console.log('Sleep Network installer');
  console.log('');
}

export function done(platformHint) {
  console.log('');
  ok(platformHint);
  say('First time only: the assistant asks you to log in with your own Claude / OpenAI account, and Claude asks you to trust the folder. Say yes to both.');
  console.log('');
}
