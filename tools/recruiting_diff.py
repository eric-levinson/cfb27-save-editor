from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path


APP_DIR = Path(__file__).resolve().parents[1]
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from server import FBChunks  # noqa: E402


DEFAULT_DECODE_MAPS = APP_DIR / ".requirements" / "research" / "upstream-cfb27-recruiting-decode-maps.json"


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def load_save_to_payload(source: Path, target: Path) -> dict:
    source_bytes = source.read_bytes()
    container = FBChunks.parse(source_bytes)
    target.write_bytes(container.decompressed_payload)
    return {
        "path": str(source),
        "file": source.name,
        "saveSha256": sha256_hex(source_bytes),
        "payloadSha256": sha256_hex(container.decompressed_payload),
        "payloadBytes": len(container.decompressed_payload),
        "tailBytes": len(container.tail),
    }


def run_node_recruiting_diff(
    before_payload: Path,
    after_payload: Path,
    before_label: str,
    after_label: str,
) -> dict:
    command = [
        "node",
        str(APP_DIR / "franchise_helper.js"),
        "recruiting-diff",
        str(before_payload),
        str(after_payload),
        before_label,
        after_label,
    ]
    completed = subprocess.run(
        command,
        cwd=APP_DIR,
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
    )
    return json.loads(completed.stdout)


def changed_table_rows(report: dict, table: str) -> int:
    diff = report.get("tableDiffs", {}).get(table, {})
    return int(diff.get("addedRowCount", 0)) + int(diff.get("removedRowCount", 0)) + int(diff.get("changedRowCount", 0))


def load_decode_maps(path: Path | None) -> dict | None:
    if not path or not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def decode_lookup(mapping: dict, value: object) -> dict | None:
    if value is None:
        return None
    if isinstance(value, int):
        keys = [f"0b{value:b}", str(value)]
    else:
        keys = [str(value)]
    raw = str(value)
    if raw and set(raw) <= {"0", "1"}:
        keys.append(str(int(raw, 2)))
        keys.append(f"0b{raw}")
    for key in dict.fromkeys(keys):
        if key in mapping:
            return mapping[key]
    return None


def binary_reference(value: object) -> dict | None:
    raw = str(value) if value is not None else ""
    if len(raw) != 32 or set(raw) - {"0", "1"}:
        return None
    return {
        "tableId": int(raw[:15], 2),
        "row": int(raw[15:], 2),
    }


def label_for_decoded(decoded: dict | None) -> str | None:
    if not decoded:
        return None
    return decoded.get("shortName") or decoded.get("longName") or decoded.get("description")


def decode_enum_value(
    decode_maps: dict | None,
    enum_name: str,
    value: object,
    *,
    raw: object | None = None,
    method: str | None = None,
    confidence: str | None = None,
) -> dict | None:
    if not decode_maps:
        return None
    decoded = decode_lookup((decode_maps.get("enums") or {}).get(enum_name, {}), value)
    if not decoded:
        return None
    out = {"enum": enum_name, **decoded}
    if raw is not None:
        out["raw"] = raw
    if method:
        out["decodeMethod"] = method
    if confidence:
        out["confidence"] = confidence
    return out


def decode_binary_prefix(
    decode_maps: dict | None,
    enum_name: str,
    raw: object,
    width: int,
    method: str,
) -> dict | None:
    bits = str(raw) if raw is not None else ""
    if len(bits) < width or set(bits) - {"0", "1"}:
        return None
    prefix = bits[:width]
    return decode_enum_value(
        decode_maps,
        enum_name,
        prefix,
        raw=bits,
        method=method,
        confidence="matched-fixture-read-label",
    )


def decode_active_visit_activity(decode_maps: dict | None, value: object) -> dict | None:
    if not decode_maps or value is None:
        return None
    raw = str(value)
    if not raw or set(raw) - {"0", "1"}:
        return None
    low_nibble = int(raw, 2) & 0xF
    mapping = ((decode_maps.get("derived") or {}).get("activeVisitInfoActivityLowNibble") or {})
    decoded = mapping.get(str(low_nibble))
    if not decoded:
        return None
    return {
        "enum": "VisitActivityType",
        "decodeMethod": "active-visit-activity-low-nibble",
        "confidence": "medium-read-only-fixture-label",
        "raw": raw,
        "lowNibble": low_nibble,
        **decoded,
    }


def unresolved_reference_window(value: object, field: str) -> dict | None:
    ref = binary_reference(value)
    if not ref:
        return None
    return {
        "field": field,
        "raw": str(value),
        "reference": ref,
        "status": "unresolved-reference-window",
        "confidence": "blocked-rg36",
        "note": "madden-franchise exposes this as a reference-sized bit window; do not treat the raw value as a direct enum label.",
    }


