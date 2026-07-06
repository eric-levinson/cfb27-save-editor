from __future__ import annotations

import argparse
import json
from pathlib import Path


APP_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DECODE_MAPS = APP_DIR / ".requirements" / "research" / "upstream-cfb27-recruiting-decode-maps.json"
DEFAULT_REPORTS = [
    APP_DIR / ".requirements" / "research" / "015-pre-season-0-to-week-0-recruiting-diff.json",
    APP_DIR / ".requirements" / "research" / "manual-send-house-scout-visit-diff.json",
]
DEFAULT_OUTPUT_JSON = APP_DIR / ".requirements" / "research" / "upstream-cfb27-recruiting-label-confidence.json"
DEFAULT_OUTPUT_MD = APP_DIR / ".requirements" / "research" / "upstream-cfb27-recruiting-label-confidence.md"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def decoded_label(entry: dict | None) -> str:
    if not entry:
        return ""
    return entry.get("shortName") or entry.get("longName") or entry.get("description") or ""


def add_unique(items: list[dict], item: dict) -> None:
    key = json.dumps(item, sort_keys=True)
    if all(json.dumps(existing, sort_keys=True) != key for existing in items):
        items.append(item)


def report_label(report: dict) -> str:
    before = (report.get("before") or {}).get("label") or "before"
    after = (report.get("after") or {}).get("label") or "after"
    return f"{before}->{after}"


def collect_weekly_action_evidence(decode_maps: dict) -> dict:
    evidence = []
    blocked = []
    for field, detail in sorted((decode_maps.get("weeklyActionFields") or {}).items()):
        upstream = detail.get("upstream") or {}
        action = upstream.get("action") or {}
        item = {
            "field": field,
            "label": decoded_label(action),
            "cost": upstream.get("cost"),
            "status": detail.get("status"),
        }
        if detail.get("status") == "blocked-rg36":
            blocked.append(item)
        else:
            evidence.append(item)
    experimental_opened = [item for item in evidence if str(item.get("status", "")).startswith("experimental-")]
    return {
        "confidence": "validated-015-read-label",
        "status": "read-labels-validated-experimental-probe-writes-opened"
        if experimental_opened else "read-labels-validated-write-recipes-still-gated",
        "evidence": evidence,
        "blocked": blocked,
        "experimentalOpened": experimental_opened,
    }


