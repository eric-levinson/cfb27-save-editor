# Safety boundary

CFB27 Lua Hook is for a separately launched offline game session. It does not
provide, distribute, or document an anticheat bypass.

## Installation safety

- Close the game before installing or restoring the MMC startup proxy.
- Both original MMC `CryptBase.dll` files are checksum-verified and preserved
  as `MMCBase.dll` before replacement.
- Unknown active proxies or backups are never overwritten.
- A failed install restores both verified MMC proxies.
- Do not disable or allowlist antivirus protection for this project.

## Runtime write gates

`cfb.write_u8` rejects a write unless all of these conditions hold:

1. The process is the exact supported CFB27 executable build.
2. No real EA anticheat or Javelin process is detected.
3. The address belongs to committed writable memory.
4. The current byte equals the caller's expected byte.
5. Readback equals the requested replacement byte.

An unsupported build may load the host for diagnostics, but writes stay
disabled. Integrations should call `hello`, inspect `writesAllowed`, and retain
their own higher-level transaction and rollback checks.
