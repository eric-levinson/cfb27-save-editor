'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline/promises');
const { promisify } = require('node:util');
const sdk = require('../../packages/sdk');
const { loadManifest } = require('../game-build-manifest.cjs');
const {
  TABLES,
  canonical,
  decodeRef,
  locateTable,
  findUserBoard,
  readRange,
  validateAnchorReread,
} = require('./reanchor-lib.cjs');
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
} = require('./reanchor-evidence.cjs');

const execFile = promisify(childProcess.execFile);
const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(REPOSITORY_ROOT, 'native', 'host', 'game_builds.json');
const COMMANDS = new Set([
  'preflight', 'validate', 'capture-add-write', 'capture-add-execute',
  'capture-remove-write', 'capture-remove-execute', 'transition-check',
  'analyze', 'status',
]);
const VALUE_FLAGS = new Set([
  '--game-dir', '--save', '--capture', '--operation', '--stage', '--recruit-row',
  '--team-row', '--board-slot',
]);
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const PATCH1_SHA = 'A048578530F7ED5967DF38803B63AD9B9F04FC71287F1E151C901A94AB240BFD';

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length < 1 || !COMMANDS.has(argv[0])) {
    throw new Error(`Usage: node reanchor-build.cjs <${[...COMMANDS].join('|')}> --game-dir <path> --save <path>`);
  }
  const options = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!VALUE_FLAGS.has(flag) || index + 1 >= argv.length) throw new Error(`Invalid or missing option: ${flag}`);
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate option: ${flag}`);
    options[key] = argv[index + 1];
  }
  for (const key of ['capture', 'recruitRow', 'teamRow', 'boardSlot']) {
    if (options[key] !== undefined) {
      const value = Number(options[key]);
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${key} must be a nonnegative integer`);
      options[key] = value;
    }
  }
  if (options.operation !== undefined && !['add', 'remove'].includes(options.operation)) {
    throw new Error('--operation must be add or remove');
  }
  if (options.stage !== undefined && options.stage !== 'rank') throw new Error('--stage must be rank');
  return options;
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex').toUpperCase();
}

function processScript(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('PID is invalid');
  return `$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" | ` +
    'Select-Object ProcessId,ExecutablePath,CreationDate | ConvertTo-Json -Compress';
}

async function queryProcess(pid, execFileImpl = execFile) {
  const { stdout } = await execFileImpl(POWERSHELL,
    ['-NoProfile', '-NonInteractive', '-Command', processScript(pid)],
    { windowsHide: true, encoding: 'utf8' });
  const value = JSON.parse(String(stdout).trim() || 'null');
  if (!value || value.ProcessId !== pid || typeof value.ExecutablePath !== 'string' ||
      typeof value.CreationDate !== 'string') throw new Error('Could not establish exact game process identity');
  return { pid, path: value.ExecutablePath, creationDate: value.CreationDate };
}

async function anticheatProcesses(execFileImpl = execFile) {
  const script = "$ErrorActionPreference='Stop'; @(Get-Process | Where-Object { $_.ProcessName -match 'Javelin|EAAntiCheat|EAAntiCheat.GameService' } | Select-Object Id,ProcessName) | ConvertTo-Json -Compress";
  const { stdout } = await execFileImpl(POWERSHELL,
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, encoding: 'utf8' });
  const text = String(stdout).trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function luaHex(value) {
  return `0x${BigInt(value).toString(16).toUpperCase()}`;
}