def collect_report_evidence(reports: list[dict]) -> dict:
    active_visits = []
    feedback_actions = []
    bonus_values = []
    unresolved = []
    pitch_labels = []
    motivation_labels = []
    scouting_grade_labels = []

    for report in reports:
        source = report_label(report)
        for target in report.get("boardTargets") or []:
            for state_key in ("before", "after"):
                state = target.get(state_key) or {}
                decoded = ((state.get("recruitingProfile") or {}).get("decoded") or {})
                ideal_pitch = decoded.get("idealPitch")
                if ideal_pitch:
                    add_unique(pitch_labels, {
                        "source": source,
                        "target": target.get("name"),
                        "row": target.get("row"),
                        "field": "Player.IdealRecruitingPitch",
                        "label": decoded_label(ideal_pitch),
                        "decodeMethod": ideal_pitch.get("decodeMethod"),
                    })
                dealbreaker = decoded.get("dealbreaker")
                if dealbreaker:
                    add_unique(motivation_labels, {
                        "source": source,
                        "target": target.get("name"),
                        "row": target.get("row"),
                        "field": "Player.RecruitingDealbreaker",
                        "label": decoded_label(dealbreaker),
                        "decodeMethod": dealbreaker.get("decodeMethod"),
                    })
                for motivation in decoded.get("motivations") or []:
                    add_unique(motivation_labels, {
                        "source": source,
                        "target": target.get("name"),
                        "row": target.get("row"),
                        "field": f"Player.{motivation.get('field')}",
                        "label": decoded_label(motivation),
                        "decodeMethod": motivation.get("decodeMethod"),
                    })

        for item in (report.get("visitEvidence") or {}).get("targets") or []:
            for state_key in ("before", "after"):
                state = item.get(state_key) or {}
                visit = state.get("scheduledVisit") or {}
                activity = visit.get("activityDecoded")
                if activity:
                    add_unique(active_visits, {
                        "source": source,
                        "target": item.get("name"),
                        "row": item.get("row"),
                        "activeVisitInfoRow": visit.get("row"),
                        "label": decoded_label(activity),
                        "decodeMethod": activity.get("decodeMethod"),
                        "confidence": activity.get("confidence"),
                    })
                prospect = state.get("prospectVisitState") or {}
                for field in ("visitActivityTypeDecode", "visitWeekTypeDecode"):
                    decoded = prospect.get(field)
                    if decoded:
                        add_unique(unresolved, {
                            "source": source,
                            "family": decoded.get("field"),
                            "status": decoded.get("status"),
                            "reference": decoded.get("reference"),
                        })

        evidence = report.get("recruitingActionEvidence") or {}
        for entry in evidence.get("feedbackEntries") or []:
            add_unique(feedback_actions, {
                "source": source,
                "row": entry.get("row"),
                "action": entry.get("action"),
                "hoursSpent": entry.get("hoursSpent"),
                "influenceGained": entry.get("influenceGained"),
            })
            if entry.get("intensityReference"):
                add_unique(unresolved, {
                    "source": source,
                    "family": "RecruitingActionFeedbackEntry.RecruitingActionIntensity",
                    "status": "unresolved-reference-window",
                    "reference": entry.get("intensityReference"),
                })
            for bonus in entry.get("linkedBonuses") or []:
                add_unique(bonus_values, {
                    "source": source,
                    "feedbackRow": entry.get("row"),
                    "bonusRow": bonus.get("row"),
                    "valueType": bonus.get("valueType"),
                    "value": bonus.get("value"),
                    "bonusType": bonus.get("type"),
                })
        for bonus in evidence.get("bonuses") or []:
            if bonus.get("bonusTypeReference"):
                add_unique(unresolved, {
                    "source": source,
                    "family": "RecruitingActionBonus.BonusType",
                    "status": "unresolved-reference-window",
                    "reference": bonus.get("bonusTypeReference"),
                })

        for diff in (report.get("tableDiffs") or {}).values():
            rows = []
            rows.extend(diff.get("addedRowDetails") or [])
            rows.extend(diff.get("changedRows") or [])
            rows.extend(diff.get("removedRowDetails") or [])
            for row in rows:
                decoded_fields = row.get("decodedFields") or {}
                for field, decoded in decoded_fields.items():
                    value = decoded.get("after") or decoded.get("before") if isinstance(decoded, dict) else decoded
                    if not isinstance(value, dict):
                        value = decoded
                    label = decoded_label(value)
                    if not label:
                        continue
                    item = {"source": source, "field": field, "label": label, "row": row.get("row")}
                    enum_name = value.get("enum")
                    if enum_name == "RecruitingPitchType":
                        add_unique(pitch_labels, item)
                    elif enum_name == "RecruitingMotivation":
                        add_unique(motivation_labels, item)
                    elif enum_name == "ScoutingGrade":
                        add_unique(scouting_grade_labels, item)

    return {
        "activeVisitActivity": {
            "confidence": "medium-read-only-fixture-label" if active_visits else "upstream-only-no-fixture-evidence",
            "status": "labels-visible-write-blocked",
            "evidence": active_visits,
        },
        "feedbackActionType": {
            "confidence": "matched-manual-fixture-read-label" if feedback_actions else "upstream-only-no-fixture-evidence",
            "status": "labels-visible-write-blocked",
            "evidence": feedback_actions,
        },
        "bonusValueType": {
            "confidence": "matched-manual-fixture-read-label" if bonus_values else "upstream-only-no-fixture-evidence",
            "status": "labels-visible-write-blocked",
            "evidence": bonus_values,
        },
        "pitchType": {
            "confidence": "matched-fixture-read-label" if pitch_labels else "upstream-only-no-fixture-evidence",
            "status": "awaiting-local-fixture-evidence",
            "evidence": pitch_labels,
        },
        "motivation": {
            "confidence": "matched-fixture-read-label" if motivation_labels else "upstream-only-no-fixture-evidence",
            "status": "awaiting-local-fixture-evidence",
            "evidence": motivation_labels,
        },
        "scoutingGrade": {
            "confidence": "matched-fixture-read-label" if scouting_grade_labels else "upstream-only-no-fixture-evidence",
            "status": "awaiting-local-fixture-evidence",
            "evidence": scouting_grade_labels,
        },
        "unresolvedReferenceWindows": {
            "confidence": "blocked-rg36",
            "status": "must-not-drive-write-recipes",
            "evidence": unresolved,
        },
    }


