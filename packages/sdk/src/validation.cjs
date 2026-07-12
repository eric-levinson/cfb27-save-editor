'use strict';

const UPPER_HEX_BYTES = /^(?:[0-9A-F]{2})+$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function hasOnlyKeys(value, keys) {
  return isObject(value) && Object.keys(value).every((key) => keys.includes(key));
}

function isSafeIntegerBetween(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isUpperHexBytes(value) {
  return typeof value === 'string' && UPPER_HEX_BYTES.test(value);
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
    return result;
  }
  throw new TypeError('Value is not a supported JSON value');
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

module.exports = {
  isObject,
  hasExactKeys,
  hasOnlyKeys,
  isSafeIntegerBetween,
  isUpperHexBytes,
  canonicalize,
  canonicalStringify,
};
