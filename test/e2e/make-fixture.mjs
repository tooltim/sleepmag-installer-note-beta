#!/usr/bin/env node
/**
 * Build a stand-in for the private tooltim/sleep-network workspace, as a bare git
 * repo the installer can clone (SLEEPNET_REPO=file://…). Same shape as the real
 * one where the installer looks: tools/sleepmag/cli.mjs, the launcher entry, the
 * Windows stubs, CLAUDE.md, sites/.
 *
 * The stubs leave evidence in <workspace>/.e2e/ so the CI job can prove each step
 * really ran: setup.json (what `sleepmag setup` received) and launcher-opened
 * (written by the launcher the desktop shortcut starts).
 *
 * Usage: node test/e2e/make-fixture.mjs <dir>   → prints the file:// URL to clone
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] || 'e2e-fixture');
const work = path.join(root, 'work');
const bare = path.join(root, 'sleep-network.git');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const write = (rel, body, mode) => {
  const p = path.join(work, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  if (mode) fs.chmodSync(p, mode);
};

// The CLI the installer runs as `node cli.mjs setup --name … --email … --passphrase …`.
// Its output carries the two phrases the installer's setup check looks for.
write(
  'tools/sleepmag/cli.mjs',
  `#!/usr/bin/env node
// e2e stand-in for the Sleep Network CLI (the real one is private).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
if (args[0] === 'setup') {
  fs.mkdirSync(path.join(ROOT, '.e2e'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, '.e2e', 'setup.json'), JSON.stringify({
    name: opt('name'), email: opt('email'), passphraseLength: (opt('passphrase') || '').length,
  }));
  console.log('  OK  team passphrase stored (e2e stand-in)');
  console.log('  OK  platform/ present (e2e stand-in)');
  console.log('  OK  setup done');
  process.exit(0);
}
console.log('sleepmag e2e stand-in: ' + args.join(' '));
// padding so the installer's size check sees a real file, not a truncated one
`,
  0o755,
);

// What the desktop shortcut starts. It only proves it ran.
write(
  'tools/sleepmag/launcher/run.mjs',
  `#!/usr/bin/env node
// e2e stand-in for the launcher: record that the desktop shortcut started us.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
fs.mkdirSync(path.join(ROOT, '.e2e'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.e2e', 'launcher-opened'), new Date().toISOString() + ' ' + process.platform);
`,
);

write('sleepmag.cmd', '@echo off\r\nnode "%~dp0tools\\sleepmag\\cli.mjs" %*\r\n');
write(
  'Sleep Network Launcher.cmd',
  '@echo off\r\ncd /d "%~dp0"\r\nnode "%~dp0tools\\sleepmag\\launcher\\run.mjs" %*\r\nexit /b %errorlevel%\r\n',
);
write('sleepmag', '#!/usr/bin/env bash\nexec node "$(dirname "$0")/tools/sleepmag/cli.mjs" "$@"\n', 0o755);
write(
  'CLAUDE.md',
  '# Sleep Network (e2e stand-in)\n\nThis is not the real workspace. It only has the shape the installer checks.\n',
);
write('sites/pl/site.json', '{ "id": "pl" }\n');
write('.gitignore', '.e2e/\n');

const git = (...a) => execFileSync('git', a, { cwd: work, stdio: 'pipe' });
git('init', '-q', '-b', 'master');
git('-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'add', '-A');
git('update-index', '--chmod=+x', 'sleepmag', 'tools/sleepmag/cli.mjs');
git('-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'commit', '-q', '-m', 'e2e fixture');
execFileSync('git', ['clone', '-q', '--bare', work, bare], { stdio: 'pipe' });

process.stdout.write(pathToFileURL(bare).href + '\n');
