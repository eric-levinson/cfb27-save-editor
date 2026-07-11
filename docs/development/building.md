# Building the developer preview

Requirements are Windows x64, Node.js 20 or later, CMake 3.24 or later, and
Visual Studio 2022 with the C++ desktop workload.

```powershell
npm ci
npm run check
npm test
cmake -S native -B native/build-active -A x64
cmake --build native/build-active --config Release
```

Verify both native harnesses:

```powershell
native/build-active/Release/cfb27_startup_smoke.exe native/build-active/Release/cfb27_lua_host.dll
native/build-active/Release/cfb27_protocol_smoke.exe native/build-active/Release/cfb27_lua_host.dll
```

Create the allowlisted preview bundle and checksum:

```powershell
npm run pack:preview
```

Set `CFB27_NATIVE_ARTIFACTS` when the native DLLs are in a different Release
directory. Set `SOURCE_DATE_EPOCH` to normalize staged file timestamps. The
packager rejects archive content, game/save data, logs, dependencies, and build
intermediates.
