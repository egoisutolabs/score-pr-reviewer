"""GitHub access through the `gh` CLI, plus a pure unified-diff parser.

`gh` is the only network path: it already holds the user's auth and handles
enterprise hosts, so we shell out instead of speaking the REST API ourselves.
Everything after the subprocess call is deterministic and unit-testable.
"""

from __future__ import annotations

import json
import re
import subprocess

from .schema import FileStatus, PRFile, PRMeta

# Trailing `/files`, `?diff=split`, `#issuecomment-…` are accepted because that's
# what people paste from the browser; only the owner/repo/number matter.
PR_URL_RE = re.compile(r"^https://github\.com/([\w.-]+)/([\w.-]+)/pull/(\d+)(?:[/?#].*)?$")

# Extension → shiki language id. Anything not listed renders unhighlighted,
# which is better than guessing wrong.
LANGUAGE_BY_EXTENSION: dict[str, str] = {
    "ts": "ts",
    "tsx": "tsx",
    "js": "js",
    "jsx": "jsx",
    "mjs": "js",
    "cjs": "js",
    "py": "py",
    "go": "go",
    "rs": "rs",
    "java": "java",
    "kt": "kt",
    "rb": "rb",
    "php": "php",
    "cs": "cs",
    "c": "c",
    "cpp": "cpp",
    "h": "c",
    "swift": "swift",
    "sh": "sh",
    "yaml": "yaml",
    "yml": "yaml",
    "json": "json",
    "md": "md",
    "css": "css",
    "scss": "scss",
    "html": "html",
    "sql": "sql",
    "toml": "toml",
    "proto": "proto",
}

BINARY_MARKER = "Binary file"

# `gh pr view --json` fields we read. Kept as one string so the command in
# error messages matches exactly what ran.
PR_VIEW_FIELDS = (
    "number,title,body,author,baseRefName,headRefName,additions,deletions,"
    "changedFiles,state,createdAt,labels,url,files"
)

_DIFF_HEADER_RE = re.compile(r"^diff --git a/(.+) b/(.+)$")


class GhError(RuntimeError):
    """`gh` could not produce the PR: not installed, not authenticated, PR missing, URL malformed."""


def parse_pr_url(url: str) -> tuple[str, str, int]:
    match = PR_URL_RE.match(url.strip())
    if not match:
        raise GhError(
            f"Not a GitHub pull request URL: {url!r}. Expected https://github.com/{{owner}}/{{repo}}/pull/{{number}}."
        )
    owner, repo, number = match.groups()
    return owner, repo, int(number)


def guess_language(path: str) -> str | None:
    name = path.rsplit("/", 1)[-1]
    if "." not in name:
        return None
    return LANGUAGE_BY_EXTENSION.get(name.rsplit(".", 1)[-1].lower())


def _split_git_header_paths(line: str) -> tuple[str, str] | None:
    """Recover (a_path, b_path) from `diff --git a/X b/Y`.

    Paths may contain spaces, so `" b/"` is ambiguous. For the common case where
    both sides are the same path, the remainder is `a/P b/P`, which splits
    cleanly in the middle; otherwise fall back to the greedy regex match.
    """
    match = _DIFF_HEADER_RE.match(line)
    if not match:
        return None
    rest = line[len("diff --git ") :]
    if len(rest) % 2 == 1:
        mid = len(rest) // 2
        left, right = rest[:mid], rest[mid + 1 :]
        if rest[mid] == " " and left.startswith("a/") and right.startswith("b/") and left[2:] == right[2:]:
            return left[2:], right[2:]
    return match.group(1), match.group(2)


def _strip_prefix(path_line: str, prefix: str) -> str | None:
    """`--- a/path` / `+++ b/path` → `path`; `/dev/null` → None. Tabs after the path are dropped."""
    body = path_line[len(prefix) :].split("\t", 1)[0]
    if body == "/dev/null":
        return None
    return body[2:] if body.startswith(("a/", "b/")) else body