function luaCaptureSerializer(prefix) {
  const quoted = JSON.stringify(prefix);
  return `
local prefix=${quoted}
local function hx(v) if v == nil then return "0x0" end return string.format("0x%X", v) end
local function list(v) local out={} if v then for i=1,#v do out[#out+1]=hx(v[i]) end end return table.concat(out,",") end
local hits=cfb.watch_hits(true)
local count=0
for i,h in ipairs(hits) do
 count=count+1
 cfb.log(prefix.."|HIT|"..i.."|"..h.slot.."|"..h.thread_id.."|"..hx(h.rip).."|"..hx(h.rsp).."|"..hx(h.rax).."|"..hx(h.rbx).."|"..hx(h.rbp).."|"..hx(h.rsi).."|"..hx(h.rdi).."|"..hx(h.rcx).."|"..hx(h.rdx).."|"..hx(h.r8).."|"..hx(h.r9).."|"..hx(h.r10).."|"..hx(h.r11))
 cfb.log(prefix.."|STACK|"..i.."|"..list(h.stack))
 cfb.log(prefix.."|RBX|"..i.."|"..list(h.rbx_memory))
 cfb.log(prefix.."|RSI|"..i.."|"..list(h.rsi_memory))
 cfb.log(prefix.."|RDI|"..i.."|"..list(h.rdi_memory))
 cfb.log(prefix.."|RCX|"..i.."|"..list(h.rcx_memory))
 cfb.log(prefix.."|RDX|"..i.."|"..list(h.rdx_memory))
 cfb.log(prefix.."|R8|"..i.."|"..list(h.r8_memory))
 cfb.log(prefix.."|R9|"..i.."|"..list(h.r9_memory))
end
cfb.unwatch()
cfb.log(prefix.."|META|"..count.."|"..(hits.dropped or 0))`;
}

function parseHexList(text) {
  if (!text) return [];
  return text.split(',').filter(Boolean).map((value) => canonical(value));
}

function parseCaptureLogs(logs, prefix) {
  const hits = new Map();
  let declaredCount = null;
  let dropped = null;
  for (const entry of logs) {
    if (!entry || typeof entry.message !== 'string' || !entry.message.startsWith(`${prefix}|`)) continue;
    const parts = entry.message.split('|');
    const type = parts[1];
    if (type === 'META') {
      declaredCount = Number(parts[2]);
      dropped = Number(parts[3]);
      continue;
    }
    const index = Number(parts[2]);
    if (!Number.isSafeInteger(index) || index <= 0) continue;
    const hit = hits.get(index) || { index };
    if (type === 'HIT') {
      const names = ['slot', 'threadId', 'rip', 'rsp', 'rax', 'rbx', 'rbp', 'rsi', 'rdi',
        'rcx', 'rdx', 'r8', 'r9', 'r10', 'r11'];
      names.forEach((name, offset) => {
        const value = parts[offset + 3];
        hit[name] = offset < 2 ? Number(value) : canonical(value);
      });
    } else {
      const field = type === 'STACK' ? 'stackReturnAddresses' : `${type.toLowerCase()}Memory`;
      hit[field] = parseHexList(parts[3]);
    }
    hits.set(index, hit);
  }
  const ordered = [...hits.values()].sort((left, right) => left.index - right.index);
  if (!Number.isSafeInteger(declaredCount) || declaredCount !== ordered.length || dropped !== 0) {
    throw new Error(`Watch capture is incomplete: declared=${declaredCount}, parsed=${ordered.length}, dropped=${dropped}`);
  }
  return ordered;
}

