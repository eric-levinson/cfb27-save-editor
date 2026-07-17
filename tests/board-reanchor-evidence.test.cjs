'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  evidenceDirectory,
  writeEvidence,
  readEvidence,
  parsePeSections,
  classifyModuleAddress,
  rankRoutineCandidates,
  validateObjectShapes,
  deriveVtableRvas,
  buildCandidateArtifact,
} = require('../scripts/board-verification/reanchor-evidence.cjs');

const SHA = 'ab'.repeat(32);
const MODULE_BASE = 0x140000000n;

function peFixture() {
  const image = Buffer.alloc(0x400);
  image.write('MZ', 0, 'ascii');
  image.writeUInt32LE(0x80, 0x3C);
  image.write('PE\0\0', 0x80, 'binary');
  image.writeUInt16LE(0x8664, 0x84);
  image.writeUInt16LE(2, 0x86);
  image.writeUInt16LE(0xF0, 0x94);
  image.writeUInt16LE(0x20B, 0x98);
  image.writeUInt32LE(0x4000, 0x98 + 56);

  const sectionTable = 0x98 + 0xF0;
  image.write('.text\0\0\0', sectionTable, 'ascii');
  image.writeUInt32LE(0x600, sectionTable + 8);
  image.writeUInt32LE(0x1000, sectionTable + 12);
  image.writeUInt32LE(0x600, sectionTable + 16);
  image.writeUInt32LE(0x60000020, sectionTable + 36);

  const rdata = sectionTable + 40;
  image.write('.rdata\0\0', rdata, 'ascii');
  image.writeUInt32LE(0x400, rdata + 8);
  image.writeUInt32LE(0x2000, rdata + 12);
  image.writeUInt32LE(0x400, rdata + 16);
  image.writeUInt32LE(0x40000040, rdata + 36);
  return image;
}

function canonical(value) {
  return `0x${BigInt(value).toString(16).toUpperCase()}`;
}

function objectShape(heapOffset = 0n) {
  const controllerAddress = 0x200000000n + heapOffset;
  const teamCellAddress = 0x200001000n + heapOffset;
  const recruitCellAddress = 0x200001100n + heapOffset;
  const teamAddress = 0x200002000n + heapOffset;
  const recruitAddress = 0x200003000n + heapOffset;
  const wrapperVtableAddress = MODULE_BASE + 0x2100n;
  const controllerVtableAddress = MODULE_BASE + 0x2200n;
  const executableEntries = [MODULE_BASE + 0x1100n, MODULE_BASE + 0x1200n];
  return {
    arguments: {
      rcx: canonical(controllerAddress),
      rdx: canonical(teamCellAddress),
      r8: canonical(recruitCellAddress),
    },
    pointerCells: {
      team: { address: canonical(teamCellAddress), value: canonical(teamAddress), readable: true },
      recruit: { address: canonical(recruitCellAddress), value: canonical(recruitAddress), readable: true },
    },
    controller: {
      address: canonical(controllerAddress),
      readable: true,
      descriptorTableId: 5003,
      vtableAddress: canonical(controllerVtableAddress),
      vtableEntries: executableEntries.map(canonical),
      boardStore: { offset: 0x138, readable: true, membershipRow: 11 },
    },
    team: {
      address: canonical(teamAddress),
      readable: true,
      descriptorTableId: 6334,
      row: 22,
      field10Readable: true,
      field18Readable: true,
      vtableAddress: canonical(wrapperVtableAddress),
      vtableEntries: executableEntries.map(canonical),
    },
    recruit: {
      address: canonical(recruitAddress),
      readable: true,
      descriptorTableId: 4269,
      row: 33,
      field10Readable: true,
      field18Readable: true,
      vtableAddress: canonical(wrapperVtableAddress),
      vtableEntries: executableEntries.map(canonical),
    },
    expected: { membershipRow: 11, teamRow: 22, recruitRow: 33 },
  };
}

function tableSummaries() {
  return Object.fromEntries(['4168', '4176', '4190', '4251', '5790', '5847'].map((id) => [id, {
    passed: true,
    candidateCount: 1,
    score: 9,
    rereadPassed: true,
  }]));
}

