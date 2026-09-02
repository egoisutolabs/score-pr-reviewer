"""Turn a fetched PR into a Brief with Claude structured output.

Two pure pieces (`build_analysis_input`, `repair_brief`) bracket one model
call so the prompt shape and the post-processing are testable without a key.
"""

from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from pydantic import ValidationError

from . import llm
from .schema import (
    REVIEW_BUDGET_MINUTES,
    Brief,
    ChangeMapEntry,
    FileRole,
    PRFile,
    PRMeta,
    ReadStep,
    SkipEntry,
    TimePlan,
)

DEFAULT_MODEL = "claude-opus-5"
MAX_TOKENS = 16000

# A single enormous file (a lockfile, a fixture) would otherwise crowd out
# every other patch; past 40k chars the tail rarely changes the verdict.
SINGLE_PATCH_LIMIT = 40_000
# Keeps the whole request comfortably inside the context window with room
# for thinking and a 16k-token answer.
TOTAL_BUDGET = 350_000
HEADLINE_LIMIT = 120

SYSTEM_PROMPT = """You are a senior engineer writing a review Brief for a pull request. The reader is a reviewer with FIFTEEN MINUTES for this PR in total — Brief included — and has not opened the diff yet. Your job is to compress the PR into the smallest set of sentences and visuals that let them spend those minutes well, and to tell them exactly where to spend them. Not to review it for them.

## The budget rules everything

- The Brief must be readable in three minutes. Cut anything that does not change what the reviewer does next.
- time_plan.read_first: the one to five files to open, in order, each with `minutes` and a one-clause `why` (what to look for). Minutes sum to at most twelve. Core behavior first; tests only when they are the fastest way to understand the behavior.
- time_plan.skip: every file the reviewer should NOT open in this budget (generated files, mechanical renames, mirrored test edits, docs), each with a one-clause reason. Between read_first and skip, account for the files that matter; a file in neither is "skim if time remains".
- verdict: approve | approve_with_nits | needs_changes | needs_discussion — the outcome a reviewer who follows the plan should reach. verdict_reason: one sentence.
- Checklist items are ordered by value and carry `minutes`; keep the total within the read_first budget.
- Length caps: intent at most three sentences; risk_reasons at most four; visuals at most four, and only when a visual saves reading time versus opening the diff; checklist at most six; questions_for_author at most three.

You receive the PR metadata, a file index, and every file's unified diff (some patches may be truncated or listed by name only; say so where it matters).

## Output: the Brief

- headline: one sentence, at most 120 characters, stating what the PR does in plain language. No trailing period needed.
- intent: two to four sentences — what changed and why, inferred from the code and the description. Plain language, no hedging filler.
- risk: low | medium | high. Base it on blast radius, reversibility, data/schema/auth/concurrency changes, and test coverage.
- risk_reasons: one to five short bullets, each a concrete reason (not "large PR").
- change_map: EVERY changed file exactly once — one entry per path in the file index, no extras, no omissions, no duplicates. role is one of core (the behavior change), supporting (plumbing the core needs), test, config, docs, generated (lockfiles, snapshots, codegen). summary is one line saying what changed in that file.
- visuals: one to six show-me blocks, most important first. Pick the smallest view that clarifies the point.
- checklist: what a reviewer should verify, anchored to a path and new-file line number where possible, with `minutes`. severity: info (worth a look), warn (likely problem), block (must fix before merge).
- verdict, verdict_reason, time_plan: see the budget rules above. Paths in time_plan must come from the file index.
- questions_for_author: zero to five questions only the author can answer. Leave empty when nothing is genuinely open.
- testing: what tests changed and what is untested.

## show-me vocabulary

Choose the visual kind by what it shows:
- pseudocode — logic. Plain-language steps of an algorithm or a changed code path.
- call_tree — runtime control flow: indented function/method names, caller above callee.
- component_tree — UI structure: `<Component>` names plus hooks, indented.
- file_tree — responsibility scope: `├──`/`└──` style tree of the files touched with a short note per node.
- mermaid — interaction or data flow: `flowchart`, `sequenceDiagram`, or `stateDiagram-v2` only.
- shape_diff — before/after of a shape: a type, a call tree, a layout. `before` and `after` are two plain-text blocks.
- code_block — copyable new code when the exact text matters; `language` is a highlighter id like ts, py, go.
- callout — a warning or a key fact; tone is info, warn, or danger.

Rules for every visual:
- body (and before/after) is plain text. Indent nesting with exactly two spaces per level. No markdown, no code fences, no backticks around the whole body.
- mermaid bodies must be valid Mermaid that starts with the diagram type keyword. No ``` fences. Quote labels containing punctuation. Keep them small — under fifteen nodes.
- refs point at real paths from the file index and at new-file line numbers (the right-hand side of the diff). Use null for the line when referring to the whole file. Do not invent paths.
- title says what the visual shows; caption (optional) says what to notice.
- Prefer the smallest view that makes the point. One visual that shows the mechanism beats three that restate the diff.

## Discipline

- Describe what the code does, not what the PR description claims, and flag disagreements.
- Never claim to have run code or tests.
- Keep everything concrete: name functions, files, and lines.
"""


