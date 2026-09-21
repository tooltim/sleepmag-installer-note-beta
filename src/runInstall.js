/**
 * Step-scoped installer orchestration.
 * tools → clean up → workspace → assistants → setup → verify → launcher → open.
 */

import { parseEnv, normalizeAssistant } from './env.js';
import { createLogger, defaultLogPath } from './log.js';
import { validateInstallInputs } from './validate.js';
import { say, ok, setMessenger } from './say.js';
import { resolveDocumentsDir } from './paths.js';
import { validateDestination } from './destination.js';
import { inspectInstall, findInstalls } from './inspect.js';
import { cleanPreviousInstall } from './cleanup.js';
import { ensureTools } from './tools.js';
import { ensureWorkspace } from './workspace.js';
import { resolveAndInstallAssistants, promptLine } from './assistants.js';
import { runSleepmagSetup, promptPassphrase } from './setup.js';
import { ensureLauncher, openInstalled } from './launcher.js';

export const STEPS = [
  { id: 'tools', label: 'Check tools' },
  { id: 'cleanup', label: 'Clear previous install' },
  { id: 'workspace', label: 'Download workspace' },
  { id: 'assistants', label: 'Optional assistants' },
  { id: 'setup', label: 'Your account setup' },
  { id: 'verify', label: 'Verify the install' },
  { id: 'launcher', label: 'Desktop launcher' },
  { id: 'open', label: 'Open launcher' },
];

