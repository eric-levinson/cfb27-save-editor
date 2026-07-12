'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  releaseEntries, assertAllowedEntry, assertAllowedContent, assertPackageTextEntries,
  assertStagedPackage, main,
} = require('../scripts/package-release.cjs');

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
    'docs/research/runtime-verification.md',
    'docs/superpowers/specs/internal.md',
    'docs/development/restructure-pr-body.md',
  ]) {
    assert.throws(() => assertAllowedEntry(value), /not allowed/i, value);
  }
  assert.doesNotThrow(() => assertAllowedEntry(path.join('examples', 'lua', 'autorun.lua')));
});

test('release content gate rejects historical process addresses but permits marked synthetic placeholders', () => {
  assert.equal(typeof assertAllowedContent, 'function');
  const research = fs.readFileSync(path.join(__dirname, '..', 'docs', 'research',
    'runtime-verification.md'), 'utf8');
  for (const token of ['0x25DDC14D0', '0x273FEB930', '0x34CC50048']) {
    assert.match(research, new RegExp(token, 'i'));
    assert.throws(() => assertAllowedContent('docs/leak.md', `historical ${token}`),
      /process address/i, token);
  }
  assert.doesNotThrow(() => assertAllowedContent('docs/protocol.md',
    'synthetic placeholder 0x7FF612340080'));
});

test('staged-package validation scans packaged text for private process addresses', async (t) => {
  assert.equal(typeof assertStagedPackage, 'function');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb27-release-stage-'));
  t.after(() => fs.rmSync(stage, { recursive: true, force: true }));
  fs.mkdirSync(path.join(stage, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'docs', 'protocol.md'),
    'synthetic placeholder 0x7FF612340080', 'utf8');
  await assert.doesNotReject(assertStagedPackage(stage));
  fs.writeFileSync(path.join(stage, 'docs', 'leak.md'), 'historical 0x25DDC14D0', 'utf8');
  await assert.rejects(assertStagedPackage(stage), /process address/i);
});

test('npm package text-entry validation rejects private process addresses inside tarballs', () => {
  assert.equal(typeof assertPackageTextEntries, 'function');
  assert.doesNotThrow(() => assertPackageTextEntries([
    { path: 'src/client.cjs', content: 'const address = "0x7FF612340080";' },
  ]));
  assert.throws(() => assertPackageTextEntries([
    { path: 'src/leak.cjs', content: 'const address = "0x25DDC14D0";' },
  ]), /process address/i);
});

test('preview packaging requires an explicit native artifact directory', async () => {
  const previous = process.env.CFB27_NATIVE_ARTIFACTS;
  delete process.env.CFB27_NATIVE_ARTIFACTS;
  try {
    await assert.rejects(
      main(),
      /Provide artifactsDir or set CFB27_NATIVE_ARTIFACTS/,
    );
  } finally {
    if (previous === undefined) delete process.env.CFB27_NATIVE_ARTIFACTS;
    else process.env.CFB27_NATIVE_ARTIFACTS = previous;
  }
});
