import json
import subprocess

import pytest

from src import github
from src.github import GhError, fetch_pr, parse_pr_url

URL = "https://github.com/acme/widgets/pull/7"

VIEW = {
    "number": 7,
    "title": "Add retries",
    "body": "Retries the gateway.",
    "author": {"login": "jo"},
    "baseRefName": "main",
    "headRefName": "retries",
    "additions": 3,
    "deletions": 2,
    "changedFiles": 2,
    "state": "OPEN",
    "createdAt": "2026-01-01T00:00:00Z",
    "labels": [{"name": "backend"}],
    "url": URL,
    "files": [{"path": "src/app.py", "additions": 3, "deletions": 2}, {"path": "huge.min.js", "additions": 0, "deletions": 0}],
}

DIFF = (
    "diff --git a/src/app.py b/src/app.py\n"
    "index 1111111..2222222 100644\n"
    "--- a/src/app.py\n"
    "+++ b/src/app.py\n"
    "@@ -1,2 +1,3 @@\n"
    "-a\n-b\n+c\n+d\n+e\n"
)


class Completed:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_parse_pr_url_accepts_browser_suffixes_and_rejects_others():
    assert parse_pr_url(URL) == ("acme", "widgets", 7)
    assert parse_pr_url(f"{URL}/files?diff=split#r1") == ("acme", "widgets", 7)
    assert parse_pr_url(f"  {URL}  ") == ("acme", "widgets", 7)
    for bad in ("https://github.com/acme/widgets", "https://gitlab.com/a/b/pull/1", "acme/widgets#7", ""):
        with pytest.raises(GhError):
            parse_pr_url(bad)


def test_fetch_pr_maps_missing_binary_to_gh_error(monkeypatch):
    def missing(*_args, **_kwargs):
        raise FileNotFoundError("gh")

    monkeypatch.setattr(github.subprocess, "run", missing)
    with pytest.raises(GhError, match="not installed"):
        fetch_pr(URL)


def test_fetch_pr_surfaces_gh_stderr(monkeypatch):
    def failing(*_args, **_kwargs):
        return Completed(returncode=4, stderr="To get started with GitHub CLI, please run:  gh auth login\n")

    monkeypatch.setattr(github.subprocess, "run", failing)
    with pytest.raises(GhError, match="gh auth login"):
        fetch_pr(URL)


def test_fetch_pr_reports_timeout(monkeypatch):
    def slow(*_args, **_kwargs):
        raise subprocess.TimeoutExpired(cmd="gh", timeout=180)

    monkeypatch.setattr(github.subprocess, "run", slow)
    with pytest.raises(GhError, match="timed out"):
        fetch_pr(URL)


def test_fetch_pr_builds_meta_and_files(monkeypatch):
    calls = []

    def fake_run(args, **_kwargs):
        calls.append(args)
        if args[:3] == ["gh", "pr", "view"]:
            return Completed(stdout=json.dumps(VIEW))
        if args[:3] == ["gh", "pr", "diff"]:
            return Completed(stdout=DIFF)
        raise AssertionError(f"unexpected gh call {args}")

    monkeypatch.setattr(github.subprocess, "run", fake_run)
    meta, files = fetch_pr(f"{URL}/files")

    assert calls[0][3] == URL and calls[1][3] == URL
    assert "--json" in calls[0]
    assert meta.owner == "acme" and meta.repo == "widgets" and meta.number == 7
    assert meta.author == "jo"
    assert meta.labels == ["backend"]
    assert meta.state == "OPEN"

    assert [file.path for file in files] == ["src/app.py", "huge.min.js"]
    assert files[0].status == "modified"
    assert (files[0].additions, files[0].deletions) == (3, 2)
    assert files[0].patch.startswith("diff --git a/src/app.py")
    # Listed by GitHub but absent from the diff: kept as a patch-less entry so change_map stays complete.
    assert files[1].patch == ""
    assert files[1].language == "js"
