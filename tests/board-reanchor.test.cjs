'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  TABLES,
  canonical,
  signature,
  decodeRef,
  scoreCandidate,
  deriveDataAddress,
  selectTableCandidate,
  locateTable,
  findUserBoard,
  readRange,
  validateAnchorReread,
} = require('../scripts/board-verification/reanchor-lib.cjs');

function encodedRef(tableId, row) {
  return ((tableId << 17) | row) >>> 0;
}

function tableData(table) {
  return Buffer.alloc(table.capacity * table.stride);
}

function setFreeRow(table, data, row) {
  data.writeUInt32LE(row + 1, row * table.stride);
}

function setContentRow(table, data, row) {
  const offset = row * table.stride;
  if (table.id === 4168) data.writeUInt32LE(encodedRef(4269, 7), offset + 12);
  if (table.id === 4251) data.writeUInt32LE(encodedRef(5847, 7), offset);
  if (table.id === 5790) data.writeUInt32LE(encodedRef(4190, 7), offset);
  if (table.id === 5847) data.writeUInt32LE(encodedRef(4168, 7), offset);
}

test('TABLES contains six frozen table definitions', () => {
  assert.equal(TABLES.size, 6);
  assert.deepEqual([...TABLES.keys()], [4168, 4176, 4190, 4251, 5790, 5847]);
  assert.equal(Object.isFrozen(TABLES), true);
  for (const table of TABLES.values()) assert.equal(Object.isFrozen(table), true);
});

test('TABLES rejects registry mutation', () => {
  try {
    assert.throws(() => TABLES.set(9999, {}), /read-only/i);
    assert.throws(() => TABLES.delete(4168), /read-only/i);
    assert.throws(() => TABLES.clear(), /read-only/i);
  } finally {
    Map.prototype.delete.call(TABLES, 9999);
  }
});

test('signature serializes table identity as four little-endian words', () => {
  assert.equal(signature(TABLES.get(4168)), 'FC9D0000FC9D00000900000060040000');
});

test('canonical and decodeRef preserve unsigned address and row identity', () => {
  assert.equal(canonical(0x7ff61234n), '0x7FF61234');
  assert.deepEqual(decodeRef(encodedRef(5847, 137)), { tableId: 5847, row: 137 });
});

test('deriveDataAddress applies header, offset, and array geometry for all tables', () => {
  const header = 0x100000n;
  for (const table of TABLES.values()) {
    const expectedOffset = table.headerSize - 204 - table.offsetStart +
      (table.isArray ? table.capacity * 4 : 0);
    assert.equal(deriveDataAddress(table, header), header + BigInt(expectedOffset), String(table.id));
  }
});

test('scoreCandidate recognizes freelist and table-specific content fixtures', () => {
  for (const table of TABLES.values()) {
    const data = tableData(table);
    setFreeRow(table, data, 0);
    if ([4168, 4251, 5790, 5847].includes(table.id)) setContentRow(table, data, 1);
    assert.deepEqual(scoreCandidate(table, data), {
      freeRows: 1,
      contentRows: [4168, 4251, 5790, 5847].includes(table.id) ? 1 : 0,
      score: [4168, 4251, 5790, 5847].includes(table.id) ? 9 : 1,
    }, String(table.id));
  }
});

test('selectTableCandidate requires a positive structural winner', () => {
  const table = TABLES.get(4168);
  assert.throws(() => selectTableCandidate(table, [{ score: { score: 0 } }]), /structural validation/i);
});

test('selectTableCandidate rejects tied structural winners', () => {
  const table = TABLES.get(4168);
  const winnerA = { header: 0x1000n, score: { score: 9 } };
  const winnerB = { header: 0x2000n, score: { score: 9 } };
  assert.throws(() => selectTableCandidate(table, [winnerA, winnerB]), /ambiguous/i);
});

test('findUserBoard discovers one compact user membership row', () => {
  const boardIndexDefinition = TABLES.get(4251);
  const membershipDefinition = TABLES.get(5847);
  const boardIndex = { ...boardIndexDefinition, data: tableData(boardIndexDefinition) };
  const membership = { ...membershipDefinition, data: tableData(membershipDefinition) };

  boardIndex.data.writeUInt32LE(encodedRef(5847, 3), 2 * boardIndex.stride);
  membership.data.writeUInt32LE(encodedRef(4168, 10), 3 * membership.stride);
  membership.data.writeUInt32LE(encodedRef(4168, 11), 3 * membership.stride + 4);

  const result = findUserBoard(new Map([[4251, boardIndex], [5847, membership]]));
  assert.equal(result.selected.boardRow, 2);
  assert.equal(result.selected.teamRow, 3);
  assert.equal(result.selected.firstFreeSlot, 2);
  assert.equal(result.selected.compact, true);
});

