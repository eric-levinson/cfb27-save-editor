# CFB27 Lua Hook Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `cfb27-save-editor` into the MIT-licensed `cfb27-lua-hook` developer-preview runtime, CommonJS SDK, CLI, framed protocol, archive, and Windows release package.

**Architecture:** MMC loads the C++ Lua host through the forwarding `CryptBase.dll` proxy. A versioned framed-JSON named-pipe protocol is consumed only through a CommonJS Node SDK; the `cfb27lua` CLI and future Electron main processes are thin SDK consumers. Unsupported save-editor and injection-era material is retained under `archive/` but excluded from the active package and release gates.

**Tech Stack:** Windows x64, C++20, CMake 3.24+, Lua 5.4.8, nlohmann/json 3.11.3, Node.js 20+ CommonJS, Node built-in `node:test`, GitHub Actions, PowerShell only for Windows process discovery.

## Global Constraints

- Product/repository identity is `cfb27-lua-hook`; SDK is `@cfb27/lua-hook`; CLI package is `cfb27-lua-hook`; binary is `cfb27lua`.
- Initial release version is `0.1.0-dev.1`; framed host protocol version is `1`.
- License is MIT.
- The first release is a developer preview and does not include a consumer-facing Electron application.
- The active JavaScript implementation is plain CommonJS with JSDoc types; do not add TypeScript or a transpilation step.
- Windows and Node.js 20+ are required.
- The hook remains offline-only, exact-build-gated, compare-before-write, readback-verified, and blocked when a real EA/Javelin anticheat process is present.
- Do not recommend disabling or allowlisting antivirus protection.
- Native build output, saves, schemas, logs, backups, extracted assets, and third-party projects remain untracked and excluded from releases.
- Move historical files with `git mv`; do not delete research or user-owned material.
- Keep the current legacy text pipe temporarily, but do not expose it from the public SDK.
- Electron renderers must never receive raw pipe access, unrestricted Lua evaluation, or memory addresses.
- Do not begin Brooks recruiting-app integration in this plan.
- Preserve the original worktree's `.requirements/progress.txt` modification; all work occurs in the isolated `codex/restructure-cfb27-lua-hook` worktree.

---

## File map

### Active native runtime

- `native/CMakeLists.txt` — active host/proxy/smoke build only.
- `native/host/lua_host.cpp` — Lua state, safety gates, Lua API, request dispatch.
- `native/host/protocol.h` — frame constants, errors, and server interfaces.
- `native/host/protocol.cpp` — exact-read/write framing and JSON validation.
- `native/proxy/cryptbase_proxy.cpp` — MMC startup loader.
- `native/proxy/cryptbase_proxy.def` — MMC export forwarding.
- `native/smoke/startup_host_smoke.cpp` — one-MiB-stack host lifecycle smoke.
- `native/smoke/protocol_smoke.cpp` — framed hello/evaluate/events client smoke.

### SDK

- `packages/sdk/package.json` — `@cfb27/lua-hook` package contract.
- `packages/sdk/src/errors.cjs` — stable error codes and `Cfb27HookError`.
- `packages/sdk/src/frame.cjs` — framed JSON encoder/decoder.
- `packages/sdk/src/process.cjs` — Windows process discovery and executable validation.
- `packages/sdk/src/client.cjs` — named-pipe request client and protocol negotiation.
- `packages/sdk/src/install.cjs` — MMC inspection, backup, install, and restore.
- `packages/sdk/src/logs.cjs` — bounded log/event polling helpers.
- `packages/sdk/src/doctor.cjs` — read-only environment and recovery diagnosis.
- `packages/sdk/index.cjs` — supported public SDK surface.
- `packages/sdk/test/*.test.cjs` — SDK unit/integration tests.

### CLI

- `packages/cli/package.json` — CLI package and `bin` mapping.
- `packages/cli/bin/cfb27lua.cjs` — process entry point.
- `packages/cli/src/args.cjs` — deterministic argument parser.
- `packages/cli/src/output.cjs` — human and JSON output.
- `packages/cli/src/main.cjs` — SDK command dispatcher and exit codes.
- `packages/cli/test/*.test.cjs` — injected-SDK CLI tests.

### Repository/release

- `package.json` — private npm workspace and active scripts.
- `package-lock.json` — active workspace lockfile.
- `LICENSE` — MIT license.
- `README.md` — CFB27 Lua Hook landing page.
- `docs/getting-started.md`, `docs/lua-api.md`, `docs/protocol.md`, `docs/cli.md`, `docs/safety.md` — supported docs.
- `docs/research/` — maintained conclusions.
- `archive/*/README.md` — archive boundaries and provenance.
- `tests/package-layout.test.cjs` — active/archive/package boundary tests.
- `scripts/package-release.cjs` — reproducible release staging/checksums.
- `.github/workflows/windows-ci.yml` — Windows active-product gate.

---

### Task 1: Establish product identity, workspaces, and MIT licensing

**Files:**
- Create: `tests/package-layout.test.cjs`
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/index.cjs`
- Create: `packages/cli/package.json`
- Create: `packages/cli/bin/cfb27lua.cjs`
- Create: `packages/cli/src/main.cjs`
- Create: `LICENSE`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Move: `package.json` -> `archive/legacy-save-editor/package.json` before creating the new root manifest
- Move: `package-lock.json` -> `archive/legacy-save-editor/package-lock.json` before generating the new root lockfile

**Interfaces:**
- Produces: root npm workspaces `packages/sdk` and `packages/cli`.
- Produces: CLI binary mapping `cfb27lua -> packages/cli/bin/cfb27lua.cjs`.
- Produces: SDK entry point `require('@cfb27/lua-hook')`.

- [ ] **Step 1: Write the failing package-layout test**

```js
// tests/package-layout.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('root identifies the developer-preview Lua hook workspaces', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.name, 'cfb27-lua-hook-workspace');
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.workspaces, ['packages/sdk', 'packages/cli']);
  assert.equal(pkg.engines.node, '>=20');
  assert.equal(pkg.license, 'MIT');
});

test('SDK and CLI package identities are stable', () => {
  const sdk = readJson('packages/sdk/package.json');
  const cli = readJson('packages/cli/package.json');
  assert.equal(sdk.name, '@cfb27/lua-hook');
  assert.equal(sdk.version, '0.1.0-dev.1');
  assert.equal(cli.name, 'cfb27-lua-hook');
  assert.equal(cli.bin.cfb27lua, 'bin/cfb27lua.cjs');
});