def build_confidence(decode_maps_path: Path, report_paths: list[Path]) -> dict:
    decode_maps = load_json(decode_maps_path)
    reports = [load_json(path) for path in report_paths if path.is_file()]
    families = {"weeklyActions": collect_weekly_action_evidence(decode_maps)}
    families.update(collect_report_evidence(reports))
    return {
        "kind": "cfb27.upstreamRecruitingLabelConfidence.v1",
        "decodeMaps": str(decode_maps_path),
        "reports": [str(path) for path in report_paths if path.is_file()],
        "families": families,
        "safety": {
            "validatedWriteRecipesEnabled": False,
            "experimentalProbeWritesEnabled": True,
            "note": "Experimental probe writes may be available before full game validation; validated helper promotion still requires local read-back and game validation.",
        },
    }


def markdown(confidence: dict) -> str:
    lines = [
        "# Upstream Recruiting Label Confidence",
        "",
        "Read-only confidence summary generated from upstream decode maps and local fixture reports.",
        "",
        "| Family | Confidence | Status | Evidence Count |",
        "| ------ | ---------- | ------ | -------------: |",
    ]
    for family, detail in confidence.get("families", {}).items():
        evidence = detail.get("evidence") or []
        lines.append(
            f"| `{family}` | {detail.get('confidence')} | {detail.get('status')} | {len(evidence)} |"
        )
    lines.extend([
        "",
        "## Blockers",
        "",
    ])
    blockers = (confidence.get("families", {}).get("unresolvedReferenceWindows") or {}).get("evidence") or []
    if not blockers:
        lines.append("- None recorded.")
    else:
        for blocker in blockers:
            ref = blocker.get("reference") or {}
            lines.append(
                f"- `{blocker.get('family')}` in {blocker.get('source')}: "
                f"{blocker.get('status')} (`{ref.get('tableId')}:{ref.get('row')}`)."
            )
    lines.extend([
        "",
        "## Safety",
        "",
        "- Experimental probe writes may be opened before full game validation.",
        "- Validated write-helper promotion still requires local read-back and game validation.",
        "- Families with upstream-only confidence need local fixture evidence before UI labels should be treated as high confidence.",
        "",
    ])
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Summarize upstream recruiting label confidence from local fixture reports.")
    parser.add_argument("--decode-maps", type=Path, default=DEFAULT_DECODE_MAPS)
    parser.add_argument("--report", dest="reports", action="append", type=Path)
    parser.add_argument("--output-json", type=Path, default=DEFAULT_OUTPUT_JSON)
    parser.add_argument("--output-md", type=Path, default=DEFAULT_OUTPUT_MD)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report_paths = args.reports or DEFAULT_REPORTS
    confidence = build_confidence(args.decode_maps.resolve(), [path.resolve() for path in report_paths])
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(confidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    args.output_md.parent.mkdir(parents=True, exist_ok=True)
    args.output_md.write_text(markdown(confidence), encoding="utf-8")
    print(json.dumps({
        "kind": confidence["kind"],
        "outputJson": str(args.output_json),
        "outputMarkdown": str(args.output_md),
        "families": {
            name: {
                "confidence": detail.get("confidence"),
                "evidenceCount": len(detail.get("evidence") or []),
            }
            for name, detail in confidence.get("families", {}).items()
        },
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
