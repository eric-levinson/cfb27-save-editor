'use strict';

const { Cfb27HookError } = require('./errors.cjs');

const MAX_FRAME_BYTES = 1024 * 1024;

function encodeFrame(payload) {
  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch (error) {
    throw new Cfb27HookError('INVALID_REQUEST', 'Payload is not valid JSON data', {
      cause: error.message,
    });
  }

  if (serialized === undefined) {
    throw new Cfb27HookError('INVALID_REQUEST', 'Payload is not valid JSON data');
  }

  const body = Buffer.from(serialized, 'utf8');
  if (!body.length || body.length > MAX_FRAME_BYTES) {
    throw new Cfb27HookError('INVALID_REQUEST', 'Frame size is outside the supported range');
  }

  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

class FrameDecoder {
  constructor({ maxBytes = MAX_FRAME_BYTES } = {}) {
    this.maxBytes = maxBytes;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const messages = [];

    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE(0);
      if (!size || size > this.maxBytes) {
        throw new Cfb27HookError('INVALID_RESPONSE', `Invalid frame size: ${size}`);
      }
      if (this.buffer.length < size + 4) break;

      const body = this.buffer.subarray(4, size + 4);
      this.buffer = this.buffer.subarray(size + 4);
      try {
        messages.push(JSON.parse(body.toString('utf8')));
      } catch (error) {
        throw new Cfb27HookError('INVALID_RESPONSE', 'Host returned invalid JSON', {
          cause: error.message,
        });
      }
    }

    return messages;
  }
}

module.exports = { MAX_FRAME_BYTES, encodeFrame, FrameDecoder };
