'use strict';

const { ERROR_CODES, Cfb27HookError } = require('./src/errors.cjs');
const { discoverGame } = require('./src/process.cjs');
const { createClient, getHostStatus, runScriptFile } = require('./src/client.cjs');
const { inspectInstallation, installHook, restoreMmcHook } = require('./src/install.cjs');
const { doctor } = require('./src/doctor.cjs');

module.exports = {
  ERROR_CODES,
  Cfb27HookError,
  discoverGame,
  createClient,
  getHostStatus,
  runScriptFile,
  inspectInstallation,
  installHook,
  restoreMmcHook,
  doctor,
};
