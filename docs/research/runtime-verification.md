# Runtime verification

This document records verified behavior of the supported startup-loaded host,
not a promise that offsets or object layouts remain stable across game builds.

## Supported executable

- File: `CollegeFB27.exe`
- Size: `247845776` bytes
- SHA-256: `9E654AD49C4702D8F9FA4E38FD1110ABE657DD38926D4124B30C70E7D29ADFE8`

## Verified on July 11, 2026

- MMC loaded the forwarding `CryptBase.dll`, preserved `MMCBase.dll`, and
  persistent `cfb27_lua_host.dll` during normal game startup.
- Host status reported ready, supported build, and writes allowed in the
  separately launched offline session with no real anticheat process present.
- Autorun, `game_ready`, and continuing tick callbacks executed.
- Multiline Lua ran through the local pipe, and module-base, guarded byte-read,
  and AOB-scan APIs returned the expected executable-header results.
- A reversible live player-rating transaction changed all validated speed-byte
  copies for player ID `25130`, read them back, restored every byte, and was
  independently confirmed after rollback while the game remained responsive.

The first startup test also found a deterministic `0xC00000FD` stack overflow:
a one-MiB hash buffer had been placed on the game's one-MiB worker stack. The
buffer now lives on the heap, and the native regression suite loads the host in
a smoke executable with the same one-MiB stack reserve.

Earlier request-detour and save-editor findings are retained separately in
`legacy-hook-findings.md` and the repository archive.

## Read-only discovery preview verified on July 11, 2026

- The manually tested process was PID `21900`; `CollegeFB27.exe` matched the
  supported SHA-256 above. The installed forwarding proxy SHA-256 was
  `4638D7E54A6715538119254069B075C94EB7AB41A6914907AAD96750ABD0F756`;
  the manually tested host SHA-256 was
  `1420F4BCAA089153E671FD41D7B89F3162EFF8AAD94B4D1EFD18039E6590D3CE`.
- The live hello response advertised `memoryScan`, `memoryRead`, and
  `telemetry` capabilities. No memory write was attempted during this gate.
- An initial automatic scan failed between pages with `ENOENT`. Retrying with
  the corrected SDK-only continuation handling completed the scan; this was a
  client retry correction, not a host reinstall.
- The complete scan covered `10,670,854,144` eligible bytes in `69,379` ms and
  returned three candidates. Batch re-read confirmed the exact 16-byte
  sentinel at `0x25DDC14D0` and `0x34CC50048`; the transient candidate at
  `0x273FEB930` had changed and was correctly rejected.
- Registered telemetry sequence `2` appeared exactly once while the event
  cursor advanced from `718` to `720`.
- After entering Recruiting and returning to the Dynasty hub, a 639-second
  responsiveness watch retained PID `21900`. Tick count advanced from `8632`
  to `14986`, the event cursor advanced from `871` to `1506`, and no error was
  observed.

The version-only native rebuild performed after this manual gate necessarily
changes the final host binary hash. That final packaged hash was verified by
the automated release gate below, but was not the binary exercised by this
manual live session.
