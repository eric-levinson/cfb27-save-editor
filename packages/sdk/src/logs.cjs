'use strict';

const { Cfb27HookError } = require('./errors.cjs');

function wait(milliseconds, signal) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

async function* followEvents(client, {
  after = 0,
  limit = 256,
  pollMs = 500,
  signal,
} = {}) {
  let cursor = after;
  while (!signal?.aborted) {
    const result = await client.getEvents({ after: cursor, limit });
    if (!result || !Array.isArray(result.events) || !Number.isSafeInteger(result.nextCursor)) {
      throw new Cfb27HookError('INVALID_RESPONSE', 'Host returned an invalid event page');
    }
    let yielded = false;
    for (const event of result.events) {
      if (!event || !Number.isSafeInteger(event.cursor) || event.cursor <= cursor) continue;
      cursor = event.cursor;
      yielded = true;
      yield event;
    }
    cursor = Math.max(cursor, result.nextCursor);
    if (!yielded) await wait(pollMs, signal);
  }
}

module.exports = { followEvents };
