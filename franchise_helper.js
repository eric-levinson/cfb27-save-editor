const fs = require("fs");
const path = require("path");

const Franchise = require("madden-franchise");
const utilService = require("madden-franchise/services/utilService");

const SCHEMA_PATH = path.join(__dirname, "schema", "CFB27_schema_for_madden_franchise.gz");
const GAME_YEAR = 26;
const PLAYER_TABLE = "Player";
const RECRUIT_TABLE = "Recruit";

const POSITIONS = [
  "QB",
  "HB",
  "FB",
  "WR",
  "TE",
  "LT",
  "LG",
  "C",
  "RG",
  "RT",
  "LE",
  "RE",
  "DT",
  "LOLB",
  "MLB",
  "ROLB",
  "CB",
  "FS",
  "SS",
  "K",
  "P",
  "LS",
  "KR",
  "PR",
];

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

function cleanString(value, label, maxLength) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be text`);
  }
  const trimmed = value.trim();
  if (!/^[\x20-\x7E]*$/.test(trimmed)) {
    throw new Error(`${label} must contain printable ASCII only`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${label} is too long; max ${maxLength} characters`);
  }
  return trimmed;
}

function cleanInt(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return number;
}

function heightDisplay(inches) {
  const raw = Number(inches);
  if (!Number.isFinite(raw) || raw <= 0) return "";
  return `${Math.floor(raw / 12)}'${raw % 12}"`;
}

function poundsFromRaw(rawWeight) {
  const raw = Number(rawWeight);
  if (!Number.isFinite(raw)) return "";
  return raw + 160;
}

function visualHintsFromHeadAsset(headAsset) {
  const match = String(headAsset || "").match(/^Generic_\d+_P_T\d+_([A-Z])_(\d+)_(\d+)$/);
  if (!match) {
    return { skinTone: "", hair: "" };
  }
  return {
    skinTone: match[2],
    hair: `${match[1]}-${match[3]}`,
  };
}

function getReference(value) {
  if (!value || typeof value !== "string" || !/^[01]+$/.test(value)) {
    return null;
  }
  return utilService.getReferenceData(value);
}

async function loadFranchise(filePath) {
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`Missing schema file: ${SCHEMA_PATH}`);
  }
  return Franchise.create(filePath, {
    schemaOverride: {
      major: 27,
      minor: 1,
      gameYear: GAME_YEAR,
      path: SCHEMA_PATH,
    },
    gameYearOverride: GAME_YEAR,
    autoParse: true,
  });
}

async function readRecruitTables(franchise) {
  const recruitTable = franchise.getTableByName(RECRUIT_TABLE);
  const playerTable = franchise.getTableByName(PLAYER_TABLE);
  if (!recruitTable || !playerTable) {
    throw new Error("Recruit or Player table was not found in this save");
  }

  await recruitTable.readRecords(["NationalRank", "PositionRank", "StateRank", "Player"]);
  await playerTable.readRecords([
    "FirstName",
    "LastName",
    "Height",
    "Weight",
    "Position",
    "GenericHeadAssetName",
    "PLYR_GENERICHEAD",
    "CharacterVisuals",
  ]);

  return { recruitTable, playerTable };
}

function recruitPlayerPair(recruitRecord, recruitIndex, playerTable) {
  if (!recruitRecord || recruitRecord.isEmpty) return null;
  const ref = getReference(recruitRecord.Player);
  if (!ref || ref.tableId !== playerTable.header.tableId) return null;
  const playerRecord = playerTable.records[ref.rowNumber];
  if (!playerRecord || playerRecord.isEmpty) return null;
  const firstName = playerRecord.FirstName || "";
  const lastName = playerRecord.LastName || "";
  if (!firstName && !lastName) return null;
  return {
    recruitRecord,
    recruitIndex,
    playerRecord,
    playerIndex: ref.rowNumber,
  };
}

function rowFromPair(pair) {
  const { recruitRecord, recruitIndex, playerRecord, playerIndex } = pair;
  const height = Number(playerRecord.Height || 0);
  const rawWeight = Number(playerRecord.Weight || 0);
  const genericHead = playerRecord.PLYR_GENERICHEAD || "";
  const headAsset = playerRecord.GenericHeadAssetName || "";
  const visualHints = visualHintsFromHeadAsset(headAsset);
  return {
    id: String(recruitIndex),
    recruit_index: recruitIndex,
    player_index: playerIndex,
    national_rank: Number(recruitRecord.NationalRank || 0),
    position_rank: Number(recruitRecord.PositionRank || 0),
    state_rank: Number(recruitRecord.StateRank || 0),
    first_name: playerRecord.FirstName || "",
    last_name: playerRecord.LastName || "",
    position: playerRecord.Position || "",
    height_inches: height,
    height_display: heightDisplay(height),
    weight_lbs: poundsFromRaw(rawWeight),
    weight_raw: rawWeight,
    generic_head_asset_name: headAsset,
    generic_head: genericHead,
    skin_tone: visualHints.skinTone,
    hair: visualHints.hair,
    character_visuals_ref: playerRecord.CharacterVisuals || "",
  };
}

