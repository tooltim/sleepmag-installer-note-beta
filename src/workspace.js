/**
 * Clone or update the private sleep-network workspace.
 * Hard-fails on auth/clone failures (no false "OK workspace").
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathExists, joinPath } from './platform.js';
import { run, resolveExe } from './exec.js';
import { say, ok } from './say.js';
import { workspaceMarkerPath } from './paths.js';

export const REPO_URL = 'https://github.com/tooltim/sleep-network.git';

/**
 * Git environment for the clone/pull.
 *
 * GIT_TERMINAL_PROMPT=0 matters: with no credential helper installed, git asks
 * for a username on a terminal nobody can see from the installer UI, and the
 * step sits there until the timeout instead of turning red. Credential helpers
 * (Git Credential Manager, gh) are unaffected — they are not terminal prompts,
 * so the browser login still works.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function gitEnv(env = process.env) {
  return { ...env, GIT_TERMINAL_PROMPT: '0' };
}

/**
 * Does this git failure look like "you do not have access"?
 * @param {string} output
 */
export function looksLikeAuthFailure(output) {
  return /repository not found|authentication failed|could not read (username|password)|terminal prompts disabled|permission denied|access denied|403/i.test(
    String(output || ''),
  );
}

/**
 * @param {{ dest: string, gitExe: string, dryRun?: boolean, repoUrl?: string }} opts
 */
export function ensureWorkspace(opts) {
  const dest = opts.dest;
  const git = opts.gitExe;
  const repo = opts.repoUrl || REPO_URL;
  const gitDir = joinPath(dest, '.git');

  if (!pathExists(gitDir)) {
    if (!opts.dryRun && pathExists(dest)) {
      say(`removing incomplete workspace folder at ${dest}…`);
      try {
        fs.rmSync(dest, { recursive: true, force: true });
      } catch (e) {
        throw new Error(
          `Could not remove incomplete workspace at ${dest}: ${e.message || e}. Delete it manually and re-run.`,
        );
      }
    }
    if (!opts.dryRun) ensureGitHubAuthReady();
    say(
      `downloading the workspace into ${dest} (a GitHub login window may open: use your GitHub account)…`,
    );
    if (!opts.dryRun) {
      const r = run(git, ['clone', repo, dest], { timeout: 600_000, env: gitEnv() });
      if (r.code !== 0) {
        const output = r.combined || r.stderr || r.stdout;
        showPrivateRepoAuthHelp(dest);
        const headline = looksLikeAuthFailure(output)
          ? 'GitHub did not let this account read tooltim/sleep-network. Ask Tim for an invite, sign in with that same account, and run the installer again.'
          : `git clone of tooltim/sleep-network failed (exit ${r.code}). Fix GitHub access and re-run; installer will not continue.`;
        throw new Error(`${headline}\n${output}`);
      }
    }
  } else {
    say('workspace already present, updating…');
    if (!opts.dryRun) {
      const r = run(git, ['-C', dest, 'pull', '--ff-only'], {
        timeout: 300_000,
        env: gitEnv(),
      });
      if (r.code !== 0) {
        say(`git pull reported exit ${r.code} (continuing with existing checkout)`);
        if (r.combined) say(r.combined.trim().split('\n').slice(0, 8).join('\n'));
      }
    }
  }

  if (!opts.dryRun) {
    const cli = resolveSleepmagCli(dest);
    if (!pathExists(joinPath(dest, '.git')) || !cli) {
      showPrivateRepoAuthHelp(dest);
      const missing = !cli ? 'tools/sleepmag/cli.mjs' : '.git';
      throw new Error(
        `Workspace incomplete at ${dest} (missing ${missing}) after clone/pull. Delete that folder if it is partial, fix GitHub access to tooltim/sleep-network, and re-run.`,
      );
    }
  }

  ok(`workspace at ${dest}`);
  return dest;
}

export function resolveSleepmagCli(dest) {
  const candidates = [
    joinPath(dest, 'tools', 'sleepmag', 'cli.mjs'),
    path.join(dest, 'tools', 'sleepmag', 'cli.mjs'),
  ];
  for (const c of candidates) {
    if (pathExists(c)) return c;
  }
  return null;
}

export function isWorkspaceComplete(dest) {
  return Boolean(pathExists(joinPath(dest, '.git')) && resolveSleepmagCli(dest));
}

export function isWorkspacePresent(dest, platform = process.platform) {
  return pathExists(workspaceMarkerPath(dest, platform)) || isWorkspaceComplete(dest);
}

function ensureGitHubAuthReady() {
  // Soft tips only — never force interactive gh auth login (that hangs UI / confuses coworkers).
  const gh = resolveExe('gh');
  if (!gh) {
    say('If Git asks you to sign in, use the GitHub account Tim invited to tooltim/sleep-network.');
    return;
  }
  try {
    const st = run(gh, ['auth', 'status'], { timeout: 15_000 });
    if (st.code === 0) {
      run(gh, ['auth', 'setup-git'], { timeout: 15_000 });
      ok('GitHub CLI already signed in');
      return;
    }
    say('GitHub CLI is installed but not signed in. A browser login may appear during download — that is normal.');
  } catch {
    say('If Git asks you to sign in, use the GitHub account Tim invited to tooltim/sleep-network.');
  }
}

function showPrivateRepoAuthHelp(dest) {
  say('Could not download the private workspace. Usually that means GitHub access is missing.');
  say('Fix, then run the installer again:');
  say('  1. Ask Tim to invite your GitHub account to tooltim/sleep-network');
  say('  2. Sign in when Git (or gh) asks — same invited account');
  if (dest) say(`  3. If a half-downloaded folder exists, delete it: ${dest}`);
}
