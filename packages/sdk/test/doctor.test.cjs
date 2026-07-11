'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { doctor } = require('../src/doctor.cjs');

test('doctor reports ordered read-only runtime checks', async () => {
  let writes = 0;
  const dependencies = {
    discoverGameImpl: async () => ({ pid: 42, path: 'F:\\CollegeFB27.exe' }),
    inspectInstallationImpl: async () => ({ mode: 'installed' }),
    createClientImpl: () => ({
      hello: async () => ({ supportedBuild: true, writesAllowed: true }),
      status: async () => ({ ready: true, supportedBuild: true, writesAllowed: true }),
    }),
    installHookImpl: async () => { writes += 1; },
    restoreMmcHookImpl: async () => { writes += 1; },
  };

  const result = await doctor({ gameDir: 'F:\\game', mmcDir: 'F:\\mmc' }, dependencies);
  assert.deepEqual(result.checks.map((check) => check.name), [
    'game', 'installation', 'host', 'build', 'writes',
  ]);
  assert.equal(result.checks.every((check) => check.ok), true);
  assert.equal(writes, 0);
});