def decode_field_value(decode_maps: dict | None, table: str, field: str, value: object) -> dict | None:
    if not decode_maps:
        return None
    enum_name = None
    if field in {"RecruitingActionType", "ActionType"}:
        enum_name = "RecruitingActionType"
    elif field in {"RecruitingActionIntensity", "Intensity"}:
        enum_name = "RecruitingActionIntensity"
    elif field in {"VisitActivityType", "Activity"}:
        enum_name = "VisitActivityType"
    elif field in {"RecruitingPitchType", "PitchType", "Pitch"}:
        enum_name = "RecruitingPitchType"
    elif field in {"RecruitingMotivation", "Motivation", "MotivationType"}:
        enum_name = "RecruitingMotivation"
    elif field == "BonusValueType":
        enum_name = "RecruitingBonusValueType"
    elif field == "BonusType":
        enum_name = "RecruitingBonusType"
    elif "ScoutingGrade" in field:
        enum_name = "ScoutingGrade"
    if not enum_name:
        return None
    return decode_enum_value(decode_maps, enum_name, value)


def enrich_recruiting_profile(state: dict, decode_maps: dict | None) -> None:
    profile = state.get("recruitingProfile") or {}
    if not profile or not decode_maps:
        return
    decodes = {}
    dealbreaker = decode_binary_prefix(
        decode_maps,
        "RecruitingMotivation",
        profile.get("dealbreakerRaw"),
        4,
        "player-recruiting-dealbreaker-high-nibble",
    )
    if dealbreaker:
        decodes["dealbreaker"] = dealbreaker
    ideal_pitch = decode_binary_prefix(
        decode_maps,
        "RecruitingPitchType",
        profile.get("idealPitchRaw"),
        5,
        "player-ideal-recruiting-pitch-high-five-bits",
    )
    if ideal_pitch:
        decodes["idealPitch"] = ideal_pitch
    motivations = []
    for field in ("motivation1Raw", "motivation2Raw", "motivation3Raw"):
        raw = profile.get(field)
        decoded = decode_enum_value(
            decode_maps,
            "RecruitingMotivation",
            raw,
            raw=raw,
            method=f"player-{field}",
            confidence="matched-fixture-read-label",
        )
        if decoded:
            motivations.append({"field": field, **decoded})
    if motivations:
        decodes["motivations"] = motivations
    if decodes:
        profile["decoded"] = decodes


def decode_changed_value(decode_maps: dict | None, table: str, field: str, change: dict) -> dict | None:
    before = decode_field_value(decode_maps, table, field, change.get("before"))
    after = decode_field_value(decode_maps, table, field, change.get("after"))
    if not before and not after:
        return None
    return {"before": before, "after": after}


def enrich_row_detail(row: dict, table: str, decode_maps: dict | None) -> None:
    decoded_fields = {}
    for field, value in (row.get("fields") or {}).items():
        if isinstance(value, dict) and ("before" in value or "after" in value):
            decoded = decode_changed_value(decode_maps, table, field, value)
        else:
            decoded = decode_field_value(decode_maps, table, field, value)
        if decoded:
            decoded_fields[field] = decoded
    if decoded_fields:
        row["decodedFields"] = decoded_fields


def enrich_visit_state(state: dict, decode_maps: dict | None) -> None:
    if not state or not decode_maps:
        return
    scheduled = state.get("scheduledVisit") or {}
    activity = decode_active_visit_activity(decode_maps, scheduled.get("activity"))
    visit_decodes = {}
    if activity:
        scheduled["activityDecoded"] = activity
        visit_decodes["activeVisitActivity"] = activity
    prospect = state.get("prospectVisitState") or {}
    prospect_activity = unresolved_reference_window(
        prospect.get("visitActivityType"),
        "ProspectInteraction.VisitActivityType",
    )
    if prospect_activity:
        prospect["visitActivityTypeDecode"] = prospect_activity
        visit_decodes["prospectInteractionVisitActivity"] = prospect_activity
    prospect_week = unresolved_reference_window(
        prospect.get("visitWeekType"),
        "ProspectInteraction.VisitWeekType",
    )
    if prospect_week:
        prospect["visitWeekTypeDecode"] = prospect_week
        visit_decodes["prospectInteractionVisitWeekType"] = prospect_week
    if visit_decodes:
        state["visitDecodes"] = visit_decodes


def rows_with_delta(diff: dict, key: str, delta: str) -> list[dict]:
    return [dict(row, delta=delta) for row in diff.get(key) or []]


def changed_value_display(value: object) -> object:
    if isinstance(value, dict) and ("before" in value or "after" in value):
        return value.get("after")
    return value


