from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from xml.etree import ElementTree


APP_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CACHE_DIR = APP_DIR / ".requirements" / "upstream-cache"
DEFAULT_OUTPUT_DIR = APP_DIR / ".requirements" / "research"
DEFAULT_TUNING_EXPORT_DIR = DEFAULT_OUTPUT_DIR / "upstream-cfb27-tuning-export"

FB_REPO = {
    "repo": "bphit4/FB-Roster-Editor",
    "url": "https://github.com/bphit4/FB-Roster-Editor",
    "commit": "9e91540e9ff72a6aa953a21ec86a122f8278e82d",
    "usage": "cfb27-schema-and-recruiting-tuning",
}
DYNASTY_MANAGER_REPO = {
    "repo": "jwbw29/My-CFB-Dynasty-Manager",
    "url": "https://github.com/jwbw29/My-CFB-Dynasty-Manager",
    "commit": "a98f7b40cef3392b3cdfc49dd2040f47221a49b8",
    "usage": "team-assets-and-recruiting-workflow-reference",
}

RECRUITING_TERMS = (
    "recruit",
    "scout",
    "visit",
    "pitch",
    "motivation",
    "scholarship",
    "prospect",
    "topschool",
)
FOCUS_TABLE_TERMS = {
    "action": ("RecruitingAction", "RecruitingQuickAction"),
    "board": ("RecruitingBoard", "UserRecruitTarget", "RecruitTarget"),
    "bonus": ("RecruitingBonus",),
    "feedback": ("RecruitingActionFeedback",),
    "motivation": ("Motivation", "RecruitingMotivation"),
    "pitch": ("RecruitingPitch", "ActiveRecruitingPitch"),
    "quickAction": ("RecruitingQuickAction",),
    "scouting": ("Scouting", "ProspectInteraction"),
    "visit": ("Visit", "ActiveVisitInfo"),
}
SCHEMA_FOCUS_NAMES = {
    "ActiveRecruitingPitch",
    "ActiveVisitInfo",
    "ProspectInteraction",
    "Recruit",
    "RecruitingActionBonus",
    "RecruitingActionFeedbackEntry",
    "RecruitingActionInfo",
    "RecruitingActionIntensity",
    "RecruitingActionIntensityEnumTableEntry",
    "RecruitingActionType",
    "RecruitingActionTypeEnumTableEntry",
    "RecruitingBoard",
    "RecruitingBonusTypeEnumTableEntry",
    "RecruitingBonusValueTypeEnumTableEntry",
    "RecruitingMotivationEnumTableEntry",
    "RecruitingMotivationToMySchoolGradeMapping",
    "RecruitingPitchInfo",
    "RecruitingPitchTypeEnumTableEntry",
    "RecruitingQuickAction",
    "RecruitingQuickActionScopeEnumTableEntry",
    "RecruitingQuickActionTypeEnumTableEntry",
    "RecruitingStageDetails",
    "RecruitingTunables",
    "RecruitingVisitGameStakesFactorEnumTableEntry",
    "RecruitingVisitWinMaginTypeEnumTableEntry",
    "RecruitInitialInterestPoolInfo",
    "RecruitOfferTypeEnumTableEntry",
    "RecruitStageEnumTableEntry",
    "RecruitTarget",
    "ScoutingAbilityInfo",
    "ScoutingGradeEnumTableEntry",
    "ScoutingGradeInfo",
    "ScoutingStageTunable",
    "ScoutingTunables",
    "UserRecruitTarget",
    "VisitActivityInfo",
    "VisitActivityTypeEnumTableEntry",
}


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def read_archive(path: Path) -> zipfile.ZipFile:
    if not path.is_file():
        raise FileNotFoundError(path)
    return zipfile.ZipFile(path)


def archive_root(zip_file: zipfile.ZipFile) -> str:
    roots = sorted({name.split("/", 1)[0] for name in zip_file.namelist() if "/" in name})
    if not roots:
        raise RuntimeError("Archive does not contain a root directory")
    return roots[0]


