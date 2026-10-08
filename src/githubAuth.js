/**
 * Make sure git can read the private workspace BEFORE cloning it.
 *
 * The installer runs git from a hidden background process, so a credential
 * prompt raised during the clone itself opens where nobody sees it and the
 * step sits until its timeout. Instead: probe access silently (prompts off);
 * if the probe needs a login, open the sign-in in its own VISIBLE window and
 * wait for the probe to pass.
 */

import { spawn } from 'node:child_process';
import { run, resolveExe, sleep } from './exec.js';
import { say, ok } from './say.js';
import { platformInfo } from './platform.js';

const SIGNIN_WAIT_MS = 10 * 60_000;
const POLL_MS = 5_000;
const GH_LOGIN_ARGS = ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'];

/**
 * Environment for a probe that must never prompt: no terminal prompt and no
 * Git Credential Manager window. Stored credentials are still used.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function probeEnv(env = process.env) {
  return { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
}

/**
 * What a silent `git ls-remote` result means.
 * - ok:        this machine can read the repo
 * - no-access: signed in, but that account cannot see the repo (wrong account / no invite)
 * - signin:    no usable GitHub login on this machine
 * - network:   GitHub could not be reached
 * - unknown:   anything else (the output is shown as is)
 * @param {{ code: number, combined?: string, error?: Error|null }} r
 */
export function classifyProbe(r) {
  if (r.code === 0) return 'ok';
  const out = String(r.combined || '');
  if (/repository not found|\b403\b|permission denied|access denied/i.test(out)) return 'no-access';
  if (
    /could not read (username|password)|terminal prompts disabled|authentication failed|interactivity has been disabled|cannot prompt|\b401\b/i.test(
      out,
    )
  ) {
    return 'signin';
  }
  if (
    r.error ||
    /could not resolve host|failed to connect|timed out|connection (reset|refused)|unable to access/i.test(out)
  ) {
    return 'network';
  }
  return 'unknown';
}

/**
 * Silent access probe.
 * @param {string} git
 * @param {string} repo
 */
export function probeAccess(git, repo) {
  const r = run(git, ['ls-remote', '--heads', repo], { timeout: 45_000, env: probeEnv() });
  return { kind: classifyProbe(r), output: r.combined || (r.error ? String(r.error.message) : '') };
}

/**
 * How to open a visible sign-in on this machine, or null when nothing can.
 * Git Credential Manager first (ships with Git for Windows), then GitHub CLI.
 * @param {{ platform?: string, git: string, gcm: boolean, gh: string|null }} opts
 * @returns {{ tool: string, cmd: string, args: string[] } | null}
 */
export function signInCommand({ platform = process.platform, git, gcm, gh }) {
  const info = platformInfo(platform);
  const title = 'Sign in to GitHub';
  if (info.isWin) {
    if (gcm) {
      return {
        tool: 'Git Credential Manager',
        cmd: 'cmd.exe',
        args: ['/c', 'start', `"${title}"`, `"${git}"`, 'credential-manager', 'github', 'login', '--browser'],
      };
    }
    if (gh) {
      return {
        tool: 'GitHub CLI',
        cmd: 'cmd.exe',
        args: ['/c', 'start', `"${title}"`, `"${gh}"`, ...GH_LOGIN_ARGS],
      };
    }
    return null;
  }
  if (info.isMac) {
    let line = null;
    let tool = null;
    if (gcm) {
      line = `'${git}' credential-manager github login --browser`;
      tool = 'Git Credential Manager';
    } else if (gh) {
      line = `'${gh}' ${GH_LOGIN_ARGS.join(' ')}`;
      tool = 'GitHub CLI';
    }
    if (!line) return null;
    const escaped = line.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return {
      tool,
      cmd: 'osascript',
      args: ['-e', `tell application "Terminal" to do script "${escaped}"`, '-e', 'tell application "Terminal" to activate'],
    };
  }
  return null;
}

/**
 * A gh login only helps git once gh is registered as git's credential helper.
 * Run after the visible `gh auth login` window, so the sign-in stays one step.
 */
function linkGhToGit(gh) {
  if (gh && run(gh, ['auth', 'status'], { timeout: 15_000 }).code === 0) {
    run(gh, ['auth', 'setup-git'], { timeout: 15_000 });
  }
}

/**
 * A Mac has no Git Credential Manager, so GitHub CLI is the only way to sign in.
 * install.sh already brews it; this covers `npx` / `node bin/install.js` runs.
 * @returns {string|null}
 */