def reference_display(ref: dict | None) -> str:
    if not ref:
        return "-"
    table = ref.get("table") or f"tableId {ref.get('tableId')}"
    return f"{table}:{ref.get('row')}"


def decoded_label(row: dict, field: str) -> str:
    decoded = (row.get("decodedFields") or {}).get(field)
    if not decoded:
        return "-"
    if "after" in decoded or "before" in decoded:
        decoded = decoded.get("after") or decoded.get("before")
    return label_for_decoded(decoded) or "-"


def build_recruiting_action_evidence(report: dict) -> dict:
    table_diffs = report.get("tableDiffs") or {}
    feedback_diff = table_diffs.get("RecruitingActionFeedbackEntry") or {}
    bonus_diff = table_diffs.get("RecruitingActionBonus") or {}
    feedback_list_diff = table_diffs.get("RecruitingActionFeedbackEntry[]") or {}
    bonus_list_diff = table_diffs.get("RecruitingActionBonus[]") or {}

    feedback_rows = (
        rows_with_delta(feedback_diff, "addedRowDetails", "added")
        + rows_with_delta(feedback_diff, "changedRows", "changed")
        + rows_with_delta(feedback_diff, "removedRowDetails", "removed")
    )
    bonus_rows = (
        rows_with_delta(bonus_diff, "addedRowDetails", "added")
        + rows_with_delta(bonus_diff, "changedRows", "changed")
        + rows_with_delta(bonus_diff, "removedRowDetails", "removed")
    )
    feedback_list_rows = rows_with_delta(feedback_list_diff, "addedRowDetails", "added")
    bonus_list_rows = rows_with_delta(bonus_list_diff, "addedRowDetails", "added")

    bonus_by_row = {row.get("row"): row for row in bonus_rows}
    bonus_rows_by_list = {}
    for list_row in bonus_list_rows:
        refs = []
        for field, ref in (list_row.get("references") or {}).items():
            if ref.get("table") == "RecruitingActionBonus":
                refs.append({"field": field, "row": ref.get("row"), "detail": bonus_by_row.get(ref.get("row"))})
        if refs:
            bonus_rows_by_list[list_row.get("row")] = refs

    feedback_entries = []
    for row in feedback_rows:
        fields = row.get("fields") or {}
        refs = row.get("references") or {}
        bonus_list_ref = refs.get("BonusList")
        linked_bonus_refs = bonus_rows_by_list.get(bonus_list_ref.get("row") if bonus_list_ref else None, [])
        linked_bonuses = []
        for linked in linked_bonus_refs:
            detail = linked.get("detail") or {}
            linked_bonuses.append({
                "field": linked.get("field"),
                "row": linked.get("row"),
                "valueType": decoded_label(detail, "BonusValueType"),
                "value": changed_value_display((detail.get("fields") or {}).get("BonusValue")),
                "type": decoded_label(detail, "BonusType"),
            })
        feedback_entries.append({
            "row": row.get("row"),
            "delta": row.get("delta"),
            "action": decoded_label(row, "RecruitingActionType"),
            "hoursSpent": changed_value_display(fields.get("HoursSpent")),
            "influenceGained": changed_value_display(fields.get("InfluenceGained")),
            "minInfluenceGain": changed_value_display(fields.get("MinInfluenceGain")),
            "maxInfluenceGain": changed_value_display(fields.get("MaxInfluenceGain")),
            "intelUnlocked": changed_value_display(fields.get("IntelUnlocked")),
            "intensity": decoded_label(row, "RecruitingActionIntensity"),
            "intensityReference": refs.get("RecruitingActionIntensity"),
            "bonusListReference": bonus_list_ref,
            "linkedBonuses": linked_bonuses,
        })

    bonuses = []
    for row in bonus_rows:
        fields = row.get("fields") or {}
        bonuses.append({
            "row": row.get("row"),
            "delta": row.get("delta"),
            "bonusType": decoded_label(row, "BonusType"),
            "bonusTypeReference": (row.get("references") or {}).get("BonusType"),
            "bonusValueType": decoded_label(row, "BonusValueType"),
            "bonusValue": changed_value_display(fields.get("BonusValue")),
        })

    if not feedback_entries and not bonuses and not feedback_list_rows and not bonus_list_rows:
        return {}
    return {
        "feedbackEntries": feedback_entries,
        "bonuses": bonuses,
        "feedbackListRows": [
            {
                "row": row.get("row"),
                "delta": row.get("delta"),
                "references": list((row.get("references") or {}).values()),
            }
            for row in feedback_list_rows
        ],
        "bonusListRows": [
            {
                "row": row.get("row"),
                "delta": row.get("delta"),
                "references": list((row.get("references") or {}).values()),
            }
            for row in bonus_list_rows
        ],
        "writeRecipesEnabled": False,
    }