def entry_sha(zip_file: zipfile.ZipFile, entry: str) -> str:
    return sha256_hex(zip_file.read(entry))


def text_entry(zip_file: zipfile.ZipFile, entry: str) -> str:
    return zip_file.read(entry).decode("utf-8-sig", errors="replace")


def source_metadata(repo: dict, archive_path: Path, zip_file: zipfile.ZipFile, root: str) -> dict:
    archive_bytes = archive_path.read_bytes()
    names = set(zip_file.namelist())
    package_json = f"{root}/package.json"
    package_license = None
    if package_json in names:
        try:
            package_license = json.loads(text_entry(zip_file, package_json)).get("license")
        except json.JSONDecodeError:
            package_license = None
    license_entries = [
        name for name in names
        if name.startswith(f"{root}/")
        and "/" not in name[len(root) + 1:].strip("/")
        and Path(name).name.lower() in {"license", "license.md", "license.txt"}
    ]
    return {
        **repo,
        "archive": str(archive_path),
        "archiveSha256": sha256_hex(archive_bytes),
        "archiveBytes": len(archive_bytes),
        "archiveRoot": root,
        "commitVerification": {
            "status": "declared-only",
            "note": "GitHub source ZIPs do not include .git metadata; commit is the requirement-pinned source commit, not verified from archive contents.",
        },
        "license": {
            "packageJson": package_license,
            "licenseFiles": sorted(license_entries),
            "note": (
                "No dedicated LICENSE file found in the ZIP; package metadata is not a substitute "
                "for clearing copied asset redistribution."
                if not license_entries else "License file is present in the ZIP and should be reviewed before vendoring assets."
            ),
        },
    }


def validate_manifest_sources(manifest: dict) -> None:
    missing: list[str] = []
    for index, source in enumerate(manifest.get("sources", [])):
        for key in ("repo", "url", "commit", "archiveSha256"):
            if not source.get(key):
                missing.append(f"sources[{index}].{key}")
    if missing:
        raise ValueError("Manifest source metadata is incomplete: " + ", ".join(missing))


def classify_table(actual_name: str) -> list[str]:
    groups: list[str] = []
    for group, terms in FOCUS_TABLE_TERMS.items():
        if any(term.lower() in actual_name.lower() for term in terms):
            groups.append(group)
    return groups


def table_export_status(zip_file: zipfile.ZipFile, root: str, table: dict, export_dir: Path | None = None) -> dict:
    names = set(zip_file.namelist())
    base = f"{root}/backend/data/test-cfb27-open-verification/dynasty-tuning-binary/"
    json_file = table.get("json_file")
    csv_file = table.get("csv_file")
    local_json = export_dir / json_file if export_dir and json_file else None
    local_csv = export_dir / "csv" / csv_file if export_dir and csv_file else None
    return {
        "jsonFile": json_file,
        "jsonPresent": bool(
            json_file and (
                f"{base}{json_file}" in names
                or (local_json is not None and local_json.is_file())
            )
        ),
        "localJsonPath": str(local_json) if local_json and local_json.is_file() else None,
        "csvFile": csv_file,
        "csvPresent": bool(
            csv_file and (
                f"{base}{csv_file}" in names
                or (local_csv is not None and local_csv.is_file())
            )
        ),
        "localCsvPath": str(local_csv) if local_csv and local_csv.is_file() else None,
    }


def load_tuning_summary(zip_file: zipfile.ZipFile, root: str) -> tuple[str, dict]:
    entry = f"{root}/backend/data/test-cfb27-open-verification/dynasty-tuning-binary/dynasty-tuning-binary_summary.json"
    return entry, json.loads(text_entry(zip_file, entry))


