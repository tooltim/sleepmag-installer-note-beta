/**
 * Local guided installer UI (127.0.0.1 only).
 * Form → step progress → success / failure with full log.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createLogger } from '../log.js';
import { runInstall } from '../runInstall.js';
import { STEPS } from '../runInstall.js';
import { validateInstallInputs } from '../validate.js';
import { setMessenger } from '../say.js';
import { resolveDocumentsDir } from '../paths.js';
import { validateDestination, destinationCandidates } from '../destination.js';
import { inspectInstall, findInstalls } from '../inspect.js';
import { findShortcuts } from '../cleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const LOGO_PNG = path.join(ASSETS, 'sleepmag-icon.png');
const LOCKUP_PNG = path.join(ASSETS, 'lockup-black.png');
const ICON_PNG = path.join(ASSETS, 'icon-black.png');

/**
 * @param {{ env?: NodeJS.ProcessEnv, openBrowser?: boolean, port?: number }} [opts]
 */
export async function startUiServer(opts = {}) {
  const env = opts.env || process.env;
  const logger = createLogger();
  /** @type {import('../log.js').InstallEvent[]} */
  const events = [];
  /** @type {Set<http.ServerResponse>} */
  const sseClients = new Set();

  let installRunning = false;
  /** @type {{ status: string, result?: object, error?: object }} */
  let installState = { status: 'idle' };

  const pushEvent = (event) => {
    events.push(event);
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(payload);
      } catch {
        sseClients.delete(res);
      }
    }
  };

  logger.onEvent(pushEvent);

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
  });

  async function handleRequest(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return sendFile(res, path.join(PUBLIC, 'index.html'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/app.css') {
      return sendFile(res, path.join(PUBLIC, 'app.css'), 'text/css; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      return sendFile(res, path.join(PUBLIC, 'app.js'), 'text/javascript; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/logo.png') {
      return sendFile(res, LOGO_PNG, 'image/png');
    }
    if (req.method === 'GET' && url.pathname === '/lockup.png') {
      return sendFile(res, LOCKUP_PNG, 'image/png');
    }
    if (req.method === 'GET' && url.pathname === '/icon.png') {
      return sendFile(res, ICON_PNG, 'image/png');
    }

    if (req.method === 'GET' && url.pathname === '/api/meta') {
      const documentsDir = safeDocuments(env);
      const suggested = validateDestination(null, { env, documentsDir, probe: false }).dest;
      return json(res, {
        steps: STEPS,
        logPath: logger.logPath,
        status: installState.status,
        defaultDest: suggested,
        candidates: destinationCandidates({ env, documentsDir }),
        ...currentState(suggested),
      });
    }

    // Live feedback while the user types a folder: is it usable, what is there now.
    if (req.method === 'POST' && url.pathname === '/api/inspect') {
      const body = await readJson(req);
      const documentsDir = safeDocuments(env);
      const check = validateDestination(body.dest || null, {
        env,
        documentsDir,
        allowCloud: Boolean(body.allowCloud),
        probe: true,
      });
      return json(res, {
        ok: check.ok,
        dest: check.dest,
        cloud: check.cloud,
        errors: check.errors,
        warnings: check.warnings,
        ...currentState(check.dest),
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'hello', logPath: logger.logPath, steps: STEPS })}\n\n`);
      for (const ev of events) {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
      if (installState.status === 'ok' || installState.status === 'failed') {
        res.write(
          `data: ${JSON.stringify({
            type: 'state',
            status: installState.status,
            result: installState.result,
            error: installState.error,
          })}\n\n`,
        );
      }
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/log') {
      let text = '';
      try {
        text = fs.readFileSync(logger.logPath, 'utf8');
      } catch {
        text = events.map((e) => JSON.stringify(e)).join('\n');
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(text);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/start') {
      if (installRunning) {
        return json(res, { ok: false, error: 'Install already running.' }, 409);
      }
      const body = await readJson(req);
      const validated = validateInstallInputs(body);
      if (!validated.ok) {
        return json(res, { ok: false, errors: validated.errors }, 400);
      }
      const destCheck = validateDestination(body.dest || null, {
        env,
        documentsDir: safeDocuments(env),
        allowCloud: Boolean(body.allowCloud),
        probe: true,
      });
      if (!destCheck.ok) {
        return json(res, { ok: false, errors: destCheck.errors }, 400);
      }

      installRunning = true;
      installState = { status: 'running' };
      pushEvent({ type: 'state', status: 'running', ts: new Date().toISOString() });
      json(res, { ok: true, logPath: logger.logPath });

      // Run install asynchronously so the HTTP response returns immediately.
      setImmediate(() => {
        void (async () => {
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
            const result = await runInstall({
              env,
              name: validated.name,
              email: validated.email,
              passphrase: validated.passphrase,
              assistant: validated.assistant,
              dest: destCheck.dest,
              allowCloud: Boolean(body.allowCloud),
              removePrevious: Boolean(body.removePrevious),
              promptIfMissing: false,
              logger,
            });
            installState = { status: 'ok', result };
            pushEvent({
              type: 'state',
              status: 'ok',
              result: {
                dest: result.dest,
                hint: result.launcher?.hint,
                logPath: result.logPath,
                opened: Boolean(result.opened),
                openEvidence: result.open?.evidence || '',
                howTo: result.open?.howTo || '',
                shortcut: result.launcher?.path || '',
                shortcuts: result.launcher?.shortcuts || [],
                target: result.launcher?.target || '',
                icon: result.launcher?.icon?.path || '',
                removed: result.cleanup?.workspacesRemoved || [],
                shortcutsRemoved: result.cleanup?.shortcutsRemoved || [],
                checks: (result.verify?.checks || []).map((c) => ({
                  label: c.label,
                  ok: c.ok,
                  detail: c.detail,
                })),
              },
              ts: new Date().toISOString(),
            });
          } catch (e) {
            const error = {
              message: e?.message || String(e),
              step: e?.step || 'unknown',
              stepLabel: e?.stepLabel || e?.step || 'unknown',
              logPath: e?.logPath || logger.logPath,
            };
            installState = { status: 'failed', error };
            pushEvent({
              type: 'state',
              status: 'failed',
              error,
              ts: new Date().toISOString(),
            });
          } finally {
            setMessenger(null);
            installRunning = false;
          }
        })();
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }

  /** What is installed right now, for the folder the user is looking at. */
  function currentState(dest) {
    const install = inspectInstall(dest, { env });
    const others = findInstalls({ env }).filter(
      (i) => i.dest.toLowerCase() !== String(dest).toLowerCase(),
    );
    const shortcuts = findShortcuts({ env });
    return {
      install: {
        dest: install.dest,
        status: install.status,
        summary: install.summary,
        problems: install.problems,
        cloud: install.cloud,
        git: install.git,
        checks: install.checks.map((c) => ({
          label: c.label,
          ok: c.ok,
          detail: c.detail,
          required: c.required,
        })),
      },
      others: others.map((o) => ({ dest: o.dest, status: o.status, summary: o.summary })),
      shortcuts: shortcuts.map((s) => ({ path: s.path, target: s.target, dead: s.dead })),
    };
  }

  function safeDocuments(e) {
    try {
      return resolveDocumentsDir({ env: e });
    } catch {
      return null;
    }
  }

  const port = opts.port || 0;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://127.0.0.1:${actualPort}/`;

  console.log(`Sleep Network installer UI: ${url}`);
  console.log(`Install log: ${logger.logPath}`);

  if (opts.openBrowser !== false) {
    openBrowser(url);
  }

  return {
    url,
    port: actualPort,
    logPath: logger.logPath,
    server,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function sendFile(res, filePath, contentType) {
  try {
    const body = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Missing UI asset');
  }
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    console.log(`Open this URL in your browser: ${url}`);
  }
}
