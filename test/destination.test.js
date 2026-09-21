import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  detectCloudSync,
  destinationCandidates,
  defaultDestination,
  normalizeDestination,
  isForbiddenLocation,
  validateDestination,
  isInside,
} from '../src/destination.js';

describe('detectCloudSync', () => {
  it('spots the OneDrive env root', () => {
    const env = { OneDrive: 'C:\\Users\\ina\\OneDrive' };
    const hit = detectCloudSync('C:\\Users\\ina\\OneDrive\\Documents\\sleep-network', { env });
    assert.equal(hit?.id, 'onedrive');
  });

  it('spots OneDrive by folder name even without the env var', () => {
    const hit = detectCloudSync('C:\\Users\\ina\\OneDrive - Mello\\Documents\\sleep-network', {});
    assert.equal(hit?.id, 'onedrive');
  });

  it('spots iCloud Drive', () => {
    const hit = detectCloudSync(
      '/Users/tim/Library/Mobile Documents/com~apple~CloudDocs/sleep-network',
      {},
    );
    assert.equal(hit?.id, 'icloud');
  });

  it('spots Dropbox and Google Drive', () => {
    assert.equal(detectCloudSync('/home/t/Dropbox/sleep-network', {})?.id, 'dropbox');
    assert.equal(detectCloudSync('/home/t/Google Drive/sleep-network', {})?.id, 'gdrive');
  });

  it('leaves a local folder alone', () => {
    assert.equal(detectCloudSync('C:\\Users\\ina\\Documents\\sleep-network', {}), null);
    assert.equal(detectCloudSync('/home/tim/sleep-network', {}), null);
  });

  it('does not treat OneDriveTemp-ish names as OneDrive when not a segment', () => {
    assert.equal(detectCloudSync('C:\\Users\\ina\\MyOneDriveBackup\\sleep-network', {}), null);
  });
});

describe('isInside', () => {
  it('matches a child path', () => {
    assert.equal(isInside('/home/t', '/home/t/sleep-network'), true);
  });
  it('rejects a sibling', () => {
    assert.equal(isInside('/home/t', '/home/tim/sleep-network'), false);
  });
});

describe('destinationCandidates', () => {
  const env = { OneDrive: 'C:\\Users\\ina\\OneDrive' };

  it('recommends a local folder when Documents is redirected to OneDrive', () => {
    const list = destinationCandidates({
      platform: 'win32',
      env,
      home: 'C:\\Users\\ina',
      documentsDir: 'C:\\Users\\ina\\OneDrive\\Documents',
    });
    const recommended = list.find((c) => c.recommended);
    assert.ok(recommended, 'one candidate must be recommended');
    assert.equal(recommended.cloud, null);
    assert.ok(!/OneDrive/i.test(recommended.path));
  });

  it('marks the OneDrive candidate as not recommended', () => {
    const list = destinationCandidates({
      platform: 'win32',
      env,
      home: 'C:\\Users\\ina',
      documentsDir: 'C:\\Users\\ina\\OneDrive\\Documents',
    });
    const od = list.find((c) => /OneDrive/i.test(c.path));
    assert.ok(od);
    assert.equal(od.recommended, false);
    assert.match(od.note, /not recommended/);
  });

  it('keeps plain Documents when it is local', () => {
    const list = destinationCandidates({
      platform: 'win32',
      env: {},
      home: 'C:\\Users\\bob',
      documentsDir: 'C:\\Users\\bob\\Documents',
    });
    assert.equal(list[0].path, path.join('C:\\Users\\bob\\Documents', 'sleep-network'));
    assert.equal(list[0].recommended, true);
  });
});

describe('defaultDestination', () => {
  it('never defaults into OneDrive', () => {
    const dest = defaultDestination({
      platform: 'win32',
      env: { OneDrive: 'C:\\Users\\ina\\OneDrive' },
      home: 'C:\\Users\\ina',
      documentsDir: 'C:\\Users\\ina\\OneDrive\\Documents',
    });
    assert.ok(!/OneDrive/i.test(dest), `${dest} must not be in OneDrive`);
    assert.equal(path.basename(dest), 'sleep-network');
  });
});

describe('normalizeDestination', () => {
  const ctx = { platform: 'win32', env: {}, home: 'C:\\Users\\ina' };

  it('appends sleep-network to a plain folder', () => {
    assert.equal(
      normalizeDestination('C:\\Users\\ina\\Documents', ctx),
      path.normalize('C:\\Users\\ina\\Documents\\sleep-network'),
    );
  });

  it('leaves a path that already ends in sleep-network', () => {
    assert.equal(
      normalizeDestination('C:\\Users\\ina\\Documents\\sleep-network', ctx),
      path.normalize('C:\\Users\\ina\\Documents\\sleep-network'),
    );
  });

  it('strips quotes and trailing slashes', () => {
    assert.equal(
      normalizeDestination('"C:\\Users\\ina\\Documents\\"', ctx),
      path.normalize('C:\\Users\\ina\\Documents\\sleep-network'),
    );
  });

  it('expands ~', () => {
    const out = normalizeDestination('~/code', { platform: 'linux', env: {}, home: '/home/ina' });
    assert.equal(out, path.normalize('/home/ina/code/sleep-network'));
  });

  it('returns empty for empty input', () => {
    assert.equal(normalizeDestination('   ', ctx), '');
  });
});

describe('isForbiddenLocation', () => {
  it('refuses a drive root and system folders', () => {
    assert.equal(isForbiddenLocation('C:\\sleep-network', 'win32'), true);
    assert.equal(isForbiddenLocation('C:\\Windows\\sleep-network', 'win32'), true);
    assert.equal(isForbiddenLocation('C:\\Program Files\\sleep-network', 'win32'), true);
    assert.equal(isForbiddenLocation('/usr/sleep-network', 'linux'), true);
  });

  it('allows a user folder', () => {
    assert.equal(isForbiddenLocation('C:\\Users\\ina\\sleep-network', 'win32'), false);
    assert.equal(isForbiddenLocation('/home/ina/sleep-network', 'linux'), false);
  });
});

describe('validateDestination', () => {
  const base = { platform: 'win32', env: { OneDrive: 'C:\\Users\\ina\\OneDrive' }, home: 'C:\\Users\\ina', probe: false };

  it('refuses OneDrive by default, with a reason', () => {
    const v = validateDestination('C:\\Users\\ina\\OneDrive\\Documents', base);
    assert.equal(v.ok, false);
    assert.equal(v.cloud.id, 'onedrive');
    assert.match(v.errors.join(' '), /OneDrive/);
  });

  it('allows OneDrive when the user insists, but warns', () => {
    const v = validateDestination('C:\\Users\\ina\\OneDrive\\Documents', {
      ...base,
      allowCloud: true,
    });
    assert.equal(v.ok, true);
    assert.match(v.warnings.join(' '), /OneDrive/);
  });

  it('accepts a local folder', () => {
    const v = validateDestination('C:\\Users\\ina\\Documents', base);
    assert.equal(v.ok, true);
    assert.equal(v.errors.length, 0);
    assert.equal(path.basename(v.dest), 'sleep-network');
  });

  it('refuses a system folder', () => {
    const v = validateDestination('C:\\Windows', base);
    assert.equal(v.ok, false);
    assert.match(v.errors.join(' '), /system folder/);
  });

  it('falls back to the default when nothing is typed', () => {
    const v = validateDestination(null, { ...base, documentsDir: 'C:\\Users\\ina\\OneDrive\\Documents' });
    assert.equal(v.ok, true);
    assert.ok(!/OneDrive/i.test(v.dest));
  });
});
