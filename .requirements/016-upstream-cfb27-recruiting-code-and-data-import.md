# 016 - Upstream CFB27 Recruiting Code And Data Import

## Status

- Status: Complete
- Owner: Unassigned
- Last updated: 2026-07-05
- Source: User request; requirement 015 findings; upstream repositories `jwbw29/My-CFB-Dynasty-Manager` and `bphit4/FB-Roster-Editor`
- Phase: Completed upstream import and recruiting probe hardening

## Summary

Requirement 015 produced enough local evidence to call the first recruiting action research checkpoint complete. The next step is to pull the useful code, schema assets, tuning data, and workflow patterns from related open-source projects so the editor stops relying on slow one-off in-game validation for every field.

This requirement is intentionally focused on upstream mining and selective import. `FB-Roster-Editor` has concrete CFB27 dynasty format handling, CFB27 schema/data assets, and recruiting tuning table leads. `My-CFB-Dynasty-Manager` is mostly a manual tracker, but it has useful team/logo assets and recruiting workflow ideas. We should use both as accelerators while preserving this project's copy-first save safety model.

## Problem

The current recruiting implementation has proven several write paths, but unresolved action families still require too much manual save editing and in-game checking. Scouting, Send the House, some feedback chains, visit variants, and tuning enum labels are not yet decoded enough for a browser workbench.

External projects already contain CFB27-oriented schema files, table summaries, dynasty file detection logic, OVR/archetype reference data, and UI/workflow ideas. Ignoring those sources would waste time; importing them carelessly could also mix incompatible roster-editor assumptions into the dynasty save writer.

## Goals

- Vendor or snapshot upstream research inputs with clear provenance and commit hashes.
- Mine `FB-Roster-Editor` for CFB27 dynasty schema assets, container detection, batch export patterns, recruiting tuning table names, OVR weights, and archetype data.
- Mine `My-CFB-Dynasty-Manager` for team/logo/color assets and recruiting workflow ideas only where licensing and fit are acceptable.
- Convert upstream recruiting tuning tables into local normalized research artifacts.
- Use upstream data to harden action labels, enum maps, visit metadata, pitch metadata, scouting semantics, and feedback chains.
- Promote positively validated 015 recipes into guarded helper code while keeping incomplete recipes gated.

## Non-Goals

- Do not wholesale replace this editor with either upstream app.
- Do not import Madden roster `.db` rebuild logic into dynasty save writes.
- Do not import Character Visuals encoding into the recruiting workflow.
- Do not enable scouting, Send the House, sell, sway, or commit writes from upstream assumptions alone.
- Do not remove copy-first output, backup, fingerprint, or read-back validation.

## User Workflow

1. Developer runs an upstream mining command against pinned upstream repo snapshots.
2. The command extracts CFB27 schema, tuning, enum, and reference data into local research artifacts.
3. The app uses normalized artifacts to decode recruiting tables more accurately.
4. Developer promotes supported recipes into guarded probe/apply helpers.
5. User validates fewer, larger in-game batches instead of slow one-field probes.

## Research Gates

| Gate | Question | Method | Evidence Required | Blocks |
| ---- | -------- | ------ | ----------------- | ------ |
| RG-33 | Which upstream assets are safe and useful to vendor? | Review repo licenses, file provenance, and overlap with local code. | Imported manifest with source URL, commit hash, selected files, and rationale. | Any vendored upstream files. |
| RG-34 | Can upstream CFB27 tuning tables map recruiting action, pitch, visit, and motivation enums? | Export or parse `dynasty-tuning-binary` tables from `FB-Roster-Editor` assets. | Normalized JSON artifacts and decoded labels matched against 015 fixtures. | Enum-backed UI labels and recipe automation. |
| RG-35 | Can upstream dynasty format detection improve local load validation? | Compare upstream detection with local `FBCHUNKS`/`FrTk` handling across fixtures. | Tests for active saves, decompressed payloads, standalone `.FTC`, and unsupported files. | Broader open/load support. |
| RG-36 | Which incomplete 015 recipes can be completed with upstream tuning plus manual diff chains? | Reconcile upstream table metadata with manual scouting, visit, and Send the House diffs. | Recipe docs with all changed rows, feedback chains, board-hour reconciliation, and game screenshots. | Scouting, Send the House, sell, sway, and commit writes. |

## Data Model

`UpstreamResearchSource`:

```json
{
  "repo": "bphit4/FB-Roster-Editor",
  "url": "https://github.com/bphit4/FB-Roster-Editor",
  "commit": "9e91540e9ff72a6aa953a21ec86a122f8278e82d",
  "files": [],
  "importedAt": "2026-07-05",
  "usage": "cfb27-schema-and-recruiting-tuning"
}
```

`RecruitingTuningMap`:

- source table path and unique id.
- enum name and decoded labels.
- action cost, action type, intensity, scope, and lock metadata where present.
- visit activity, visit week type, visit stakes, pitch, motivation, and grade mappings.
- confidence and matched local evidence from requirement 015.

## Field Safety

### Writable Now

- `UserRecruitTarget.SearchSocialMedia`: validated in game through 015 probes.
- `UserRecruitTarget.ContactHighSchoolCoaches`: validated in game through 015 probes.
- `UserRecruitTarget.ContactFriendsAndFamily`: validated in game through 015 probes.
- `UserRecruitTarget.ScholarshipStatus` plus `CurrentNILOffer`: validated in game for offer/NIL display and scholarship counter.
- `UserRecruitTarget.IsFavorite`: validated in game for board/profile favorite star.
- Existing-interaction visit scheduling chain: validated in game for a target with compatible row provenance.
- Existing game-created `UserRecruitTarget.ActivePitches` rows: validated for copy-first pitch and intensity edits through natural active-pitch probes. Pitch-only and Hard Sell intensity edits loaded and survived week advance; Sway intensity displayed correctly in game and was accepted as the final 016 manual check.

### Writable After Research

- `UserRecruitTarget.SendTheHouse` plus related fields: RG-36.
- `UserRecruitTarget.VisitRecruitsSchool`: RG-36.
- `ProspectInteraction.TimesScouted` and scouting feedback chains: RG-36.
- New `ActiveRecruitingPitch` allocation and new `UserRecruitTarget.ActivePitches` references: deferred outside 016.
  - Seeded active-pitch row/list allocation is currently blocked: `DYNASTY-JUL02-07h43m00-AUTOSAVE-MODDED-SEEDED-SWAY-016-20260705` parsed locally but failed to load in game.
  - Empty `UserRecruitTarget.ActivePitches` list slots must be treated as empty; all-zero reference slots are not valid active-pitch rows.
  - SwayPitch-only isolation loaded after being renamed to `DYNASTY-JUL02-07h43m00-AUTOSAVE` and survived a week advance.
  - Explicit row-only patching of `ActiveRecruitingPitch[1164]` is blocked because that row is empty/unavailable in the baseline.
  - Current post-advance board has no populated `UserRecruitTarget.ActivePitches` rows; true sell/sway testing needs a manual game-created active-pitch fixture first.
  - Kenyon Tabor is locked out in the game UI despite looking clean in save data; manual fixture candidates must be UI-confirmed sell/sway-enabled.
  - Manual in-game setup captured naturally linked active-pitch rows for Stanley Herron, Jamie Martini, and Teddy Krenzel. The first safe follow-up probe changes only Teddy Krenzel's existing `ActiveRecruitingPitch[1347].Pitch` from Coach Connection to College Experience while preserving Soft Sell intensity and 20h cost.
  - That natural pitch-only probe loaded and survived a week advance. Existing game-created `UserRecruitTarget.ActivePitches` pitch changes are now validated for load/week survival.
  - The next probe changes only Teddy Krenzel's existing `ActiveRecruitingPitch[1347].Intensity` from Soft Sell to Hard Sell while preserving College Experience. Board-hour fields are intentionally untouched for the first intensity isolation.
  - The natural Hard Sell intensity probe loaded and survived a week advance. Existing game-created `UserRecruitTarget.ActivePitches` sell intensity edits now have load/week-surviving evidence.
  - The final Sway probe changed Teddy Krenzel's existing `ActiveRecruitingPitch[1347].Intensity` from Hard Sell to Sway while preserving College Experience. Board-hour fields were intentionally untouched for the sway isolation. The game displayed Sway correctly; no additional manual week-advance testing is required for 016.
- `RecruitingActionFeedbackEntry` and `RecruitingActionBonus`: RG-34 and RG-36.

### Preserve By Default