function sortRecruitRows(a, b) {
  const rankA = a.national_rank > 0 ? a.national_rank : Number.MAX_SAFE_INTEGER;
  const rankB = b.national_rank > 0 ? b.national_rank : Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
}

async function listRecruits(filePath, limit, offset) {
  const franchise = await loadFranchise(filePath);
  const { recruitTable, playerTable } = await readRecruitTables(franchise);
  const rows = [];
  for (let index = 0; index < recruitTable.records.length; index += 1) {
    const pair = recruitPlayerPair(recruitTable.records[index], index, playerTable);
    if (pair) rows.push(rowFromPair(pair));
  }
  rows.sort(sortRecruitRows);
  const start = Math.max(0, offset || 0);
  const stop = Math.min(rows.length, start + Math.max(1, Math.min(limit || 1000, 7600)));
  return {
    recordCount: rows.length,
    offset: start,
    limit,
    players: rows.slice(start, stop),
  };
}

function applyPatch(pair, changes) {
  const { recruitRecord, playerRecord } = pair;
  const allowed = new Set([
    "first_name",
    "last_name",
    "position",
    "height_inches",
    "weight_lbs",
    "national_rank",
    "position_rank",
    "state_rank",
    "generic_head_asset_name",
  ]);
  for (const key of Object.keys(changes)) {
    if (!allowed.has(key)) {
      throw new Error(`${key} is not editable yet`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "first_name")) {
    playerRecord.FirstName = cleanString(changes.first_name, "First name", 17);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "last_name")) {
    playerRecord.LastName = cleanString(changes.last_name, "Last name", 21);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "position")) {
    const position = String(changes.position || "").trim().toUpperCase();
    if (!POSITIONS.includes(position)) {
      throw new Error(`Position must be one of: ${POSITIONS.join(", ")}`);
    }
    playerRecord.Position = position;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "height_inches")) {
    playerRecord.Height = cleanInt(changes.height_inches, "Height", 48, 96);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "weight_lbs")) {
    const pounds = cleanInt(changes.weight_lbs, "Weight", 160, 415);
    playerRecord.Weight = pounds - 160;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "national_rank")) {
    recruitRecord.NationalRank = cleanInt(changes.national_rank, "National rank", 0, 4500);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "position_rank")) {
    recruitRecord.PositionRank = cleanInt(changes.position_rank, "Position rank", 0, 4000);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "state_rank")) {
    recruitRecord.StateRank = cleanInt(changes.state_rank, "State rank", 0, 4000);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "generic_head_asset_name")) {
    playerRecord.GenericHeadAssetName = cleanString(
      changes.generic_head_asset_name,
      "Head asset",
      33,
    );
  }
}

async function patchRecruit(filePath, patchPath, outputPath) {
  const patch = JSON.parse(fs.readFileSync(patchPath, "utf8"));
  const recruitIndex = Number(patch.id);
  if (!Number.isInteger(recruitIndex) || recruitIndex < 0) {
    throw new Error("Recruit id is invalid");
  }
  if (!patch.changes || typeof patch.changes !== "object") {
    throw new Error("Patch changes are missing");
  }

  const franchise = await loadFranchise(filePath);
  const { recruitTable, playerTable } = await readRecruitTables(franchise);
  const pair = recruitPlayerPair(recruitTable.records[recruitIndex], recruitIndex, playerTable);
  if (!pair) {
    throw new Error("Recruit row was not found or does not reference a valid player");
  }
  applyPatch(pair, patch.changes);

  // The Python server owns the outer FBCHUNKS/zlib container. Here we only
  // rebuild the decompressed FrTk payload after madden-franchise updates tables.
  const unpacked = franchise.strategy.file.generateUnpackedContents(
    franchise.tables,
    franchise.unpackedFileContents,
  );
  fs.writeFileSync(outputPath, unpacked);

  const verify = await loadFranchise(outputPath);
  const { recruitTable: verifyRecruitTable, playerTable: verifyPlayerTable } = await readRecruitTables(verify);
  const updatedPair = recruitPlayerPair(verifyRecruitTable.records[recruitIndex], recruitIndex, verifyPlayerTable);
  return { player: rowFromPair(updatedPair) };
}

async function main() {
  const [command, filePath, arg1, arg2, arg3] = process.argv.slice(2);
  if (!command || !filePath) {
    fail("Usage: node franchise_helper.js <list|patch> <file> ...");
  }
  if (command === "list") {
    const result = await listRecruits(filePath, Number(arg1 || 1000), Number(arg2 || 0));
    console.log(JSON.stringify(result));
    return;
  }
  if (command === "patch") {
    if (!arg1 || !arg2) fail("Patch requires <patch.json> <output-file>");
    const result = await patchRecruit(filePath, arg1, arg2);
    console.log(JSON.stringify(result));
    return;
  }
  fail(`Unknown command: ${command}`);
}

main().catch((error) => fail(error.stack || error.message));
