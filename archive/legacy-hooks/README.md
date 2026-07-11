# Legacy hook experiments

Status: **unsupported historical snapshot**.

These sources proved useful runtime layouts, guarded memory writes, request
tracing, and the limitations of remote injection and UI-triggered request
detours. They are intentionally absent from active CMake targets. Do not use
them as an installation or anticheat-bypass mechanism.

Git history at pre-restructure commit `7498ae9` and PR #4 preserves their
original build context. Maintained behavior now lives in `native/host`,
`native/proxy`, `docs/lua-api.md`, and `docs/research/runtime-verification.md`.