def enrich_report_with_decodes(report: dict, decode_maps: dict | None) -> dict:
    if not decode_maps:
        return report
    weekly = decode_maps.get("weeklyActionFields") or {}
    for target in report.get("boardTargets", []):
        for state_key in ("before", "after"):
            state = target.get(state_key) or {}
            enrich_recruiting_profile(state, decode_maps)
            enrich_visit_state(state, decode_maps)
            details = []
            for field, enabled in (state.get("actionBooleans") or {}).items():
                if not enabled:
                    continue
                mapped = weekly.get(field)
                if mapped:
                    details.append(mapped)
            if details:
                state["selectedActionDetails"] = details
    for diff in (report.get("tableDiffs") or {}).values():
        table = diff.get("name") or ""
        for row in diff.get("addedRowDetails") or []:
            enrich_row_detail(row, table, decode_maps)
        for row in diff.get("removedRowDetails") or []:
            enrich_row_detail(row, table, decode_maps)
        for row in diff.get("changedRows") or []:
            enrich_row_detail(row, table, decode_maps)
    for item in (report.get("visitEvidence") or {}).get("targets") or []:
        enrich_visit_state(item.get("before") or {}, decode_maps)
        enrich_visit_state(item.get("after") or {}, decode_maps)
    action_evidence = build_recruiting_action_evidence(report)
    if action_evidence:
        report["recruitingActionEvidence"] = action_evidence
    report["upstreamDecodes"] = {
        "kind": decode_maps.get("kind"),
        "source": decode_maps.get("source"),
        "writeRecipesEnabled": False,
        "weeklyActionFields": weekly,
        "enumMaps": {
            name: len(values)
            for name, values in (decode_maps.get("enums") or {}).items()
        },
        "derivedMaps": {
            name: len(values)
            for name, values in (decode_maps.get("derived") or {}).items()
        },
    }
    return report


def action_display(state: dict) -> str:
    details = state.get("selectedActionDetails") or []
    if not details:
        return ", ".join(state.get("selectedActions") or []) or "-"
    labels = []
    for detail in details:
        upstream = detail.get("upstream") or {}
        action = upstream.get("action") or {}
        label = action.get("shortName") or action.get("longName") or detail.get("field")
        cost = upstream.get("cost")
        status = detail.get("status")
        labels.append(f"{label} [{detail.get('field')}, {cost}h, {status}]")
    return ", ".join(labels) or "-"


def format_visit_state(state: dict) -> str:
    visit = state.get("scheduledVisit")
    prospect = state.get("prospectVisitState") or {}
    if visit:
        activity = label_for_decoded(visit.get("activityDecoded"))
        activity_text = f" {activity}" if activity else ""
        return f"ActiveVisitInfo:{visit.get('row')} W{visit.get('weekNumber')} type {visit.get('weekType')}{activity_text}"
    if prospect.get("isVisitScheduled"):
        activity_decode = prospect.get("visitActivityTypeDecode") or {}
        ref = activity_decode.get("reference") or {}
        ref_text = (
            f" PI activity unresolved ref {ref.get('tableId')}:{ref.get('row')}"
            if ref else ""
        )
        return f"scheduled W{prospect.get('visitWeekNumber')}{ref_text}"
    return "-"


def bonus_display(bonus: dict) -> str:
    if not bonus:
        return "-"
    row = bonus.get("row")
    value_type = bonus.get("valueType") or bonus.get("bonusValueType") or "-"
    value = bonus.get("value") if "value" in bonus else bonus.get("bonusValue")
    bonus_type = bonus.get("type") or bonus.get("bonusType") or "-"
    return f"{row}: {value_type} {value} ({bonus_type})"


def profile_decode_label(state: dict, key: str) -> str:
    decoded = (((state.get("recruitingProfile") or {}).get("decoded") or {}).get(key))
    return label_for_decoded(decoded) or "-"


def active_pitch_summary(pitches: list[dict]) -> str:
    if not pitches:
        return "-"
    return ", ".join(
        f"{item.get('row')}:{item.get('pitch')}/{item.get('intensity')}"
        for item in pitches
    )