def normalized_tuning_summary(
    zip_file: zipfile.ZipFile,
    root: str,
    source: dict,
    generated_at: str,
    export_dir: Path | None = None,
) -> dict:
    entry, summary = load_tuning_summary(zip_file, root)
    relevant_tables: list[dict] = []
    groups: dict[str, list[dict]] = defaultdict(list)
    for table in summary.get("tables", []):
        actual_name = table.get("actual_name", "")
        if not any(term in actual_name.lower() for term in RECRUITING_TERMS):
            continue
        table_groups = classify_table(actual_name)
        normalized = {
            "path": table.get("path"),
            "actualName": actual_name,
            "uniqueId": table.get("unique_id"),
            "tableId": table.get("table_id"),
            "fieldCount": table.get("field_count"),
            "recordCapacity": table.get("record_capacity"),
            "recordsParsed": table.get("records_parsed"),
            "groups": table_groups,
            "exports": table_export_status(zip_file, root, table, export_dir),
        }
        relevant_tables.append(normalized)
        for group in table_groups or ["otherRecruiting"]:
            groups[group].append(normalized)

    return {
        "kind": "cfb27.upstreamTuningSummary.v1",
        "generatedAt": generated_at,
        "source": source,
        "sourceEntry": entry,
        "parser": summary.get("parser"),
        "gameYear": summary.get("game_year"),
        "fileType": summary.get("file_type"),
        "tableCount": summary.get("table_count"),
        "warnings": summary.get("warnings", []),
        "relevantTableCount": len(relevant_tables),
        "groups": {key: value for key, value in sorted(groups.items())},
        "relevantTables": sorted(relevant_tables, key=lambda item: (item["actualName"], item["uniqueId"] or 0)),
        "missingTableExports": [
            table for table in relevant_tables
            if not table["exports"]["jsonPresent"] or not table["exports"]["csvPresent"]
        ],
        "notes": [
            (
                "Local per-table JSON/CSV exports are present and can be used for enum/action label normalization."
                if export_dir and export_dir.is_dir() and not [
                    table for table in relevant_tables
                    if not table["exports"]["jsonPresent"] or not table["exports"]["csvPresent"]
                ]
                else "The ZIP contains the dynasty tuning summary but not all referenced per-table JSON/CSV exports."
            ),
            "No recipe should be promoted from upstream tables alone; match labels and metadata against local 015 evidence first.",
        ],
    }


def parse_schema_ftx(text: str, entry: str) -> list[dict]:
    root = ElementTree.fromstring(text)
    schemas: list[dict] = []
    for schema in root.findall(".//schema"):
        attributes: list[dict] = []
        for attribute in schema.findall("attribute"):
            attributes.append({
                "name": attribute.attrib.get("name"),
                "idx": int(attribute.attrib["idx"]) if attribute.attrib.get("idx", "").isdigit() else attribute.attrib.get("idx"),
                "type": attribute.attrib.get("type"),
                "default": attribute.attrib.get("default"),
                "minValue": attribute.attrib.get("minValue"),
                "maxValue": attribute.attrib.get("maxValue"),
                "maxLen": attribute.attrib.get("maxLen"),
            })
        schemas.append({
            "name": schema.attrib.get("name"),
            "entry": entry,
            "base": schema.attrib.get("base"),
            "numMembers": int(schema.attrib.get("numMembers", 0)),
            "defaultStoreCapacity": schema.attrib.get("defaultStoreCapacity"),
            "defaultStoreGroupName": schema.attrib.get("defaultStoreGroupName"),
            "assetId": schema.attrib.get("assetId"),
            "majorVersionCRC": schema.attrib.get("majorVersionCRC"),
            "minorVersionCRC": schema.attrib.get("minorVersionCRC"),
            "attributes": attributes,
        })
    return schemas


