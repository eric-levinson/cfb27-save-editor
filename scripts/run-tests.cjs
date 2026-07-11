'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function testFiles() {
  const files = [];
  const rootTests = path.join(root, 'tests');
  for (const entry of fs.readdirSync(rootTests, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.test.cjs')) {
      files.push(path.join(rootTests, entry.name));
    }
  }

  const packages = path.join(root, 'packages');
  for (const packageEntry of fs.readdirSync(packages, { withFileTypes: true })) {
    if (!packageEntry.isDirectory()) continue;
    const testDirectory = path.join(packages, packageEntry.name, 'test');
    if (!fs.existsSync(testDirectory)) continue;
    for (const entry of fs.readdirSync(testDirectory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.test.cjs')) {
        files.push(path.join(testDirectory, entry.name));
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function main() {
  const files = testFiles();
  if (!files.length) throw new Error('No test files were found');
  const result = childProcess.spawnSync(process.execPath, ['--test', ...files], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { testFiles, main };
