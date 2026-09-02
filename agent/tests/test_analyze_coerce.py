"""Model-written visuals drift on small things; coercion must absorb the common slips and drop only the hopeless."""

import asyncio
from typing import ClassVar

import pytest

from src.analyze import analyze, coerce_brief, coerce_visual
from src.schema import Brief, PRFile, PRMeta

PR = PRMeta(
    owner="o", repo="r", number=1, url="https://github.com/o/r/pull/1", title="t", author="a",
    base_ref="main", head_ref="x", state="OPEN", additions=1, deletions=0, changed_files=1, created_at="2026-01-01T00:00:00Z",
)
FILES = [PRFile(path="a.py", status="modified", additions=1, deletions=0, patch="diff --git a/a.py b/a.py\n+x\n", language="py")]
GOOD = {
    "headline": "h", "intent": "i", "risk": "low", "risk_reasons": ["r"],
    "change_map": [{"path": "a.py", "role": "core", "summary": "s"}],
    "visuals": [], "checklist": [], "questions_for_author": [], "testing": "t",
}


def test_body_aliases_and_kind_aliases_are_absorbed():
    assert coerce_visual({"kind": "calltree", "title": "T", "content": "a\n  b"}) == {
        "kind": "call_tree", "title": "T", "caption": None, "refs": [], "body": "a\n  b",
    }
    assert coerce_visual({"kind": "pseudocode", "title": "T", "lines": ["one", "two"]})["body"] == "one\ntwo"
    assert coerce_visual({"kind": "code", "title": "T", "code": "x = 1"})["language"] == "text"
    assert coerce_visual({"kind": "warning", "title": "T", "text": "careful", "tone": "warning"})["tone"] == "warn"


def test_shape_diff_aliases_and_missing_halves():
    assert coerce_visual({"kind": "diff", "title": "T", "old": "a", "new": "b"}) == {
        "kind": "shape_diff", "title": "T", "caption": None, "refs": [], "before": "a", "after": "b",
    }
    assert coerce_visual({"kind": "shape_diff", "title": "T", "before": "a"}) is None


def test_hopeless_visuals_are_dropped_not_fatal():
    # The exact shape from the field report: a call_tree with a caption and no body.
    assert coerce_visual({"kind": "call_tree", "title": "T", "caption": "Decision record"}) is None
    assert coerce_visual({"kind": "hologram", "title": "T", "body": "x"}) is None
    assert coerce_visual("not a dict") is None
    brief = coerce_brief({**GOOD, "visuals": [{"kind": "call_tree", "title": "T", "caption": "c"}, {"kind": "callout", "title": "K", "body": "b"}]})
    assert [v["kind"] for v in brief["visuals"]] == ["callout"]
    assert Brief.model_validate(brief).visuals[0].kind == "callout"


def test_refs_are_sanitised():
    visual = coerce_visual({"kind": "mermaid", "title": "T", "diagram": "flowchart LR\n a-->b", "refs": [{"path": "a.py", "line": "12"}, {"nope": 1}, {"path": "b.py", "line": 3}]})
    assert visual["refs"] == [{"path": "a.py", "line": None}, {"path": "b.py", "line": 3}]


class _Stub:
    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = []

    async def ainvoke(self, messages, config=None):
        self.calls.append(messages)
        return self.answers.pop(0)


def test_analyze_retries_once_with_the_validation_error_then_gives_up():
    stub = _Stub([{**GOOD, "headline": None}, GOOD])
    brief = asyncio.run(analyze(PR, FILES, model=stub))
    assert brief.headline == "h"
    assert len(stub.calls) == 2
    # The retry carries the failure back to the model as a human turn.
    assert "failed validation" in stub.calls[1][-1].content
    assert "headline" in stub.calls[1][-1].content

    stub = _Stub([{**GOOD, "risk": "sideways"}, {**GOOD, "risk": "sideways"}])
    with pytest.raises(ValueError, match="failed validation twice"):
        asyncio.run(analyze(PR, FILES, model=stub))


def test_analyze_accepts_the_include_raw_triple():
    class Raw:
        tool_calls: ClassVar = [{"name": "Brief", "args": {**GOOD, "visuals": [{"kind": "call_tree", "title": "T", "caption": "no body"}]}}]
        content = ""

    stub = _Stub([{"raw": Raw(), "parsed": None, "parsing_error": Exception("x")}])
    brief = asyncio.run(analyze(PR, FILES, model=stub))
    assert brief.visuals == [] and brief.headline == "h"