def normalized_schema_snapshot(zip_file: zipfile.ZipFile, root: str, source: dict, generated_at: str) -> dict:
    schema_entries = [
        name for name in zip_file.namelist()
        if name.startswith(f"{root}/backend/data/cfb27/Dynasty_Files/")
        and name.lower().endswith(".ftx")
        and any(f"{schema_name.lower()}.ftx" in name.lower() for schema_name in SCHEMA_FOCUS_NAMES)
    ]
    schemas: list[dict] = []
    failed: list[dict] = []
    for entry in sorted(schema_entries):
        try:
            schemas.extend(parse_schema_ftx(text_entry(zip_file, entry), entry))
        except ElementTree.ParseError as exc:
            failed.append({"entry": entry, "error": str(exc)})
    return {
        "kind": "cfb27.upstreamSchemaSnapshot.v1",
        "generatedAt": generated_at,
        "source": source,
        "schemaCount": len(schemas),
        "entryCount": len(schema_entries),
        "schemas": sorted(schemas, key=lambda item: item["name"] or ""),
        "parseFailures": failed,
    }


def normalized_ovr_reference(zip_file: zipfile.ZipFile, root: str, source: dict, generated_at: str) -> dict:
    weights_entry = f"{root}/backend/data/cfb27/CFB27 OVR Weights Archetypes.json"
    archetypes_entry = f"{root}/backend/data/cfb27/CFB27-Archetypes.csv"
    weights = json.loads(text_entry(zip_file, weights_entry))
    archetype_rows = list(csv.DictReader(StringIO(text_entry(zip_file, archetypes_entry))))
    by_position: dict[str, int] = defaultdict(int)
    for item in weights.get("archetypes", []):
        by_position[item.get("position") or ""] += 1
    return {
        "kind": "cfb27.upstreamOvrArchetypeReference.v1",
        "generatedAt": generated_at,
        "source": source,
        "files": [
            {"entry": weights_entry, "sha256": entry_sha(zip_file, weights_entry), "usage": "OVR weights by archetype"},
            {"entry": archetypes_entry, "sha256": entry_sha(zip_file, archetypes_entry), "usage": "archetype labels/reference rows"},
        ],
        "ovrWeightCount": len(weights.get("archetypes", [])),
        "ovrWeightsByPosition": dict(sorted(by_position.items())),
        "archetypeCsvRows": len(archetype_rows),
        "sampleArchetypes": weights.get("archetypes", [])[:8],
    }


def parse_fbs_teams(text: str) -> list[dict]:
    object_blocks = re.findall(r"\{\s*name:\s*\"(.*?)\"(.*?)\},", text, flags=re.DOTALL)
    teams: list[dict] = []
    for name, body in object_blocks:
        team = {"name": name}
        for key in ("nickName", "city", "state", "conference", "stadium", "abbrev"):
            match = re.search(rf"{key}:\s*\"(.*?)\"", body)
            if match:
                value = match.group(1)
                team[key] = value.strip() if key == "state" else value
        if "abbrev" in team:
            teams.append(team)
    return teams


def parse_grade_values(text: str) -> list[dict]:
    grades_match = re.search(r"const grades = \[(.*?)\];", text, flags=re.DOTALL)
    if not grades_match:
        return []
    return [
        {"label": label, "value": int(value)}
        for label, value in re.findall(r"\{\s*label:\s*'([^']+)'\s*,\s*value:\s*(\d+)\s*\}", grades_match.group(1))
    ]


def json_safe_csv_rows(rows: list[dict]) -> list[dict]:
    safe_rows: list[dict] = []
    for row in rows:
        safe_row: dict = {}
        extras = None
        for key, value in row.items():
            if key is None:
                extras = value
            else:
                safe_row[str(key)] = value
        if extras:
            safe_row["_extra"] = extras
        safe_rows.append(safe_row)
    return safe_rows


