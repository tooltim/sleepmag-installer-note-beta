/**
 * Clone or update the private sleep-network workspace.
 */

import { pathExists, joinPath } from './platform.js';
import { run } from './exec.js';
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
    say(`downloading the workspace into ${dest} (a GitHub login window may open: use your GitHub account)…`);
    if (!opts.dryRun) {
      const r = run(git, ['clone', '-q', repo, dest], { timeout: 600_000 });
      if (r.code !== 0) {
        throw new Error(
          `git clone failed (exit ${r.code}). Ensure you have access to tooltim/sleep-network and retry.\n${r.stderr || r.stdout}`,
        );
      }
    }
  } else {
    say('workspace already present, updating…');
    if (!opts.dryRun) {
      const r = run(git, ['-C', dest, 'pull', '-q', '--ff-only'], { timeout: 300_000 });
      if (r.code !== 0) {
        say(`git pull reported exit ${r.code} (continuing with existing checkout)`);
      }
    }
  }
  ok(`workspace at ${dest}`);
  return dest;
}

export function isWorkspacePresent(dest, platform = process.platform) {
  return pathExists(workspaceMarkerPath(dest, platform));
}
