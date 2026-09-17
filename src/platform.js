import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';

export function platformInfo(platform = process.platform, env = process.env) {
  const isWin = platform === 'win32';
  const isMac = platform === 'darwin';
  const isLinux = platform === 'linux';
  return {
    platform,
    isWin,
    isMac,
    isLinux,
    home: env.HOME || env.USERPROFILE || os.homedir(),
    localAppData: env.LOCALAPPDATA || null,
    programFiles: env.ProgramFiles || env.PROGRAMFILES || null,
    temp: env.TEMP || env.TMPDIR || os.tmpdir(),
  };
}

/** Join path segments safely (handles empty segments). */
export function joinPath(...parts) {
  return path.join(...parts.filter((p) => p != null && p !== ''));
}

/** True if path exists (never throws on weird unicode / long paths). */
export function pathExists(p) {
  if (!p) return false;
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}
