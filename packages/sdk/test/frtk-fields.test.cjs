'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decodePackedReference,
  encodePackedReference,
  decodeField,
  encodeField,
} = require('../src/frtk-fields.cjs');

test('packed references round trip table and row identities', () => {
  assert.deepEqual(decodePackedReference(encodePackedReference({ tableId: 4288, rowIndex: 37 })), {
    tableId: 4288,
    rowIndex: 37,
  });
  assert.throws(() => encodePackedReference({ tableId: 0x8000, rowIndex: 0 }), /tableId/);
  assert.throws(() => encodePackedReference({ tableId: 1, rowIndex: 0x20000 }), /rowIndex/);
});

test('cross-byte bitfields decode and preserve unrelated bits', () => {
  const definition = {
    name: 'CrossByte', encoding: 'bitfield', byteOffset: 0,
    storageBytes: 2, bitOffset: 5, bitWidth: 7, minimum: 0, maximum: 127,
  };
  const original = Buffer.from('A55A', 'hex');
  const updated = encodeField(original, definition, 73);
  assert.equal(decodeField(updated, definition), 73);
  assert.equal(updated[0] & 0x1F, 0x05);
  assert.equal(updated[1] & 0xF0, 0x50);
  assert.deepEqual(original, Buffer.from('A55A', 'hex'));
});

test('signed 11-bit fields round trip their legal extremes', () => {
  const definition = {
    name: 'SignedEleven', encoding: 'signed', byteOffset: 1,
    storageBytes: 2, bitOffset: 2, bitWidth: 11, minimum: -1024, maximum: 1023,
  };
  for (const value of [-1024, -17, 0, 1023]) {
    const encoded = encodeField(Buffer.from('AA55AA', 'hex'), definition, value);
    assert.equal(decodeField(encoded, definition), value);
    assert.equal(encoded[0], 0xAA);
    assert.equal(encoded[2] & 0xE0, 0xA0);
  }
  assert.throws(() => encodeField(Buffer.alloc(3), definition, -1025), /bounds|range/i);
});

test('unsigned and packed-reference fields enforce definitions and record bounds', () => {
  const unsigned = {
    name: 'Count', encoding: 'unsigned', byteOffset: 0,
    storageBytes: 2, bitOffset: 0, bitWidth: 16, minimum: 10, maximum: 500,
  };
  assert.equal(decodeField(encodeField(Buffer.alloc(2), unsigned, 300), unsigned), 300);
  assert.throws(() => encodeField(Buffer.alloc(2), unsigned, 9), /bounds/i);
  assert.throws(() => decodeField(Buffer.alloc(1), unsigned), /record/i);
  assert.throws(() => decodeField(Buffer.alloc(4), { ...unsigned, bitWidth: 0 }), /bitWidth/i);
  assert.throws(() => decodeField(Buffer.alloc(8), { ...unsigned, storageBytes: 8, bitWidth: 33 }), /bitWidth/i);

  const reference = {
    name: 'RecruitTarget', encoding: 'packed-reference', byteOffset: 0,
    storageBytes: 4, bitOffset: 0, bitWidth: 32, minimum: 0, maximum: 0xFFFFFFFF,
    referenceTableId: 4288,
  };
  const value = { tableId: 4288, rowIndex: 91 };
  assert.deepEqual(decodeField(encodeField(Buffer.alloc(4), reference, value), reference), value);
  assert.throws(() => encodeField(Buffer.alloc(4), reference,
    { tableId: 5840, rowIndex: 91 }), /target/i);
});

test('signed definitions cannot claim values outside their bit width', () => {
  const invalid = {
    name: 'Invalid', encoding: 'signed', byteOffset: 0,
    storageBytes: 2, bitOffset: 0, bitWidth: 11, minimum: -1025, maximum: 1023,
  };
  assert.throws(() => decodeField(Buffer.alloc(2), invalid), /signed range/i);
});