function installGhWithBrew() {
  const brew = resolveExe('brew');
  if (!brew) return null;
  say('installing GitHub CLI (needed to sign in to GitHub on a Mac)…');
  run(brew, ['install', 'gh'], { timeout: 600_000 });
  return resolveExe('gh');
}

function hasGcm(git) {
  return run(git, ['credential-manager', '--version'], { timeout: 15_000 }).code === 0;
}

function noAccessError(output) {
  if (platformInfo().isMac) {
    return new Error(
      'You are signed in to GitHub, but that account cannot read tooltim/sleep-network. ' +
        'Either the invite is not accepted yet (open https://github.com/tooltim/sleep-network/invitations), ' +
        'or this Mac is signed in with a different GitHub account: run `gh auth logout`, then `gh auth login` ' +
        'with the account Tim invited, then run the installer again.\n' +
        output,
    );
  }
  return new Error(
    'You are signed in to GitHub, but that account cannot read tooltim/sleep-network. ' +
      'Either the invite is not accepted yet (open https://github.com/tooltim/sleep-network/invitations), ' +
      'or this computer is signed in with a different GitHub account: remove it in Windows Credential Manager ' +
      '(Windows Credentials, entry git:https://github.com) or with `git credential-manager github logout <account>`, then run the installer again.\n' +
      output,
  );
}

/**
 * Verify (and if needed obtain) read access to the workspace repo.
 * @param {{ git: string, repo: string, interactive?: boolean, waitMs?: number, pollMs?: number }} opts
 */
export async function ensureGitHubAccess(opts) {
  const { git, repo } = opts;
  const interactive = opts.interactive !== false;

  say('checking your GitHub access to tooltim/sleep-network…');
  let probe = probeAccess(git, repo);
  if (probe.kind === 'ok') {
    ok('GitHub access confirmed');
    return;
  }
  if (probe.kind === 'no-access') throw noAccessError(probe.output);
  if (probe.kind === 'network') {
    throw new Error(`Could not reach GitHub. Check the internet connection (VPN, proxy) and run the installer again.\n${probe.output}`);
  }
  if (probe.kind === 'unknown') {
    throw new Error(`git could not check access to tooltim/sleep-network.\n${probe.output}`);
  }

  // probe.kind === 'signin'
  let gh = resolveExe('gh');
  if (!gh && platformInfo().isMac && !hasGcm(git)) gh = installGhWithBrew();
  if (gh) {
    linkGhToGit(gh);
    probe = probeAccess(git, repo);
    if (probe.kind === 'ok') {
      ok('GitHub access confirmed (GitHub CLI login)');
      return;
    }
    if (probe.kind === 'no-access') throw noAccessError(probe.output);
  }

  const signIn = signInCommand({ git, gcm: hasGcm(git), gh });
  if (!signIn) {
    throw new Error(
      'This computer has no way to sign in to GitHub for git. Reinstall Git for Windows from https://git-scm.com ' +
        'with the default options (they include Git Credential Manager), or install GitHub CLI (`winget install GitHub.cli` / `brew install gh`), then run the installer again.',
    );
  }
  if (!interactive) {
    throw new Error(`Not signed in to GitHub (sign-in via ${signIn.tool} is needed).\n${probe.output}`);
  }

  say('You are not signed in to GitHub on this computer yet.');
  say(`Opening a "Sign in to GitHub" window (${signIn.tool}). If you do not see it, check the taskbar.`);
  say('Sign in with the GitHub account Tim invited, then come back here: the install continues by itself.');
  if (platformInfo().isMac) {
    say('In that Terminal window: press Enter, copy the code it shows, paste it in the GitHub page, approve.');
  }
  spawn(signIn.cmd, signIn.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    windowsVerbatimArguments: signIn.cmd === 'cmd.exe',
  }).unref();

  const waitMs = opts.waitMs ?? SIGNIN_WAIT_MS;
  const pollMs = opts.pollMs ?? POLL_MS;
  const deadline = Date.now() + waitMs;
  let nextReminder = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    if (signIn.tool === 'GitHub CLI') linkGhToGit(gh);
    probe = probeAccess(git, repo);
    if (probe.kind === 'ok') {
      ok('signed in to GitHub, access confirmed');
      return;
    }
    if (probe.kind === 'no-access') throw noAccessError(probe.output);
    if (Date.now() >= nextReminder) {
      say('still waiting for the GitHub sign-in…');
      nextReminder = Date.now() + 60_000;
    }
  }
  throw new Error(
    'The GitHub sign-in was not completed within 10 minutes. Run the installer again and finish the "Sign in to GitHub" window (check the taskbar if it is hidden).',
  );
}
