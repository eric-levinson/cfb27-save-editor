# Lua API

The host embeds Lua 5.4 in the offline `CollegeFB27.exe` process. One Lua state
persists for the game session, so globals and callbacks registered by one
script remain available to later scripts.

## Runtime functions

```lua
local base = cfb.module_base()
local byte = cfb.read_u8(base)
local matches = cfb.aob_scan("4D 5A ?? ??", 8)

-- Writes require the supported build, offline safety gates, an exact expected
-- byte, writable committed memory, and successful readback.
local changed = cfb.write_u8(address, expected, replacement)

cfb.log("script loaded")

cfb.on("game_ready", function()
  cfb.log("game ready")
end)

cfb.on("tick", function()
  -- Keep callbacks short because all callbacks share the Lua state.
end)
```

Supported callback names are `game_ready` and `tick`. The host runs `tick`
callbacks approximately every 100 ms. The event protocol coalesces observable
tick events to at most one per second.

## Script execution

Protocol v1 accepts complete UTF-8 source buffers through `evaluate` and
`runScript`; multiline scripts are not split on newlines. `runScript` also
accepts a chunk name so Lua errors identify the source file. Use the Node SDK
or `cfb27lua run <file>` instead of writing directly to the named pipe.

Lua errors return the stable `SCRIPT_ERROR` code. Recent logs and cursor-based
events are available through the SDK and CLI without reading the host log file.