def _parse_file_block(lines: list[str]) -> PRFile:
    """One `diff --git` block → PRFile. Lines carry no trailing newline."""
    header_paths = _split_git_header_paths(lines[0])
    a_path, b_path = header_paths if header_paths else (lines[0], lines[0])

    status: FileStatus = "modified"
    rename_from: str | None = None
    rename_to: str | None = None
    minus_path: str | None = None
    plus_path: str | None = None
    is_binary = False
    additions = 0
    deletions = 0
    in_hunks = False
    header_end = len(lines)

    for index, line in enumerate(lines):
        if in_hunks:
            # `\ No newline at end of file` starts with a backslash and is neither.
            if line.startswith("+"):
                additions += 1
            elif line.startswith("-"):
                deletions += 1
            continue
        if line.startswith("@@"):
            in_hunks = True
            continue
        if line.startswith("new file mode"):
            status = "added"
        elif line.startswith("deleted file mode"):
            status = "removed"
        elif line.startswith("rename from "):
            rename_from = line[len("rename from ") :]
            status = "renamed"
        elif line.startswith("rename to "):
            rename_to = line[len("rename to ") :]
            status = "renamed"
        elif line.startswith("--- "):
            minus_path = _strip_prefix(line, "--- ")
        elif line.startswith("+++ "):
            plus_path = _strip_prefix(line, "+++ ")
        elif line.startswith("Binary files ") or line == "GIT binary patch":
            is_binary = True
            # The binary payload (or the one-line marker) ends the useful text.
            header_end = index
            break

    if status == "removed":
        path = minus_path or a_path
    else:
        path = rename_to or plus_path or b_path
    previous_path = rename_from if status == "renamed" else None

    if is_binary:
        # @pierre/diffs needs the `diff --git` header to identify the file; the
        # payload itself is unrenderable, so we replace it with a marker line.
        patch = "\n".join([*lines[:header_end], f"{BINARY_MARKER}s a/{a_path} and b/{b_path} differ"]) + "\n"
    else:
        patch = "\n".join(lines) + "\n"

    return PRFile(
        path=path,
        previous_path=previous_path,
        status=status,
        additions=additions,
        deletions=deletions,
        patch=patch,
        language=guess_language(path),
    )


def parse_unified_diff(diff_text: str) -> list[PRFile]:
    """Split `git diff` output into per-file patches. Pure; order follows the diff."""
    if not diff_text.strip():
        return []
    blocks: list[list[str]] = []
    for line in diff_text.splitlines():
        # Content lines inside hunks always carry a +/-/space prefix, so a bare
        # `diff --git` can only be a file boundary.
        if line.startswith("diff --git "):
            blocks.append([line])
        elif blocks:
            blocks[-1].append(line)
        # Preamble before the first header (never emitted by gh) is dropped.
    return [_parse_file_block(block) for block in blocks]


def _run_gh(args: list[str]) -> str:
    try:
        completed = subprocess.run(
            ["gh", *args],
            capture_output=True,
            text=True,
            check=False,
            timeout=180,
        )
    except FileNotFoundError as exc:
        raise GhError(
            "The GitHub CLI (`gh`) is not installed or not on PATH. Install it from https://cli.github.com "
            "and run `gh auth login`."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise GhError(f"`gh {' '.join(args[:2])}` timed out after 180s.") from exc
    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        raise GhError(stderr or f"`gh {' '.join(args)}` exited with status {completed.returncode}.")
    return completed.stdout


def _meta_from_view(owner: str, repo: str, view: dict) -> PRMeta:
    author = view.get("author") or {}
    return PRMeta(
        owner=owner,
        repo=repo,
        number=int(view["number"]),
        url=view.get("url") or f"https://github.com/{owner}/{repo}/pull/{view['number']}",
        title=view.get("title") or "",
        body=view.get("body") or "",
        author=author.get("login") or author.get("name") or "unknown",
        base_ref=view.get("baseRefName") or "",
        head_ref=view.get("headRefName") or "",
        state=view.get("state") or "OPEN",
        additions=int(view.get("additions") or 0),
        deletions=int(view.get("deletions") or 0),
        changed_files=int(view.get("changedFiles") or 0),
        created_at=view.get("createdAt") or "",
        labels=[label["name"] for label in view.get("labels") or [] if label.get("name")],
    )


def fetch_pr(url: str) -> tuple[PRMeta, list[PRFile]]:
    """Fetch metadata and per-file patches for a PR URL. Raises GhError on any failure."""
    owner, repo, _number = parse_pr_url(url)
    canonical = f"https://github.com/{owner}/{repo}/pull/{_number}"

    raw_view = _run_gh(["pr", "view", canonical, "--json", PR_VIEW_FIELDS])
    try:
        view = json.loads(raw_view)
    except json.JSONDecodeError as exc:
        raise GhError(f"Could not parse `gh pr view` output: {exc}") from exc
    meta = _meta_from_view(owner, repo, view)

    files = parse_unified_diff(_run_gh(["pr", "diff", canonical]))

    # The diff is the source of truth for patches, but GitHub's file list can
    # name files the diff omits (e.g. huge or vendored files it refuses to
    # render). Add those as patch-less entries so change_map stays complete.
    seen = {file.path for file in files}
    for entry in view.get("files") or []:
        path = entry.get("path")
        if not path or path in seen:
            continue
        files.append(
            PRFile(
                path=path,
                previous_path=None,
                status="modified",
                additions=int(entry.get("additions") or 0),
                deletions=int(entry.get("deletions") or 0),
                patch="",
                language=guess_language(path),
            )
        )
    return meta, files
