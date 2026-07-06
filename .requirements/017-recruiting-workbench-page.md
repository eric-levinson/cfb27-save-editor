# 017 - Recruiting Workbench Desktop And Browser Workbench

## Status

- Status: Draft
- Owner: Unassigned
- Last updated: 2026-07-05
- Source: User workflow request for optional desktop app; requirement 015 research; requirement 016 upstream code/data import; BG recruiting research
- Phase: Recruiting workbench MVP

## Summary

Add a dedicated recruiting workbench for weekly dynasty recruiting, available both as a browser route and as an optional desktop app shell. The first shippable version should make the app better than the in-game UI for reading and planning: load a save, show the active board, inspect each target, calculate available actions, and preview changes without writing unsafe fields.

Writes are intentionally gated by requirements 015 and 016. The workbench can be built read-only first, then upgraded to action previews and finally copy-first save writes once each action recipe is proven.

The desktop target should feel like a real local save editor, not like a user manually running a web server. Electron is the preferred packaging path unless implementation research finds a simpler local desktop wrapper that fits the existing Python backend better. The browser route remains valuable for development, debugging, and users who prefer the web flow.

This workstream is intentionally independent from BG's recruit-generation engine work. The workbench should operate on the current loaded save's existing recruiting board and should not depend on generated-class logic, generator configs, or reroll decisions. The two efforts can later meet through shared recruit/player profile contracts, field capability metadata, safe save output, and sidecar/report artifacts.

## Parallel Workstream Boundary

The recruiting workbench owns:

- Loading and displaying the current weekly recruiting board.
- Mapping board targets to `Recruit`, linked `Player`, `UserRecruitTarget`, `ProspectInteraction`, and candidate `RecruitTarget` rows.
- Planning weekly actions against the current board state.
- Validating hours, scholarships, NIL offer state, scouting state, lock state, and stale save fingerprints.
- Applying proven recruiting-action recipes to a new modded save copy after requirements 015 and 016 clear the relevant gates.
- Providing both browser and desktop delivery surfaces over the same backend/API contract.

BG's recruit-generation engine owns:

- Generating or rerolling recruit/player identities, ratings, body, appearance, rankings, archetypes, and recruiting presentation fields.
- Class-level budgets, distributions, validation, and generator-specific sidecars.
- Any generator apply path that rewrites recruit/player profiles.

Shared contracts:

- Joined `Recruit` plus linked `Player` profile shape.
- Field capability metadata: `writable`, `preview-only`, `research`, `preserve`, `unsafe`.
- Save fingerprint and stale-preview validation.
- Copy-first save writer and read-back verification from archived requirement 007.
- Sidecar/report record ids based on save fingerprint, recruit row, and player row.

## Goals

- Add a dedicated Recruiting navigation item and route/state for `/recruiting`.
- Add an optional desktop-app delivery path, preferably Electron, that can launch/connect to the local backend and present the same workbench UI.
- Let desktop users pick dynasty saves with native file dialogs and, where practical, default to the College Football saves directory.
- Load recruiting board state for the selected dynasty save.
- Show top counters: remaining points, targets, weekly hours, scholarships, and save fingerprint.
- Show target list with name, position, stars, ranks, stage, interest rank, scouting percent, offer state, active hours, and max hours.
- Show selected recruit details: profile, top schools, influence, motivations, dealbreaker, NIL, scouting reveal, active actions, scholarship, and lock states.
- Provide read-only action planning controls before writes are enabled.
- Keep all write buttons disabled or preview-only until requirement 015 gates pass.
- Keep workbench APIs and state independent from generator config and generator preview internals.
- Expose enough provenance that later generator/workbench integration can join on stable recruit/player row ids instead of duplicated matching logic.
- Preserve browser access as a supported development and fallback mode.

## Non-Goals

- Do not implement action writes in the first read-only workbench.
- Do not require the user to run terminal commands just to use the desktop app once packaging exists.
- Do not replace the existing generator page.
- Do not call into generator preview/apply logic to build the board.
- Do not require BG's recruit engine work to land before the workbench can read saves.
- Do not create or delete recruits, teams, board rows, or target rows.
- Do not expose unsafe overwrite; all future writes must use the archived requirement 007 copy-first flow.
- Do not fork desktop and browser behavior into separate business logic implementations.

## User Workflow

