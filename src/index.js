/**
 * Main installer entry (CLI / check / UI orchestration helpers).
 */

import { parseEnv } from './env.js';
import { setMessenger, banner, say, ok } from './say.js';
import { createLogger } from './log.js';
import { runInstall } from './runInstall.js';
import { resolveDocumentsDir } from './paths.js';
import { validateDestination } from './destination.js';
import { inspectInstall, findInstalls } from './inspect.js';
import { findShortcuts } from './cleanup.js';
import { resolveExe, refreshPath } from './exec.js';
import { checkReport } from './tools.js';

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
      // Where we would install, and what is actually there — with real paths.
      const dest = validateDestination(cfg.dest, {
        env,
        documentsDir: safeDocuments(env),
        allowCloud: true,
        probe: false,
      }).dest;
      const install = inspectInstall(dest, { env });
      const others = findInstalls({ env }).filter(
        (i) => i.dest.toLowerCase() !== dest.toLowerCase(),
      );
      const shortcuts = findShortcuts({ env });
      const workspacePresent = install.status === 'installed';

      for (const line of checkReport({ have, workspacePresent, install, others, shortcuts })) {
        if (line.startsWith('OK')) ok(line.slice(4).trim());
        else say(line);
      }
      if (!shortcuts.length) say('shortcut: none found on any Desktop or Start Menu folder');
      say(`Install log: ${logger.logPath}`);
      return {
        mode: 'check',
        have,
        dest,
        workspacePresent,
        install,
        others,
        shortcuts,
        logPath: logger.logPath,
      };
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

function safeDocuments(env) {
  try {
    return resolveDocumentsDir({ env });
  } catch {
    return null;
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
