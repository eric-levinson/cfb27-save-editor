'use strict';

function usageError(message) {
  const error = new Error(message);
  error.code = 'USAGE';
  return error;
}

function parseArgs(argv) {
  let command;
  let json = false;
  let help = false;
  let literal = false;
  const positionals = [];
  const options = {
    gameDir: undefined,
    mmcDir: undefined,
    artifactsDir: undefined,
    follow: false,
    after: undefined,
  };
  const seen = new Set();
  const values = new Map([
    ['--game-dir', 'gameDir'],
    ['--mmc-dir', 'mmcDir'],
    ['--artifacts-dir', 'artifactsDir'],
    ['--after', 'after'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (literal) {
      if (!command) command = token;
      else positionals.push(token);
      continue;
    }
    if (token === '--') {
      literal = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }
    if (token === '--json' || token === '--follow') {
      if (seen.has(token)) throw usageError(`Duplicate option: ${token}`);
      seen.add(token);
      if (token === '--json') json = true;
      else options.follow = true;
      continue;
    }
    if (values.has(token)) {
      if (seen.has(token)) throw usageError(`Duplicate option: ${token}`);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw usageError(`Missing value for ${token}`);
      }
      seen.add(token);
      options[values.get(token)] = value;
      index += 1;
      continue;
    }
    if (token.startsWith('-')) throw usageError(`Unknown option: ${token}`);
    if (!command) command = token;
    else positionals.push(token);
  }

  if (options.after !== undefined) {
    const after = Number(options.after);
    if (!Number.isSafeInteger(after) || after < 0) throw usageError('--after must be a nonnegative integer');
    options.after = after;
  }
  if (help) command = 'help';
  return { command, json, positionals, options };
}

module.exports = { parseArgs, usageError };
