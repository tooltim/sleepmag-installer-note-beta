import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  pickDocumentsFromCandidates,
  resolveWorkspaceDir,
  WORKSPACE_NAME,
} from '../src/paths.js';

describe('pickDocumentsFromCandidates', () => {
  it('Windows: prefers PowerShell MyDocuments (OneDrive redirect)', () => {
    const home = 'C:\\Users\\Émilie';
    const od = path.join(home, 'OneDrive', 'Documents');
    const picked = pickDocumentsFromCandidates([od], {
      platform: 'win32',
      home,
      env: { OneDrive: path.join(home, 'OneDrive') },
      psResult: od,
    });
    assert.equal(picked, path.normalize(od));
  });

  it('Windows: falls back to OneDrive\\Documents when present', () => {
    const home = 'C:\\Users\\Test User';
    const odDocs = path.join(home, 'OneDrive', 'Documents');
    const picked = pickDocumentsFromCandidates([odDocs], {
      platform: 'win32',
      home,
      env: { OneDrive: path.join(home, 'OneDrive') },
      psResult: null,
    });
    assert.equal(picked, odDocs);
  });

  it('Windows: classic Documents when nothing else', () => {
    const home = 'C:\\Users\\Bob';
    const picked = pickDocumentsFromCandidates([], {
      platform: 'win32',
      home,
      env: {},
      psResult: null,
    });
    assert.equal(picked, path.join(home, 'Documents'));
  });

  it('macOS: prefers ~/Documents over iCloud path when both exist', () => {
    const home = '/Users/café';
    const classic = path.join(home, 'Documents');
    const iCloud = path.join(
      home,
      'Library',
      'Mobile Documents',
      'com~apple~CloudDocs',
      'Documents',
    );
    const picked = pickDocumentsFromCandidates([classic, iCloud], {
      platform: 'darwin',
      home,
    });
    assert.equal(picked, classic);
  });

  it('macOS: uses iCloud Documents when classic missing', () => {
    const home = '/Users/tim';
    const iCloud = path.join(
      home,
      'Library',
      'Mobile Documents',
      'com~apple~CloudDocs',
      'Documents',
    );
    const picked = pickDocumentsFromCandidates([iCloud], {
      platform: 'darwin',
      home,
    });
    assert.equal(picked, iCloud);
  });

  it('Linux: honors XDG_DOCUMENTS_DIR with non-ASCII name', () => {
    const home = '/home/jean';
    const docs = path.join(home, 'Pièces jointes');
    const picked = pickDocumentsFromCandidates([docs], {
      platform: 'linux',
      home,
      env: { XDG_DOCUMENTS_DIR: docs },
    });
    assert.equal(picked, docs);
  });
});

describe('resolveWorkspaceDir', () => {
  it('appends sleep-network under Documents', () => {
    // On this Linux agent, should resolve something ending with sleep-network
    const dest = resolveWorkspaceDir();
    assert.ok(dest.endsWith(WORKSPACE_NAME) || dest.endsWith(`${WORKSPACE_NAME}`));
    assert.equal(path.basename(dest), WORKSPACE_NAME);
  });
});