def normalized_dynasty_manager_summary(zip_file: zipfile.ZipFile, root: str, source: dict, generated_at: str) -> dict:
    names = zip_file.namelist()
    colors_entry = f"{root}/public/fbsColors.csv"
    teams_entry = f"{root}/src/utils/fbsTeams.ts"
    calculator_entry = f"{root}/src/components/RecruitingCalculator.tsx"
    tracker_entry = f"{root}/src/components/RecruitingClassTracker.tsx"
    colors = json_safe_csv_rows(list(csv.DictReader(StringIO(text_entry(zip_file, colors_entry)))))
    teams = parse_fbs_teams(text_entry(zip_file, teams_entry))
    grades = parse_grade_values(text_entry(zip_file, calculator_entry))
    logo_entries = [
        name for name in names
        if name.startswith(f"{root}/public/logos/") and name.lower().endswith((".png", ".webp", ".svg"))
    ]
    return {
        "kind": "cfb27.upstreamTeamWorkflowSummary.v1",
        "generatedAt": generated_at,
        "source": source,
        "files": [
            {"entry": colors_entry, "sha256": entry_sha(zip_file, colors_entry), "usage": "team color reference"},
            {"entry": teams_entry, "sha256": entry_sha(zip_file, teams_entry), "usage": "team/conference/stadium reference"},
            {"entry": calculator_entry, "sha256": entry_sha(zip_file, calculator_entry), "usage": "sell/pitch workflow heuristic reference"},
            {"entry": tracker_entry, "sha256": entry_sha(zip_file, tracker_entry), "usage": "manual recruiting class tracker workflow reference"},
        ],
        "teamColorRows": len(colors),
        "fbsTeamRows": len(teams),
        "logoAssetCount": len(logo_entries),
        "conferenceLogoAssetCount": sum("/public/logos/conferences/" in name for name in logo_entries),
        "sampleTeams": teams[:10],
        "sampleColors": colors[:10],
        "recruitingCalculator": {
            "gradeValues": grades,
            "observedThresholds": [
                {"result": "DON'T SELL", "condition": "sum <= 17"},
                {"result": "RISKY", "condition": "18 <= sum <= 20"},
                {"result": "SELL", "condition": "sum >= 21"},
            ],
            "confidence": "workflow-only",
        },
        "assetLicenseNote": "Logos/colors are recorded as leads only; do not vendor or redistribute without license review.",
    }


def artifact_file(path: Path, artifact: dict) -> dict:
    payload = json.dumps(artifact, indent=2, sort_keys=True).encode("utf-8")
    path.write_bytes(payload + b"\n")
    return {"path": str(path), "sha256": sha256_hex(payload + b"\n"), "bytes": len(payload) + 1}


def markdown_summary(manifest: dict, tuning: dict, schema: dict, ovr: dict, team: dict) -> str:
    missing_exports = len(tuning.get("missingTableExports", []))
    lines = [
        "# Upstream Import Summary",
        "",
        f"Generated: `{manifest['generatedAt']}`",
        "",
        "## Sources",
        "",
    ]
    for source in manifest["sources"]:
        lines.append(f"- `{source['repo']}` at `{source['commit']}` from `{source['archive']}`")
    lines.extend([
        "",
        "## FB-Roster-Editor Leads",
        "",
        f"- Relevant tuning tables: {tuning['relevantTableCount']} of {tuning['tableCount']}.",
        f"- Focus schema entries parsed: {schema['schemaCount']}.",
        f"- OVR/archetype weight rows: {ovr['ovrWeightCount']}.",
        f"- Missing referenced per-table JSON/CSV exports: {missing_exports}.",
        "",
        "Most useful tuning groups:",
        "",
    ])
    for group, tables in tuning["groups"].items():
        lines.append(f"- `{group}`: {len(tables)} tables")
    lines.extend([
        "",
        "## My-CFB-Dynasty-Manager Leads",
        "",
        f"- FBS team rows parsed: {team['fbsTeamRows']}.",
        f"- Team color rows parsed: {team['teamColorRows']}.",
        f"- Logo asset files discovered but not vendored: {team['logoAssetCount']}.",
        "- Recruiting calculator thresholds are workflow-only leads, not save-write evidence.",
        "",
        "## Safety Notes",
        "",
        "- No upstream code path enables new save writes.",
        (
            "- Local tuning table exports are available; enum labels still need matching against 015 evidence "
            "before becoming high-confidence UI labels."
            if missing_exports == 0
            else "- Missing tuning table exports must be regenerated before enum labels can become high confidence."
        ),
        "- Logos and other visual assets remain unvendored until license/provenance is cleared.",
    ])
    return "\n".join(lines) + "\n"


