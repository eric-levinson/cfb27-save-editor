'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_OUTPUT_ROOT = path.resolve(__dirname, '..', '..', '.frtk', 'board-reanchor');
const TABLE_IDS = Object.freeze(['4168', '4176', '4190', '4251', '5790', '5847']);
const BOARD_RVAS = Object.freeze([
  'genericRecordWrapperVtableRva',
  'recruitingControllerVtableRva',
  'fullAddRva',
  'fullRemoveRva',
]);
const IMAGE_SCN_MEM_EXECUTE = 0x20000000;
const IMAGE_SCN_MEM_READ = 0x40000000;

function canonicalSha(value) {
  if (typeof value !== 'string' || !/^[0-9A-Fa-f]{64}$/.test(value)) {
    throw new TypeError('Executable SHA-256 must contain exactly 64 hexadecimal characters');
  }
  return value.toUpperCase();
}

function toAddress(value, label = 'address') {
  let result;
  if (typeof value === 'bigint') {
    result = value;
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    result = BigInt(value);
  } else if (typeof value === 'string' && /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) {
    result = BigInt(value);
  } else {
    throw new TypeError(`${label} must be a bigint, safe integer, or hexadecimal string`);
  }
  if (result < 0n) throw new RangeError(`${label} must not be negative`);
  return result;
}

function canonicalHex(value, label) {
  return `0x${toAddress(value, label).toString(16).toUpperCase()}`;
}

function evidenceDirectory(executableSha256, outputRoot = DEFAULT_OUTPUT_ROOT) {
  const root = path.resolve(outputRoot);
  return path.join(root, canonicalSha(executableSha256));
}