### Desktop

1. User launches the desktop app.
2. App starts or connects to the local backend without requiring a separate terminal.
3. User selects a dynasty save through a native file picker, recent-file list, or default saves directory shortcut.
4. App loads a read-only board snapshot and shows counters plus target list.
5. User selects a recruit and inspects scouting, top schools, motivations, offer state, and available actions.
6. User optionally stages planned actions in app-local state.
7. App validates staged plans against visible hours, scholarships, action locks, and research-gated write support.
8. Once future gates pass, user applies the staged plan to a new modded save copy.

### Browser

1. Developer or user starts the local server.
2. User opens the existing browser UI and navigates to `/recruiting`.
3. Browser flow uses the same API, board read model, preview validation, and copy-first write rules as the desktop app.

## Data Model

`RecruitingWorkbenchState`:

```json
{
  "saveName": "DYNASTY-JUL02-07h43m00-AUTOSAVE",
  "saveFingerprint": "SHA256",
  "phase": "preseason-or-week",
  "counters": {
    "remainingPoints": null,
    "targetsUsed": 3,
    "targetsMax": 35,
    "hoursUsed": 25,
    "hoursMax": 750,
    "scholarshipsUsed": 2,
    "scholarshipsMax": 35
  },
  "targets": []
}
```

Each target should include row provenance:

- `recruitRow`
- `playerRow`
- `userRecruitTargetRow`
- `prospectInteractionRow`
- candidate `recruitTargetRows`
- candidate `boardRow`
- source confidence per field

The workbench may reuse joined profile fields from the generator model, but it should treat that model as an input contract, not as the owner of board state. Board/action fields belong to a separate recruiting-board read model.

## API Contract

The API contract must remain transport-neutral. The browser UI and desktop shell should both call the same backend endpoints so parsing, validation, diffing, and writing live in one implementation.

### Get Recruiting Board

`GET /api/recruiting/{file}`

Response:

```json
{
  "saveName": "DYNASTY-JUL02-07h43m00-AUTOSAVE",
  "saveFingerprint": "SHA256",
  "readOnly": true,
  "writeGates": {
    "actions": "blocked-by-recipe-support",
    "scouting": "blocked-by-rg-36",
    "offers": "supported-after-validation",
    "visitsAndPitches": "blocked-by-rg-36"
  },
  "counters": {},
  "targets": []
}
```

The response must be stable enough for a separate generator implementation to consume later, but it must not require a generator preview id, generator config hash, or generated profile payload.

### Preview Recruiting Plan

`POST /api/recruiting/preview`

Preview-only until 015 gates pass.

Request:

```json
{
  "file": "DYNASTY-JUL02-07h43m00-AUTOSAVE",
  "saveFingerprint": "SHA256",
  "plans": []
}
```

Response:

```json
{
  "valid": true,
  "writeEnabled": false,
  "errors": [],
  "warnings": [],
  "hourSummary": {},
  "plannedTargets": []
}
```

### Apply Recruiting Plan

`POST /api/recruiting/apply`

Future endpoint only. It must require `writeMode: "copy"`, source fingerprint validation, complete recipe support, read-back verification, and game-load evidence tracking.

### Desktop Save Picker Bridge

Desktop-only bridge API exposed by Electron preload or equivalent local wrapper. It must not bypass backend validation.

```json
{
  "selectSaveFile": true,
  "defaultDirectory": "C:\\Users\\<user>\\Documents\\EA SPORTS College Football 27\\saves",
  "recentFiles": []
}
```

The selected path is passed into the same backend save-load flow used by browser-selected files.

## UI Requirements

- Add a Recruiting tab near Generator and Recruit Editor.
- Support direct route/state `/recruiting`; if the app remains a static SPA, use history/hash routing without breaking existing tabs.
- Desktop shell should open directly into the main app/workbench, not a marketing or landing page.
- Desktop shell should provide native file open, recent saves, backup/output location visibility, and clear app status for backend starting, backend ready, and backend failed.
- Use a dense workbench layout:
  - top save/counter bar.
  - left target list with search/filter/sort.
  - center selected recruit summary and action planner.
  - right details for top schools, scouting, motivations, and validation.
- Action controls should use clear disabled states:
  - unavailable due to phase.
  - unavailable due to lock state.
  - unavailable due to insufficient hours or scholarships.
  - unavailable because the write recipe is research-gated.