def _truncate_patch(patch: str) -> str:
    if len(patch) <= SINGLE_PATCH_LIMIT:
        return patch
    dropped = len(patch) - SINGLE_PATCH_LIMIT
    return patch[:SINGLE_PATCH_LIMIT].rstrip("\n") + f"\n[truncated {dropped} chars]\n"


def _file_index_line(file: PRFile) -> str:
    rename = f" (from {file.previous_path})" if file.previous_path else ""
    return f"- {file.path}{rename} [{file.status}] +{file.additions} -{file.deletions}"


def build_analysis_input(pr: PRMeta, files: list[PRFile]) -> str:
    """The user turn for the analyze call: PR meta, file index, then patches within budget."""
    lines: list[str] = [
        f"# PR #{pr.number}: {pr.title}",
        f"repo: {pr.owner}/{pr.repo}",
        f"url: {pr.url}",
        f"author: {pr.author}",
        f"branches: {pr.head_ref} -> {pr.base_ref}",
        f"state: {pr.state}",
        f"size: +{pr.additions} -{pr.deletions} across {pr.changed_files} files",
        f"labels: {', '.join(pr.labels) if pr.labels else '(none)'}",
        "",
        "## Description",
        pr.body.strip() or "(no description)",
        "",
        "## File index (every changed file; change_map must cover exactly these paths)",
        *(_file_index_line(file) for file in files),
        "",
    ]

    prepared = [(file, _truncate_patch(file.patch)) for file in files]
    total = sum(len(patch) for _, patch in prepared)

    if total <= TOTAL_BUDGET:
        included = prepared
        omitted: list[PRFile] = []
    else:
        # Largest first: the big files are where the risk hides, and the small
        # ones are cheap to describe from the index alone.
        included = []
        omitted = []
        used = 0
        for file, patch in sorted(
            prepared, key=lambda item: len(item[1]), reverse=True
        ):
            if used + len(patch) <= TOTAL_BUDGET:
                included.append((file, patch))
                used += len(patch)
            else:
                omitted.append(file)

    lines.append("## Patches")
    if omitted:
        lines.append(
            f"NOTE: the diff exceeds the {TOTAL_BUDGET} character budget. {len(included)} patches are included "
            f"(largest first); {len(omitted)} files are listed by name only under 'Omitted patches'. "
            "Mention this in testing and risk_reasons; still include every file in change_map."
        )
    lines.append("")
    for file, patch in included:
        lines.append(f"### {file.path}")
        lines.append(
            patch.rstrip("\n") if patch else "(no patch available for this file)"
        )
        lines.append("")
    if omitted:
        lines.append("## Omitted patches (name only)")
        lines.extend(_file_index_line(file) for file in omitted)
        lines.append("")
    return "\n".join(lines)