function writeEvidence(filePath, value, {
  fileSystem = fs,
  temporaryToken = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`,
} = {}) {
  const target = path.resolve(filePath);
  const directory = path.dirname(target);
  const safeToken = String(temporaryToken).replace(/[^A-Za-z0-9_-]/g, '_');
  if (safeToken.length === 0) throw new TypeError('Temporary token must not be empty');
  const temporary = path.join(directory, `.${path.basename(target)}.${safeToken}.tmp`);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  fileSystem.mkdirSync(directory, { recursive: true });
  let temporaryCreated = false;
  try {
    fileSystem.writeFileSync(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
    temporaryCreated = true;
    fileSystem.renameSync(temporary, target);
  } catch (error) {
    if (temporaryCreated) {
      try {
        fileSystem.rmSync(temporary, { force: true });
      } catch {
        // Preserve the original write or rename failure.
      }
    }
    throw error;
  }
  return target;
}

function evidenceIdentity(evidence) {
  return {
    pid: evidence?.session?.pid ?? evidence?.pid,
    sessionId: evidence?.session?.sessionId ?? evidence?.sessionId ?? evidence?.hostSessionToken,
    executableSha256: evidence?.build?.executableSha256 ?? evidence?.executableSha256,
  };
}

function readEvidence(filePath, expectedIdentity, { fileSystem = fs } = {}) {
  const evidence = JSON.parse(fileSystem.readFileSync(path.resolve(filePath), 'utf8'));
  if (!expectedIdentity) return evidence;

  const actual = evidenceIdentity(evidence);
  const expectedSessionId = expectedIdentity.sessionId ?? expectedIdentity.hostSessionToken;
  if (actual.pid !== expectedIdentity.pid) {
    throw new Error('Evidence belongs to a different process PID');
  }
  if (actual.sessionId !== expectedSessionId) {
    throw new Error('Evidence belongs to a different host session');
  }
  if (canonicalSha(actual.executableSha256) !== canonicalSha(expectedIdentity.executableSha256)) {
    throw new Error('Evidence belongs to a different executable SHA-256');
  }
  return evidence;
}

function requireBufferRange(buffer, offset, length, label) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('PE image must be a Buffer');
  if (!Number.isInteger(offset) || offset < 0 || offset + length > buffer.length) {
    throw new Error(`PE image is truncated before ${label}`);
  }
}

function parsePeSections(image) {
  requireBufferRange(image, 0, 0x40, 'the DOS header');
  if (image.toString('ascii', 0, 2) !== 'MZ') throw new Error('PE image has no MZ signature');
  const peOffset = image.readUInt32LE(0x3C);
  requireBufferRange(image, peOffset, 24, 'the PE file header');
  if (image.toString('binary', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error('PE image has no PE signature');
  }

  const numberOfSections = image.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = image.readUInt16LE(peOffset + 20);
  const optionalHeaderOffset = peOffset + 24;
  if (numberOfSections === 0 || numberOfSections > 96) {
    throw new Error('PE image has an invalid section count');
  }
  if (optionalHeaderSize < 60) throw new Error('PE optional header is too small');
  requireBufferRange(image, optionalHeaderOffset, optionalHeaderSize, 'the PE optional header');
  const magic = image.readUInt16LE(optionalHeaderOffset);
  if (magic !== 0x20B && magic !== 0x10B) throw new Error('PE optional header has an unsupported magic');
  const sizeOfImage = image.readUInt32LE(optionalHeaderOffset + 56);
  if (sizeOfImage === 0) throw new Error('PE SizeOfImage must not be zero');

  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
  requireBufferRange(image, sectionTableOffset, numberOfSections * 40, 'the PE section table');
  const sections = [];
  for (let index = 0; index < numberOfSections; index += 1) {
    const offset = sectionTableOffset + index * 40;
    const name = image.toString('ascii', offset, offset + 8).replace(/\0.*$/, '');
    const virtualSize = image.readUInt32LE(offset + 8);
    const virtualAddress = image.readUInt32LE(offset + 12);
    const rawSize = image.readUInt32LE(offset + 16);
    const characteristics = image.readUInt32LE(offset + 36);
    const mappedSize = Math.max(virtualSize, rawSize);
    if (mappedSize === 0 || virtualAddress >= sizeOfImage ||
        virtualAddress + mappedSize > sizeOfImage) {
      throw new Error(`PE section ${name || index} escapes SizeOfImage`);
    }
    sections.push(Object.freeze({
      name,
      virtualAddress,
      virtualSize,
      rawSize,
      mappedSize,
      characteristics,
      readable: (characteristics & IMAGE_SCN_MEM_READ) !== 0,
      executable: (characteristics & IMAGE_SCN_MEM_EXECUTE) !== 0,
    }));
  }
  return Object.freeze({ sizeOfImage, sections: Object.freeze(sections) });
}

function classifyModuleAddress(address, moduleBase, pe) {
  if (!pe || !Number.isInteger(pe.sizeOfImage) || !Array.isArray(pe.sections)) {
    throw new TypeError('Parsed PE metadata is required');
  }
  const target = toAddress(address);
  const base = toAddress(moduleBase, 'module base');
  const end = base + BigInt(pe.sizeOfImage);
  if (target < base || target >= end) {
    return Object.freeze({
      address: canonicalHex(target),
      insideImage: false,
      rva: null,
      section: null,
      readable: false,
      executable: false,
    });
  }

  const rvaValue = target - base;
  const section = pe.sections.find((candidate) =>
    rvaValue >= BigInt(candidate.virtualAddress) &&
    rvaValue < BigInt(candidate.virtualAddress + candidate.mappedSize)) ?? null;
  return Object.freeze({
    address: canonicalHex(target),
    insideImage: true,
    rva: canonicalHex(rvaValue),
    section,
    readable: section?.readable === true,
    executable: section?.executable === true,
  });
}

function captureStackReturns(capture) {
  if (Array.isArray(capture?.hits)) {
    return capture.hits.flatMap((hit) => Array.isArray(hit?.stackReturnAddresses) ? hit.stackReturnAddresses : []);
  }
  return Array.isArray(capture?.stackReturnAddresses) ? capture.stackReturnAddresses : [];
}

function rankRoutineCandidates(captures, { moduleBase, pe }) {
  if (!Array.isArray(captures) || captures.length < 2) {
    throw new Error('At least two independent captures are required to rank routine candidates');
  }
  const captureCounts = captures.map((capture) => {
    const counts = new Map();
    for (const address of captureStackReturns(capture)) {
      const key = canonicalHex(address);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  });

  const ranked = [];
  for (const address of captureCounts[0].keys()) {
    if (!captureCounts.every((counts) => counts.has(address))) continue;
    const classification = classifyModuleAddress(address, moduleBase, pe);
    if (!classification.insideImage || !classification.executable) continue;
    const captureCount = captureCounts.length;
    const hitCount = captureCounts.reduce((sum, counts) => sum + counts.get(address), 0);
    ranked.push({
      address,
      rva: classification.rva,
      captureCount,
      hitCount,
      score: captureCount * 100 + hitCount,
    });
  }
  ranked.sort((left, right) =>
    (right.score - left.score) ||
    (toAddress(left.address) < toAddress(right.address) ? -1 : 1));
  return ranked;
}

function sameAddress(left, right) {
  return toAddress(left) === toAddress(right);
}

function validateVtable(object, label, moduleBase, pe) {
  const table = classifyModuleAddress(object.vtableAddress, moduleBase, pe);
  if (!table.insideImage || !table.readable) {
    return `${label} vtable is not in readable main-module image memory`;
  }
  if (!Array.isArray(object.vtableEntries) || object.vtableEntries.length === 0) {
    return `${label} vtable has no sampled entries`;
  }
  for (const entry of object.vtableEntries) {
    const target = classifyModuleAddress(entry, moduleBase, pe);
    if (!target.insideImage || !target.executable) {
      return `${label} vtable entry is not in an executable main-module section`;
    }
  }
  return null;
}

function validateObjectShapes(capture, { moduleBase, pe }) {
  const reject = (detail) => Object.freeze({ passed: false, detail });
  try {
    const args = capture?.arguments;
    const cells = capture?.pointerCells;
    const controller = capture?.controller;
    const team = capture?.team;
    const recruit = capture?.recruit;
    const expected = capture?.expected;
    if (!args || !cells || !controller || !team || !recruit || !expected) {
      return reject('Full entry object shape is incomplete');
    }
    if (!sameAddress(args.rcx, controller.address)) return reject('RCX does not contain the recruiting controller');
    if (controller.readable !== true || controller.descriptorTableId !== 5003) {
      return reject('RCX object is not a readable descriptor-table 5003 recruiting controller');
    }
    if (controller.boardStore?.offset !== 0x138 || controller.boardStore?.readable !== true ||
        controller.boardStore?.membershipRow !== expected.membershipRow) {
      return reject('Controller board store at +0x138 does not expose the expected membership row');
    }

    if (cells.team?.readable !== true || !sameAddress(args.rdx, cells.team.address) ||
        !sameAddress(cells.team.value, team.address)) {
      return reject('RDX is not a readable pointer cell containing the Team wrapper');
    }
    if (cells.recruit?.readable !== true || !sameAddress(args.r8, cells.recruit.address) ||
        !sameAddress(cells.recruit.value, recruit.address)) {
      return reject('R8 is not a readable pointer cell containing the Recruit wrapper');
    }
    if (team.readable !== true || team.descriptorTableId !== 6334 || team.row !== expected.teamRow ||
        team.field10Readable !== true || team.field18Readable !== true) {
      return reject('Team wrapper descriptor, row identity, or +0x10/+0x18 fields are invalid');
    }
    if (recruit.readable !== true || recruit.descriptorTableId !== 4269 ||
        recruit.row !== expected.recruitRow || recruit.field10Readable !== true ||
        recruit.field18Readable !== true) {
      return reject('Recruit wrapper descriptor, row identity, or +0x10/+0x18 fields are invalid');
    }
    if (!sameAddress(team.vtableAddress, recruit.vtableAddress)) {
      return reject('Team and Recruit wrappers do not share the generic record-wrapper vtable');
    }

    for (const [object, label] of [[controller, 'Controller'], [team, 'Team'], [recruit, 'Recruit']]) {
      const error = validateVtable(object, label, moduleBase, pe);
      if (error) return reject(error);
    }
    return Object.freeze({
      passed: true,
      detail: 'Full entry arguments and object shapes matched',
      genericRecordWrapperVtableAddress: canonicalHex(team.vtableAddress),
      recruitingControllerVtableAddress: canonicalHex(controller.vtableAddress),
    });
  } catch (error) {
    return reject(`Full entry object shape is malformed: ${error.message}`);
  }
}

function deriveVtableRvas(captures, { moduleBase, pe }) {
  if (!Array.isArray(captures) || captures.length < 2) {
    throw new Error('At least two object captures are required to prove stable vtables');
  }
  const validations = captures.map((capture) => validateObjectShapes(capture, { moduleBase, pe }));
  const rejected = validations.findIndex((validation) => !validation.passed);
  if (rejected !== -1) {
    throw new Error(`Capture ${rejected + 1} object shape rejected: ${validations[rejected].detail}`);
  }
  const wrapper = validations[0].genericRecordWrapperVtableAddress;
  const controller = validations[0].recruitingControllerVtableAddress;
  if (!validations.every((validation) =>
    validation.genericRecordWrapperVtableAddress === wrapper &&
    validation.recruitingControllerVtableAddress === controller)) {
    throw new Error('Vtable addresses were not stable across captures');
  }
  return Object.freeze({
    genericRecordWrapperVtableRva: classifyModuleAddress(wrapper, moduleBase, pe).rva,
    recruitingControllerVtableRva: classifyModuleAddress(controller, moduleBase, pe).rva,
  });
}

function normalizedCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizedScore(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function buildCandidateArtifact(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Candidate input is required');
  const tables = Object.fromEntries(TABLE_IDS.map((id) => {
    const summary = input.tables?.[id] ?? {};
    return [id, {
      passed: summary.passed === true,
      candidateCount: normalizedCount(summary.candidateCount),
      score: normalizedScore(summary.score),
      rereadPassed: summary.rereadPassed === true,
    }];
  }));
  const captures = Object.fromEntries(['add', 'remove'].map((operation) => {
    const summary = input.captures?.[operation] ?? {};
    return [operation, {
      writeCount: normalizedCount(summary.writeCount),
      executeCount: normalizedCount(summary.executeCount),
      consistent: summary.consistent === true,
    }];
  }));
  const proposedBoard = Object.fromEntries(BOARD_RVAS.map((name) =>
    [name, canonicalHex(input.proposedBoard?.[name], name)]));
  const sourceGates = Array.isArray(input.gates) ? input.gates : [];
  const gates = sourceGates.map((gate, index) => ({
    name: typeof gate?.name === 'string' && gate.name.length > 0 ? gate.name : `unnamed-gate-${index + 1}`,
    passed: gate?.passed === true,
    detail: typeof gate?.detail === 'string' ? gate.detail : String(gate?.detail ?? ''),
  }));
  const allTablesPassed = Object.values(tables).every((table) => table.passed && table.rereadPassed);
  const allCapturesPassed = Object.values(captures).every((capture) =>
    capture.writeCount >= 2 && capture.executeCount >= 1 && capture.consistent);
  const allGatesPassed = gates.length > 0 && gates.every((gate) => gate.passed);

  return {
    schemaVersion: 1,
    build: {
      label: String(input.build?.label ?? ''),
      executableSize: normalizedCount(input.build?.executableSize),
      executableSha256: canonicalSha(input.build?.executableSha256),
    },
    session: {
      pid: normalizedCount(input.session?.pid),
      sessionId: String(input.session?.sessionId ?? ''),
      moduleBase: canonicalHex(input.session?.moduleBase, 'module base'),
      capturedAt: String(input.session?.capturedAt ?? ''),
    },
    tables,
    captures,
    proposedBoard,
    gates,
    passed: allTablesPassed && allCapturesPassed && allGatesPassed,
  };
}

module.exports = {
  evidenceDirectory,
  writeEvidence,
  readEvidence,
  parsePeSections,
  classifyModuleAddress,
  rankRoutineCandidates,
  validateObjectShapes,
  deriveVtableRvas,
  buildCandidateArtifact,
};