- Show field provenance for research mode: table, row, field, raw value, decoded value, and confidence.
- Never imply a staged plan has modified the save until a future copy-write succeeds.
- Avoid desktop-only UI features that make browser fallback incomplete for core recruiting workflows.

## Algorithm Requirements

1. For desktop mode, launch or locate the local backend and wait for a health check before enabling save load controls.
2. Parse the selected save through existing `FBChunks` handling.
3. Read joined recruit/player profiles.
4. Read recruiting tables from requirement 015 and upstream mappings from requirement 016.
5. Join `UserRecruitTarget.Recruit` to `Recruit` and linked `Player`.
6. Attach matching `ProspectInteraction` rows by recruit/team.
7. Attach candidate `RecruitTarget` rows and top-school/influence rows without treating them as authoritative writes.
8. Compute visible active hours from decoded selected actions, not solely from `ProspectHoursSpentCurrent`.
9. Reconcile computed counters against read board counters; mark unknown or mismatched counters with warning state.
10. Return a read-only snapshot with provenance to either browser or desktop UI.

Generator integration rule: if generator sidecars exist for the same recruit/player rows, the workbench may display that generated intent as supplemental context, but it must not let sidecar data override current save state unless a future explicit merge workflow is specified.

## Validation Requirements

- Selected save must be an editable `FBCHUNKS` dynasty save.
- Desktop-selected file paths must resolve to normal files and must not write in place unless a future explicit replace-active workflow is guarded by backups and confirmation.
- Schema file must be available for named recruiting tables.
- A target cannot be writable unless it has row provenance for every recipe field.
- Planned action hours cannot exceed the visible per-target cap or team weekly cap.
- Scholarship plans cannot exceed scholarship cap.
- Action lock state must be explained when a control is disabled.
- A stale save fingerprint blocks future apply.

## Test Plan

### Unit Tests

- board action-hour calculation from action booleans.
- scholarship count calculation from `ScholarshipStatus`.
- disabled-state reason selection.
- row-provenance normalization.

### Integration Tests

- `GET /api/recruiting/{file}` returns Bynum, Ekanem, and Tabor from the supplied `week-0` fixture.
- Bynum preview shows Social Media + DM Player as `15/50`.
- Ekanem preview shows scholarship offered with value `65`.
- Tabor preview shows scholarship offered with value `0`.
- Preseason fixture marks offer/action/visit writes unavailable.
- Desktop shell can start or connect to the backend health endpoint in a local test/dev mode.

### UI Tests

- Recruiting tab renders counters and target list.
- Selecting a target updates profile, actions, scouting, and motivations.
- Research-gated write controls are visibly disabled.
- Staged planning does not enable apply while gates are blocked.
- Desktop mode exposes native open/save affordances without changing the underlying recruiting board behavior.

## Acceptance Criteria

- `/recruiting` exists as a dedicated app view.
- The same workbench can be delivered through a browser route and an optional desktop app shell.
- Desktop packaging has a documented path, startup behavior, and save-selection workflow, even if the first implementation lands as a development shell before a distributable installer.
- The supplied `week-0` fixture can be read into a useful recruiting board without writing save bytes.
- The UI clearly shows why writes are unavailable.
- Future write work has a defined API and validation path but remains gated by requirements 015 and 016.

## Dependencies

- Archived requirement 007 safe copy-first writer.
- Archived requirement 014 joined recruiting profile and market fields.
- Requirement 015 action and board state research.
- Requirement 016 upstream CFB27 recruiting code and data import.
- Validated 016 capability metadata for existing game-created active pitch rows; forced active-pitch allocation and scouting-grade writes remain gated.
- Desktop shell implementation choice, with Electron preferred unless a better local wrapper is proven.
- Local schema files in `schema/`.

## Rollout Plan

1. Ship read-only `/recruiting` board and selected-target detail in the existing browser/server flow.
2. Add a desktop shell proof of concept that starts/connects to the backend and opens the same UI.
3. Add app-local action planning and validation shared by browser and desktop.
4. Add diff-report import/export for research fixtures.
5. Enable one action family at a time after requirement 016 recipe gates pass.
6. Add optional generator/workbench merge context only after both sides share stable row ids, capability metadata, and sidecar schemas.