test('evidenceDirectory uses the ignored board-reanchor root and uppercase SHA', () => {
  assert.equal(
    evidenceDirectory(SHA),
    path.resolve('.frtk', 'board-reanchor', SHA.toUpperCase()),
  );
});

test('writeEvidence writes a temporary sibling before atomically renaming it', () => {
  const calls = [];
  const fileSystem = {
    mkdirSync(directory, options) { calls.push(['mkdir', directory, options]); },
    writeFileSync(filePath, contents, options) { calls.push(['write', filePath, contents, options]); },
    renameSync(from, to) { calls.push(['rename', from, to]); },
    rmSync(filePath, options) { calls.push(['remove', filePath, options]); },
  };
  const target = path.resolve('ignored', 'candidate.json');

  writeEvidence(target, { schemaVersion: 1 }, { fileSystem, temporaryToken: 'TEST' });

  const write = calls.find(([operation]) => operation === 'write');
  const rename = calls.find(([operation]) => operation === 'rename');
  assert.equal(path.dirname(write[1]), path.dirname(target));
  assert.notEqual(write[1], target);
  assert.deepEqual(rename.slice(1), [write[1], target]);
  assert.equal(write[2], '{\n  "schemaVersion": 1\n}\n');
  assert.equal(calls.some(([operation]) => operation === 'remove'), false);
});

test('writeEvidence never removes a colliding temporary sibling it did not create', () => {
  const calls = [];
  const collision = Object.assign(new Error('temporary evidence already exists'), { code: 'EEXIST' });
  const fileSystem = {
    mkdirSync() {},
    writeFileSync() { throw collision; },
    renameSync() { assert.fail('rename must not run after a temporary-file collision'); },
    rmSync(filePath) { calls.push(filePath); },
  };

  assert.throws(
    () => writeEvidence(path.resolve('ignored', 'candidate.json'), {}, {
      fileSystem,
      temporaryToken: 'COLLISION',
    }),
    (error) => error === collision,
  );
  assert.deepEqual(calls, []);
});

test('readEvidence rejects evidence from another process, host session, or executable', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb27-evidence-'));
  const evidencePath = path.join(temporaryDirectory, 'capture.json');
  writeEvidence(evidencePath, {
    build: { executableSha256: SHA.toUpperCase() },
    session: { pid: 77, sessionId: 'host-start-1' },
  });

  const identity = { pid: 77, sessionId: 'host-start-1', executableSha256: SHA };
  assert.equal(readEvidence(evidencePath, identity).session.pid, 77);
  assert.throws(() => readEvidence(evidencePath, { ...identity, pid: 78 }), /different process/i);
  assert.throws(() => readEvidence(evidencePath, { ...identity, sessionId: 'host-start-2' }), /different host session/i);
  assert.throws(() => readEvidence(evidencePath, { ...identity, executableSha256: 'cd'.repeat(32) }), /different executable/i);
});

test('parsePeSections distinguishes executable text from readable non-executable rdata', () => {
  const pe = parsePeSections(peFixture());
  assert.equal(pe.sizeOfImage, 0x4000);
  assert.deepEqual(pe.sections.map(({ name, readable, executable }) => ({ name, readable, executable })), [
    { name: '.text', readable: true, executable: true },
    { name: '.rdata', readable: true, executable: false },
  ]);
});

test('classifyModuleAddress emits an RVA only for addresses inside SizeOfImage', () => {
  const pe = parsePeSections(peFixture());
  const text = classifyModuleAddress(MODULE_BASE + 0x1100n, MODULE_BASE, pe);
  assert.deepEqual(
    { insideImage: text.insideImage, rva: text.rva, section: text.section.name, executable: text.executable },
    { insideImage: true, rva: '0x1100', section: '.text', executable: true },
  );
  const below = classifyModuleAddress(MODULE_BASE - 1n, MODULE_BASE, pe);
  const end = classifyModuleAddress(MODULE_BASE + 0x4000n, MODULE_BASE, pe);
  assert.equal(below.rva, null);
  assert.equal(end.rva, null);
  assert.equal(below.insideImage, false);
  assert.equal(end.insideImage, false);
});

