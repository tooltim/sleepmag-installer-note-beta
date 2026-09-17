/**
 * Main installer orchestration.
 */

import { parseEnv } from './env.js';
import { banner, say, ok, done } from './say.js';
import { resolveWorkspaceDir } from './paths.js';
import { resolveExe, refreshPath } from './exec.js';
import { ensureTools, checkReport } from './tools.js';
import { ensureWorkspace, isWorkspacePresent } from './workspace.js';
import { resolveAndInstallAssistants } from './assistants.js';
import { runSleepmagSetup } from './setup.js';
import { ensureLauncher } from './launcher.js';
import { pathExists } from './platform.js';

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 */
export async function main(options = {}) {
  const env = options.env || process.env;
  const cfg = parseEnv(env);

  banner();

  if (cfg.check) {
    refreshPath(env);
    const have = {
      git: Boolean(resolveExe('git', { env })),
      node: Boolean(resolveExe('node', { env })),
      claude: Boolean(resolveExe('claude', { env })),
      codex: Boolean(resolveExe('codex', { env })),
      python: Boolean(resolveExe('python', { env }) || resolveExe('python3', { env })),
    };
    const dest = resolveWorkspaceDir({ env });
    const workspacePresent = isWorkspacePresent(dest);
    for (const line of checkReport({ have, workspacePresent })) {
      if (line.startsWith('OK')) ok(line.slice(4).trim());
      else say(line);
    }
    say(`documents/workspace path: ${dest}`);
    return { mode: 'check', have, dest, workspacePresent };
  }

  const { git, node } = await ensureTools({ dryRun: cfg.dryRun });

  const dest = resolveWorkspaceDir({ env });
  ensureWorkspace({ dest, gitExe: git, dryRun: cfg.dryRun });

  await resolveAndInstallAssistants({
    assistant: cfg.assistant,
    dryRun: cfg.dryRun,
  });

  await runSleepmagSetup({
    dest,
    nodeExe: node,
    name: cfg.name,
    email: cfg.email,
    passphrase: cfg.passphrase,
    dryRun: cfg.dryRun,
  });

  const launcher = ensureLauncher({ dest, dryRun: cfg.dryRun });
  done(launcher.hint);

  return { mode: 'install', dest, launcher };
}

/**
 * Exported for tests: check-mode decision without I/O beyond path resolve helpers.
 */
export function buildCheckSnapshot({ tools, dest, markerExists }) {
  return {
    lines: checkReport({
      have: tools,
      workspacePresent: markerExists,
    }),
    dest,
    ready: Boolean(tools.git && tools.node && markerExists),
  };
}

void pathExists;
