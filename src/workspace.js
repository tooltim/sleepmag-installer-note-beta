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
      const r = run(git, ['clone', repo, dest], { timeout: 600_000 });
      if (r.code !== 0) {
        showPrivateRepoAuthHelp(dest);
        throw new Error(
          `git clone of tooltim/sleep-network failed (exit ${r.code}). Fix GitHub access and re-run; installer will not continue.\n${r.combined || r.stderr || r.stdout}`,
        );
      }
    }
  } else {
    say('workspace already present, updating…');
    if (!opts.dryRun) {
      const r = run(git, ['-C', dest, 'pull', '--ff-only'], { timeout: 300_000 });
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
  const gh = resolveExe('gh');
  if (!gh) {
    say(
      'Tip: for reliable private-repo access, install GitHub CLI (winget install --id GitHub.cli -e --source winget) then run: gh auth login',
    );
    say(
      'Otherwise Git Credential Manager may open a browser during clone — sign in with an account that has access to tooltim/sleep-network.',
    );
    return;
  }
  const st = run(gh, ['auth', 'status'], { timeout: 30_000 });
  if (st.code === 0) {
    run(gh, ['auth', 'setup-git'], { timeout: 30_000 });
    ok('GitHub CLI authenticated');
    return;
  }
  say('GitHub CLI found but not logged in — starting gh auth login (browser)…');
  say('Use the same GitHub account Tim invited to tooltim/sleep-network.');
  const login = run(gh, ['auth', 'login', '-h', 'github.com', '-p', 'https', '-w'], {
    timeout: 600_000,
  });
  if (login.code === 0) {
    run(gh, ['auth', 'setup-git'], { timeout: 30_000 });
    ok('GitHub CLI authenticated');
    return;
  }
  say(
    `gh auth login did not finish (exit ${login.code}). Git may still prompt via Credential Manager during clone.`,
  );
}

function showPrivateRepoAuthHelp(dest) {
  say('tooltim/sleep-network is a PRIVATE GitHub repo — clone fails with "Repository not found" if you lack access or are not signed in.');
  say('Fix, then re-run this installer:');
  say('  1. Ask Tim to invite your GitHub account to https://github.com/tooltim/sleep-network');
  say('  2. Sign in on this PC (preferred):  gh auth login');
  say('     Or approve the Git Credential Manager / browser prompt when Git asks.');
  say('  3. Confirm access:  gh auth status');
  say('     and:  git ls-remote https://github.com/tooltim/sleep-network.git');
  if (dest) say(`  4. If a half-downloaded folder exists, delete it:  ${dest}`);
}