def build_artifacts(args: argparse.Namespace) -> dict:
    generated_at = args.generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    fb_zip_path = args.fb_roster_zip.resolve()
    dynasty_zip_path = args.dynasty_manager_zip.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    with read_archive(fb_zip_path) as fb_zip, read_archive(dynasty_zip_path) as dynasty_zip:
        fb_root = archive_root(fb_zip)
        dynasty_root = archive_root(dynasty_zip)
        fb_source = source_metadata(FB_REPO, fb_zip_path, fb_zip, fb_root)
        dynasty_source = source_metadata(DYNASTY_MANAGER_REPO, dynasty_zip_path, dynasty_zip, dynasty_root)
        tuning = normalized_tuning_summary(fb_zip, fb_root, fb_source, generated_at, args.tuning_export_dir.resolve())
        schema = normalized_schema_snapshot(fb_zip, fb_root, fb_source, generated_at)
        ovr = normalized_ovr_reference(fb_zip, fb_root, fb_source, generated_at)
        team = normalized_dynasty_manager_summary(dynasty_zip, dynasty_root, dynasty_source, generated_at)

    manifest = {
        "kind": "cfb27.upstreamImportManifest.v1",
        "generatedAt": generated_at,
        "generationCommand": "python tools/upstream_import.py",
        "sources": [fb_source, dynasty_source],
        "selectedScope": [
            "FB-Roster-Editor CFB27 dynasty schemas and tuning summary",
            "FB-Roster-Editor CFB27 OVR/archetype reference files",
            "My-CFB-Dynasty-Manager team/color/workflow reference files",
        ],
        "safety": {
            "writeRecipesEnabled": False,
            "copyFirstRequired": True,
            "notes": [
                "Artifacts are research references only.",
                "Scouting and Send the House remain blocked pending local game validation.",
            ],
        },
    }
    validate_manifest_sources(manifest)

    artifacts = {
        "manifest": artifact_file(output_dir / "upstream-import-manifest.json", manifest),
        "tuning": artifact_file(output_dir / "upstream-cfb27-tuning-summary.json", tuning),
        "schema": artifact_file(output_dir / "upstream-cfb27-schema-snapshot.json", schema),
        "ovr": artifact_file(output_dir / "upstream-cfb27-ovr-archetypes.json", ovr),
        "team": artifact_file(output_dir / "upstream-team-workflow-summary.json", team),
    }
    md_path = output_dir / "upstream-import-summary.md"
    md = markdown_summary(manifest, tuning, schema, ovr, team)
    md_path.write_text(md, encoding="utf-8")
    artifacts["markdown"] = {
        "path": str(md_path),
        "sha256": sha256_hex(md.encode("utf-8")),
        "bytes": len(md.encode("utf-8")),
    }
    manifest["generatedArtifacts"] = artifacts
    artifact_file(output_dir / "upstream-import-manifest.json", manifest)
    return {"manifest": manifest, "artifacts": artifacts}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalize pinned upstream CFB27 research ZIPs into local artifacts.")
    parser.add_argument(
        "--fb-roster-zip",
        type=Path,
        default=DEFAULT_CACHE_DIR / "FB-Roster-Editor-main.zip",
        help="ZIP archive for bphit4/FB-Roster-Editor",
    )
    parser.add_argument(
        "--dynasty-manager-zip",
        type=Path,
        default=DEFAULT_CACHE_DIR / "My-CFB-Dynasty-Manager-main.zip",
        help="ZIP archive for jwbw29/My-CFB-Dynasty-Manager",
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Research artifact output directory")
    parser.add_argument(
        "--tuning-export-dir",
        type=Path,
        default=DEFAULT_TUNING_EXPORT_DIR,
        help="Optional local directory containing exported FRANCHISE_*.json and csv/*.csv tuning tables",
    )
    parser.add_argument("--generated-at", help="Override generatedAt timestamp for deterministic tests")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    result = build_artifacts(parse_args(argv))
    print(json.dumps(result["artifacts"], indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
