# Developer-preview release checklist

- [ ] Complete independent task-level specification and quality reviews, then a
      different-reviewer whole-branch review, before candidate installation.
- [ ] Run `npm ci`, `npm run check`, and `npm test`.
- [ ] Configure and build all native targets with Windows x64 MSVC.
- [ ] Run startup, memory-reader, telemetry, transaction, and framed-protocol
      smoke executables from the full Release build.
- [ ] Confirm CLI memory scans automatically follow continuation pages with a
      bounded `--max-pages` value and retain the scan-only timeout.
- [ ] Set `CFB27_NATIVE_ARTIFACTS` to the absolute path of that exact Release
      directory, then run `npm run pack:preview`.
- [ ] Run `git diff --check`.
- [ ] Confirm the staged package and both npm tarballs contain no archive,
      game/save data, schema, logs, dependencies, or build intermediates.
- [ ] Verify the external `dist/SHA256SUMS.txt` against the preview zip. The ZIP
      checksum cannot be embedded in documentation inside that same ZIP.
- [ ] Confirm Windows CI is green.
- [ ] With both applications closed, verify the original active proxies, install
      the exact automated-gate candidate through the supported SDK or CLI, and
      independently verify the installed proxy and host hashes.
- [ ] Relaunch MMC and CFB27 offline to the Dynasty hub. Confirm the supported
      executable, PID, session, capabilities, write eligibility, and exact
      selected-save recipes before opting into any read-only scan.
- [ ] Calibrate authority with bounded scans, stable batch rereads, allocation
      topology, and a hub-to-Recruiting-to-hub lifecycle transition. Proceed
      only when exactly one authoritative permission record remains; reject
      presentation copies, stale neighborhoods, and unresolved replicas.
- [ ] Immediately revalidate the complete record, change only the byte containing
      the two-bit enum through one guarded transaction, verify the complete
      alternate record and responsiveness, then restore through a second guarded
      transaction and verify the complete original record. Require no lockdown
      and continued write eligibility. Do not advance or write recruiting data.
- [ ] Record the date, executable hash, exact commands, and observed results in
      `docs/research/runtime-verification.md` only after observing them. Retain
      hashes, counts, and topology relationships, never addresses or raw bytes.
- [ ] After the manual gate succeeds, set root, SDK, CLI, lockfile, release
      packager, SDK dependency, and native hello versions to `0.2.0-dev.2`, then
      repeat every automated build, test, smoke, package-inspection, and
      diff-check step.
- [ ] Close both applications, confirm process absence, use the supported
      uninstall, and verify both original active proxy hashes before packaging.
- [ ] Publish GitHub artifacts only; npm publication is not part of this preview.
