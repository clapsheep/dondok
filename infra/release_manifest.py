#!/usr/bin/env python3
"""Resolve only successful main CI artifacts; never execute artifact contents."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

REPOSITORY = "clapsheep/dondok"
SHA = re.compile(r"[0-9a-f]{40}")
DIGEST = r"sha256:[0-9a-f]{64}"


def validate(value, revision, run_id, attempt):
    expected = {
        "schemaVersion": 1, "repository": REPOSITORY, "revision": revision,
        "runId": int(run_id), "runAttempt": int(attempt), "platform": "linux/arm64",
    }
    if not SHA.fullmatch(revision) or int(run_id) < 1 or int(attempt) < 1:
        raise ValueError("Invalid release identity")
    if any(value.get(key) != item for key, item in expected.items()):
        raise ValueError("Release identity does not match the successful main CI run")
    images = value.get("images", {})
    if set(images) != {"backend", "frontend"}:
        raise ValueError("Release must contain both application images")
    for service, image in images.items():
        if not isinstance(image, str) or not re.fullmatch(
            rf"ghcr\.io/{REPOSITORY}-{service}@{DIGEST}", image
        ):
            raise ValueError("Release image must use the expected repository and digest")
    return value


def gh_json(endpoint):
    result = subprocess.run(["gh", "api", endpoint], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def fetch(revision, output):
    if not SHA.fullmatch(revision):
        raise ValueError("Invalid revision")
    if gh_json(f"repos/{REPOSITORY}/commits/main")["sha"] != revision:
        raise ValueError("Requested revision is no longer latest main")
    runs = gh_json(
        f"repos/{REPOSITORY}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha={revision}&per_page=20"
    )["workflow_runs"]
    candidates = [run for run in runs if run["head_sha"] == revision and run["event"] == "push"
                  and run["head_branch"] == "main" and run["path"] == ".github/workflows/ci.yml"
                  and run["repository"]["full_name"] == REPOSITORY]
    if not candidates:
        raise ValueError("No main CI run for this revision")
    run = max(candidates, key=lambda item: item["id"])
    if run["status"] != "completed" or run["conclusion"] != "success":
        raise ValueError("Latest main CI run has not succeeded")
    run_id, attempt = run["id"], run["run_attempt"]
    with tempfile.TemporaryDirectory(prefix="dondok-release-") as directory:
        subprocess.run([
            "gh", "run", "download", str(run_id), "--repo", REPOSITORY,
            "--name", f"release-manifest-{attempt}", "--dir", directory,
        ], check=True, capture_output=True)
        value = validate(json.loads((Path(directory) / "release.json").read_text()), revision, run_id, attempt)
    # A rerun or a new merge during artifact retrieval invalidates this approval.
    latest_run = gh_json(f"repos/{REPOSITORY}/actions/runs/{run_id}")
    if (latest_run["run_attempt"] != attempt or latest_run["status"] != "completed"
            or latest_run["conclusion"] != "success"
            or gh_json(f"repos/{REPOSITORY}/commits/main")["sha"] != revision):
        raise ValueError("Release approval changed while resolving artifacts")
    Path(output).write_text(json.dumps(value, indent=2) + "\n")
    Path(output).chmod(0o600)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    resolver = sub.add_parser("fetch")
    resolver.add_argument("--revision", required=True)
    resolver.add_argument("--output", required=True)
    sub.add_parser("create")
    args = parser.parse_args()
    if args.command == "fetch":
        fetch(args.revision, args.output)
    else:
        value = {
            "schemaVersion": 1, "repository": REPOSITORY,
            "revision": os.environ["GITHUB_SHA"], "runId": int(os.environ["GITHUB_RUN_ID"]),
            "runAttempt": int(os.environ["GITHUB_RUN_ATTEMPT"]), "platform": "linux/arm64",
            "images": {service: os.environ[f"{service.upper()}_IMAGE"] for service in ("backend", "frontend")},
        }
        validate(value, value["revision"], value["runId"], value["runAttempt"])
        print(json.dumps(value, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError):
        raise SystemExit("Release resolution failed: require latest successful main CI and a valid ARM64 manifest")