_LOCKFILES = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
    "uv.lock",
    "poetry.lock",
    "pipfile.lock",
    "cargo.lock",
    "go.sum",
    "gemfile.lock",
    "composer.lock",
    "flake.lock",
}
_CONFIG_EXTENSIONS = {
    "yaml",
    "yml",
    "toml",
    "json",
    "ini",
    "cfg",
    "conf",
    "env",
    "properties",
    "editorconfig",
}
_CONFIG_NAMES = {
    "dockerfile",
    "makefile",
    "justfile",
    "procfile",
    "codeowners",
    "license",
    "licence",
}
_DOC_EXTENSIONS = {"md", "mdx", "rst", "txt", "adoc"}
_TEST_DIRS = {
    "test",
    "tests",
    "__tests__",
    "spec",
    "specs",
    "testing",
    "fixtures",
    "__snapshots__",
}
_TEST_FILE_RE = re.compile(
    r"(^test_.*\.py$)|(_test\.(go|py|rb|rs|ts|js)$)|(\.(test|spec)\.[cm]?[jt]sx?$)|(Test\.(java|kt|cs)$)"
)
_GENERATED_RE = re.compile(
    r"(\.snap$)|(\.generated\.)|(\.pb\.go$)|(_pb2(_grpc)?\.py$)|(\.min\.(js|css)$)|(\.d\.ts$)"
)


def guess_role(path: str) -> FileRole:
    """Path-only role guess for files the model failed to describe."""
    lowered = path.lower()
    parts = lowered.split("/")
    name = parts[-1]
    ext = name.rsplit(".", 1)[-1] if "." in name else ""
    dirs = set(parts[:-1])

    if (
        name in _LOCKFILES
        or _GENERATED_RE.search(name)
        or {"dist", "build", "vendor", "node_modules"} & dirs
    ):
        return "generated"
    if dirs & _TEST_DIRS or _TEST_FILE_RE.search(name):
        return "test"
    if (
        ext in _DOC_EXTENSIONS
        or "docs" in dirs
        or "doc" in dirs
        or name in {"readme", "changelog"}
    ):
        return "docs"
    if (
        ext in _CONFIG_EXTENSIONS
        or name in _CONFIG_NAMES
        or name.startswith(".")
        or ".config." in name
    ):
        return "config"
    return "supporting"


_FENCE_RE = re.compile(r"^\s*```[\w-]*\s*\n?|\n?\s*```\s*$")


def repair_brief(brief: Brief, files: list[PRFile]) -> Brief:
    """Deterministic fixes for the invariants the model most often breaks.

    Coverage of change_map is a hard contract (the file tree keys off it), so
    missing files are added with a path-guessed role and unknown paths dropped.
    """
    known = [file.path for file in files]
    known_set = set(known)

    seen: set[str] = set()
    entries: list[ChangeMapEntry] = []
    for entry in brief.change_map:
        if entry.path in known_set and entry.path not in seen:
            entries.append(entry)
            seen.add(entry.path)
    for path in known:
        if path not in seen:
            entries.append(
                ChangeMapEntry(
                    path=path,
                    role=guess_role(path),
                    summary="(not described by the model)",
                )
            )

    headline = " ".join(brief.headline.split())
    if len(headline) > HEADLINE_LIMIT:
        headline = headline[: HEADLINE_LIMIT - 1].rstrip() + "…"

    visuals = []
    for visual in brief.visuals:
        # Fenced mermaid is the one formatting slip that breaks rendering outright.
        if visual.kind == "mermaid":
            visual = visual.model_copy(
                update={"body": _FENCE_RE.sub("", visual.body).strip("\n")}
            )
        visuals.append(visual)

    return brief.model_copy(
        update={
            "headline": headline,
            "change_map": entries,
            "visuals": visuals,
            "time_plan": repair_time_plan(brief.time_plan, entries, known_set),
            "checklist": [
                item.model_copy(update={"path": item.path if item.path in known_set else None}) for item in brief.checklist
            ],
        }
    )