test('findUserBoard rejects a user membership row with an interior hole', () => {
  const boardIndexDefinition = TABLES.get(4251);
  const membershipDefinition = TABLES.get(5847);
  const boardIndex = { ...boardIndexDefinition, data: tableData(boardIndexDefinition) };
  const membership = { ...membershipDefinition, data: tableData(membershipDefinition) };
  boardIndex.data.writeUInt32LE(encodedRef(5847, 3), 2 * boardIndex.stride);
  membership.data.writeUInt32LE(encodedRef(4168, 10), 3 * membership.stride);
  membership.data.writeUInt32LE(encodedRef(4168, 11), 3 * membership.stride + 8);

  assert.throws(() => findUserBoard(new Map([[4251, boardIndex], [5847, membership]])), /compact/i);
});

test('readRange explicitly opts diagnostic reads into unsupported builds', async () => {
  const requests = [];
  const client = {
    async readMemory(request) {
      requests.push(request);
      return { ranges: [{ bytesHex: '00010203' }] };
    },
  };
  assert.deepEqual(await readRange(client, 0x1000n, 4), Buffer.from('00010203', 'hex'));
  assert.equal(requests[0].allowUnsupportedBuild, true);
});

test('validateAnchorReread rejects a changed table header', async () => {
  const table = TABLES.get(4168);
  const data = tableData(table);
  setFreeRow(table, data, 0);
  setContentRow(table, data, 1);
  const candidate = {
    header: 0x1000n,
    base: deriveDataAddress(table, 0x1000n),
    data,
    score: scoreCandidate(table, data),
    freelistHead: 0,
  };
  const requests = [];
  const client = {
    async readMemory(request) {
      requests.push(request);
      return { ranges: [{ bytesHex: Buffer.alloc(request.ranges[0].length).toString('hex') }] };
    },
  };

  await assert.rejects(() => validateAnchorReread(client, table, candidate), /header.*mismatch/i);
  assert.equal(requests[0].ranges[0].length, 16);
  assert.ok(requests.every((request) => request.allowUnsupportedBuild === true));
});

test('locateTable explicitly opts scans and validation reads into unsupported builds', async () => {
  const table = TABLES.get(4176);
  const header = 0x1000n;
  const base = deriveDataAddress(table, header);
  const data = tableData(table);
  setFreeRow(table, data, 0);
  const scanRequests = [];
  const readRequests = [];
  const client = {
    async scanMemoryPage(request) {
      scanRequests.push(request);
      return {
        complete: true,
        nextCursor: null,
        matches: [{ address: canonical(header), allocationBase: '0x1000', allocationSize: 0x10000 }],
      };
    },
    async readMemory(request) {
      readRequests.push(request);
      const range = request.ranges[0];
      const address = BigInt(range.address);
      let bytes = Buffer.alloc(range.length);
      if (address === base && range.length === data.length) bytes = data;
      if (address === header && range.length === 16) bytes = Buffer.from(signature(table), 'hex');
      if (address === base && range.length === table.stride) bytes = data.subarray(0, table.stride);
      return { ranges: [{ bytesHex: bytes.toString('hex') }] };
    },
  };

  const located = await locateTable(client, table, { log: () => {} });
  assert.equal(located.base, base);
  assert.equal(located.validation.header, true);
  assert.ok(scanRequests.every((request) => request.allowUnsupportedBuild === true));
  assert.ok(readRequests.every((request) => request.allowUnsupportedBuild === true));
});

test('live anchor consumes the reusable layer and records identity validation summaries', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'board-verification',
    'live-anchor.cjs'), 'utf8');
  assert.match(source, /require\(['"]\.\/reanchor-lib\.cjs['"]\)/);
  assert.doesNotMatch(source, /const TABLES\s*=/);
  assert.doesNotMatch(source, /function signature\(/);
  assert.match(source, /executableSha256/);
  assert.match(source, /sessionIdentity/);
  assert.match(source, /validationSummaries/);
});

test('live snapshot rejects executable drift and explicitly opts every read into diagnostics', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'board-verification',
    'live-table-snapshot.cjs'), 'utf8');
  assert.match(source, /executableSha256/);
  assert.match(source, /different game executable/i);
  assert.match(source, /allowUnsupportedBuild:\s*true/);
});
