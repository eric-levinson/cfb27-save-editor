from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path


APP_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CACHE_DIR = APP_DIR / ".requirements" / "upstream-cache"
DEFAULT_FB_ROSTER_DIR = DEFAULT_CACHE_DIR / "FB-Roster-Editor"
DEFAULT_OUTPUT_DIR = APP_DIR / ".requirements" / "research" / "upstream-cfb27-tuning-export"

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


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def resolve_fb_roster_root(path: Path) -> Path:
    path = path.resolve()
    candidates = [
        path,
        path / "FB-Roster-Editor-main",
    ]
    for candidate in candidates:
        if (candidate / "backend" / "tools" / "madden_franchise_bridge.mjs").is_file():
            return candidate
    raise FileNotFoundError(f"Could not find FB-Roster-Editor root under {path}")


def bridge_paths(root: Path) -> dict[str, Path]:
    dynasty_files = root / "backend" / "data" / "cfb27" / "Dynasty_Files"
    paths = {
        "bridge": root / "backend" / "tools" / "madden_franchise_bridge.mjs",
        "maddenFranchiseRoot": root / "backend" / "vendor" / "madden-franchise",
        "dynastyFiles": dynasty_files,
        "tuningInput": dynasty_files / "dynasty-tuning-binary.FTC",
    }
    missing = [str(path) for path in paths.values() if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing upstream export input(s): " + ", ".join(missing))
    return paths


def run_bridge(paths: dict[str, Path], args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["MADDEN_FRANCHISE_ROOT"] = str(paths["maddenFranchiseRoot"])
    env["CFB27_DYNASTY_FILES_ROOT"] = str(paths["dynastyFiles"])
    return subprocess.run(
        ["node", str(paths["bridge"]), *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
        timeout=300,
        env=env,
    )


def is_recruiting_table(table: dict) -> bool:
    actual_name = str(table.get("actual_name") or "")
    return any(term in actual_name.lower() for term in RECRUITING_TERMS)


def build_batch_manifest(summary: dict, output_dir: Path) -> tuple[list[dict], list[dict]]:
    meta_dir = output_dir / "_table_meta"
    meta_dir.mkdir(parents=True, exist_ok=True)
    batch: list[dict] = []
    selected: list[dict] = []
    for table in summary.get("tables", []):
        if not is_recruiting_table(table):
            continue
        meta_path = meta_dir / f"{table['json_file']}.table-meta.json"
        meta_path.write_text(json.dumps(table, indent=2), encoding="utf-8")
        output_path = output_dir / table["json_file"]
        batch.append({"tableMetaPath": str(meta_path.resolve()), "outputPath": str(output_path.resolve())})
        selected.append(table)
    (output_dir / "_batch_manifest.json").write_text(json.dumps(batch, indent=2), encoding="utf-8")
    return batch, selected


def flatten_csv_value(value: object) -> object:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return value


def write_table_csv(table_json_path: Path, csv_path: Path) -> dict:
    table = json.loads(table_json_path.read_text(encoding="utf-8"))
    records = table.get("records", [])
    field_names = ["_index"]
    if any(record.get("_isEmpty") for record in records):
        field_names.append("_isEmpty")
    for field in table.get("field_definitions", []):
        name = field.get("name")
        if name and name not in field_names:
            field_names.append(name)
    for record in records:
        for key in record:
            if key not in field_names:
                field_names.append(key)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=field_names, extrasaction="ignore")
        writer.writeheader()
        for record in records:
            writer.writerow({key: flatten_csv_value(record.get(key)) for key in field_names})
    return {
        "path": str(csv_path),
        "sha256": sha256_hex(csv_path.read_bytes()),
        "rows": len(records),
        "columns": field_names,
    }


def exported_table_summary(table_json_path: Path, csv_info: dict) -> dict:
    data = json.loads(table_json_path.read_text(encoding="utf-8"))
    payload = table_json_path.read_bytes()
    return {
        "path": data.get("path"),
        "name": data.get("name"),
        "actualName": data.get("actual_name"),
        "uniqueId": data.get("unique_id"),
        "tableId": data.get("table_id"),
        "jsonFile": table_json_path.name,
        "jsonSha256": sha256_hex(payload),
        "jsonBytes": len(payload),
        "csvFile": Path(csv_info["path"]).name,
        "csvSha256": csv_info["sha256"],
        "recordCount": len(data.get("records", [])),
        "fields": [field.get("name") for field in data.get("field_definitions", [])],
        "records": data.get("records", []),
    }


def write_exports_manifest(
    output_dir: Path,
    aggregate_path: Path,
    root: Path,
    paths: dict[str, Path],
    summary: dict,
    selected: list[dict],
    batch_result: dict,
    stderr_text: str,
) -> dict:
    csv_dir = output_dir / "csv"
    exported_tables: list[dict] = []
    csv_outputs: list[dict] = []
    for table in selected:
        table_json_path = output_dir / table["json_file"]
        if not table_json_path.is_file():
            continue
        csv_path = csv_dir / f"{Path(table['json_file']).stem}.csv"
        csv_info = write_table_csv(table_json_path, csv_path)
        csv_outputs.append(csv_info)
        exported_tables.append(exported_table_summary(table_json_path, csv_info))

    failures = [result for result in batch_result.get("results", []) if not result.get("ok")]
    aggregate = {
        "kind": "cfb27.upstreamRecruitingTuningTables.v1",
        "source": {
            "repo": "bphit4/FB-Roster-Editor",
            "root": str(root),
            "tuningInput": str(paths["tuningInput"]),
            "tuningInputSha256": sha256_hex(paths["tuningInput"].read_bytes()),
        },
        "summary": {
            "tableCount": summary.get("table_count"),
            "selectedRecruitingTableCount": len(selected),
            "exportedTableCount": len(exported_tables),
            "csvTableCount": len(csv_outputs),
            "failedExportCount": len(failures),
        },
        "tables": sorted(exported_tables, key=lambda item: (item["actualName"] or "", item["uniqueId"] or 0)),
    }
    aggregate_path.parent.mkdir(parents=True, exist_ok=True)
    aggregate_payload = json.dumps(aggregate, indent=2, sort_keys=True).encode("utf-8")
    aggregate_path.write_bytes(aggregate_payload + b"\n")

    manifest = {
        "kind": "cfb27.upstreamTuningExportManifest.v1",
        "sourceRoot": str(root),
        "bridge": str(paths["bridge"]),
        "maddenFranchiseRoot": str(paths["maddenFranchiseRoot"]),
        "dynastyFilesRoot": str(paths["dynastyFiles"]),
        "tuningInput": str(paths["tuningInput"]),
        "outputDir": str(output_dir),
        "summaryPath": str(output_dir / "dynasty-tuning-binary_summary.json"),
        "batchManifestPath": str(output_dir / "_batch_manifest.json"),
        "bridgeWarningsPath": str(output_dir / "_bridge-warnings.log"),
        "batchResultPath": str(output_dir / "_batch_export-result.json"),
        "aggregatePath": str(aggregate_path),
        "selectedRecruitingTableCount": len(selected),
        "exportedTableCount": len(exported_tables),
        "csvTableCount": len(csv_outputs),
        "failedExportCount": len(failures),
        "failures": failures,
        "schemaWarningLineCount": len([line for line in stderr_text.splitlines() if line.strip()]),
    }
    manifest_path = output_dir / "_export_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return manifest


def export_tuning_tables(args: argparse.Namespace) -> dict:
    root = resolve_fb_roster_root(args.fb_roster_dir)
    paths = bridge_paths(root)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    summary_completed = run_bridge(
        paths,
        ["summary", str(paths["tuningInput"]), str(output_dir), "dynasty-tuning-binary"],
        cwd=APP_DIR,
    )
    summary_path = output_dir / "dynasty-tuning-binary_summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    _, selected = build_batch_manifest(summary, output_dir)
    batch_completed = run_bridge(
        paths,
        ["batch-export", str(paths["tuningInput"]), str(output_dir / "_batch_manifest.json")],
        cwd=APP_DIR,
    )
    batch_result = json.loads(batch_completed.stdout)
    (output_dir / "_batch_export-result.json").write_text(json.dumps(batch_result, indent=2), encoding="utf-8")
    stderr_text = "\n".join(
        text for text in [summary_completed.stderr, batch_completed.stderr] if text
    )
    (output_dir / "_bridge-warnings.log").write_text(stderr_text, encoding="utf-8")
    aggregate_path = args.aggregate_output.resolve() if args.aggregate_output else (
        output_dir.parent / "upstream-cfb27-recruiting-tuning-tables.json"
    )
    return write_exports_manifest(output_dir, aggregate_path, root, paths, summary, selected, batch_result, stderr_text)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export CFB27 recruiting tuning tables from upstream FB-Roster-Editor.")
    parser.add_argument("--fb-roster-dir", type=Path, default=DEFAULT_FB_ROSTER_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--aggregate-output", type=Path, help="Aggregate recruiting tuning table JSON output path")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    manifest = export_tuning_tables(parse_args(argv))
    print(json.dumps(manifest, indent=2, sort_keys=True))
    if manifest["failedExportCount"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