def repair_time_plan(plan: TimePlan, change_map: list[ChangeMapEntry], known: set[str]) -> TimePlan:
    """Keep the plan honest: real paths, no duplicates, minutes within budget.

    A model that skipped the plan gets one synthesised from the change map —
    core files first, three minutes each — because an empty plan defeats the
    point of the Brief, and the roles are a fair first approximation.
    """
    budget = plan.budget_minutes if 5 <= plan.budget_minutes <= 60 else REVIEW_BUDGET_MINUTES
    seen: set[str] = set()
    read_first: list[ReadStep] = []
    for step in plan.read_first:
        if step.path in known and step.path not in seen and len(read_first) < 5:
            seen.add(step.path)
            read_first.append(step.model_copy(update={"minutes": max(1, min(step.minutes, budget))}))
    if not read_first:
        order = {"core": 0, "supporting": 1, "config": 2, "test": 3, "docs": 4, "generated": 5}
        for entry in sorted(change_map, key=lambda e: order.get(e.role, 9)):
            if entry.role in {"generated", "docs"} or len(read_first) >= 4:
                continue
            seen.add(entry.path)
            read_first.append(ReadStep(path=entry.path, minutes=3, why=entry.summary[:120] or "changed behavior"))
    # Scale down proportionally when the model overspent; three minutes are
    # reserved for reading the Brief itself.
    available = max(1, budget - 3)
    total = sum(step.minutes for step in read_first)
    if total > available:
        scale = available / total
        read_first = [step.model_copy(update={"minutes": max(1, round(step.minutes * scale))}) for step in read_first]
    skip = [entry for entry in plan.skip if entry.path in known and entry.path not in seen]
    if not plan.skip:
        skip = [
            SkipEntry(path=entry.path, why=f"{entry.role} file; not needed to judge the behavior change")
            for entry in change_map
            if entry.role in {"generated", "docs"} and entry.path not in seen
        ]
    return TimePlan(budget_minutes=budget, read_first=read_first, skip=skip)


def model_name() -> str:
    return llm.model_name()


def make_model(**overrides: Any):
    """Provider-agnostic; see llm.py. Constructed lazily so importing this module never needs an API key."""
    return llm.make_chat_model(**overrides)


VISUAL_KINDS = {
    "pseudocode",
    "call_tree",
    "component_tree",
    "file_tree",
    "mermaid",
    "shape_diff",
    "code_block",
    "callout",
}
KIND_ALIASES = {
    "calltree": "call_tree",
    "call-tree": "call_tree",
    "componenttree": "component_tree",
    "component-tree": "component_tree",
    "filetree": "file_tree",
    "file-tree": "file_tree",
    "tree": "file_tree",
    "diagram": "mermaid",
    "flowchart": "mermaid",
    "sequence": "mermaid",
    "diff": "shape_diff",
    "shapediff": "shape_diff",
    "shape-diff": "shape_diff",
    "before_after": "shape_diff",
    "code": "code_block",
    "codeblock": "code_block",
    "code-block": "code_block",
    "snippet": "code_block",
    "note": "callout",
    "warning": "callout",
    "info": "callout",
    "pseudo": "pseudocode",
}
BODY_ALIASES = (
    "body",
    "content",
    "text",
    "code",
    "lines",
    "diagram",
    "definition",
    "source",
    "tree",
    "value",
)


def _as_text(value: Any) -> str | None:
    if isinstance(value, str):
        return value if value.strip() else None
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        joined = "\n".join(value)
        return joined if joined.strip() else None
    return None


def coerce_visual(raw: Any) -> dict | None:
    """Best-effort normalisation of one model-written visual, or None to drop it.

    Models drift on the small things — `content` for `body`, a list of lines,
    `calltree` for `call_tree` — and one such slip must not sink the whole
    Brief. Anything still missing its required text after aliasing is dropped;
    the Brief's other visuals survive.
    """
    if not isinstance(raw, dict):
        return None
    kind = (
        str(raw.get("kind") or raw.get("type") or "").strip().lower().replace(" ", "_")
    )
    kind = KIND_ALIASES.get(kind, kind)
    if kind not in VISUAL_KINDS:
        return None
    out: dict = {
        "kind": kind,
        "title": str(raw.get("title") or raw.get("name") or "").strip()
        or kind.replace("_", " ").title(),
        "caption": raw.get("caption") if isinstance(raw.get("caption"), str) else None,
        "refs": [
            {
                "path": ref["path"],
                "line": ref.get("line") if isinstance(ref.get("line"), int) else None,
            }
            for ref in (raw.get("refs") or [])
            if isinstance(ref, dict) and isinstance(ref.get("path"), str)
        ],
    }
    if kind == "shape_diff":
        before = next(
            (_as_text(raw[k]) for k in ("before", "old", "left", "from") if k in raw),
            None,
        )
        after = next(
            (_as_text(raw[k]) for k in ("after", "new", "right", "to") if k in raw),
            None,
        )
        if before is None or after is None:
            return None
        out.update(before=before, after=after)
        return out
    body = next(
        (text for k in BODY_ALIASES if (text := _as_text(raw.get(k))) is not None), None
    )
    if body is None:
        return None
    out["body"] = body
    if kind == "code_block":
        out["language"] = str(raw.get("language") or raw.get("lang") or "text")
    if kind == "callout":
        tone = str(raw.get("tone") or raw.get("level") or "info").lower()
        out["tone"] = (
            tone
            if tone in {"info", "warn", "danger"}
            else "warn"
            if tone in {"warning", "caution"}
            else "danger"
            if tone in {"error", "critical"}
            else "info"
        )
    return out


