'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'native/host/frtk_lua_api.cpp'), 'utf8');

function bodyOf(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:int|LuaDatabaseApi::PreparedStatus)\\s+${escaped}\\s*\\([^)]*lua_State\\*\\s+state[^)]*\\)\\s*\\{`).exec(source);
  assert.ok(match, `missing Lua callback or leaf ${name}`);
  const begin = source.indexOf('{', match.index);
  let depth = 0;
  for (let index = begin; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(begin + 1, index);
  }
  assert.fail(`unterminated Lua callback or leaf ${name}`);
}

const callbacks = [
  'ReferenceParts',
  'TableToString',
  'RecordToString',
  'TransactionToString',
  'LuaDatabaseApi::GetTableByUniqueId',
  'LuaDatabaseApi::GetRecord',
  'LuaDatabaseApi::GetField',
  'LuaDatabaseApi::SetField',
  'LuaDatabaseApi::Transaction',
];

const leafHelpers = [
  'ProtectedReferenceParts',
  'RunTransactionCallback',
  'LuaDatabaseApi::Raise',
  'LuaDatabaseApi::RaiseLiteral',
];

test('every FrTk Lua callback has a POD-only longjmp leaf', () => {
  for (const name of [...callbacks, ...leafHelpers]) {
    const body = bodyOf(name);
    assert.match(body, /LUA_LONGJMP_LEAF/,
      `${name} must identify its POD-only Lua longjmp leaf`);
    assert.doesNotMatch(body,
      /std::(?:string|vector|optional|unique_lock|lock_guard|function|map|unordered_map)|\btry\b|\bcatch\b/,
      `${name} must not own non-trivial automatic C++ state`);
  }
});

test('FrTk Lua callbacks do not perform C++ exception translation beside Lua errors', () => {
  for (const name of callbacks) {
    const body = bodyOf(name);
    assert.doesNotMatch(body, /throw\s|std::runtime_error|error\.what\(\)/,
      `${name} must prepare errors before entering Lua error paths`);
  }
});