/**
 * @typedef {{
 *   env?: NodeJS.ProcessEnv,
 *   name?: string|null,
 *   email?: string|null,
 *   passphrase?: string|null,
 *   assistant?: string|null,
 *   dest?: string|null,
 *   allowCloud?: boolean,
 *   removePrevious?: boolean,
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
    let destInput = options.dest ?? cfg.dest;
    const allowCloud = options.allowCloud ?? cfg.allowCloud;
    const removePrevious = options.removePrevious ?? cfg.removePrevious;

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
          'Which assistant do you use? [1] Claude Code  [2] Codex  [3] Gemini CLI  [4] all  [5] already installed / skip',
        );
        assistant = normalizeAssistant(answer);
      }
      if (!destInput) {
        const suggested = validateDestination(null, {
          env,
          documentsDir: safeDocumentsDir(env),
          probe: false,
        }).dest;
        const answer = await promptLine(`Install folder [${suggested}]`);
        destInput = String(answer || '').trim() || suggested;
      }
    }

    const validated = validateInstallInputs({ name, email, passphrase, assistant });
    if (!validated.ok) {
      const msg = validated.errors.join(' ');
      logger.error(msg);
      throw decorate(new Error(msg), 'validation', 'Validate inputs', logger.logPath);
    }
    ({ name, email, passphrase, assistant } = validated);

    // Destination is decided before anything is downloaded or deleted.
    const destCheck = validateDestination(destInput, {
      env,
      documentsDir: safeDocumentsDir(env),
      allowCloud,
      probe: !dryRun,
    });
    for (const w of destCheck.warnings) say(w);
    if (!destCheck.ok) {
      const msg = destCheck.errors.join(' ');
      logger.error(msg);
      throw decorate(new Error(msg), 'destination', 'Choose install folder', logger.logPath);
    }
    const dest = destCheck.dest;
    say(`Install folder: ${dest}`);
    if (destCheck.cloud) {
      say(`WARNING: ${destCheck.cloud.label} syncs this folder — you chose to continue anyway.`);
    }

    /** @type {{ git?: string, node?: string, dest?: string, launcher?: any, cleanup?: any, verify?: any }} */
    const state = { dest };

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
        throw decorate(
          e instanceof Error ? e : new Error(message),
          stepId,
          meta?.label || stepId,
          logger.logPath,
        );
      }
    }

    await runStep('tools', async () => {
      const tools = await ensureTools({ dryRun });
      state.git = tools.git;
      state.node = tools.node;
      return tools;
    });

    await runStep('cleanup', async () => {
      const existingHere = inspectInstall(dest, { env, withGit: false });
      const elsewhere = findInstalls({ env }).filter(
        (i) => i.dest.toLowerCase() !== dest.toLowerCase(),
      );

      if (existingHere.status === 'partial') {
        say(`the folder already holds an incomplete install: ${existingHere.problems.join('; ')}`);
      } else if (existingHere.status === 'installed') {
        say(`updating the existing install at ${dest}`);
      }
      for (const other of elsewhere) {
        say(`another install exists at ${other.dest} (${other.status})`);
      }

      const report = cleanPreviousInstall({
        keepDest: dest,
        previous: elsewhere,
        removePrevious,
        dryRun,
        env,
      });
      state.cleanup = { ...report, existingHere: existingHere.status, elsewhere: elsewhere.length };
      if (elsewhere.length && !removePrevious) {
        say('left the other install(s) in place; tick "remove previous install" to delete them');
      }
      return report;
    });

    await runStep('workspace', async () => {
      ensureWorkspace({ dest, gitExe: state.git, dryRun });
      return dest;
    });

    await runStep('assistants', async () => {
      return resolveAndInstallAssistants({
        assistant,
        dryRun,
      });
    });

    await runStep('setup', async () => {
      return runSleepmagSetup({
        dest,
        nodeExe: state.node,
        name,
        email,
        passphrase,
        dryRun,
        promptIfMissing: false,
      });
    });

    await runStep('verify', async () => {
      if (dryRun) {
        say('[dry-run] skipping install verification');
        state.verify = { status: 'dry-run', dest, checks: [], problems: [] };
        return state.verify;
      }
      const report = inspectInstall(dest, { env });
      for (const c of report.checks) {
        if (c.ok) ok(`${c.label}: ${c.detail}`);
        else say(`${c.label}: ${c.detail}`);
      }
      if (report.status !== 'installed') {
        throw new Error(
          `The workspace at ${dest} is incomplete: ${report.problems.join('; ') || 'required files missing'}`,
        );
      }
      ok(report.summary);
      state.verify = report;
      return report;
    });

    let launcher;
    await runStep('launcher', async () => {
      launcher = ensureLauncher({ dest, dryRun });
      state.launcher = launcher;
      return launcher;
    });

    let openResult = { opened: false, evidence: 'not attempted', howTo: launcher?.hint || '' };
    await runStep('open', async () => {
      try {
        openResult = openInstalled(launcher, { dryRun, dest });
      } catch (e) {
        say(`Could not open launcher automatically (${e.message || e}) — use the desktop shortcut.`);
        openResult = {
          opened: false,
          evidence: e.message || String(e),
          howTo: launcher?.hint || '',
        };
      }
      return openResult;
    });

    const opened = Boolean(openResult.opened);

    console.log('');
    ok(`Installed at: ${dest}`);
    if (launcher?.path) say(`Desktop shortcut: ${launcher.path}`);
    if (opened) {
      say('Sleep Network Launcher is opening now…');
    } else {
      say(`The launcher did not open by itself (${openResult.evidence}).`);
      say(openResult.howTo || launcher?.hint || '');
    }
    say(
      'First time only: the assistant asks you to log in with your own Claude / OpenAI / Google account, and to trust the folder. Say yes.',
    );
    say(`Install log saved at: ${logger.logPath}`);
    console.log('');

    logger.emit({
      type: 'done',
      status: 'ok',
      message: launcher.hint,
      dest,
      logPath: logger.logPath,
      opened,
    });

    return {
      mode: 'install',
      dest,
      launcher,
      opened,
      open: openResult,
      cleanup: state.cleanup,
      verify: state.verify,
      logPath: logger.logPath,
    };
  } finally {
    if (ownsLogger) setMessenger(prevMessenger);
    else setMessenger(null);
  }
}

function decorate(err, step, stepLabel, logPath) {
  err.step = err.step || step;
  err.stepLabel = err.stepLabel || stepLabel;
  err.logPath = err.logPath || logPath;
  return err;
}

/** Documents resolution must never sink the install; it is only a suggestion. */
function safeDocumentsDir(env) {
  try {
    return resolveDocumentsDir({ env });
  } catch {
    return null;
  }
}

export { defaultLogPath };
