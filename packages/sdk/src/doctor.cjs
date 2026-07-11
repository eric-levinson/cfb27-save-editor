'use strict';

const { discoverGame } = require('./process.cjs');
const { createClient } = require('./client.cjs');
const { inspectInstallation } = require('./install.cjs');

function failedCheck(name, error) {
  return {
    name,
    ok: false,
    details: {
      code: typeof error?.code === 'string' ? error.code : 'CHECK_FAILED',
      message: error?.message || 'Check failed',
    },
  };
}

async function doctor(options = {}, dependencies = {}) {
  const discoverGameImpl = dependencies.discoverGameImpl || discoverGame;
  const inspectInstallationImpl = dependencies.inspectInstallationImpl || inspectInstallation;
  const createClientImpl = dependencies.createClientImpl || createClient;
  const checks = [];
  const recommendations = [];

  let game;
  try {
    game = await discoverGameImpl(options);
    checks.push({ name: 'game', ok: true, details: game });
  } catch (error) {
    checks.push(failedCheck('game', error));
    recommendations.push('Launch College Football 27 in the supported offline configuration.');
  }

  try {
    const installation = await inspectInstallationImpl(options);
    const ok = installation.mode === 'installed';
    checks.push({ name: 'installation', ok, details: installation });
    if (!ok) recommendations.push('Run cfb27lua install after closing the game.');
  } catch (error) {
    checks.push(failedCheck('installation', error));
    recommendations.push('Verify the game and MMC directories, then inspect the existing proxies.');
  }

  let hello;
  let status;
  if (game) {
    try {
      const client = createClientImpl({ pid: game.pid, timeoutMs: options.timeoutMs });
      hello = await client.hello();
      status = await client.status();
      checks.push({ name: 'host', ok: status?.ready === true, details: status });
      if (status?.ready !== true) recommendations.push('Confirm the Lua host DLL is installed and loaded.');
    } catch (error) {
      checks.push(failedCheck('host', error));
      recommendations.push('Confirm the Lua host DLL is installed and loaded.');
    }
  } else {
    checks.push({ name: 'host', ok: false, details: { message: 'Game process is unavailable' } });
  }

  const supportedBuild = status?.supportedBuild ?? hello?.supportedBuild ?? false;
  checks.push({ name: 'build', ok: supportedBuild === true, details: { supportedBuild } });
  if (!supportedBuild) recommendations.push('Use the exact supported College Football 27 executable build.');

  const writesAllowed = status?.writesAllowed ?? hello?.writesAllowed ?? false;
  checks.push({ name: 'writes', ok: writesAllowed === true, details: { writesAllowed } });
  if (!writesAllowed) recommendations.push('Keep EA anticheat closed and use offline mode before writing.');

  return { checks, recommendations };
}

module.exports = { doctor };
