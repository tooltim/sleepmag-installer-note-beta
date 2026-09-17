/**
 * Append-only install log + optional UI event fan-out.
 */

import fs from 'node:fs';
import { joinPath, platformInfo } from './platform.js';

/** @typedef {'info'|'ok'|'error'|'step'} LogLevel */

/**
 * @typedef {{
 *   type: string,
 *   step?: string,
 *   status?: string,
 *   message?: string,
 *   level?: LogLevel,
 *   ts: string,
 *   [key: string]: unknown,
 * }} InstallEvent
 */

export function defaultLogPath(env = process.env) {
  const info = platformInfo(process.platform, env);
  return joinPath(info.temp, 'sleepnet-install.log');
}

/**
 * @param {{ logPath?: string, onEvent?: (e: InstallEvent) => void }} [opts]
 */
export function createLogger(opts = {}) {
  const logPath = opts.logPath || defaultLogPath();
  /** @type {InstallEvent[]} */
  const events = [];
  const listeners = new Set();
  if (typeof opts.onEvent === 'function') listeners.add(opts.onEvent);

  try {
    fs.writeFileSync(
      logPath,
      `=== Sleep Network installer log ${new Date().toISOString()} ===\n`,
      'utf8',
    );
  } catch {
    /* ignore — still emit in-memory */
  }

  function emit(event) {
    const full = {
      ...event,
      ts: event.ts || new Date().toISOString(),
    };
    events.push(full);
    const line = formatLine(full);
    try {
      fs.appendFileSync(logPath, line + '\n', 'utf8');
    } catch {
      /* ignore */
    }
    for (const fn of listeners) {
      try {
        fn(full);
      } catch {
        /* ignore listener errors */
      }
    }
    return full;
  }

  return {
    logPath,
    events,
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    info(message) {
      return emit({ type: 'log', level: 'info', message: String(message) });
    },
    ok(message) {
      return emit({ type: 'log', level: 'ok', message: String(message) });
    },
    error(message) {
      return emit({ type: 'log', level: 'error', message: String(message) });
    },
    step(step, status, message) {
      return emit({
        type: 'step',
        step,
        status,
        message: message != null ? String(message) : undefined,
        level: status === 'failed' ? 'error' : 'info',
      });
    },
    emit,
  };
}

function formatLine(event) {
  const t = event.ts || '';
  if (event.type === 'step') {
    return `[${t}] STEP ${event.step} ${event.status}${event.message ? ': ' + event.message : ''}`;
  }
  const tag =
    event.level === 'ok' ? 'OK' : event.level === 'error' ? 'ERROR' : 'INFO';
  return `[${t}] ${tag}  ${event.message || ''}`;
}
