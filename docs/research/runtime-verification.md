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
