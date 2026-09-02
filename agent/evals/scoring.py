"""Deterministic per-case scoring for Briefs.

Pure functions over plain dicts so the scorer runs in unit tests with a canned
Brief and no API key. The only project import is the schema: scoring must not
depend on `analyze`, otherwise a broken analyzer would take the scorer down
with it and we would lose the ability to score saved reports.
"""

from __future__ import annotations

import json
import re
from typing import Any

from pydantic import TypeAdapter, ValidationError

from src.schema import Brief, Visual

HEADLINE_MAX = 120

# The mermaid renderer on the frontend only accepts these diagram types
# (`stateDiagram` also covers `stateDiagram-v2`).
MERMAID_STARTS = ("flowchart", "graph", "sequenceDiagram", "stateDiagram", "classDiagram", "erDiagram")

# Weights of the non-gate metrics; they sum to 100. `mentions` is fractional,
# everything else is all-or-nothing.
WEIGHTS: dict[str, int] = {
    "headline_ok": 8,
    "mentions": 18,
    "mentions_any_ok": 8,
    "forbidden_ok": 8,
    "visuals_ok": 12,
    "mermaid_ok": 8,
    "refs_ok": 8,
    "risk_ok": 8,
    "roles_ok": 4,
    "time_plan_ok": 10,
    "verdict_ok": 4,
    "length_ok": 4,
}

# The reader's budget the Brief is sized against; mirrors schema.REVIEW_BUDGET_MINUTES.
BUDGET_MINUTES = 15
VERDICTS = {"approve", "approve_with_nits", "needs_changes", "needs_discussion"}

# Fail either of these and the score is 0 regardless of the rest: a Brief that
# does not parse cannot be rendered, and one that drops a file has failed the
# contract's one hard rule ("EVERY changed file appears exactly once").
GATES = ("schema_valid", "files_covered")

_VISUAL_ADAPTER: TypeAdapter[Any] = TypeAdapter(Visual)


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_dicts(value: Any) -> list[dict[str, Any]]:
    return [v for v in _as_list(value) if isinstance(v, dict)]


def _str(value: Any) -> str:
    return value if isinstance(value, str) else ""


def case_paths(case: dict[str, Any]) -> list[str]:
    return [f["path"] for f in _as_dicts(case.get("files")) if isinstance(f.get("path"), str)]


def schema_valid(brief: Any) -> bool:
    try:
        Brief.model_validate(brief)
    except ValidationError:
        return False
    return isinstance(brief, dict)


def files_covered(case: dict[str, Any], brief: dict[str, Any]) -> bool:
    expected = case_paths(case)
    listed = [_str(e.get("path")) for e in _as_dicts(brief.get("change_map"))]
    # An invented path is as wrong as a missing one: the frontend's file tree
    # joins change_map to the PR's files by path, so extras dangle.
    return all(listed.count(p) == 1 for p in expected) and all(p in expected for p in listed)


def headline_ok(brief: dict[str, Any]) -> bool:
    headline = _str(brief.get("headline")).strip()
    return 0 < len(headline) <= HEADLINE_MAX


def mention_text(brief: dict[str, Any]) -> str:
    """The prose a reviewer actually reads first: headline, intent, risk, visual bodies."""
    parts = [_str(brief.get("headline")), _str(brief.get("intent"))]
    parts.extend(_str(r) for r in _as_list(brief.get("risk_reasons")))
    for visual in _as_dicts(brief.get("visuals")):
        parts.extend(_str(visual.get(k)) for k in ("body", "before", "after"))
    return "\n".join(parts)


