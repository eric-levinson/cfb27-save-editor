'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeFrame, FrameDecoder, MAX_FRAME_BYTES } = require('../src/frame.cjs');
const { Cfb27HookError } = require('../src/errors.cjs');

test('frame decoder preserves fragmented multiline JSON', () => {
  const frame = encodeFrame({
    protocol: 1,
    id: 'a',
    command: 'evaluate',
    params: { source: 'x=1\nx=x+1' },
  });
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.push(frame.subarray(0, 2)), []);
  assert.deepEqual(decoder.push(frame.subarray(2, 11)), []);
  assert.deepEqual(decoder.push(frame.subarray(11)), [{
    protocol: 1,
    id: 'a',
    command: 'evaluate',
    params: { source: 'x=1\nx=x+1' },
  }]);
});

test('frame decoder handles two frames in one chunk', () => {
  const decoder = new FrameDecoder();
  const both = Buffer.concat([encodeFrame({ id: 'a' }), encodeFrame({ id: 'b' })]);
  assert.deepEqual(decoder.push(both), [{ id: 'a' }, { id: 'b' }]);
});

test('oversized frame throws stable INVALID_RESPONSE error', () => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(MAX_FRAME_BYTES + 1);
  assert.throws(
    () => new FrameDecoder().push(header),
    (error) => error instanceof Cfb27HookError && error.code === 'INVALID_RESPONSE',
  );
});
