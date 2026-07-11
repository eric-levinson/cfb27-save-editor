'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { releaseEntries, assertAllowedEntry } = require('../scripts/package-release.cjs');

test('release allowlist contains only supported product areas', () => {
  assert.deepEqual(releaseEntries(), [
    'native',
    'packages',
    'examples',
    'docs',
    'README.md',
    'LICENSE',
  ]);
});

test('release rejects archive and generated/private material', () => {
  for (const value of [
    'archive/a',
    'node_modules/a',
    'schema/a.gz',
    'save/DYNASTY-X',
    'host.log',
  ]) {
    assert.throws(() => assertAllowedEntry(value), /not allowed/i, value);
  }
  assert.doesNotThrow(() => assertAllowedEntry(path.join('examples', 'lua', 'autorun.lua')));
});