def full_text(brief: dict[str, Any]) -> str:
    """Everything, including checklist and summaries — used for forbidden phrases."""
    try:
        return json.dumps(brief, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(brief)


def _contains(haystack: str, needle: str) -> bool:
    return needle.lower() in haystack.lower()


def mentions(case: dict[str, Any], brief: dict[str, Any]) -> float:
    required = [_str(m) for m in _as_list(case.get("expect", {}).get("must_mention")) if _str(m)]
    if not required:
        return 1.0
    text = mention_text(brief)
    return sum(1 for m in required if _contains(text, m)) / len(required)


def mentions_any_ok(case: dict[str, Any], brief: dict[str, Any]) -> bool:
    options = [_str(m) for m in _as_list(case.get("expect", {}).get("must_mention_any")) if _str(m)]
    if not options:
        return True
    text = mention_text(brief)
    return any(_contains(text, m) for m in options)


def forbidden_ok(case: dict[str, Any], brief: dict[str, Any]) -> bool:
    banned = [_str(m) for m in _as_list(case.get("expect", {}).get("must_not_mention")) if _str(m)]
    text = full_text(brief)
    return not any(_contains(text, m) for m in banned)


def _visual_valid(visual: Any) -> bool:
    try:
        _VISUAL_ADAPTER.validate_python(visual)
    except ValidationError:
        return False
    return True


def visuals_ok(case: dict[str, Any], brief: dict[str, Any]) -> bool:
    visuals = _as_list(brief.get("visuals"))
    minimum = case.get("expect", {}).get("min_visuals", 0)
    minimum = minimum if isinstance(minimum, int) else 0
    return len(visuals) >= minimum and all(_visual_valid(v) for v in visuals)


def mermaid_body_ok(body: str) -> bool:
    if "```" in body:
        return False
    first = next((line.strip() for line in body.splitlines() if line.strip()), "")
    return first.startswith(MERMAID_STARTS)


def mermaid_ok(brief: dict[str, Any]) -> bool:
    bodies = [_str(v.get("body")) for v in _as_dicts(brief.get("visuals")) if v.get("kind") == "mermaid"]
    return all(mermaid_body_ok(b) for b in bodies)


def refs_ok(case: dict[str, Any], brief: dict[str, Any]) -> bool:
    known = set(case_paths(case))
    for visual in _as_dicts(brief.get("visuals")):
        for ref in _as_dicts(visual.get("refs")):
            if ref.get("path") not in known:
                return False
    # Checklist anchors are refs too: `open_file` on an unknown path is a dead link.
    for item in _as_dicts(brief.get("checklist")):
        path = item.get("path")
        if path is not None and path not in known:
            return False
    return True


def risk_ok(case: dict[str, Any], brief: dict[str, Any]) -> bool:
    allowed = _as_list(case.get("expect", {}).get("risk_in"))
    return not allowed or brief.get("risk") in allowed


def roles_ok(case: dict[str, Any], brief: dict[str, Any]) -> bool:
    expected = case.get("expect", {}).get("roles")
    if not isinstance(expected, dict) or not expected:
        return True
    actual = {_str(e.get("path")): e.get("role") for e in _as_dicts(brief.get("change_map"))}
    return all(actual.get(path) == role for path, role in expected.items())


def time_plan_ok(case: dict[str, Any], brief: dict[str, Any]) -> bool:
    """One to five real files in reading order, minutes summing within the budget minus three for the Brief."""
    plan = brief.get("time_plan")
    if not isinstance(plan, dict):
        return False
    steps = _as_dicts(plan.get("read_first"))
    if not 1 <= len(steps) <= 5:
        return False
    paths = set(case_paths(case))
    seen: set[str] = set()
    total = 0
    for step in steps:
        path, minutes = step.get("path"), step.get("minutes")
        if path not in paths or path in seen or not isinstance(minutes, int) or minutes < 1:
            return False
        seen.add(path)
        total += minutes
    budget = plan.get("budget_minutes") if isinstance(plan.get("budget_minutes"), int) else BUDGET_MINUTES
    if total > budget - 3:
        return False
    return all(entry.get("path") in paths and entry.get("path") not in seen for entry in _as_dicts(plan.get("skip")))


def verdict_ok(brief: dict[str, Any]) -> bool:
    return brief.get("verdict") in VERDICTS and bool(_str(brief.get("verdict_reason")).strip())


def length_ok(brief: dict[str, Any]) -> bool:
    """The Brief must be readable in three minutes: caps on prose and item counts."""
    intent_words = len(_str(brief.get("intent")).split())
    return (
        intent_words <= 90
        and len(_as_list(brief.get("risk_reasons"))) <= 4
        and len(_as_list(brief.get("visuals"))) <= 4
        and len(_as_list(brief.get("checklist"))) <= 6
        and len(_as_list(brief.get("questions_for_author"))) <= 3
    )


def score_case(case: dict[str, Any], brief: Any) -> dict[str, Any]:
    """Score one Brief (as a dict) against a case's `expect` block. Never raises."""
    b: dict[str, Any] = brief if isinstance(brief, dict) else {}
    result: dict[str, Any] = {
        "schema_valid": schema_valid(brief),
        "files_covered": files_covered(case, b),
        "headline_ok": headline_ok(b),
        "mentions": mentions(case, b),
        "mentions_any_ok": mentions_any_ok(case, b),
        "forbidden_ok": forbidden_ok(case, b),
        "visuals_ok": visuals_ok(case, b),
        "mermaid_ok": mermaid_ok(b),
        "refs_ok": refs_ok(case, b),
        "risk_ok": risk_ok(case, b),
        "roles_ok": roles_ok(case, b),
        "time_plan_ok": time_plan_ok(case, b),
        "verdict_ok": verdict_ok(b),
        "length_ok": length_ok(b),
    }
    if not all(result[g] for g in GATES):
        result["score"] = 0
        return result
    total = 0.0
    for key, weight in WEIGHTS.items():
        value = result[key]
        total += weight * (value if isinstance(value, float) else float(bool(value)))
    result["score"] = round(total)
    return result


def _cell(value: Any) -> str:
    if isinstance(value, bool):
        return "ok" if value else "FAIL"
    if isinstance(value, float):
        return f"{value:.0%}"
    return "" if value is None else str(value)


_COLUMNS = (
    ("score", "score"),
    ("schema_valid", "schema"),
    ("files_covered", "files"),
    ("headline_ok", "headline"),
    ("mentions", "mentions"),
    ("mentions_any_ok", "any"),
    ("forbidden_ok", "forbidden"),
    ("visuals_ok", "visuals"),
    ("mermaid_ok", "mermaid"),
    ("refs_ok", "refs"),
    ("risk_ok", "risk"),
    ("roles_ok", "roles"),
    ("time_plan_ok", "plan"),
    ("verdict_ok", "verdict"),
    ("length_ok", "length"),
)


def summarize_report(results: list[dict[str, Any]]) -> str:
    """Markdown table for a list of `{case, scores, judge?, error?}` results."""
    has_judge = any(isinstance(r.get("judge"), dict) for r in results)
    header = ["case", *(label for _, label in _COLUMNS)]
    if has_judge:
        header.append("judge")
    rows = [header, ["---"] * len(header)]
    for r in results:
        scores = r.get("scores") or {}
        row = [_str(r.get("case")) or "?"]
        if r.get("error"):
            row.extend(["0", f"error: {_one_line(r['error'])}"] + [""] * (len(_COLUMNS) - 2))
        else:
            row.extend(_cell(scores.get(key)) for key, _ in _COLUMNS)
        if has_judge:
            judge = r.get("judge")
            row.append(f"{judge.get('faithfulness')}/5" if isinstance(judge, dict) else "")
        rows.append(row)
    return "\n".join("| " + " | ".join(row) + " |" for row in rows)


def _one_line(text: str, limit: int = 80) -> str:
    flat = re.sub(r"\s+", " ", text).strip()
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"
