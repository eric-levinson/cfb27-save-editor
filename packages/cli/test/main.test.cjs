'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { main } = require('../src/main.cjs');

function memoryIo(env = {}) {
  const output = { stdout: '', stderr: '' };
  return {
    output,
    io: {
      env,
      out: (value) => { output.stdout += `${value}\n`; },
      err: (value) => { output.stderr += `${value}\n`; },
    },
  };
}

test('status --json prints one stable JSON object', async () => {
  const { io, output } = memoryIo();
  const sdk = {
    discoverGame: async () => ({ pid: 42, path: 'F:\\CollegeFB27.exe' }),
    createClient: () => ({ status: async () => ({ ready: true, protocolVersion: 1 }) }),
  };
  assert.equal(await main(['status', '--json'], { sdk, io }), 0);
  assert.deepEqual(JSON.parse(output.stdout), {
    ok: true,
    command: 'status',
    result: { ready: true, protocolVersion: 1 },
  });
});

test('SDK errors map to stable nonzero exit families', async () => {
  const { io, output } = memoryIo();
  const error = Object.assign(new Error('not running'), { code: 'GAME_NOT_RUNNING' });
  assert.equal(await main(['status'], {
    sdk: { discoverGame: async () => { throw error; } },
    io,
  }), 20);
  assert.match(output.stderr, /GAME_NOT_RUNNING/);
});

test('help succeeds and unknown commands are usage errors', async () => {
  const help = memoryIo();
  assert.equal(await main(['--help'], { sdk: {}, io: help.io }), 0);
  assert.match(help.output.stdout, /install/);
  assert.match(help.output.stdout, /doctor/);

  const unknown = memoryIo();
  assert.equal(await main(['nope'], { sdk: {}, io: unknown.io }), 2);
  assert.match(unknown.output.stderr, /Unknown command/);
});

test('duplicate scalar flags and missing values are usage errors', async () => {
  const duplicate = memoryIo();
  assert.equal(await main(['doctor', '--game-dir', 'a', '--game-dir', 'b'], {
    sdk: {}, io: duplicate.io,
  }), 2);
  assert.match(duplicate.output.stderr, /Duplicate option/);

  const missing = memoryIo();
  assert.equal(await main(['doctor', '--mmc-dir'], { sdk: {}, io: missing.io }), 2);
  assert.match(missing.output.stderr, /Missing value/);
});

test('install requires explicit directories and resolves artifact paths', async () => {
  const missing = memoryIo();
  assert.equal(await main(['install'], { sdk: {}, io: missing.io }), 2);

  const called = [];
  const configured = memoryIo({
    CFB27_GAME_DIR: 'F:\\game',
    CFB27_MMC_DIR: 'F:\\mmc',
    CFB27_HOOK_ARTIFACTS: 'F:\\artifacts',
  });
  assert.equal(await main(['install'], {
    sdk: { installHook: async (options) => { called.push(options); return { installed: true }; } },
    io: configured.io,
  }), 0);
  assert.equal(called[0].proxyDll, path.resolve('F:\\artifacts', 'cfb27_cryptbase_proxy.dll'));
  assert.equal(called[0].hostDll, path.resolve('F:\\artifacts', 'cfb27_lua_host.dll'));
});

test('run delegates the complete file and eval preserves separate source tokens', async () => {
  const run = memoryIo();
  let file;
  assert.equal(await main(['run', 'scripts\\recruit.lua'], {
    sdk: { runScriptFile: async (value) => { file = value; return { status: 'ok' }; } },
    io: run.io,
  }), 0);
  assert.equal(file, 'scripts\\recruit.lua');

  const evaluated = [];
  const evaluate = memoryIo();
  const sdk = {
    discoverGame: async () => ({ pid: 9, path: 'F:\\CollegeFB27.exe' }),
    createClient: () => ({ evaluateLua: async (source) => { evaluated.push(source); return { status: 'ok' }; } }),
  };
  assert.equal(await main(['eval', 'local x=1', 'x=x+1'], { sdk, io: evaluate.io }), 0);
  assert.deepEqual(evaluated, ['local x=1 x=x+1']);
});

test('doctor dispatch performs no installation writes', async () => {
  const { io } = memoryIo({ CFB27_GAME_DIR: 'F:\\game', CFB27_MMC_DIR: 'F:\\mmc' });
  let installs = 0;
  const sdk = {
    doctor: async () => ({ checks: [] }),
    installHook: async () => { installs += 1; },
    restoreMmcHook: async () => { installs += 1; },
  };
  assert.equal(await main(['doctor'], { sdk, io }), 0);
  assert.equal(installs, 0);
});

test('--json errors emit exactly one object to stdout', async () => {
  const { io, output } = memoryIo();
  const error = Object.assign(new Error('host missing'), { code: 'HOST_NOT_READY' });
  assert.equal(await main(['status', '--json'], {
    sdk: { discoverGame: async () => { throw error; } },
    io,
  }), 20);
  assert.equal(output.stderr, '');
  assert.equal(output.stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(output.stdout).error.code, 'HOST_NOT_READY');
});