- `RecruitTarget` influence/top-school state until ownership and recalculation are proven.
- Team budget and remaining-point fields until authoritative counters are decoded.
- Character Visuals, roster `.db`, and player appearance encoders from upstream projects.

## Algorithm Requirements

1. Clone or fetch upstream repos into a cache directory pinned by commit hash.
2. Build a manifest listing every copied or mined file, source URL, commit, local path, license note, and reason.
3. Extract `FB-Roster-Editor` CFB27 files:
   - `backend/data/cfb27/Dynasty_Files`
   - `backend/data/cfb27/CFB27 OVR Weights Archetypes.json`
   - `backend/data/cfb27/CFB27-Archetypes.csv`
   - `backend/data/test-cfb27-open-verification/*_summary.json`
4. Extract or regenerate recruiting tuning table JSON/CSV for tables named in the `dynasty-tuning-binary` summary.
5. Normalize the data into `.requirements/research/upstream-*` artifacts.
6. Compare upstream enum/tuning labels to the local 015 fixtures and manual diffs.
7. Promote matching labels into local decode helpers and tests.
8. Add guarded recipe helpers only after local read-back and game validation evidence exists.

## Validation Requirements

- Every imported artifact must carry source repo, source commit, and local generation command.
- Upstream-derived labels must match at least one local fixture before being presented as high confidence.
- Write helpers must still run through copy-first save output, source fingerprint checks, read-back diff, and backup handling.
- Scouting, seeded sell/sway allocation, and active-pitch allocation remain blocked/deferred until game validation proves the complete multi-row recipe. Existing naturally linked active-pitch pitch edits and sell/sway intensity edits are promoted as validated helper behavior for existing rows only.
- Use default-style save names for in-game validation when possible; long `*-MODDED-*` names are useful local artifacts but may not behave like normal game saves.

## Test Plan

### Unit Tests

- upstream manifest parser rejects missing commit/source metadata.
- normalized tuning maps preserve table ids, unique ids, and source filenames.
- action cost labels from upstream data match known 015 action costs.
- dynasty format detection accepts known `FBCHUNKS`, `FrTk`, and standalone CFB27 binary fixtures.

### Integration Tests

- upstream mining command produces deterministic artifacts from pinned commits.
- recruiting diff reports use upstream labels without changing raw values.
- guarded probe helpers reject unsupported Send the House and scouting recipes until RG-36 passes.

### Fixture/Research Tests

- compare upstream `RecruitingQuickAction` and `RecruitingActionInfo` data to validated Social Media, DM Player, Friends and Family, scholarship, favorite, and visit evidence.
- compare manual Teddy scouting diff against upstream scouting action metadata.
- compare manual Stanley Send the House diff against upstream action metadata and identify missing fields.

## Acceptance Criteria

- 015 is closed as a completed research checkpoint.
- Existing 016 workbench requirement is renumbered to 017.
- Upstream repositories are documented with pinned commit hashes and import scope.
- A repeatable local command or documented process extracts upstream CFB27 recruiting/tuning artifacts.
- The project has normalized upstream research artifacts ready to drive recipe hardening.
- No new unsafe writes are enabled solely because an upstream repo contains related code.
- Natural sell/sway helper support is limited to already-linked, game-created active pitch rows; forced row/list allocation is deferred to later research.

## Dependencies

- Requirement 015 recruiting actions and board state research.
- Requirement 017 recruiting workbench page.
- Archived requirement 007 safe copy-first writer.
- Local `FBCHUNKS` parsing and recruiting diff/probe tools.

## Rollout Plan

1. Document upstream scope and pinned commits.
2. Import/minimize schema, tuning, and reference artifacts into research output.
3. Add decode helpers and tests for upstream recruiting labels.
4. Feed stable read/decode/write capabilities into requirement 017.
5. Leave scouting-grade proof, forced active-pitch allocation, and remaining feedback-chain research to later requirements.

## Open Questions

- What license constraints apply to copying logos, team data, and schema-like assets from each repo?
- Are the upstream tuning table exports complete in Git, or do we need to run their bridge locally to regenerate table JSON?
- Which missing Send the House field is authoritative: `VisitRecruitsSchool`, feedback rows, action type metadata, or another board/interactions field?
- Can scouting percentage be written through feedback chains alone, or does the game recalculate revealed scouting from hidden prospect data?
- Deferred after 016: true `ScoutingGrade` label evidence and forced active-pitch allocation need separate fixtures before UI write enablement.