def markdown_report(report: dict) -> str:
    before = report["before"]
    after = report["after"]
    fixture_context = report.get("fixtureContext", {})
    lines = [
        f"# Recruiting Diff: {before['label']} to {after['label']}",
        "",
        "Read-only fixture diff generated from full `FBCHUNKS` dynasty saves.",
        "",
        "## Save Fingerprints",
        "",
        "| Fixture | Save SHA-256 | Payload SHA-256 | Payload Bytes | Tail Bytes |",
        "| ------- | ------------ | --------------- | ------------: | ---------: |",
        (
            f"| {before['label']} | `{before['saveSha256']}` | `{before['payloadSha256']}` | "
            f"{before['payloadBytes']} | {before['tailBytes']} |"
        ),
        (
            f"| {after['label']} | `{after['saveSha256']}` | `{after['payloadSha256']}` | "
            f"{after['payloadBytes']} | {after['tailBytes']} |"
        ),
        "",
    ]
    if fixture_context:
        lines.extend([
            "## Fixture Context",
            "",
            f"- User team: {fixture_context.get('userTeam') or 'unknown'}",
            "",
        ])
    upstream_decodes = report.get("upstreamDecodes") or {}
    if upstream_decodes:
        weekly_count = len(upstream_decodes.get("weeklyActionFields") or {})
        derived_count = len(upstream_decodes.get("derivedMaps") or {})
        lines.extend([
            "## Upstream Decodes",
            "",
            f"- Decode artifact: `{upstream_decodes.get('kind')}`.",
            f"- Weekly action fields mapped: {weekly_count}.",
            f"- Derived visit label maps: {derived_count}.",
            "- `ActiveVisitInfo.Activity` labels use a read-only low-nibble match against upstream visit activity tuning.",
            "- `ProspectInteraction` visit activity/week bit windows remain unresolved references and are not write-safe.",
            "- Decode labels are report aids only; write recipes remain gated by local validation.",
            "",
        ])
    save_comparison = report.get("saveComparison", {})
    if save_comparison:
        lines.extend([
            "## Save Comparison",
            "",
            f"- Same save bytes: {str(save_comparison.get('sameSaveBytes')).lower()}",
            f"- Same decompressed payload bytes: {str(save_comparison.get('samePayloadBytes')).lower()}",
            "",
        ])
    lines.extend([
        "## Table Delta Summary",
        "",
        "| Table | Non-empty Before | Non-empty After | Added | Removed | Changed | Top Changed Fields |",
        "| ----- | ---------------: | --------------: | ----: | ------: | ------: | ------------------ |",
    ])
    for table, diff in report.get("tableDiffs", {}).items():
        counts = sorted(
            diff.get("fieldChangeCounts", {}).items(),
            key=lambda item: (-item[1], item[0]),
        )
        top_fields = ", ".join(f"{field} ({count})" for field, count in counts[:6]) or "-"
        lines.append(
            f"| `{table}` | {diff.get('beforeNonEmptyRows', 0)} | {diff.get('afterNonEmptyRows', 0)} | "
            f"{diff.get('addedRowCount', 0)} | {diff.get('removedRowCount', 0)} | "
            f"{diff.get('changedRowCount', 0)} | {top_fields} |"
        )

    lines.extend([
        "",
        "## Board Counter Candidates",
        "",
        "| Board Row | Evidence | Target Rows | Targets | Before Hours | After Hours | After Selected Action Hours | Scholarships | Visits |",
        "| --------: | -------- | ----------- | ------: | ------------ | ----------- | --------------------------: | ------------ | -----: |",
    ])
    for candidate in report.get("boardCandidates", []):
        visible = candidate.get("derivedVisibleHours", {})
        target_rows = ", ".join(str(row) for row in candidate.get("userRecruitTargetRows", [])) or "-"
        before_hours = f"{visible.get('beforeUsed')}/{visible.get('beforeMax')}"
        after_hours = f"{visible.get('afterUsed')}/{visible.get('afterMax')}"
        target_count = f"{candidate.get('derivedBeforeTargetCount')}/{candidate.get('derivedAfterTargetCount')}"
        scholarship_count = (
            f"{candidate.get('derivedBeforeScholarshipCount')}/"
            f"{candidate.get('derivedAfterScholarshipCount')}"
        )
        visit_count = (
            f"{candidate.get('derivedBeforeScheduledVisitCount')}/"
            f"{candidate.get('derivedAfterScheduledVisitCount')}"
        )
        lines.append(
            f"| {candidate.get('row')} | {candidate.get('evidence')} | {target_rows} | "
            f"{target_count} | {before_hours} | {after_hours} | "
            f"{candidate.get('derivedAfterSelectedActionHours')} | {scholarship_count} | {visit_count} |"
        )

    visit_evidence = report.get("visitEvidence", {})
    lines.extend([
        "",
        "## Scheduled Visit Evidence",
        "",
        (
            f"- Scheduled target count: {visit_evidence.get('scheduledTargetCountBefore', 0)} before, "
            f"{visit_evidence.get('scheduledTargetCountAfter', 0)} after."
        ),
        f"- New scheduled target rows: {', '.join(str(row) for row in visit_evidence.get('newScheduledTargetRows', [])) or '-'}",
        f"- Changed scheduled target rows: {', '.join(str(row) for row in visit_evidence.get('changedScheduledTargetRows', [])) or '-'}",
        f"- Unchanged scheduled target rows: {', '.join(str(row) for row in visit_evidence.get('unchangedScheduledTargetRows', [])) or '-'}",
        "",
        "| Row | Recruit | Status | Before Visit | After Visit | After Consistent | Changed URT Fields | Changed PI Rows |",
        "| --: | ------- | ------ | ------------ | ----------- | ---------------- | ------------------ | --------------- |",
    ])
    for item in visit_evidence.get("targets", []):
        before_visit = format_visit_state(item.get("before") or {})
        after_visit = format_visit_state(item.get("after") or {})
        after_consistency = item.get("afterConsistency", {})
        changed_fields = ", ".join(item.get("changedUserRecruitTargetFields", [])) or "-"
        changed_pi_rows = ", ".join(str(row) for row in item.get("changedProspectInteractionRows", [])) or "-"
        lines.append(
            f"| {item.get('row')} | {item.get('name') or '-'} | {item.get('status')} | "
            f"{before_visit} | {after_visit} | {str(after_consistency.get('consistent')).lower()} | "
            f"{changed_fields} | {changed_pi_rows} |"
        )

    lines.extend([
        "",
        "## User Board Targets",
        "",
        "| Row | Recruit | Recruit Row | Player Row | Before Actions | After Actions | Before Offer | After Offer | Before Visit | After Visit | Changed URT Fields | Changed ProspectInteraction Rows |",
        "| --: | ------- | ----------: | ---------: | -------------- | ------------- | ------------ | ----------- | ------------ | ----------- | ------------------ | -------------------------------: |",
    ])
    for target in report.get("boardTargets", []):
        before_state = target.get("before") or {}
        after_state = target.get("after") or {}
        before_actions = action_display(before_state)
        after_actions = action_display(after_state)
        before_offer = f"{before_state.get('scholarshipStatus')} / {before_state.get('currentNilOffer')}"
        after_offer = f"{after_state.get('scholarshipStatus')} / {after_state.get('currentNilOffer')}"
        before_visit = format_visit_state(before_state)
        after_visit = format_visit_state(after_state)
        changed_fields = ", ".join(target.get("userRecruitTargetChanges", {}).keys()) or "-"
        lines.append(
            f"| {target.get('row')} | {target.get('name') or '-'} | "
            f"{after_state.get('recruitRow', before_state.get('recruitRow'))} | "
            f"{after_state.get('playerRow', before_state.get('playerRow'))} | "
            f"{before_actions} ({before_state.get('selectedActionHours', 0)}h) | "
            f"{after_actions} ({after_state.get('selectedActionHours', 0)}h) | "
            f"{before_offer} | {after_offer} | "
            f"{before_visit} | {after_visit} | "
            f"{changed_fields} | "
            f"{len(target.get('prospectInteractionChanges', []))} |"
        )

    profile_rows = []
    for target in report.get("boardTargets", []):
        state = target.get("after") or target.get("before") or {}
        decoded = ((state.get("recruitingProfile") or {}).get("decoded") or {})
        if decoded.get("dealbreaker") or decoded.get("idealPitch"):
            profile_rows.append((target, state))
    if profile_rows:
        lines.extend([
            "",
            "## Recruiting Profile Label Evidence",
            "",
            "- These are read-only fixture labels decoded from player profile bit windows; they are not write recipes.",
            "",
            "| Row | Recruit | Dealbreaker Motivation | Ideal Pitch | Production Grade |",
            "| --: | ------- | ---------------------- | ----------- | ---------------- |",
        ])
        for target, state in profile_rows:
            profile = state.get("recruitingProfile") or {}
            lines.append(
                f"| {target.get('row')} | {target.get('name') or '-'} | "
                f"{profile_decode_label(state, 'dealbreaker')} | "
                f"{profile_decode_label(state, 'idealPitch')} | "
                f"{profile.get('productionGrade', '-')} |"
            )

    user_active_pitch_rows = []
    for target in report.get("boardTargets", []):
        before_state = target.get("before") or {}
        after_state = target.get("after") or {}
        if before_state.get("activePitches") or after_state.get("activePitches"):
            user_active_pitch_rows.append((target, before_state, after_state))
    if user_active_pitch_rows:
        lines.extend([
            "",
            "## UserRecruitTarget Active Pitch State",
            "",
            "- These rows are linked directly from `UserRecruitTarget.ActivePitches` and are eligible for copy-first probes only after the game has created the link.",
            "",
            "| Row | Recruit | Before Active Pitches | After Active Pitches |",
            "| --: | ------- | --------------------- | -------------------- |",
        ])
        for target, before_state, after_state in user_active_pitch_rows:
            lines.append(
                f"| {target.get('row')} | {target.get('name') or '-'} | "
                f"{active_pitch_summary(before_state.get('activePitches') or [])} | "
                f"{active_pitch_summary(after_state.get('activePitches') or [])} |"
            )

    recruit_target_pitch_rows = []
    for target in report.get("boardTargets", []):
        state = target.get("after") or target.get("before") or {}
        evidence = state.get("sameRecruitTargetActivePitches") or []
        if evidence:
            recruit_target_pitch_rows.append((target, evidence))
    if recruit_target_pitch_rows:
        lines.extend([
            "",
            "## RecruitTarget Active Pitch Evidence",
            "",
            "- These global `RecruitTarget` rows share the same recruit as user board targets, but ownership is ambiguous and read-only.",
            "",
            "| User Row | Recruit | RecruitTarget Row | Referencing Board Rows | Active Pitch Rows | Status |",
            "| -------: | ------- | ----------------: | ---------------------- | ----------------- | ------ |",
        ])
        for target, evidence in recruit_target_pitch_rows:
            for item in evidence:
                board_rows = ", ".join(str(row) for row in item.get("referencingBoardRows") or []) or "-"
                lines.append(
                    f"| {target.get('row')} | {target.get('name') or '-'} | "
                    f"{item.get('recruitTargetRow')} | {board_rows} | "
                    f"{active_pitch_summary(item.get('activePitches') or [])} | "
                    f"{item.get('ownershipStatus') or 'read-only'} |"
                )

    lines.extend([
        "",
        "## Prospect Interaction Bit Notes",
        "",
        "| Recruit | Interaction Row | Changed Fields | Raw Byte Diffs | Conclusion |",
        "| ------- | --------------: | -------------- | -------------- | ---------- |",
    ])
    for target in report.get("boardTargets", []):
        for interaction_change in target.get("prospectInteractionChanges", []):
            analysis = interaction_change.get("analysis", {})
            changed_fields = ", ".join(analysis.get("changedFields") or interaction_change.get("fields", {}).keys())
            byte_diffs = ", ".join(
                f"byte {diff.get('byte')}: {diff.get('beforeHex')}->{diff.get('afterHex')}"
                for diff in analysis.get("rawByteDiffs", [])
            ) or "-"
            lines.append(
                f"| {target.get('name') or '-'} | {interaction_change.get('row')} | "
                f"{changed_fields or '-'} | {byte_diffs} | {analysis.get('conclusion') or '-'} |"
            )

    action_evidence = report.get("recruitingActionEvidence") or {}
    if action_evidence:
        lines.extend([
            "",
            "## Recruiting Action Evidence",
            "",
            "- Feedback and bonus rows are read-only evidence; write recipes remain disabled.",
            "",
            "| Feedback Row | Delta | Action | Hours | Influence | Intel | Intensity Ref | Bonus List | Linked Bonuses |",
            "| -----------: | ----- | ------ | ----: | --------- | ----: | ------------- | ---------- | -------------- |",
        ])
        for entry in action_evidence.get("feedbackEntries") or []:
            influence = (
                f"{entry.get('influenceGained')} "
                f"({entry.get('minInfluenceGain')}-{entry.get('maxInfluenceGain')})"
            )
            linked = ", ".join(bonus_display(bonus) for bonus in entry.get("linkedBonuses") or []) or "-"
            lines.append(
                f"| {entry.get('row')} | {entry.get('delta')} | {entry.get('action')} | "
                f"{entry.get('hoursSpent')} | {influence} | {entry.get('intelUnlocked')} | "
                f"{reference_display(entry.get('intensityReference'))} | "
                f"{reference_display(entry.get('bonusListReference'))} | {linked} |"
            )
        lines.extend([
            "",
            "| Bonus Row | Delta | Bonus Type | Value Type | Value | Raw Type Ref |",
            "| --------: | ----- | ---------- | ---------- | ----: | ------------ |",
        ])
        for bonus in action_evidence.get("bonuses") or []:
            lines.append(
                f"| {bonus.get('row')} | {bonus.get('delta')} | {bonus.get('bonusType')} | "
                f"{bonus.get('bonusValueType')} | {bonus.get('bonusValue')} | "
                f"{reference_display(bonus.get('bonusTypeReference'))} |"
            )

    lines.extend([
        "",
        "## Research Notes",
        "",
        "- This report does not write or rebuild save bytes.",
        "- Reference-like binary strings are preserved in the JSON report with decoded table/row hints where available.",
        "- Action writes remain blocked until isolated action-family diffs reconcile with UI counters and game-load checks.",
        "",
    ])
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read-only recruiting table diff for two CFB27 dynasty saves.")
    parser.add_argument("--before", required=True, type=Path, help="Before FBCHUNKS dynasty save")
    parser.add_argument("--after", required=True, type=Path, help="After FBCHUNKS dynasty save")
    parser.add_argument("--before-label", default="before")
    parser.add_argument("--after-label", default="after")
    parser.add_argument("--user-team", default="", help="Manual fixture note for the user's controlled school")
    parser.add_argument("--output-json", type=Path)
    parser.add_argument("--output-md", type=Path)
    parser.add_argument("--decode-maps", type=Path, default=DEFAULT_DECODE_MAPS)
    parser.add_argument("--no-upstream-decodes", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    with tempfile.TemporaryDirectory(prefix="cfb27-recruiting-diff-") as temp_dir:
        temp = Path(temp_dir)
        before_payload = temp / "before.frk"
        after_payload = temp / "after.frk"
        before_meta = load_save_to_payload(args.before, before_payload)
        after_meta = load_save_to_payload(args.after, after_payload)
        report = run_node_recruiting_diff(
            before_payload,
            after_payload,
            args.before_label,
            args.after_label,
        )
        report["before"].update(before_meta)
        report["after"].update(after_meta)
        report["saveComparison"] = {
            "sameSaveBytes": before_meta["saveSha256"] == after_meta["saveSha256"],
            "samePayloadBytes": before_meta["payloadSha256"] == after_meta["payloadSha256"],
        }
        if args.user_team:
            report["fixtureContext"] = {"userTeam": args.user_team}
        decode_maps = None if args.no_upstream_decodes else load_decode_maps(args.decode_maps)
        enrich_report_with_decodes(report, decode_maps)

    if args.output_json:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if args.output_md:
        args.output_md.parent.mkdir(parents=True, exist_ok=True)
        args.output_md.write_text(markdown_report(report), encoding="utf-8")

    summary = {
        "kind": report["kind"],
        "readOnly": report["readOnly"],
        "before": report["before"]["label"],
        "after": report["after"]["label"],
        "artifacts": {
            "json": str(args.output_json) if args.output_json else None,
            "markdown": str(args.output_md) if args.output_md else None,
        },
        "fixtureContext": report.get("fixtureContext", {}),
        "saveComparison": report.get("saveComparison", {}),
        "visitEvidence": {
            "scheduledTargetCountBefore": report.get("visitEvidence", {}).get("scheduledTargetCountBefore", 0),
            "scheduledTargetCountAfter": report.get("visitEvidence", {}).get("scheduledTargetCountAfter", 0),
            "newScheduledTargetRows": report.get("visitEvidence", {}).get("newScheduledTargetRows", []),
            "changedScheduledTargetRows": report.get("visitEvidence", {}).get("changedScheduledTargetRows", []),
            "unchangedScheduledTargetRows": report.get("visitEvidence", {}).get("unchangedScheduledTargetRows", []),
        },
        "changedTableRows": {
            table: changed_table_rows(report, table)
            for table in report.get("tableDiffs", {})
            if changed_table_rows(report, table)
        },
        "boardTargets": [
            {
                "row": target.get("row"),
                "name": target.get("name"),
                "afterActions": (target.get("after") or {}).get("selectedActions", []),
                "afterActionHours": (target.get("after") or {}).get("selectedActionHours", 0),
                "changedUserRecruitTargetFields": list(target.get("userRecruitTargetChanges", {}).keys()),
                "changedProspectInteractionRows": len(target.get("prospectInteractionChanges", [])),
            }
            for target in report.get("boardTargets", [])[:10]
        ],
        "boardCandidates": [
            {
                "row": candidate.get("row"),
                "evidence": candidate.get("evidence"),
                "userRecruitTargetRows": candidate.get("userRecruitTargetRows"),
                "derivedAfterTargetCount": candidate.get("derivedAfterTargetCount"),
                "derivedVisibleHours": candidate.get("derivedVisibleHours"),
                "derivedAfterSelectedActionHours": candidate.get("derivedAfterSelectedActionHours"),
                "derivedAfterScholarshipCount": candidate.get("derivedAfterScholarshipCount"),
                "derivedAfterScheduledVisitCount": candidate.get("derivedAfterScheduledVisitCount"),
            }
            for candidate in report.get("boardCandidates", [])[:10]
        ],
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
