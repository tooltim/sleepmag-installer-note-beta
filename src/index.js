/**
 * Main installer entry (CLI / check / UI orchestration helpers).
 */

import { parseEnv } from './env.js';
import { setMessenger, banner, say, ok } from './say.js';
import { createLogger } from './log.js';
import { runInstall } from './runInstall.js';
import { resolveWorkspaceDir } from './paths.js';
import { resolveExe, refreshPath } from './exec.js';
import { checkReport } from './tools.js';
import { isWorkspacePresent } from './workspace.js';

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   name?: string|null,
 *   email?: string|null,
 *   passphrase?: string|null,
 *   assistant?: string|null,
 *   dryRun?: boolean,
 *   promptIfMissing?: boolean,
 *   onEvent?: (e: import('./log.js').InstallEvent) => void,
 * }} [options]
 */
export async function main(options = {}) {
  const env = options.env || process.env;
  const cfg = parseEnv(env);
  const logger = createLogger({ onEvent: options.onEvent });

  setMessenger({
    say: (m) => {
      logger.info(m);
      console.log(`  ${m}`);
    },
    ok: (m) => {
      logger.ok(m);
      console.log(`  OK  ${m}`);
    },
  });

  try {
    if (cfg.check) {
      banner();
      refreshPath(env);
      const have = {
        git: Boolean(resolveExe('git', { env })),
        node: Boolean(resolveExe('node', { env })),
        claude: Boolean(resolveExe('claude', { env })),
        codex: Boolean(resolveExe('codex', { env })),
        gemini: Boolean(resolveExe('gemini', { env })),
        python: Boolean(
          resolveExe('python', { env }) || resolveExe('python3', { env }),
        ),
      };
      const dest = resolveWorkspaceDir({ env });
      const workspacePresent = isWorkspacePresent(dest);
      for (const line of checkReport({ have, workspacePresent })) {
        if (line.startsWith('OK')) ok(line.slice(4).trim());
        else say(line);
      }
      say(`documents/workspace path: ${dest}`);
      say(`Install log: ${logger.logPath}`);
      return { mode: 'check', have, dest, workspacePresent, logPath: logger.logPath };
    }

    return await runInstall({
      ...options,
      env,
      logger,
      promptIfMissing: options.promptIfMissing !== false,
    });
  } finally {
    setMessenger(null);
  }
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
