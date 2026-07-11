'use strict';

const { ERROR_CODES, Cfb27HookError } = require('./src/errors.cjs');
const { MAX_FRAME_BYTES, encodeFrame, FrameDecoder } = require('./src/frame.cjs');

module.exports = Object.freeze({
  version: '0.1.0-dev.1',
  ERROR_CODES,
  Cfb27HookError,
  MAX_FRAME_BYTES,
  encodeFrame,
  FrameDecoder,
});