test('repository is MIT licensed', () => {
  const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Eric Levinson/);
});
```

- [ ] **Step 2: Run the layout test and verify RED**

Run: `node --test tests/package-layout.test.cjs`

Expected: FAIL because the root package is still named `cfb27-save-editor` and the workspace packages/LICENSE do not exist.

- [ ] **Step 3: Preserve the old manifests and create the active workspace**

Run:

```powershell
New-Item -ItemType Directory -Force archive\legacy-save-editor | Out-Null
git mv package.json archive\legacy-save-editor\package.json
git mv package-lock.json archive\legacy-save-editor\package-lock.json
```

Create `package.json`:

```json
{
  "name": "cfb27-lua-hook-workspace",
  "version": "0.1.0-dev.1",
  "private": true,
  "description": "Offline CFB27 Lua hook, scripting SDK, and MMC startup tooling for PC.",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "workspaces": ["packages/sdk", "packages/cli"],
  "scripts": {
    "check": "node --check packages/sdk/index.cjs && node --check packages/cli/bin/cfb27lua.cjs && node --check packages/cli/src/main.cjs",
    "test": "node --test tests/*.test.cjs packages/*/test/*.test.cjs",
    "pack:preview": "node scripts/package-release.cjs"
  }
}
```

Create `packages/sdk/package.json`:

```json
{
  "name": "@cfb27/lua-hook",
  "version": "0.1.0-dev.1",
  "description": "Node SDK for the offline CFB27 Lua hook.",
  "main": "index.cjs",
  "type": "commonjs",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "files": ["index.cjs", "src"]
}
```

Create `packages/cli/package.json`:

```json
{
  "name": "cfb27-lua-hook",
  "version": "0.1.0-dev.1",
  "description": "Developer CLI for the offline CFB27 Lua hook.",
  "type": "commonjs",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "bin": { "cfb27lua": "bin/cfb27lua.cjs" },
  "files": ["bin", "src"],
  "dependencies": { "@cfb27/lua-hook": "0.1.0-dev.1" }
}
```

Create `packages/sdk/index.cjs`:

```js
'use strict';
module.exports = Object.freeze({ version: '0.1.0-dev.1' });
```

Create `packages/cli/src/main.cjs`:

```js
'use strict';
async function main() {
  process.stdout.write('cfb27lua developer preview\n');
  return 0;
}
module.exports = { main };
```

Create `packages/cli/bin/cfb27lua.cjs`:

```js
#!/usr/bin/env node
'use strict';
const { main } = require('../src/main.cjs');
main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
```

Create `LICENSE` with the standard MIT license and `Copyright (c) 2026 Eric Levinson`.

Replace the README introduction with the product name, developer-preview label, offline-only warning, supported-build statement, and links to getting started/API/safety documentation. Do not document commands that are not implemented yet; mark the command table as the `0.1.0-dev.1` target surface.

- [ ] **Step 4: Generate the workspace lockfile and verify GREEN**

Run:

```powershell
npm install --package-lock-only
npm test
npm run check
```

Expected: package-layout tests PASS; syntax checks PASS; no Electron or `madden-franchise` dependency exists in the active root lockfile.

- [ ] **Step 5: Commit the identity slice**

```powershell
git add package.json package-lock.json packages tests LICENSE README.md archive/legacy-save-editor/package*.json
git commit -m "Establish CFB27 Lua Hook workspace"
```

---

### Task 2: Isolate the active native host, proxy, and smoke build

**Files:**
- Create: `tests/native-layout.test.cjs`
- Move: `native/lua_host.cpp` -> `native/host/lua_host.cpp`
- Move: `native/cryptbase_proxy.cpp` -> `native/proxy/cryptbase_proxy.cpp`
- Move: `native/cryptbase_proxy.def` -> `native/proxy/cryptbase_proxy.def`
- Move: `native/startup_host_smoke.cpp` -> `native/smoke/startup_host_smoke.cpp`
- Modify: `native/CMakeLists.txt`
- Modify: `.gitignore`

**Interfaces:**
- Produces native targets: `cfb27_lua_host`, `cfb27_cryptbase_proxy`, `cfb27_startup_smoke`.
- Produces artifact names: `cfb27_lua_host.dll`, `cfb27_cryptbase_proxy.dll`, `cfb27_startup_smoke.exe`.
- Later tasks consume active paths only; no active CMake target may reference `archive/`.

- [ ] **Step 1: Write the failing native-layout test**

```js
// tests/native-layout.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('active native tree contains only host, proxy, and smoke entry points', () => {
  for (const file of [
    'native/host/lua_host.cpp',
    'native/proxy/cryptbase_proxy.cpp',
    'native/proxy/cryptbase_proxy.def',
    'native/smoke/startup_host_smoke.cpp',
  ]) assert.equal(fs.existsSync(path.join(root, file)), true, file);

  const cmake = fs.readFileSync(path.join(root, 'native/CMakeLists.txt'), 'utf8');
  assert.match(cmake, /add_library\(cfb27_lua_host/);
  assert.match(cmake, /add_library\(cfb27_cryptbase_proxy/);
  assert.match(cmake, /add_executable\(cfb27_startup_smoke/);
  assert.doesNotMatch(cmake, /hook\.cpp|injector\.cpp|response_guard\.cpp/);
  assert.doesNotMatch(cmake, /archive[\\/]/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/native-layout.test.cjs`

Expected: FAIL because native sources still use the old flat layout and CMake builds legacy targets.

- [ ] **Step 3: Move active sources and replace active CMake configuration**

Use `git mv` for the four active sources. Replace `native/CMakeLists.txt` with a focused build that:

```cmake
cmake_minimum_required(VERSION 3.24)
project(cfb27_lua_hook LANGUAGES C CXX)

if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "CFB27 Lua Hook requires 64-bit Windows")
endif()

include(FetchContent)
FetchContent_Declare(lua_source
  URL https://www.lua.org/ftp/lua-5.4.8.tar.gz
  URL_HASH SHA256=4f18ddae154e793e46eeab727c59ef1c0c0c2b744e7b94219710d76f530629ae)
FetchContent_GetProperties(lua_source)
if(NOT lua_source_POPULATED)
  FetchContent_Populate(lua_source)
endif()

# Preserve the existing explicit Lua source list as target lua54.

add_library(cfb27_lua_host SHARED host/lua_host.cpp)
target_compile_features(cfb27_lua_host PRIVATE cxx_std_20)
target_compile_definitions(cfb27_lua_host PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(cfb27_lua_host PRIVATE lua54 bcrypt)

add_library(cfb27_cryptbase_proxy SHARED
  proxy/cryptbase_proxy.cpp proxy/cryptbase_proxy.def)
target_compile_features(cfb27_cryptbase_proxy PRIVATE cxx_std_20)
target_compile_definitions(cfb27_cryptbase_proxy PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)

add_executable(cfb27_startup_smoke smoke/startup_host_smoke.cpp)
target_compile_features(cfb27_startup_smoke PRIVATE cxx_std_20)
target_compile_definitions(cfb27_startup_smoke PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_options(cfb27_startup_smoke PRIVATE /STACK:1048576)
```

Retain the existing Lua 5.4.8 source list verbatim between the FetchContent and active targets. Add `native/build*/` and `dist/` to `.gitignore` if not already covered.

- [ ] **Step 4: Build and verify the active native targets**

Run:

```powershell
cmake -S native -B native/build-active -A x64
cmake --build native/build-active --config Release --target cfb27_lua_host cfb27_cryptbase_proxy cfb27_startup_smoke
node --test tests/native-layout.test.cjs
```

Expected: three targets build; layout test PASS; smoke executable PE stack reserve is exactly `1048576`.

- [ ] **Step 5: Commit the native-layout slice**

```powershell
git add native .gitignore tests/native-layout.test.cjs
git commit -m "Isolate active Lua hook native targets"
```

---

### Task 3: Implement the reusable JavaScript frame codec

**Files:**
- Create: `packages/sdk/src/errors.cjs`
- Create: `packages/sdk/src/frame.cjs`
- Create: `packages/sdk/test/frame.test.cjs`
- Modify: `packages/sdk/index.cjs`

**Interfaces:**
- Produces: `encodeFrame(payload: object): Buffer`.
- Produces: `new FrameDecoder({ maxBytes? }).push(chunk: Buffer): object[]`.
- Produces: `ERROR_CODES`, `Cfb27HookError`.
- Protocol size constant: `MAX_FRAME_BYTES = 1024 * 1024`.

- [ ] **Step 1: Write failing frame/error tests**

```js
// packages/sdk/test/frame.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeFrame, FrameDecoder, MAX_FRAME_BYTES } = require('../src/frame.cjs');
const { Cfb27HookError } = require('../src/errors.cjs');

test('frame decoder preserves fragmented multiline JSON', () => {
  const frame = encodeFrame({ protocol: 1, id: 'a', command: 'evaluate', params: { source: 'x=1\nx=x+1' } });
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.push(frame.subarray(0, 2)), []);
  assert.deepEqual(decoder.push(frame.subarray(2, 11)), []);
  assert.deepEqual(decoder.push(frame.subarray(11)), [{
    protocol: 1, id: 'a', command: 'evaluate', params: { source: 'x=1\nx=x+1' },
  }]);
});

test('frame decoder handles two frames in one chunk', () => {
  const decoder = new FrameDecoder();
  const both = Buffer.concat([encodeFrame({ id: 'a' }), encodeFrame({ id: 'b' })]);
  assert.deepEqual(decoder.push(both), [{ id: 'a' }, { id: 'b' }]);
});

test('oversized frame throws stable INVALID_RESPONSE error', () => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(MAX_FRAME_BYTES + 1);
  assert.throws(() => new FrameDecoder().push(header), (error) =>
    error instanceof Cfb27HookError && error.code === 'INVALID_RESPONSE');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test packages/sdk/test/frame.test.cjs`

Expected: FAIL because frame/error modules do not exist.

- [ ] **Step 3: Implement stable errors and framed JSON**

Create `packages/sdk/src/errors.cjs`:

```js
'use strict';
const ERROR_CODES = Object.freeze([
  'GAME_NOT_RUNNING', 'GAME_PATH_MISMATCH', 'HOST_NOT_INSTALLED',
  'HOST_NOT_READY', 'UNSUPPORTED_BUILD', 'ANTICHEAT_RUNNING',
  'PROTOCOL_MISMATCH', 'PIPE_TIMEOUT', 'INVALID_REQUEST', 'INVALID_RESPONSE',
  'SCRIPT_ERROR', 'INSTALLATION_CONFLICT', 'BACKUP_VERIFICATION_FAILED',
]);
class Cfb27HookError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'Cfb27HookError';
    this.code = code;
    this.details = details;
  }
}
module.exports = { ERROR_CODES, Cfb27HookError };
```

Create `packages/sdk/src/frame.cjs` with:

```js
'use strict';
const { Cfb27HookError } = require('./errors.cjs');
const MAX_FRAME_BYTES = 1024 * 1024;

function encodeFrame(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  if (!body.length || body.length > MAX_FRAME_BYTES) {
    throw new Cfb27HookError('INVALID_RESPONSE', 'Frame size is outside the supported range');
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

class FrameDecoder {
  constructor({ maxBytes = MAX_FRAME_BYTES } = {}) {
    this.maxBytes = maxBytes;
    this.buffer = Buffer.alloc(0);
  }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const messages = [];
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE(0);
      if (!size || size > this.maxBytes) {
        throw new Cfb27HookError('INVALID_RESPONSE', `Invalid frame size: ${size}`);
      }
      if (this.buffer.length < size + 4) break;
      const body = this.buffer.subarray(4, size + 4);
      this.buffer = this.buffer.subarray(size + 4);
      try { messages.push(JSON.parse(body.toString('utf8'))); }
      catch (error) { throw new Cfb27HookError('INVALID_RESPONSE', 'Host returned invalid JSON', { cause: error.message }); }
    }
    return messages;
  }
}
module.exports = { MAX_FRAME_BYTES, encodeFrame, FrameDecoder };
```

Export these interfaces from `packages/sdk/index.cjs`.

- [ ] **Step 4: Run frame and workspace tests**

Run: `node --test packages/sdk/test/frame.test.cjs tests/package-layout.test.cjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit the frame-codec slice**

```powershell
git add packages/sdk
git commit -m "Add framed protocol codec"
```

---

### Task 4: Add framed JSON protocol v1 to the native host

**Files:**
- Create: `native/host/protocol.h`
- Create: `native/host/protocol.cpp`
- Create: `native/smoke/protocol_smoke.cpp`
- Modify: `native/host/lua_host.cpp`
- Modify: `native/CMakeLists.txt`

**Interfaces:**
- Consumes framed request shape `{ protocol, id, command, params }`.
- Produces framed response shape `{ protocol, id, ok, result }` or `{ protocol, id, ok:false, error }`.
- Produces named pipe `\\.\pipe\CFB27LuaHost.v1.<pid>`.
- Preserves legacy `\\.\pipe\CFB27LuaHost.<pid>`.
- Initial native commands: `hello`, `status`, `runScript`, `evaluate`.

- [ ] **Step 1: Write the failing native protocol smoke client**

Create `native/smoke/protocol_smoke.cpp` that:

```cpp
#include <windows.h>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

using Json = nlohmann::json;

bool WriteAll(HANDLE pipe, const std::uint8_t* data, std::size_t size) {
  while (size) {
    DWORD written = 0;
    if (!WriteFile(pipe, data, static_cast<DWORD>(size), &written, nullptr) || !written) return false;
    data += written;
    size -= written;
  }
  return true;
}

bool ReadAll(HANDLE pipe, std::uint8_t* data, std::size_t size) {
  while (size) {
    DWORD read = 0;
    if (!ReadFile(pipe, data, static_cast<DWORD>(size), &read, nullptr) || !read) return false;
    data += read;
    size -= read;
  }
  return true;
}

bool Request(const std::wstring& pipe_name, const Json& request, Json& response, bool fragment) {
  if (!WaitNamedPipeW(pipe_name.c_str(), 5000)) return false;
  HANDLE pipe = CreateFileW(pipe_name.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr,
                            OPEN_EXISTING, 0, nullptr);
  if (pipe == INVALID_HANDLE_VALUE) return false;
  const std::string body = request.dump();
  std::vector<std::uint8_t> frame(4 + body.size());
  const auto size = static_cast<std::uint32_t>(body.size());
  frame[0] = static_cast<std::uint8_t>(size);
  frame[1] = static_cast<std::uint8_t>(size >> 8);
  frame[2] = static_cast<std::uint8_t>(size >> 16);
  frame[3] = static_cast<std::uint8_t>(size >> 24);
  std::memcpy(frame.data() + 4, body.data(), body.size());
  bool ok = fragment
      ? WriteAll(pipe, frame.data(), 2) && WriteAll(pipe, frame.data() + 2, frame.size() - 2)
      : WriteAll(pipe, frame.data(), frame.size());
  std::uint8_t header[4]{};
  ok = ok && ReadAll(pipe, header, sizeof(header));
  const std::uint32_t response_size = static_cast<std::uint32_t>(header[0]) |
      (static_cast<std::uint32_t>(header[1]) << 8) |
      (static_cast<std::uint32_t>(header[2]) << 16) |
      (static_cast<std::uint32_t>(header[3]) << 24);
  std::vector<std::uint8_t> response_body(response_size);
  ok = ok && response_size > 0 && response_size <= 1024 * 1024 &&
      ReadAll(pipe, response_body.data(), response_body.size());
  CloseHandle(pipe);
  if (!ok) return false;
  response = Json::parse(response_body.begin(), response_body.end(), nullptr, false);
  return !response.is_discarded();
}

int wmain(int argc, wchar_t** argv) {
  if (argc != 2 || !LoadLibraryW(argv[1])) return 2;
  const std::wstring pipe = L"\\\\.\\pipe\\CFB27LuaHost.v1." +
      std::to_wstring(GetCurrentProcessId());
  Json response;
  if (!Request(pipe, {{"protocol", 1}, {"id", "hello-1"},
                      {"command", "hello"}, {"params", Json::object()}}, response, true)) return 3;
  if (!response.value("ok", false) || response["result"].value("protocolVersion", 0) != 1) return 4;
  const auto capabilities = response["result"]["capabilities"];
  if (std::find(capabilities.begin(), capabilities.end(), "evaluate") == capabilities.end()) return 5;
  const std::string source = "local x=40\nx=x+2\ncfb.log(\"protocol-smoke=\"..tostring(x))";
  if (!Request(pipe, {{"protocol", 1}, {"id", "eval-1"},
                      {"command", "evaluate"}, {"params", {{"source", source}}}}, response, false)) return 6;
  if (!response.value("ok", false) || response["result"].value("status", "") != "ok") return 7;
  if (!Request(pipe, {{"protocol", 1}, {"id", "run-1"}, {"command", "runScript"},
                      {"params", {{"name", "smoke.lua"}, {"source", source}}}}, response, false)) return 8;
  if (!response.value("ok", false) || response["result"].value("status", "") != "ok") return 9;
  std::cout << "protocol smoke passed\n";
  return 0;
}
```

Use nlohmann/json in the smoke client so the exact request/response contract is asserted rather than substring-matched.

- [ ] **Step 2: Add the smoke target and verify RED**

Add `cfb27_protocol_smoke` to CMake, then run:

```powershell
cmake --build native/build-active --config Release --target cfb27_protocol_smoke
native\build-active\Release\cfb27_protocol_smoke.exe native\build-active\Release\cfb27_lua_host.dll
```

Expected: build or runtime FAIL because the host has no v1 pipe/protocol implementation.

- [ ] **Step 3: Implement exact framed reads/writes and validation**

Add nlohmann/json 3.11.3 via FetchContent:

```cmake
FetchContent_Declare(nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(nlohmann_json)
```

Define in `protocol.h`:

```cpp
namespace cfb27::protocol {
constexpr std::uint32_t kVersion = 1;
constexpr std::uint32_t kMaxFrameBytes = 1024 * 1024;
using Json = nlohmann::json;
using Handler = std::function<Json(const Json&)>;
bool ReadFrame(HANDLE pipe, Json& value, std::string& error);
bool WriteFrame(HANDLE pipe, const Json& value, std::string& error);
void Serve(std::wstring pipe_name, std::atomic<bool>& running, const Handler& handler);
Json ErrorResponse(std::string id, std::string code, std::string message, Json details = Json::object());
}
```

`ReadFrame` must loop until exactly four header bytes and exactly the declared body length are read. `WriteFrame` must loop until the entire frame is written. Reject invalid length before allocating. `Serve` accepts one request per connection and closes the connection after one response.

- [ ] **Step 4: Add host dispatch and capability negotiation**

In `lua_host.cpp`, add `HandleV1Request(const Json&)` with exact validation:

```cpp
if (!request.is_object() || request.value("protocol", 0) != 1 ||
    !request.contains("id") || !request["id"].is_string() ||
    !request.contains("command") || !request["command"].is_string()) {
  return ErrorResponse(id, "INVALID_REQUEST", "Request is missing protocol, id, or command");
}
```

Implement:

- `hello` result: `{ protocolVersion:1, hostVersion:"0.1.0-dev.1", supportedBuild, writesAllowed, capabilities:["status","runScript","evaluate"] }`.
- `status` result: current readiness/build/write/counter/error fields.
- `runScript`: require `params.name` and `params.source` strings, execute the complete source using the supplied name as the Lua chunk name, and return `{ status:"ok" }`; map Lua errors to `SCRIPT_ERROR`.
- `evaluate`: require `params.source` string, run the complete multiline buffer, clear stale `g_last_error` on success, and return `{ status:"ok" }`; map Lua errors to `SCRIPT_ERROR`.

Start `protocol::Serve` on the v1 pipe from `Start()` while leaving the legacy pipe server intact.

Add `host/protocol.cpp` to `cfb27_lua_host` and link both
`cfb27_lua_host` and `cfb27_protocol_smoke` against
`nlohmann_json::nlohmann_json`.

- [ ] **Step 5: Build and verify native protocol GREEN**

Run:

```powershell
cmake --build native/build-active --config Release --target cfb27_lua_host cfb27_protocol_smoke
native\build-active\Release\cfb27_protocol_smoke.exe native\build-active\Release\cfb27_lua_host.dll
```

Expected: hello and multiline evaluation PASS under the one-MiB-stack smoke host; malformed/oversized test frames return structured errors without process termination.

- [ ] **Step 6: Commit native protocol v1**

```powershell
git add native
git commit -m "Add native framed protocol v1"
```

---

### Task 5: Implement SDK named-pipe client and process discovery

**Files:**
- Create: `packages/sdk/src/client.cjs`
- Create: `packages/sdk/src/process.cjs`
- Create: `packages/sdk/test/client.test.cjs`
- Create: `packages/sdk/test/process.test.cjs`
- Modify: `packages/sdk/index.cjs`

**Interfaces:**
- Produces: `discoverGame({ execFileImpl?, expectedSha256?, expectedSize? }): Promise<GameProcess>`.
- Produces: `createClient({ pid, timeoutMs? }): HostClient`.
- Produces: `getHostStatus(options): Promise<object>`.
- Produces: `runScriptFile(filePath, options): Promise<object>`.
- `HostClient.request(command, params): Promise<object>`.
- `HostClient.hello()`, `.status()`, `.runScript({ name, source })`, `.evaluateLua(source)`.

- [ ] **Step 1: Write failing process-discovery tests**

```js
// packages/sdk/test/process.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProcessJson, discoverGame } = require('../src/process.cjs');

test('normalizes one PowerShell process object', () => {
  assert.deepEqual(parseProcessJson('{"ProcessId":42,"ExecutablePath":"F:\\\\CollegeFB27.exe"}'), [
    { pid: 42, path: 'F:\\CollegeFB27.exe' },
  ]);
});

test('reports GAME_NOT_RUNNING for an empty process result', async () => {
  const execFileImpl = (_file, _args, _opts, callback) => callback(null, '', '');
  await assert.rejects(discoverGame({ execFileImpl }), (error) => error.code === 'GAME_NOT_RUNNING');
});
```

The real implementation invokes `powershell.exe -NoProfile -NonInteractive -Command` with a constant `Get-CimInstance Win32_Process` query and JSON projection. No user input is interpolated into the PowerShell program.

- [ ] **Step 2: Write failing fake-pipe client tests**

```js
// packages/sdk/test/client.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { createClient } = require('../src/client.cjs');
const { FrameDecoder, encodeFrame } = require('../src/frame.cjs');

test('client negotiates hello and preserves multiline evaluate', async (t) => {
  const pipeName = `\\\\.\\pipe\\cfb27-test-${process.pid}-${Date.now()}`;
  const server = net.createServer((socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const request of decoder.push(chunk)) {
        const result = request.command === 'hello'
          ? { protocolVersion: 1, capabilities: ['status', 'evaluate'] }
          : { echoed: request.params.source };
        socket.end(encodeFrame({ protocol: 1, id: request.id, ok: true, result }));
      }
    });
  });
  await new Promise((resolve) => server.listen(pipeName, resolve));
  t.after(() => server.close());
  const client = createClient({ pipeName, timeoutMs: 1000 });
  assert.equal((await client.hello()).protocolVersion, 1);
  assert.equal((await client.evaluateLua('x=1\nx=2')).echoed, 'x=1\nx=2');
});
```

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test packages/sdk/test/process.test.cjs packages/sdk/test/client.test.cjs`

Expected: FAIL because discovery/client modules do not exist.

- [ ] **Step 4: Implement discovery and client**

`process.cjs` exports `parseProcessJson` and `discoverGame`. Normalize PowerShell's zero/one/many JSON shapes. Validate PID is a positive integer and path ends with `CollegeFB27.exe`. When expected size/hash are supplied, use `fs.stat` and streaming `crypto.createHash('sha256')`; throw `GAME_PATH_MISMATCH` on mismatch.

`client.cjs` uses `net.createConnection(pipeName)`, `encodeFrame`, `FrameDecoder`, `crypto.randomUUID()`, and an explicit timeout. It verifies response `protocol`, matching `id`, and `ok`. Host errors become `Cfb27HookError(error.code, error.message, error.details)`. The client closes every connection after one response. `runScriptFile` reads UTF-8 with `fs.promises.readFile`, uses `path.basename(filePath)` as the chunk name, and calls `client.runScript`. `getHostStatus` discovers the process when no PID is supplied, creates a client, negotiates `hello`, requires the `status` capability, and returns `client.status()`.

Default pipe name is `\\.\pipe\CFB27LuaHost.v1.<pid>`.

- [ ] **Step 5: Export supported SDK interfaces and verify GREEN**

Export only:

```js
module.exports = {
  Cfb27HookError,
  ERROR_CODES,
  discoverGame,
  createClient,
  getHostStatus,
  runScriptFile,
};
```

Run: `node --test packages/sdk/test/*.test.cjs`

Expected: all SDK tests PASS, including fragmented fake-pipe responses and timeout mapping to `PIPE_TIMEOUT`.

- [ ] **Step 6: Commit SDK transport/discovery**

```powershell
git add packages/sdk
git commit -m "Add Lua hook Node client"
```

---

### Task 6: Port reversible MMC installation into the SDK

**Files:**
- Create: `packages/sdk/src/install.cjs`
- Create: `packages/sdk/test/install.test.cjs`
- Modify: `packages/sdk/index.cjs`

**Interfaces:**
- Produces: `inspectInstallation(options): Promise<InstallationState>`.
- Produces: `installHook(options): Promise<InstallationResult>`.
- Produces: `restoreMmcHook(options): Promise<RestoreResult>`.
- Options require `gameDir`, `mmcDir`, `proxyDll`, `hostDll`; `autorunScript` is optional.

- [ ] **Step 1: Write failing temporary-directory install/restore tests**

```js
// packages/sdk/test/install.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { installHook, restoreMmcHook } = require('../src/install.cjs');

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();

test('install preserves both MMC proxies and restore reverses both', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cfb27-hook-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const gameDir = path.join(root, 'game');
  const mmcDir = path.join(root, 'mmc');
  const thirdParty = path.join(mmcDir, 'ThirdParty');
  await fs.mkdir(thirdParty, { recursive: true });
  const mmc = Buffer.from('recognized-mmc');
  const proxy = Buffer.from('new-proxy');
  const host = Buffer.from('new-host');
  await fs.writeFile(path.join(gameDir, 'CryptBase.dll'), mmc).catch(async () => {
    await fs.mkdir(gameDir, { recursive: true });
    await fs.writeFile(path.join(gameDir, 'CryptBase.dll'), mmc);
  });
  await fs.writeFile(path.join(thirdParty, 'CryptBase.dll'), mmc);
  await fs.writeFile(path.join(root, 'proxy.dll'), proxy);
  await fs.writeFile(path.join(root, 'host.dll'), host);

  await installHook({ gameDir, mmcDir, proxyDll: path.join(root, 'proxy.dll'), hostDll: path.join(root, 'host.dll'), expectedMmcSha256: sha(mmc), assertGameClosed: async () => {} });
  assert.deepEqual(await fs.readFile(path.join(gameDir, 'MMCBase.dll')), mmc);
  assert.deepEqual(await fs.readFile(path.join(thirdParty, 'MMCBase.dll')), mmc);
  assert.deepEqual(await fs.readFile(path.join(gameDir, 'CryptBase.dll')), proxy);
  await restoreMmcHook({ gameDir, mmcDir, expectedMmcSha256: sha(mmc), assertGameClosed: async () => {} });
  assert.deepEqual(await fs.readFile(path.join(gameDir, 'CryptBase.dll')), mmc);
  assert.deepEqual(await fs.readFile(path.join(thirdParty, 'CryptBase.dll')), mmc);
});
```

Add separate tests for unknown active proxy, mismatched backup, missing artifacts, simulated copy failure rollback, and refusal when `assertGameClosed` rejects.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test packages/sdk/test/install.test.cjs`

Expected: FAIL because install module does not exist.

- [ ] **Step 3: Implement hashing, inspection, atomic copy, install, and restore**

Implement:

```js
async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fsSync.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex').toUpperCase();
}

async function atomicCopy(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await fs.copyFile(source, temporary);
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
```

`inspectInstallation` hashes the active and backup proxies in the game and MMC
`ThirdParty` directories plus the installed host. It returns `mode` as exactly
`restored`, `installed`, `partial`, or `conflict`; it never changes files.

`installHook` executes these ordered operations: call `assertGameClosed`; verify
both source artifacts; verify or create both `MMCBase.dll` backups from a
recognized active MMC proxy; snapshot both active proxy hashes; replace both
active proxies; install the host and optional autorun; verify all destination
hashes; on any failure restore both active proxies from the already-verified
backups and throw `INSTALLATION_CONFLICT` with the original failure in details.

`restoreMmcHook` calls `assertGameClosed`, verifies both backups equal the known
MMC hash, atomically copies each backup over its active proxy, verifies both
destinations, and returns the restored paths/hashes. Any mismatch throws
`BACKUP_VERIFICATION_FAILED` before mutation.

Use the recognized MMC SHA constant `3E87682118E593F334BA665826E2A6AB85BA460F2E1FE95B173A7199863AD454` as the default. Never replace an unrecognized active/backup proxy. Return only paths and hashes; never return file content.

- [ ] **Step 4: Verify installer GREEN**

Run: `node --test packages/sdk/test/install.test.cjs packages/sdk/test/process.test.cjs`

Expected: all tests PASS, including rollback and close-game refusal.

- [ ] **Step 5: Export installer functions and commit**

```powershell
git add packages/sdk
git commit -m "Add reversible MMC hook installer"
```

---

### Task 7: Implement the `cfb27lua` CLI contract

**Files:**
- Create: `packages/cli/src/args.cjs`
- Create: `packages/cli/src/output.cjs`
- Create: `packages/sdk/src/doctor.cjs`
- Create: `packages/sdk/test/doctor.test.cjs`
- Modify: `packages/cli/src/main.cjs`
- Modify: `packages/cli/bin/cfb27lua.cjs`
- Create: `packages/cli/test/main.test.cjs`

**Interfaces:**
- Consumes SDK `discoverGame`, `createClient`, `getHostStatus`, `runScriptFile`, `installHook`, `restoreMmcHook`, `inspectInstallation`, `doctor`.
- Produces commands `install`, `uninstall`, `status`, `run`, `eval`, `doctor` in this slice.
- Produces deterministic `{ code, stdout, stderr }` behavior via injected IO/SDK tests.

- [ ] **Step 1: Write failing CLI dispatch/output tests**

```js
// packages/cli/test/main.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../src/main.cjs');

function memoryIo() {
  const output = { stdout: '', stderr: '' };
  return {
    output,
    io: {
      out: (value) => { output.stdout += `${value}\n`; },
      err: (value) => { output.stderr += `${value}\n`; },
      readFile: async () => 'cfb.log("file")',
    },
  };
}

test('status --json prints one stable JSON object', async () => {
  const { io, output } = memoryIo();
  const sdk = {
    discoverGame: async () => ({ pid: 42, path: 'F:\\CollegeFB27.exe' }),
    createClient: () => ({ status: async () => ({ ready: true, protocolVersion: 1 }) }),
  };
  assert.equal(await main(['status', '--json'], { sdk, io }), 0);
  assert.deepEqual(JSON.parse(output.stdout), { ok: true, command: 'status', result: { ready: true, protocolVersion: 1 } });
});

test('SDK errors map to stable nonzero exit families', async () => {
  const { io, output } = memoryIo();
  const error = Object.assign(new Error('not running'), { code: 'GAME_NOT_RUNNING' });
  assert.equal(await main(['status'], { sdk: { discoverGame: async () => { throw error; } }, io }), 20);
  assert.match(output.stderr, /GAME_NOT_RUNNING/);
});
```

Add tests for help/unknown command, install required paths, run reading a multiline file, eval preserving separate argv tokens, doctor performing no writes, and `--json` errors going to stdout as one JSON object.

Create `packages/sdk/test/doctor.test.cjs` with injected `discoverGame`,
`inspectInstallation`, and `createClient` functions. Assert that `doctor()`
returns checks for game, installation, host, build, and write eligibility; assert
the injected installer/restore functions are never called.

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `node --test packages/cli/test/main.test.cjs`

Expected: FAIL because parsing/output/dispatch are not implemented.

- [ ] **Step 3: Implement deterministic parser and output**

`args.cjs` returns:

```js
{ command, json, positionals, options: { gameDir, mmcDir, artifactsDir, follow, after } }
```

Reject duplicate scalar flags and missing values. Do not use `eval`, shell expansion, or dynamic command loading.

`output.cjs` exposes `printSuccess(io, command, result, json)` and `printError(io, error, json)`. JSON mode always emits exactly one object.

- [ ] **Step 4: Implement CLI command dispatch and exit codes**

`main(argv, { sdk = require('@cfb27/lua-hook'), io = defaultIo } = {})` dispatches:

- `install`: resolve artifact paths, call `installHook`.
- `uninstall`: call `restoreMmcHook`.
- `status`: discover process, connect, call `status`.
- `run`: call SDK `runScriptFile` so the host receives the script filename and full multiline source.
- `eval`: join remaining positional source with spaces and call `evaluateLua`.
- `doctor`: call SDK `doctor`, which performs only discovery, installation inspection, hello, and status; it returns ordered checks and recovery recommendations without writes.

Exit families: `0` success, `2` usage, `20-29` unavailable runtime, `30-39` protocol/script rejection, `40-49` installation/recovery, `70` internal failure.

`install`, `uninstall`, and `doctor` resolve `gameDir` from `--game-dir` then
`CFB27_GAME_DIR`, and `mmcDir` from `--mmc-dir` then `CFB27_MMC_DIR`. Installation
fails with usage exit `2` when either is absent. `artifactsDir` resolves from
`--artifacts-dir` then `CFB27_HOOK_ARTIFACTS`; it never guesses a game or MMC
directory.

- [ ] **Step 5: Verify CLI GREEN**

Run:

```powershell
node --test packages/cli/test/main.test.cjs
node packages/cli/bin/cfb27lua.cjs --help
npm test
```

Expected: tests PASS; help lists only implemented commands/options.

- [ ] **Step 6: Commit CLI**

```powershell
git add packages/cli
git commit -m "Add cfb27lua developer CLI"
```

---

### Task 8: Add bounded logs and cursor-based host events

**Files:**
- Modify: `native/host/lua_host.cpp`
- Modify: `native/smoke/protocol_smoke.cpp`
- Create: `packages/sdk/src/logs.cjs`
- Create: `packages/sdk/test/logs.test.cjs`
- Modify: `packages/sdk/src/client.cjs`
- Modify: `packages/sdk/index.cjs`
- Modify: `packages/cli/src/main.cjs`
- Modify: `packages/cli/src/args.cjs`
- Modify: `packages/cli/test/main.test.cjs`

**Interfaces:**
- Host commands: `logs { limit }`, `events { after, limit }`.
- Event result: `{ events: [{ cursor, type, timestampMs, payload }], nextCursor }`.
- SDK: `client.getLogs({ limit })`, `client.getEvents({ after, limit })`, `followEvents(options)` async iterator.
- CLI: `logs [--follow] [--json]`, `events [--after N] [--json]`.

- [ ] **Step 1: Write failing SDK log/event tests**

```js
// packages/sdk/test/logs.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { followEvents } = require('../src/logs.cjs');

test('followEvents advances cursor and does not duplicate events', async () => {
  const calls = [];
  const client = { getEvents: async ({ after }) => {
    calls.push(after);
    return calls.length === 1
      ? { events: [{ cursor: 1, type: 'log', payload: { message: 'a' } }], nextCursor: 1 }
      : { events: [{ cursor: 2, type: 'tick', payload: {} }], nextCursor: 2 };
  } };
  const iterator = followEvents(client, { after: 0, pollMs: 0 })[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.cursor, 1);
  assert.equal((await iterator.next()).value.cursor, 2);
  await iterator.return();
  assert.deepEqual(calls, [0, 1]);
});
```

- [ ] **Step 2: Extend native smoke expectations and verify RED**

Update protocol smoke to evaluate `cfb.log("event-proof")`, call `logs`, call `events` after cursor zero, and require the log event exactly once. Run the native smoke and SDK test; expect both to FAIL.

- [ ] **Step 3: Implement bounded native rings**

In `lua_host.cpp`, add a mutex-protected ring of at most 1,024 events and 512 log entries. Each event receives a monotonically increasing `std::uint64_t` cursor and Unix epoch milliseconds. `Log()` writes the file and appends a `log` event. Lifecycle callbacks append `game_ready` and `tick` events, but coalesce tick events to at most one per second to prevent unbounded churn.

Validate `limit` as integer `1..256`. `events.after` defaults to zero. Responses are naturally bounded below one MiB.

- [ ] **Step 4: Implement SDK polling and CLI commands**

`followEvents` is an async generator with `AbortSignal` support, cursor advancement, and a default 500 ms poll. `logs --follow` prints only new log events. JSON follow mode prints one JSON object per line and is documented as JSONL, unlike one-shot `--json` commands.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```powershell
cmake --build native/build-active --config Release --target cfb27_lua_host cfb27_protocol_smoke
native\build-active\Release\cfb27_protocol_smoke.exe native\build-active\Release\cfb27_lua_host.dll
npm test
```

Expected: native smoke and all Node tests PASS with no duplicate cursor events.

Commit:

```powershell
git add native packages
git commit -m "Add Lua host logs and events"
```

---

### Task 9: Archive unsupported save-editor, injection, and raw research material

**Files:**
- Create: `archive/README.md`
- Create: `archive/legacy-save-editor/README.md`
- Create: `archive/legacy-hooks/README.md`
- Create: `archive/research-tools/README.md`
- Create: `tests/archive-boundary.test.cjs`
- Move with `git mv`: files listed below
- Create/modify: supported docs under `docs/`

**Interfaces:**
- Active npm workspaces/CMake/CI may not reference `archive/`.
- Archive files remain history-preserving snapshots and are not promised runnable from their new paths.

- [ ] **Step 1: Write the failing archive-boundary test**

```js
// tests/archive-boundary.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('unsupported roots are absent from the active tree', () => {
  for (const entry of ['server.py', 'static', 'electron', 'franchise_helper.js', 'test_editor.py', 'tools']) {
    assert.equal(fs.existsSync(path.join(root, entry)), false, entry);
  }
});

test('active manifests and CMake never reference archive', () => {
  const files = ['package.json', 'native/CMakeLists.txt'];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /archive[\\/]/i, file);
  }
});

test('all archive areas explain unsupported status', () => {
  for (const area of ['legacy-save-editor', 'legacy-hooks', 'research-tools']) {
    const text = fs.readFileSync(path.join(root, 'archive', area, 'README.md'), 'utf8');
    assert.match(text, /unsupported/i);
    assert.match(text, /Git history/i);
  }
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/archive-boundary.test.cjs`

Expected: FAIL because unsupported files still occupy active roots.

- [ ] **Step 3: Move legacy save-editor material**

Use `git mv` to place these under `archive/legacy-save-editor/`, preserving subdirectories:

```text
server.py
franchise_helper.js
live_dynasty.py
live_process.py
native_hook.py
startup_hook.py
test_editor.py
electron/
static/
schema/
```

The old package manifests are already present from Task 1. State in the archive README that relative paths may no longer run and historical commits are the authoritative runnable snapshots.

- [ ] **Step 4: Move legacy injection material**

Use `git mv` into `archive/legacy-hooks/`:

```text
native/hook.cpp
native/injector.cpp
native/request_trace.cpp
native/response_guard.cpp
native/submit_probe.cpp
scripts/speed_guard_test.lua
scripts/speed_test.lua
```

If these files were already moved or excluded by Task 2, move them from their current locations without recreating copies.

- [ ] **Step 5: Move raw research tools and promote maintained findings**

Move `tools/` to `archive/research-tools/tools/`. Move obsolete execution plans/specs tied only to real-time roster/save editing under `archive/research-tools/docs/`. Move `docs/live-hook-research.md` to `docs/research/legacy-hook-findings.md` and edit its header to distinguish verified historical findings from the supported startup host. Move `docs/live-lua-host.md` content into supported `docs/lua-api.md`, `docs/safety.md`, and `docs/research/runtime-verification.md` without duplicating installation commands.

- [ ] **Step 6: Write archive READMEs and active documentation navigation**

Each archive README must name what it proved, why it is inactive, its unsupported status, the relevant historical commit/PR, and the maintained documentation replacement. Root `archive/README.md` lists all three areas and states they are excluded from releases.

- [ ] **Step 7: Verify archive boundary GREEN and commit**

Run:

```powershell
node --test tests/archive-boundary.test.cjs tests/package-layout.test.cjs
npm test
rg "archive[\\/]" package.json native/CMakeLists.txt; if ($LASTEXITCODE -eq 0) { throw "active build references archive" }
```

Expected: active tests PASS; final search finds no active build reference.

Commit:

```powershell
git add -A
git commit -m "Archive legacy editor and hook research"
```

---

### Task 10: Build reproducible developer-preview packages and Windows CI

**Files:**
- Create: `scripts/package-release.cjs`
- Create: `tests/release-package.test.cjs`
- Create: `.github/workflows/windows-ci.yml`
- Modify: `.gitignore`
- Modify: `package.json`
- Create: `docs/development/building.md`

**Interfaces:**
- Produces: `dist/cfb27-lua-hook-0.1.0-dev.1/` staging tree and zip.
- Produces: `dist/SHA256SUMS.txt`.
- Rejects any package containing archive, saves, schemas, logs, backups, node_modules, or build intermediates.

- [ ] **Step 1: Write the failing release-package test**

```js
// tests/release-package.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { releaseEntries, assertAllowedEntry } = require('../scripts/package-release.cjs');

test('release allowlist contains only supported product areas', () => {
  assert.deepEqual(releaseEntries(), ['native', 'packages', 'examples', 'docs', 'README.md', 'LICENSE']);
});

test('release rejects archive and generated/private material', () => {
  for (const value of ['archive/a', 'node_modules/a', 'schema/a.gz', 'save/DYNASTY-X', 'host.log']) {
    assert.throws(() => assertAllowedEntry(value), /not allowed/i, value);
  }
  assert.doesNotThrow(() => assertAllowedEntry(path.join('examples', 'lua', 'autorun.lua')));
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/release-package.test.cjs`

Expected: FAIL because packaging script does not exist.

- [ ] **Step 3: Implement deterministic release staging**

`package-release.cjs` must:

- require explicit native artifact paths or locate `native/build-active/Release`;
- run `npm pack --workspace packages/sdk` and `npm pack --workspace packages/cli`;
- copy only allowlisted docs/examples and the three native runtime artifacts;
- normalize copied file mtimes to `SOURCE_DATE_EPOCH` when set;
- recursively sort paths before checksumming;
- emit uppercase SHA-256 lines in `SHA256SUMS.txt`;
- fail if any denylisted path or extension is encountered;
- export `releaseEntries`, `assertAllowedEntry`, and `main` for tests;
- run only when `require.main === module`.

- [ ] **Step 4: Add Windows CI**

Create `.github/workflows/windows-ci.yml` triggered by pushes and PRs:

```yaml
name: windows-ci
on: [push, pull_request]
jobs:
  verify:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm test
      - run: cmake -S native -B native/build-active -A x64
      - run: cmake --build native/build-active --config Release
      - run: native/build-active/Release/cfb27_startup_smoke.exe native/build-active/Release/cfb27_lua_host.dll
      - run: native/build-active/Release/cfb27_protocol_smoke.exe native/build-active/Release/cfb27_lua_host.dll
      - run: npm run pack:preview
      - uses: actions/upload-artifact@v4
        with:
          name: cfb27-lua-hook-0.1.0-dev.1
          path: dist/
```

- [ ] **Step 5: Verify package contents locally**

Run:

```powershell
npm run pack:preview
node --test tests/release-package.test.cjs
Get-ChildItem dist -Recurse | Select-Object FullName
```

Expected: package tests PASS; no path contains `archive`, `save`, `schema`, `node_modules`, `.obj`, `.pdb`, `.log`, or third-party project content.

- [ ] **Step 6: Commit release tooling**

```powershell
git add .github scripts tests package.json .gitignore docs/development/building.md
git commit -m "Package Lua hook developer preview"
```

---

### Task 11: Final documentation, verification, PR, merge, and GitHub rename

**Files:**
- Modify: `README.md`
- Create: `docs/getting-started.md`
- Create: `docs/protocol.md`
- Create: `docs/cli.md`
- Create: `docs/safety.md`
- Create: `docs/development/release-checklist.md`
- Create: `docs/development/restructure-pr-body.md`
- Create: `examples/lua/autorun.lua`
- Create: `examples/lua/read-image-header.lua`
- Create: `examples/lua/events.lua`

**Interfaces:**
- Documentation describes only implemented `0.1.0-dev.1` behavior.
- Post-merge repository URL becomes `https://github.com/eric-levinson/cfb27-lua-hook`.

- [ ] **Step 1: Write examples and supported documentation**

Examples must use only `cfb.module_base`, `cfb.read_u8`, `cfb.aob_scan`, `cfb.log`, and `cfb.on`; no example performs a game-data write by default. `getting-started.md` documents Node 20+, local native build, `cfb27lua doctor`, reversible install, MMC launch, status, safe example run, and uninstall. `safety.md` documents offline-only scope, exact-build gates, no anticheat bypass, compare-before-write semantics, backups, and recovery. `restructure-pr-body.md` contains reviewed Markdown sections for Summary, Architecture, Archive scope, Protocol/SDK/CLI, Safety, Packaging, Verification, Runtime evidence, and Follow-up; its Follow-up section states that Brooks integration is a separate PR.

- [ ] **Step 2: Run fresh active-product verification**

Run:

```powershell
npm ci
npm run check
npm test
cmake -S native -B native/build-active -A x64
cmake --build native/build-active --config Release
native\build-active\Release\cfb27_startup_smoke.exe native\build-active\Release\cfb27_lua_host.dll
native\build-active\Release\cfb27_protocol_smoke.exe native\build-active\Release\cfb27_lua_host.dll
npm run pack:preview
git diff --check
```

Expected: every command exits `0`; package inspection contains no denylisted material.

- [ ] **Step 3: Perform the documented offline runtime checklist**

With CFB27 closed, install the package build; launch through MMC; require `hello`, `status`, multiline evaluation, Lua log, read of the `MZ` header, AOB header scan, and advancing events. Confirm `supportedBuild=true`, `writesAllowed=true`, no real anticheat process, and a responsive game. Do not perform an additional gameplay-data write unless a disposable/reversible test is explicitly selected. Close the game and verify uninstall restores both MMC proxy hashes.

- [ ] **Step 4: Commit final documentation**

```powershell
git add README.md docs examples
git commit -m "Document CFB27 Lua Hook preview"
```

- [ ] **Step 5: Push and open the cleanup PR**

Run:

```powershell
git push -u origin codex/restructure-cfb27-lua-hook
gh pr create --draft --base main --head codex/restructure-cfb27-lua-hook --title "Restructure repository as CFB27 Lua Hook" --body-file docs/development/restructure-pr-body.md
```

The PR body must summarize architecture, archive scope, protocol/SDK/CLI, safety, package artifact, verification commands, runtime evidence, and explicitly state that Brooks integration is a separate follow-up.

- [ ] **Step 6: Merge only after checks and review are green**

Confirm GitHub Actions passes, inspect the PR file list for archive/generated/third-party leaks, mark ready, and merge. Record the merge commit before renaming.

- [ ] **Step 7: Rename and describe the GitHub repository**

After merge:

```powershell
gh repo rename cfb27-lua-hook --repo eric-levinson/cfb27-save-editor --yes
gh repo edit eric-levinson/cfb27-lua-hook --description "Offline CFB27 Lua hook, scripting SDK, and MMC startup tooling for PC." --add-topic college-football-27 --add-topic cfb27 --add-topic lua --add-topic modding --add-topic game-modding --add-topic electron --add-topic windows
git remote set-url origin https://github.com/eric-levinson/cfb27-lua-hook.git
git fetch origin
```

Verify the new URL resolves, the old GitHub URL redirects, `origin/main` contains the merge, release artifacts are reachable, and a fresh clone uses the new name.

- [ ] **Step 8: Create the Brooks integration follow-up boundary**

Open a GitHub issue—not implementation code—with acceptance criteria for a read-only Electron-main SDK connection, capability negotiation, selected-recruit live overlay, cursor events, and no renderer exposure of raw eval/memory. Link the assessment and this repository design.

- [ ] **Step 9: Final completion report**

Report the renamed repository URL, merge commit, developer-preview version, CI run, release artifact/checksum, runtime checklist, archive policy, and the Brooks integration issue. Do not claim npm publication because it is outside this plan.