test('rankRoutineCandidates ranks only common executable stack returns across captures', () => {
  const pe = parsePeSections(peFixture());
  const common = canonical(MODULE_BASE + 0x1100n);
  const captures = [
    { hits: [{ stackReturnAddresses: [common, canonical(MODULE_BASE + 0x1200n), canonical(MODULE_BASE + 0x2100n)] }, { stackReturnAddresses: [common] }] },
    { hits: [{ stackReturnAddresses: [canonical(MODULE_BASE + 0x1300n), common, canonical(MODULE_BASE + 0x2100n)] }] },
  ];

  assert.deepEqual(rankRoutineCandidates(captures, { moduleBase: MODULE_BASE, pe }), [{
    address: common,
    rva: '0x1100',
    captureCount: 2,
    hitCount: 3,
    score: 203,
  }]);
});

test('object validation and transition derivation require stable readable vtables with executable entries', () => {
  const pe = parsePeSections(peFixture());
  const first = objectShape();
  const afterTransition = objectShape(0x100000n);
  const validation = validateObjectShapes(first, { moduleBase: MODULE_BASE, pe });
  assert.equal(validation.passed, true);
  assert.deepEqual(deriveVtableRvas([first, afterTransition], { moduleBase: MODULE_BASE, pe }), {
    genericRecordWrapperVtableRva: '0x2100',
    recruitingControllerVtableRva: '0x2200',
  });

  const nonExecutableEntry = objectShape();
  nonExecutableEntry.team.vtableEntries[0] = canonical(MODULE_BASE + 0x2100n);
  assert.equal(validateObjectShapes(nonExecutableEntry, { moduleBase: MODULE_BASE, pe }).passed, false);
});

test('object validation decisively rejects a common low-level routine with wrong entry arguments', () => {
  const pe = parsePeSections(peFixture());
  const lowLevel = objectShape();
  lowLevel.arguments.rcx = lowLevel.team.address;
  const validation = validateObjectShapes(lowLevel, { moduleBase: MODULE_BASE, pe });
  assert.equal(validation.passed, false);
  assert.match(validation.detail, /RCX/i);
  assert.throws(
    () => deriveVtableRvas([lowLevel, objectShape(0x100000n)], { moduleBase: MODULE_BASE, pe }),
    /object shape/i,
  );
});

test('buildCandidateArtifact emits the complete schema and passes only when every gate passes', () => {
  const input = {
    build: { label: 'Patch 1', executableSize: 123, executableSha256: SHA },
    session: { pid: 77, sessionId: 'host-start-1', moduleBase: canonical(MODULE_BASE), capturedAt: '2026-07-16T12:00:00.000Z' },
    tables: tableSummaries(),
    captures: {
      add: { writeCount: 2, executeCount: 1, consistent: true },
      remove: { writeCount: 2, executeCount: 1, consistent: true },
    },
    proposedBoard: {
      genericRecordWrapperVtableRva: '0x2100',
      recruitingControllerVtableRva: '0x2200',
      fullAddRva: '0x1100',
      fullRemoveRva: '0x1200',
    },
    gates: [
      { name: 'pe-sections', passed: true, detail: 'all addresses classified' },
      { name: 'argument-shapes', passed: true, detail: 'full entry arguments matched' },
    ],
  };
  const candidate = buildCandidateArtifact(input);
  assert.equal(candidate.schemaVersion, 1);
  assert.deepEqual(Object.keys(candidate.tables), ['4168', '4176', '4190', '4251', '5790', '5847']);
  assert.deepEqual(candidate.proposedBoard, input.proposedBoard);
  assert.equal(candidate.gates.every((gate) => typeof gate.passed === 'boolean'), true);
  assert.equal(candidate.passed, true);

  const failed = buildCandidateArtifact({
    ...input,
    gates: input.gates.map((gate, index) => index === 0 ? { ...gate, passed: false } : gate),
  });
  assert.equal(failed.passed, false);
});
