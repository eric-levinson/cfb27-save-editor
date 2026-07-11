'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('unsupported roots are absent from the active tree', () => {
  for (const entry of [
    'server.py',
    'static',
    'electron',
    'franchise_helper.js',
    'test_editor.py',
    'tools',
  ]) {
    assert.equal(fs.existsSync(path.join(root, entry)), false, entry);
  }
});

test('active manifests and CMake never reference archive', () => {
  for (const file of ['package.json', 'native/CMakeLists.txt']) {
    const contents = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(contents, /archive[\\/]/i, file);
  }
});

test('all archive areas explain unsupported status', () => {
  for (const area of ['legacy-save-editor', 'legacy-hooks', 'research-tools']) {
    const contents = fs.readFileSync(path.join(root, 'archive', area, 'README.md'), 'utf8');
    assert.match(contents, /unsupported/i);
    assert.match(contents, /Git history/i);
  }
});
