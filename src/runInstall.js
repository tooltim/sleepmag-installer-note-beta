/**
 * Step-scoped installer orchestration.
 * Order matches legacy install.ps1: tools → workspace → setup → assistants → launcher.
 */

import { parseEnv } from './env.js';
import { normalizeAssistant } from './env.js';
import { createLogger, defaultLogPath } from './log.js';
import { validateInstallInputs } from './validate.js';
import { say, ok, setMessenger } from './say.js';
import { resolveWorkspaceDir } from './paths.js';
import { ensureTools } from './tools.js';
import { ensureWorkspace } from './workspace.js';
import { resolveAndInstallAssistants, promptLine } from './assistants.js';
import { runSleepmagSetup, promptPassphrase } from './setup.js';
import { ensureLauncher } from './launcher.js';

export const STEPS = [
  { id: 'tools', label: 'Install / verify tools (Git, Node, Python)' },
  { id: 'workspace', label: 'Download or update workspace' },
  { id: 'setup', label: 'Configure Sleep Network (name, e-mail, passphrase)' },
  { id: 'assistants', label: 'Optional assistants (Claude / Codex)' },
  { id: 'launcher', label: 'Create desktop shortcut' },
];

/**
 * @typedef {{
 *   env?: NodeJS.ProcessEnv,
 *   name?: string|null,
 *   email?: string|null,
 *   passphrase?: string|null,
 *   assistant?: string|null,
 *   dryRun?: boolean,
 *   promptIfMissing?: boolean,
 *   logger?: ReturnType<typeof createLogger>,
 *   onEvent?: (e: import('./log.js').InstallEvent) => void,
 * }} RunInstallOptions
 */

/**
 * @param {RunInstallOptions} [options]
 */
export async function runInstall(options = {}) {
  const env = options.env || process.env;
  const cfg = parseEnv(env);
  const ownsLogger = !options.logger;
  const logger =
    options.logger ||
    createLogger({
      onEvent: options.onEvent,
    });
  if (options.onEvent && options.logger) {
    logger.onEvent(options.onEvent);
  }

  const prevMessenger = null;
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
    console.log('');
    console.log('Sleep Network installer');
    console.log('');
    say(`Install log: ${logger.logPath}`);

    const dryRun = options.dryRun ?? cfg.dryRun;
    const promptIfMissing = options.promptIfMissing !== false;

    let name = options.name ?? cfg.name;
    let email = options.email ?? cfg.email;
    let passphrase = options.passphrase ?? cfg.passphrase;
    let assistant = options.assistant ?? cfg.assistant;

    if (promptIfMissing) {
      if (!name) name = (await promptLine('Your first name')) || '';
      if (!email) email = (await promptLine('Your work e-mail')) || '';
      if (!passphrase) {
        passphrase = await promptPassphrase(
          'Team passphrase (Tim gives it to you; typing is hidden)',
        );
      }
      if (!assistant) {
        const answer = await promptLine(
          'Which assistant do you use? [1] Claude Code  [2] Codex  [3] both  [4] already installed / skip',
        );
        assistant = normalizeAssistant(answer);
      }
    }

    const validated = validateInstallInputs({ name, email, passphrase, assistant });
    if (!validated.ok) {
      const msg = validated.errors.join(' ');
      logger.error(msg);
      const err = new Error(msg);
      err.step = 'validation';
      err.stepLabel = 'Validate inputs';
      err.logPath = logger.logPath;
      throw err;
    }
    ({ name, email, passphrase, assistant } = validated);

    /** @type {{ git?: string, node?: string, dest?: string, launcher?: object }} */
    const state = {};

    async function runStep(stepId, fn) {
      const meta = STEPS.find((s) => s.id === stepId);
      logger.step(stepId, 'running', meta?.label);
      try {
        const result = await fn();
        logger.step(stepId, 'ok', meta?.label);
        return result;
      } catch (e) {
        const message = e?.message || String(e);
        logger.step(stepId, 'failed', message);
        logger.error(`Failed at step "${stepId}" (${meta?.label || stepId}): ${message}`);
        say(`Failed at step: ${meta?.label || stepId}`);
        say(`Full log: ${logger.logPath}`);
        const err = e instanceof Error ? e : new Error(message);
        err.step = stepId;
        err.stepLabel = meta?.label || stepId;
        err.logPath = logger.logPath;
        throw err;
      }
    }

    await runStep('tools', async () => {
      const tools = await ensureTools({ dryRun });
      state.git = tools.git;
      state.node = tools.node;
      return tools;
    });

    await runStep('workspace', async () => {
      const dest = resolveWorkspaceDir({ env });
      state.dest = dest;
      ensureWorkspace({ dest, gitExe: state.git, dryRun });
      return dest;
    });

    await runStep('setup', async () => {
      return runSleepmagSetup({
        dest: state.dest,
        nodeExe: state.node,
        name,
        email,
        passphrase,
        dryRun,
        promptIfMissing: false,
      });
    });

    await runStep('assistants', async () => {
      return resolveAndInstallAssistants({
        assistant,
        dryRun,
      });
    });

    let launcher;
    await runStep('launcher', async () => {
      launcher = ensureLauncher({ dest: state.dest, dryRun });
      state.launcher = launcher;
      return launcher;
    });

    console.log('');
    ok(launcher.hint);
    say(
      'First time only: the assistant asks you to log in with your own Claude / OpenAI account, and Claude asks you to trust the folder. Say yes to both.',
    );
    say(`Install log saved at: ${logger.logPath}`);
    console.log('');

    logger.emit({
      type: 'done',
      status: 'ok',
      message: launcher.hint,
      dest: state.dest,
      logPath: logger.logPath,
    });

    return {
      mode: 'install',
      dest: state.dest,
      launcher,
      logPath: logger.logPath,
    };
  } finally {
    if (ownsLogger) setMessenger(prevMessenger);
    else setMessenger(null);
  }
}

export { defaultLogPath };
