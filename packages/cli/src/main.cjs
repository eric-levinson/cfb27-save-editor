'use strict';

const path = require('node:path');
const { parseArgs, usageError } = require('./args.cjs');
const { printSuccess, printError } = require('./output.cjs');

const HELP = `cfb27lua <command> [options]

Commands:
  install      Install the proxy and Lua host after closing the game
  uninstall    Restore both preserved MMC proxies
  status       Read live host status
  run <file>   Run a Lua script file
  eval <lua>   Evaluate Lua source
  doctor       Run read-only diagnostics

Options:
  --game-dir <path>       College Football 27 directory
  --mmc-dir <path>        Madden Modding Community manager directory
  --artifacts-dir <path>  Built hook DLL directory
  --json                  Emit one JSON object
  -h, --help              Show this help`;

const defaultIo = {
  env: process.env,
  out: (value) => process.stdout.write(`${value}\n`),
  err: (value) => process.stderr.write(`${value}\n`),
};

function exitCodeFor(error) {
  if (error?.code === 'USAGE' || error?.code === 'INVALID_REQUEST') return 2;
  if (['GAME_NOT_RUNNING', 'GAME_PATH_MISMATCH', 'HOST_NOT_INSTALLED', 'HOST_NOT_READY',
    'UNSUPPORTED_BUILD', 'ANTICHEAT_RUNNING', 'PIPE_TIMEOUT'].includes(error?.code)) return 20;
  if (['PROTOCOL_MISMATCH', 'INVALID_RESPONSE', 'SCRIPT_ERROR'].includes(error?.code)) return 30;
  if (['INSTALLATION_CONFLICT', 'BACKUP_VERIFICATION_FAILED'].includes(error?.code)) return 40;
  return 70;
}

function requireDirectory(value, label) {
  if (!value) throw usageError(`${label} is required`);
  return value;
}

async function main(argv, { sdk = require('@cfb27/lua-hook'), io = defaultIo } = {}) {
  let parsed = { json: false };
  try {
    parsed = parseArgs(argv);
    const { command, json, positionals, options } = parsed;
    const env = io.env || process.env;
    if (!command || command === 'help') {
      io.out(HELP);
      return 0;
    }

    let result;
    if (command === 'install') {
      if (positionals.length) throw usageError('install does not accept positional arguments');
      const gameDir = requireDirectory(options.gameDir || env.CFB27_GAME_DIR, '--game-dir');
      const mmcDir = requireDirectory(options.mmcDir || env.CFB27_MMC_DIR, '--mmc-dir');
      const artifactsDir = requireDirectory(
        options.artifactsDir || env.CFB27_HOOK_ARTIFACTS,
        '--artifacts-dir',
      );
      result = await sdk.installHook({
        gameDir,
        mmcDir,
        proxyDll: path.resolve(artifactsDir, 'cfb27_cryptbase_proxy.dll'),
        hostDll: path.resolve(artifactsDir, 'cfb27_lua_host.dll'),
      });
    } else if (command === 'uninstall') {
      if (positionals.length) throw usageError('uninstall does not accept positional arguments');
      const gameDir = requireDirectory(options.gameDir || env.CFB27_GAME_DIR, '--game-dir');
      const mmcDir = requireDirectory(options.mmcDir || env.CFB27_MMC_DIR, '--mmc-dir');
      result = await sdk.restoreMmcHook({ gameDir, mmcDir });
    } else if (command === 'status') {
      if (positionals.length) throw usageError('status does not accept positional arguments');
      const game = await sdk.discoverGame();
      result = await sdk.createClient({ pid: game.pid }).status();
    } else if (command === 'run') {
      if (positionals.length !== 1) throw usageError('run requires exactly one Lua file');
      result = await sdk.runScriptFile(positionals[0]);
    } else if (command === 'eval') {
      if (!positionals.length) throw usageError('eval requires Lua source');
      const game = await sdk.discoverGame();
      result = await sdk.createClient({ pid: game.pid }).evaluateLua(positionals.join(' '));
    } else if (command === 'doctor') {
      if (positionals.length) throw usageError('doctor does not accept positional arguments');
      const gameDir = requireDirectory(options.gameDir || env.CFB27_GAME_DIR, '--game-dir');
      const mmcDir = requireDirectory(options.mmcDir || env.CFB27_MMC_DIR, '--mmc-dir');
      result = await sdk.doctor({ gameDir, mmcDir });
    } else {
      throw usageError(`Unknown command: ${command}`);
    }

    printSuccess(io, command, result, json);
    return 0;
  } catch (error) {
    printError(io, error, parsed.json === true);
    return exitCodeFor(error);
  }
}

module.exports = { HELP, exitCodeFor, main };
