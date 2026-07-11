'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { followEvents } = require('../src/logs.cjs');

test('followEvents advances cursor and does not duplicate events', async () => {
  const calls = [];
  const client = {
    getEvents: async ({ after }) => {
      calls.push(after);
      return calls.length === 1
        ? { events: [{ cursor: 1, type: 'log', payload: { message: 'a' } }], nextCursor: 1 }
        : { events: [{ cursor: 2, type: 'tick', payload: {} }], nextCursor: 2 };
    },
  };
  const iterator = followEvents(client, { after: 0, pollMs: 0 })[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.cursor, 1);
  assert.equal((await iterator.next()).value.cursor, 2);
  await iterator.return();
  assert.deepEqual(calls, [0, 1]);
});
