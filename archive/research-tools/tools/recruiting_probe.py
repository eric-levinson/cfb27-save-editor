from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


APP_DIR = Path(__file__).resolve().parents[1]
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from server import FBChunks, atomic_write_bytes  # noqa: E402


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def default_output_path(source: Path) -> Path:
    base = source.with_name(f"{source.name}-MODDED-RECRUITING-PROBE-ACTION")
    for suffix in ["", *[f"-{index}" for index in range(2, 100)]]:
        candidate = source.with_name(f"{base.name}{suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError("Could not allocate a unique recruiting probe output path")


def run_node_probe(payload_path: Path, patch_path: Path, output_payload_path: Path) -> dict:
    command = [
        "node",
        str(APP_DIR / "franchise_helper.js"),
        "recruiting-probe-action",
        str(payload_path),
        str(patch_path),
        str(output_payload_path),
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=APP_DIR,
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.CalledProcessError as exc:
        details = {
            "command": exc.cmd,
            "returncode": exc.returncode,
            "stdout": exc.stdout,
            "stderr": exc.stderr,
        }
        raise RuntimeError(f"Node recruiting probe failed: {json.dumps(details, indent=2)}") from exc
    return json.loads(completed.stdout)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a copy-first recruiting action probe save.")
    parser.add_argument("--source", required=True, type=Path, help="Source FBCHUNKS dynasty save")
    parser.add_argument("--output", type=Path, help="Output modded save copy")
    parser.add_argument("--user-target-row", type=int, default=1, help="UserRecruitTarget row to edit")
    parser.add_argument("--action", help="Weekly action boolean to enable, e.g. SearchSocialMedia or SendTheHouse")
    parser.add_argument("--disable", action="store_true", help="Disable the selected action instead of enabling it")
    parser.add_argument("--patch-json", type=Path, help="JSON file with boardRow, adjustBoardHours, and patches[]")
    parser.add_argument("--board-row", type=int, default=87, help="RecruitingBoard row to reconcile hours against")
    parser.add_argument("--no-board-hours", action="store_true", help="Do not adjust RecruitingBoard.RecruitingHoursAssigned")
    parser.add_argument(
        "--sway-pitch",
        help=(
            "Experimental: patch UserRecruitTarget.SwayPitch, e.g. AspirationalGoals, "
            "RecruitingPitchType:AspirationalGoals, or a schema-accepted enum value"
        ),
    )
    parser.add_argument(
        "--scholarship-status",
        help="Experimental: patch UserRecruitTarget.ScholarshipStatus, e.g. Committed",
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Experimental shorthand for --scholarship-status Committed",
    )
    parser.add_argument(
        "--committed-week",
        type=int,
        help="Experimental: patch UserRecruitTarget.CommittedWeekNumber",
    )
    parser.add_argument(
        "--active-pitch-row",
        type=int,
        help="Experimental: explicit ActiveRecruitingPitch row to patch for sell/sway experiments",
    )
    parser.add_argument(
        "--active-pitch-index",
        type=int,
        default=0,
        help=(
            "Experimental: ActivePitches list index for --user-target-row when "
            "--active-pitch-row is omitted"
        ),
    )
    parser.add_argument(
        "--pitch",
        help="Experimental: patch ActiveRecruitingPitch.Pitch, e.g. Aspirational or a raw 5-bit value",
    )
    parser.add_argument(
        "--pitch-intensity",
        help="Experimental: patch ActiveRecruitingPitch.Intensity, e.g. Soft Sell, Hard Sell, Sway, or raw value",
    )
    parser.add_argument(
        "--replace-active",
        action="store_true",
        help="Back up the source save, then write the probe back to the source filename",
    )
    return parser.parse_args()


def load_probe_patch(args: argparse.Namespace) -> dict:
    if args.patch_json:
        patch = json.loads(args.patch_json.read_text(encoding="utf-8"))
        if "boardRow" not in patch:
            patch["boardRow"] = args.board_row
        if "adjustBoardHours" not in patch:
            patch["adjustBoardHours"] = not args.no_board_hours
        return patch
    patches = []
    field_patches = []
    action = args.action
    if action:
        patches.append({
            "userRecruitTargetRow": args.user_target_row,
            "actionField": action,
            "enabled": not args.disable,
        })
    scholarship_status = "Committed" if args.commit else args.scholarship_status
    if args.sway_pitch:
        field_patches.append({
            "table": "UserRecruitTarget",
            "row": args.user_target_row,
            "field": "SwayPitch",
            "value": args.sway_pitch,
            "experimental": True,
        })
    if scholarship_status:
        field_patches.append({
            "table": "UserRecruitTarget",
            "row": args.user_target_row,
            "field": "ScholarshipStatus",
            "value": scholarship_status,
            "experimental": True,
        })
    if args.committed_week is not None:
        field_patches.append({
            "table": "UserRecruitTarget",
            "row": args.user_target_row,
            "field": "CommittedWeekNumber",
            "value": args.committed_week,
            "experimental": True,
        })
    if args.pitch or args.pitch_intensity:
        active_pitch_target = (
            {"row": args.active_pitch_row}
            if args.active_pitch_row is not None
            else {
                "userRecruitTargetRow": args.user_target_row,
                "activePitchIndex": args.active_pitch_index,
            }
        )
        if args.pitch:
            field_patches.append({
                "table": "ActiveRecruitingPitch",
                "field": "Pitch",
                "value": args.pitch,
                "experimental": True,
                **active_pitch_target,
            })
        if args.pitch_intensity:
            field_patches.append({
                "table": "ActiveRecruitingPitch",
                "field": "Intensity",
                "value": args.pitch_intensity,
                "experimental": True,
                **active_pitch_target,
            })
    if not patches and not field_patches:
        patches.append({
            "userRecruitTargetRow": args.user_target_row,
            "actionField": "SearchSocialMedia",
            "enabled": not args.disable,
        })
    return {
        "patches": patches,
        "fieldPatches": field_patches,
        "boardRow": args.board_row,
        "adjustBoardHours": not args.no_board_hours,
    }


def backup_path(source: Path) -> Path:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    base = source.with_name(f"{source.name}.BACKUP-RECRUITING-PROBE-{timestamp}")
    for suffix in ["", *[f"-{index}" for index in range(2, 100)]]:
        candidate = source.with_name(f"{base.name}{suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError("Could not allocate a unique recruiting probe backup path")


def main() -> int:
    args = parse_args()
    source = args.source.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    output = source if args.replace_active else (args.output.resolve() if args.output else default_output_path(source))
    if output.exists() and output != source:
        raise FileExistsError(output)
    if output.parent != source.parent:
        raise RuntimeError("Probe output must be written beside the source save")

    source_bytes = source.read_bytes()
    container = FBChunks.parse(source_bytes)
    with tempfile.TemporaryDirectory(prefix="cfb27-recruiting-probe-") as temp_dir:
        temp = Path(temp_dir)
        before_payload = temp / "before.frk"
        after_payload = temp / "after.frk"
        patch_path = temp / "probe.json"
        before_payload.write_bytes(container.decompressed_payload)
        patch = load_probe_patch(args)
        patch_path.write_text(json.dumps(patch), encoding="utf-8")
        node_report = run_node_probe(before_payload, patch_path, after_payload)
        new_payload = after_payload.read_bytes()

    rebuilt = container.rebuild(new_payload)
    FBChunks.parse(rebuilt)
    backup: Path | None = None
    if args.replace_active:
        current_source_bytes = source.read_bytes()
        if sha256_hex(current_source_bytes) != sha256_hex(source_bytes):
            raise RuntimeError("Source save changed while preparing probe; refusing to replace active file")
        backup = backup_path(source)
        shutil.copy2(source, backup)
    atomic_write_bytes(output, rebuilt)
    readback = FBChunks.parse(output.read_bytes())
    report = {
        "kind": "cfb27.recruitingProbeSave.v1",
        "source": {
            "path": str(source),
            "file": source.name,
            "saveSha256": sha256_hex(source_bytes),
            "payloadSha256": sha256_hex(container.decompressed_payload),
        },
        "output": {
            "path": str(output),
            "file": output.name,
            "saveSha256": sha256_hex(rebuilt),
            "payloadSha256": sha256_hex(readback.decompressed_payload),
        },
        "writeMode": "replace-active" if args.replace_active else "copy",
        "backup": {
            "path": str(backup),
            "file": backup.name,
            "saveSha256": sha256_hex(backup.read_bytes()),
        } if backup else None,
        "sourceUnchanged": False if args.replace_active else sha256_hex(source.read_bytes()) == sha256_hex(source_bytes),
        "probe": node_report,
    }
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