async function moduleBase(client) {
  const prefix = `REANCHOR_MODULE_${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  await client.evaluateLua(`cfb.log(${JSON.stringify(prefix)}.."|"..string.format("0x%X",cfb.module_base()))`);
  const result = await client.getLogs({ limit: 256 });
  const entry = result.logs.findLast((item) => item.message.startsWith(`${prefix}|`));
  if (!entry) throw new Error('Could not read the main module base from the host');
  return canonical(entry.message.slice(prefix.length + 1));
}

function sessionId({ pid, creationDate, hostVersion, readyTimestampMs }) {
  return sha256Buffer(Buffer.from(`${pid}|${creationDate}|${hostVersion}|${readyTimestampMs}`, 'utf8'));
}

function evidenceIdentity(runtime) {
  return {
    pid: runtime.session.pid,
    sessionId: runtime.session.sessionId,
    executableSha256: runtime.build.executableSha256,
  };
}

function envelope(runtime, extra = {}) {
  return { schemaVersion: 1, build: runtime.build, session: runtime.session, ...extra };
}

async function establishRuntime(options, dependencies = {}) {
  const discoverGame = dependencies.discoverGame || sdk.discoverGame;
  const createClient = dependencies.createClient || sdk.createClient;
  const query = dependencies.queryProcess || queryProcess;
  const anticheat = dependencies.anticheatProcesses || anticheatProcesses;
  const executable = path.resolve(options.gameDir || '', 'CollegeFB27.exe');
  const stat = await fsp.stat(executable);
  if (!stat.isFile()) throw new Error('CollegeFB27.exe is not a file');
  const sha = await (dependencies.sha256File || sha256File)(executable);
  const manifest = loadManifest(MANIFEST_PATH);
  const build = manifest.builds.find((entry) => entry.size === stat.size && entry.sha256 === sha);
  if (!build) throw new Error(`Executable is absent from the build registry: ${sha}`);
  const game = await discoverGame({ expectedSize: stat.size, expectedSha256: sha });
  const process = await query(game.pid);
  if (path.resolve(process.path).toLowerCase() !== executable.toLowerCase()) {
    throw new Error('Running executable path does not match --game-dir');
  }
  const activeAnticheat = await anticheat();
  if (activeAnticheat.length > 0) throw new Error('Real EA/Javelin anticheat process is running');
  const client = createClient({ pid: game.pid, timeoutMs: 60_000 });
  const hello = await client.hello();
  const status = await client.status();
  if (!status.ready || !hello.capabilities.includes('researchWatch')) throw new Error('Research-capable host is not ready');
  const logs = (await client.getLogs({ limit: 256 })).logs;
  const ready = logs.findLast((entry) => entry.message === 'CFB27 Lua host ready');
  if (!ready) throw new Error('Host-ready session marker is absent');
  const base = await moduleBase(client);
  const runtime = {
    build: { label: build.label, executableSize: build.size, executableSha256: build.sha256 },
    session: {
      pid: game.pid,
      sessionId: sessionId({ pid: game.pid, creationDate: process.creationDate,
        hostVersion: hello.hostVersion, readyTimestampMs: ready.timestampMs }),
      moduleBase: base,
      capturedAt: new Date().toISOString(),
    },
    registrySupport: build.support,
    hello,
    status,
    process,
    executable,
    client,
  };
  return runtime;
}

async function backupSave(savePath, runtime) {
  const source = path.resolve(savePath || '');
  const stat = await fsp.stat(source);
  if (!stat.isFile()) throw new Error('--save must identify an existing save file');
  const directory = path.join(evidenceDirectory(runtime.build.executableSha256), 'save-backup');
  await fsp.mkdir(directory, { recursive: true });
  const target = path.join(directory, path.basename(source));
  const sourceHash = await sha256File(source);
  if (fs.existsSync(target)) {
    if (await sha256File(target) !== sourceHash) throw new Error('Existing save backup does not match the selected save');
  } else {
    await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  }
  const backupHash = await sha256File(target);
  if (backupHash !== sourceHash) throw new Error('Save backup verification failed');
  return { source, sourceHash, backupPath: target, backupHash, size: stat.size, verified: true };
}

async function locateAll(client, log = (text) => process.stderr.write(text)) {
  const located = [];
  for (const table of TABLES.values()) located.push(await locateTable(client, table, { log }));
  const tables = new Map(located.map((table) => [table.id, table]));
  return { located, tables, board: findUserBoard(tables) };
}

function serializeTables(result) {
  return {
    tables: Object.fromEntries(result.located.map((table) => [String(table.id), {
      header: canonical(table.header), base: canonical(table.base), stride: table.stride,
      capacity: table.capacity, words: table.words, candidateCount: table.candidateCount,
      signatureMatches: table.signatureMatches, freelistHead: table.freelistHead,
      score: table.score.score, rereadPassed: true,
    }])),
    tableSummaries: Object.fromEntries(result.located.map((table) => [String(table.id), {
      passed: true, candidateCount: table.candidateCount, score: table.score.score, rereadPassed: true,
    }])),
    userBoard: result.board.selected,
  };
}

async function hydrateTables(client, stored) {
  const located = [];
  for (const [idText, saved] of Object.entries(stored.tables)) {
    const spec = TABLES.get(Number(idText));
    if (!spec) throw new Error(`Unknown stored table ${idText}`);
    const data = await readRange(client, BigInt(saved.base), spec.capacity * spec.stride);
    const freelistHead = (await readRange(client, BigInt(saved.header) + 24n, 4)).readUInt32LE(0);
    const table = { ...spec, header: BigInt(saved.header), base: BigInt(saved.base), data,
      freelistHead, score: { score: saved.score }, candidateCount: saved.candidateCount,
      signatureMatches: saved.signatureMatches };
    await validateAnchorReread(client, spec, table);
    located.push(table);
  }
  const tables = new Map(located.map((entry) => [entry.id, entry]));
  return { located, tables, board: findUserBoard(tables) };
}

function findBoardSlot(tables, teamRow, recruitRow) {
  const membership = tables.get(5847);
  const targets = tables.get(4168);
  if (!Number.isSafeInteger(teamRow) || teamRow < 0 || teamRow >= membership.capacity) {
    throw new Error('teamRow is outside table 5847');
  }
  const offset = teamRow * membership.stride;
  for (let slot = 0; slot < membership.words; slot += 1) {
    const membershipRef = decodeRef(membership.data.readUInt32LE(offset + slot * 4));
    if (membershipRef.tableId !== 4168 || membershipRef.row >= targets.capacity) continue;
    const recruitRef = decodeRef(targets.data.readUInt32LE(membershipRef.row * targets.stride + 12));
    if (recruitRef.tableId === 4269 && recruitRef.row === recruitRow) return slot;
  }
  throw new Error(`Recruit row ${recruitRow} is not on membership row ${teamRow}`);
}

function armScript(watches, execute) {
  const calls = watches.map(({ address, length = 4 }) => execute
    ? `cfb.watch_exec(${luaHex(address)})`
    : `cfb.watch(${luaHex(address)},${length})`).join('\n');
  return `cfb.unwatch()\n${calls}`;
}

async function promptAction(message, input = process.stdin, output = process.stdout) {
  if (!input.isTTY) throw new Error('Interactive vanilla action confirmation requires a TTY');
  const rl = readline.createInterface({ input, output });
  try { await rl.question(`${message}\nPress Enter only after the vanilla UI action finishes... `); }
  finally { rl.close(); }
}

async function collectWatch(client, prefix) {
  await client.evaluateLua(luaCaptureSerializer(prefix));
  const result = await client.getLogs({ limit: 256 });
  return parseCaptureLogs(result.logs, prefix);
}

async function readBytes(client, address, length) {
  const result = await client.readMemory({ allowUnsupportedBuild: true,
    ranges: [{ address: canonical(address), length }] });
  return Buffer.from(result.ranges[0].bytesHex, 'hex');
}

async function readQword(client, address) {
  return (await readBytes(client, address, 8)).readBigUInt64LE(0);
}

async function descriptorTableId(client, descriptor) {
  return Number((await readQword(client, descriptor + 40n)) >> 32n);
}

async function vtableEntries(client, address) {
  const bytes = await readBytes(client, address, 16);
  return [canonical(bytes.readBigUInt64LE(0)), canonical(bytes.readBigUInt64LE(8))];
}

async function enrichExecuteHit(client, hit, expected, runtime, captureId) {
  const controllerAddress = BigInt(hit.rcx);
  const teamCell = BigInt(hit.rdx);
  const recruitCell = BigInt(hit.r8);
  const teamAddress = await readQword(client, teamCell);
  const recruitAddress = await readQword(client, recruitCell);
  const controller = await readBytes(client, controllerAddress, 0x140);
  const team = await readBytes(client, teamAddress, 32);
  const recruit = await readBytes(client, recruitAddress, 32);
  const controllerDescriptor = controller.readBigUInt64LE(16);
  const teamDescriptor = team.readBigUInt64LE(16);
  const recruitDescriptor = recruit.readBigUInt64LE(16);
  const controllerVtable = controller.readBigUInt64LE(0);
  const wrapperVtable = team.readBigUInt64LE(0);
  const recruitVtable = recruit.readBigUInt64LE(0);
  const membershipRow = Number(controller.readBigUInt64LE(8));
  const boardStore = controller.readBigUInt64LE(0x138);
  await readBytes(client, boardStore, 8);
  return {
    captureId,
    build: { executableSize: runtime.build.executableSize,
      executableSha256: runtime.build.executableSha256 },
    session: { pid: runtime.session.pid, sessionId: runtime.session.sessionId },
    entryAddress: hit.rip,
    arguments: { rcx: hit.rcx, rdx: hit.rdx, r8: hit.r8 },
    pointerCells: {
      team: { address: hit.rdx, value: canonical(teamAddress), readable: true },
      recruit: { address: hit.r8, value: canonical(recruitAddress), readable: true },
    },
    controller: {
      address: hit.rcx, readable: true,
      descriptorTableId: await descriptorTableId(client, controllerDescriptor),
      membershipRow, vtableAddress: canonical(controllerVtable),
      vtableEntries: await vtableEntries(client, controllerVtable),
      boardStore: { offset: 0x138, readable: true, membershipRow },
    },
    team: {
      address: canonical(teamAddress), readable: true,
      descriptorTableId: await descriptorTableId(client, teamDescriptor),
      row: Number(team.readBigUInt64LE(24)), field10Readable: true, field18Readable: true,
      vtableAddress: canonical(wrapperVtable), vtableEntries: await vtableEntries(client, wrapperVtable),
    },
    recruit: {
      address: canonical(recruitAddress), readable: true,
      descriptorTableId: await descriptorTableId(client, recruitDescriptor),
      row: Number(recruit.readBigUInt64LE(24)), field10Readable: true, field18Readable: true,
      vtableAddress: canonical(recruitVtable), vtableEntries: await vtableEntries(client, recruitVtable),
    },
    expected: { membershipRow: expected.membershipRow, teamRow: expected.teamRow,
      recruitRow: expected.recruitRow },
  };
}

async function requirePreflight(options, dependencies) {
  const runtime = await establishRuntime(options, dependencies);
  const identity = evidenceIdentity(runtime);
  const preflight = readEvidence('preflight.json', identity);
  if (preflight.saveBackup?.verified !== true) throw new Error('Preflight has no verified save backup');
  return { runtime, identity, preflight };
}

async function commandPreflight(options, dependencies) {
  const runtime = await establishRuntime(options, dependencies);
  if (runtime.registrySupport !== 'diagnostic' || runtime.hello.supportedBuild !== false ||
      runtime.hello.writesAllowed !== false || runtime.status.writesAllowed !== false) {
    throw new Error('Preflight requires an exact diagnostic host with writes disabled');
  }
  const saveBackup = await backupSave(options.save, runtime);
  const record = envelope(runtime, {
    process: { path: runtime.process.path, creationDate: runtime.process.creationDate },
    host: { version: runtime.hello.hostVersion, supportedBuild: runtime.hello.supportedBuild,
      writesAllowed: runtime.hello.writesAllowed, ready: runtime.status.ready },
    saveBackup,
  });
  writeEvidence('preflight.json', record);
  return record;
}

async function commandValidate(options, dependencies) {
  const { runtime } = await requirePreflight(options, dependencies);
  const result = await locateAll(runtime.client);
  const serialized = serializeTables(result);
  const record = envelope(runtime, serialized);
  writeEvidence('tables.json', record);
  return record;
}

async function commandWriteCapture(options, dependencies, operation) {
  if (![1, 2].includes(options.capture)) throw new Error('--capture must be 1 or 2');
  if (!Number.isSafeInteger(options.recruitRow) || !Number.isSafeInteger(options.teamRow)) {
    throw new Error('Write capture requires --recruit-row and --team-row');
  }
  const { runtime, identity } = await requirePreflight(options, dependencies);
  const stored = readEvidence('tables.json', identity);
  const live = await hydrateTables(runtime.client, stored);
  const membership = live.tables.get(5847);
  const userTargets = live.tables.get(4168);
  const pitches = live.tables.get(5790);
  const teamRow = options.teamRow;
  const watches = [];
  if (operation === 'add') {
    if (teamRow !== live.board.selected.teamRow) throw new Error('teamRow is not the validated user board');
    watches.push({ address: userTargets.header + 24n }, {
      address: membership.base + BigInt(teamRow * membership.stride + live.board.selected.firstFreeSlot * 4),
    });
  } else {
    const slot = options.boardSlot ?? findBoardSlot(live.tables, teamRow, options.recruitRow);
    watches.push({ address: membership.base + BigInt(teamRow * membership.stride + slot * 4) },
      { address: userTargets.header + 24n }, { address: pitches.header + 24n });
  }
  await runtime.client.evaluateLua(armScript(watches, false));
  await (dependencies.promptAction || promptAction)(
    `Perform ONE vanilla ${operation.toUpperCase()} for recruit row ${options.recruitRow} now.`);
  const captureId = `${operation}-write-${options.capture}`;
  const prefix = `REANCHOR_${runtime.session.sessionId.slice(0, 12)}_${captureId.toUpperCase()}`;
  const hits = await collectWatch(runtime.client, prefix);
  await hydrateTables(runtime.client, stored);
  const record = envelope(runtime, { captureId, operation, recruitRow: options.recruitRow,
    teamRow, hits, postconditionVerified: true });
  writeEvidence(`captures/${captureId}.json`, record);
  return record;
}

async function rankedCandidates(operation, runtime, identity) {
  const captures = [1, 2].map((index) => readEvidence(`captures/${operation}-write-${index}.json`, identity));
  const pe = parsePeSections(fs.readFileSync(runtime.executable));
  return rankRoutineCandidates(captures, { moduleBase: runtime.session.moduleBase, pe });
}

async function commandRank(options, dependencies) {
  if (!options.operation) throw new Error('Rank analysis requires --operation add or remove');
  const { runtime, identity } = await requirePreflight(options, dependencies);
  const candidates = await rankedCandidates(options.operation, runtime, identity);
  const record = envelope(runtime, { operation: options.operation, candidates });
  writeEvidence(`rank-${options.operation}.json`, record);
  return record;
}

async function commandExecuteCapture(options, dependencies, operation, transition = false) {
  if (!Number.isSafeInteger(options.recruitRow) || !Number.isSafeInteger(options.teamRow)) {
    throw new Error('Execute capture requires --recruit-row and --team-row');
  }
  const { runtime, identity } = await requirePreflight(options, dependencies);
  const stored = readEvidence('tables.json', identity);
  const live = await hydrateTables(runtime.client, stored);
  const candidates = await rankedCandidates(operation, runtime, identity);
  if (candidates.length < 1) throw new Error(`No executable ${operation} candidate was ranked`);
  const watches = candidates.slice(0, 4).map((entry) => ({ address: BigInt(runtime.session.moduleBase) + BigInt(entry.rva) }));
  await runtime.client.evaluateLua(armScript(watches, true));
  await (dependencies.promptAction || promptAction)(transition
    ? `Leave and re-enter Recruiting, then perform ONE vanilla ${operation.toUpperCase()} for recruit row ${options.recruitRow}.`
    : `Perform ONE vanilla ${operation.toUpperCase()} for recruit row ${options.recruitRow} to confirm the full entry.`);
  const captureId = transition ? 'transition' : `${operation}-execute`;
  const prefix = `REANCHOR_${runtime.session.sessionId.slice(0, 12)}_${captureId.toUpperCase()}`;
  const hits = await collectWatch(runtime.client, prefix);
  const expected = { membershipRow: live.board.selected.teamRow, teamRow: options.teamRow,
    recruitRow: options.recruitRow };
  const pe = parsePeSections(fs.readFileSync(runtime.executable));
  const enriched = [];
  for (const hit of hits) {
    try {
      const capture = await enrichExecuteHit(runtime.client, hit, expected, runtime, captureId);
      if (validateObjectShapes(capture, { moduleBase: runtime.session.moduleBase, pe }).passed) enriched.push(capture);
    } catch {
      // Incidental execute candidates are expected; only full entry shapes survive.
    }
  }
  if (enriched.length !== 1) throw new Error(`Expected exactly one full ${operation} entry shape; found ${enriched.length}`);
  const record = envelope(runtime, { captureId, operation, objectCapture: enriched[0], rawHitCount: hits.length });
  writeEvidence(`captures/${captureId}.json`, record);
  return record;
}

async function commandAnalyzeFinal(options, dependencies) {
  const { runtime, identity } = await requirePreflight(options, dependencies);
  const tables = readEvidence('tables.json', identity);
  const addWrite = [1, 2].map((index) => readEvidence(`captures/add-write-${index}.json`, identity));
  const removeWrite = [1, 2].map((index) => readEvidence(`captures/remove-write-${index}.json`, identity));
  const addExecute = readEvidence('captures/add-execute.json', identity).objectCapture;
  const removeExecute = readEvidence('captures/remove-execute.json', identity).objectCapture;
  const transition = readEvidence('captures/transition.json', identity).objectCapture;
  const pe = parsePeSections(fs.readFileSync(runtime.executable));
  const vtables = deriveVtableRvas([addExecute, removeExecute, transition], {
    moduleBase: runtime.session.moduleBase, pe,
  });
  const addEntry = classifyModuleAddress(addExecute.entryAddress, runtime.session.moduleBase, pe);
  const removeEntry = classifyModuleAddress(removeExecute.entryAddress, runtime.session.moduleBase, pe);
  const input = {
    build: runtime.build,
    session: runtime.session,
    tables: tables.tableSummaries,
    captures: {
      add: { writeCount: addWrite.length, executeCount: 1,
        consistent: addWrite.every((capture) => capture.postconditionVerified) },
      remove: { writeCount: removeWrite.length, executeCount: 1,
        consistent: removeWrite.every((capture) => capture.postconditionVerified) },
    },
    proposedBoard: { ...vtables, fullAddRva: addEntry.rva, fullRemoveRva: removeEntry.rva },
    proof: { pe, fullAddCapture: addExecute, fullRemoveCapture: removeExecute,
      transitionObjectCapture: transition },
  };
  const candidate = buildCandidateArtifact(input);
  writeEvidence('candidate.json', candidate);
  return candidate;
}

async function commandStatus(options, dependencies) {
  const runtime = await establishRuntime(options, dependencies);
  const directory = evidenceDirectory(runtime.build.executableSha256);
  const files = fs.existsSync(directory)
    ? fs.readdirSync(directory, { recursive: true }).map(String).sort()
    : [];
  return { build: runtime.build, session: runtime.session, registrySupport: runtime.registrySupport,
    hello: runtime.hello, status: runtime.status, evidenceFiles: files };
}

async function run(options, dependencies = {}) {
  if (!options.gameDir) throw new Error('--game-dir is required');
  if (options.command !== 'status' && !options.save) throw new Error('--save is required');
  switch (options.command) {
    case 'preflight': return commandPreflight(options, dependencies);
    case 'validate': return commandValidate(options, dependencies);
    case 'capture-add-write': return commandWriteCapture(options, dependencies, 'add');
    case 'capture-remove-write': return commandWriteCapture(options, dependencies, 'remove');
    case 'capture-add-execute': return commandExecuteCapture(options, dependencies, 'add');
    case 'capture-remove-execute': return commandExecuteCapture(options, dependencies, 'remove');
    case 'transition-check': return commandExecuteCapture(options, dependencies, options.operation || 'add', true);
    case 'analyze': return options.stage === 'rank'
      ? commandRank(options, dependencies) : commandAnalyzeFinal(options, dependencies);
    case 'status': return commandStatus(options, dependencies);
    default: throw new Error('Unsupported command');
  }
}

async function main() {
  const result = await run(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.code || 'ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  parseCaptureLogs,
  sessionId,
  findBoardSlot,
  serializeTables,
  run,
};
