'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sdk = require('../../packages/sdk');

const anchorPath = path.resolve(__dirname, '..', '..', '.frtk', 'board-verification', 'live-mirror-bases.json');
const requestedOutput = process.argv[2];
if (!requestedOutput) {
  process.stderr.write('Usage: node live-table-snapshot.cjs <output.json>\n');
  process.exit(2);
}
const outputPath = path.resolve(requestedOutput);

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
    stream.on('error', reject);
  });
}

async function main() {
  const anchor = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
  const game = await sdk.discoverGame();
  if (game.pid !== anchor.pid) throw new Error('Anchor belongs to a different game process; rerun live-anchor.cjs');
  const executableSha256 = await sha256File(game.path);
  if (executableSha256 !== anchor.executableSha256) {
    throw new Error('Anchor belongs to a different game executable; rerun live-anchor.cjs');
  }
  const client = sdk.createClient({ pid: game.pid, timeoutMs: 30_000 });
  const tables = {};
  for (const [id, table] of Object.entries(anchor.tables)) {
    const length = table.stride * table.capacity;
    const result = await client.readMemory({
      ranges: [{ address: table.dataBase, length }],
      allowUnsupportedBuild: true,
    });
    tables[id] = {
      dataBase: table.dataBase,
      stride: table.stride,
      capacity: table.capacity,
      freelistHeadValue: table.freelistHeadValue,
      bytesHex: result.ranges[0].bytesHex,
    };
  }
  const capture = {
    capturedAt: new Date().toISOString(),
    pid: game.pid,
    executableSha256,
    sessionIdentity: anchor.sessionIdentity,
    userBoard: anchor.userBoard,
    tables,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(capture, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    pid: game.pid,
    occupied: anchor.userBoard.occupied,
    bytes: Object.values(tables).reduce((sum, table) => sum + table.bytesHex.length / 2, 0),
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.code || 'ERROR'}: ${error.message}\n`);
  process.exitCode = 1;
});