def coerce_brief(raw: Any) -> Any:
    """Apply coerce_visual to a Brief-shaped dict; non-dicts pass through untouched."""
    if not isinstance(raw, dict):
        return raw
    out = dict(raw)
    visuals = raw.get("visuals")
    if isinstance(visuals, list):
        out["visuals"] = [
            v for v in (coerce_visual(item) for item in visuals) if v is not None
        ]
    return out


def _payload_from_result(result: Any) -> Any:
    """Whatever the runnable returned, reduce it to a Brief or a Brief-shaped dict."""
    if isinstance(result, Brief):
        return result
    if isinstance(result, dict) and {"raw", "parsed", "parsing_error"} <= set(result):
        # include_raw=True shape: the parsed Brief when validation passed, else
        # the tool-call arguments (function calling) or the JSON text (json_schema).
        if isinstance(result["parsed"], Brief):
            return result["parsed"]
        raw = result["raw"]
        calls = getattr(raw, "tool_calls", None) or []
        if calls:
            return calls[0].get("args")
        content = getattr(raw, "content", raw)
        if isinstance(content, list):
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )
        try:
            return json.loads(content) if isinstance(content, str) else content
        except json.JSONDecodeError:
            return content
    return result


def _validation_summary(error: ValidationError, limit: int = 8) -> str:
    lines = [
        f"{'.'.join(str(p) for p in item['loc'])}: {item['msg']}"
        for item in error.errors()[:limit]
    ]
    more = len(error.errors()) - len(lines)
    return "; ".join(lines) + (f" (+{more} more)" if more > 0 else "")


async def analyze(
    pr: PRMeta,
    files: list[PRFile],
    model: Any | None = None,
    config: RunnableConfig | None = None,
) -> Brief:
    """Produce a repaired Brief.

    `model` is any runnable returning a Brief, a Brief-shaped dict, or the
    include_raw triple (tests inject a stub). `config` is passed through so the
    graph can silence token streaming for this call. A response that fails
    validation after coercion is sent back to the model once with the errors;
    only a second failure surfaces.
    """
    structured = (
        model
        if model is not None
        else make_model().with_structured_output(
            Brief, method=llm.structured_output_method(), include_raw=True
        )
    )
    messages: list[Any] = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=build_analysis_input(pr, files)),
    ]
    last_error: ValidationError | None = None
    for attempt in range(2):
        result = await structured.ainvoke(messages, config)
        payload = _payload_from_result(result)
        try:
            brief = (
                payload
                if isinstance(payload, Brief)
                else Brief.model_validate(coerce_brief(payload))
            )
            return repair_brief(brief, files)
        except ValidationError as error:
            last_error = error
            if attempt == 0:
                messages = [
                    *messages,
                    AIMessage(
                        content=json.dumps(payload, default=str)
                        if not isinstance(payload, str)
                        else payload
                    ),
                    HumanMessage(
                        content=(
                            "That Brief failed validation: "
                            f"{_validation_summary(error)}. Return the complete Brief again with those fields fixed. "
                            "Every visual needs kind, title, and a non-empty body (before and after for shape_diff)."
                        )
                    ),
                ]
    raise ValueError(
        f"the model's Brief failed validation twice: {_validation_summary(last_error)}"
    )  # type: ignore[arg-type]
