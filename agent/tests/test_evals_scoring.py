"""Scoring is pure; these run without network or an API key."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from evals.scoring import WEIGHTS, score_case, summarize_report

CASES_DIR = Path(__file__).resolve().parent.parent / "evals" / "cases"


@pytest.fixture(scope="module")
def case() -> dict[str, Any]:
    return json.loads((CASES_DIR / "small-bugfix.json").read_text())


def perfect_brief() -> dict[str, Any]:
    """A Brief that satisfies every check for the small-bugfix case."""
    return {
        "headline": "Client.get retries 5xx responses up to four times with jittered exponential backoff",
        "intent": (
            "Transient 502/503s from the billing gateway were surfacing as hard failures. "
            "Client.get now loops up to MAX_ATTEMPTS, sleeping for a full-jitter backoff "
            "between attempts, and still raises immediately on 4xx."
        ),
        "risk": "low",
        "risk_reasons": ["Retry adds latency on persistent 5xx: up to ~8s before the error surfaces."],
        "change_map": [
            {"path": "httpclient/client.py", "role": "core", "summary": "Retry loop and _backoff helper in Client.get."},
            {"path": "tests/test_client.py", "role": "test", "summary": "Retry-then-succeed, give-up, and no-retry-on-4xx tests."},
        ],
        "visuals": [
            {
                "kind": "pseudocode",
                "title": "Client.get retry loop",
                "body": "for attempt in 0..MAX_ATTEMPTS\n  try urlopen\n  on 5xx and attempts left: sleep(backoff(attempt))\n  else: raise HTTPError",
                "caption": None,
                "refs": [{"path": "httpclient/client.py", "line": 37}],
            },
            {
                "kind": "mermaid",
                "title": "Request outcome",
                "body": "flowchart LR\n  A[urlopen] -->|2xx| B[return json]\n  A -->|4xx| C[raise]\n  A -->|5xx| D{attempts left?}\n  D -->|yes| E[sleep backoff] --> A\n  D -->|no| C",
                "caption": "Only 5xx re-enters the loop.",
                "refs": [],
            },
        ],
        "checklist": [
            {"item": "Confirm 429 should not be retried without honoring Retry-After.", "path": "httpclient/client.py", "line": 41, "severity": "info"},
        ],
        "questions_for_author": ["Should POST get the same treatment, or is idempotency the reason it is GET-only?"],
        "testing": "Three new tests cover retry-then-succeed, exhausting attempts, and no retry on 404; sleep is patched out.",
        "verdict": "approve_with_nits",
        "verdict_reason": "Behavior is contained and tested; only the 429 question is open.",
        "time_plan": {
            "budget_minutes": 15,
            "read_first": [
                {"path": "httpclient/client.py", "minutes": 6, "why": "the retry loop and what counts as retryable"},
                {"path": "tests/test_client.py", "minutes": 3, "why": "that give-up and 4xx paths are pinned"},
            ],
            "skip": [],
        },
    }


def test_perfect_brief_scores_100(case: dict[str, Any]) -> None:
    result = score_case(case, perfect_brief())
    failing = {k: v for k, v in result.items() if v is False}
    assert not failing, failing
    assert result["mentions"] == 1.0
    assert result["score"] == 100


def test_missing_file_is_a_gate(case: dict[str, Any]) -> None:
    brief = perfect_brief()
    brief["change_map"] = brief["change_map"][:1]
    result = score_case(case, brief)
    assert result["files_covered"] is False
    assert result["schema_valid"] is True
    assert result["score"] == 0


def test_duplicate_or_invented_path_fails_files_covered(case: dict[str, Any]) -> None:
    duplicated = perfect_brief()
    duplicated["change_map"].append(copy.deepcopy(duplicated["change_map"][0]))
    assert score_case(case, duplicated)["files_covered"] is False

    invented = perfect_brief()
    invented["change_map"].append({"path": "httpclient/retry.py", "role": "core", "summary": "does not exist"})
    assert score_case(case, invented)["files_covered"] is False


def test_fenced_mermaid_fails_mermaid_ok(case: dict[str, Any]) -> None:
    brief = perfect_brief()
    brief["visuals"][1]["body"] = "```mermaid\nflowchart LR\n  A --> B\n```"
    result = score_case(case, brief)
    assert result["mermaid_ok"] is False
    assert result["score"] == 100 - WEIGHTS["mermaid_ok"]


def test_mermaid_without_diagram_keyword_fails(case: dict[str, Any]) -> None:
    brief = perfect_brief()
    brief["visuals"][1]["body"] = "A --> B\nB --> C"
    assert score_case(case, brief)["mermaid_ok"] is False


def test_forbidden_phrase_fails_forbidden_ok(case: dict[str, Any]) -> None:
    brief = perfect_brief()
    # Lives in `testing`, which is outside the mention text, to prove the
    # forbidden check scans the whole Brief.
    brief["testing"] = "as an ai language model I cannot run the tests."
    result = score_case(case, brief)
    assert result["forbidden_ok"] is False
    assert result["score"] == 100 - WEIGHTS["forbidden_ok"]


def test_invalid_schema_is_a_gate(case: dict[str, Any]) -> None:
    brief = perfect_brief()
    brief["risk"] = "catastrophic"
    result = score_case(case, brief)
    assert result["schema_valid"] is False
    assert result["score"] == 0
    assert score_case(case, None)["score"] == 0


def test_partial_mentions_are_fractional(case: dict[str, Any]) -> None:
    brief = perfect_brief()
    for key in ("headline", "intent"):
        brief[key] = brief[key].replace("backoff", "delay")
    brief["risk_reasons"] = ["Retry adds latency."]
    brief["visuals"][0]["body"] = brief["visuals"][0]["body"].replace("backoff", "wait")
    brief["visuals"][1]["body"] = brief["visuals"][1]["body"].replace("backoff", "wait")
    result = score_case(case, brief)
    assert result["mentions"] == 0.5
    assert result["score"] == 100 - WEIGHTS["mentions"] // 2


def test_refs_risk_and_roles(case: dict[str, Any]) -> None:
    brief = perfect_brief()
    brief["visuals"][0]["refs"] = [{"path": "httpclient/nope.py", "line": 1}]
    brief["risk"] = "high"
    brief["change_map"][1]["role"] = "docs"
    result = score_case(case, brief)
    assert result["refs_ok"] is False
    assert result["risk_ok"] is False
    assert result["roles_ok"] is False
    assert result["score"] == 100 - WEIGHTS["refs_ok"] - WEIGHTS["risk_ok"] - WEIGHTS["roles_ok"]


def test_summarize_report_renders_table(case: dict[str, Any]) -> None:
    results = [
        {"case": "small-bugfix", "scores": score_case(case, perfect_brief()), "judge": {"faithfulness": 5, "rationale": ""}},
        {"case": "broken", "scores": score_case(case, None), "error": "RuntimeError: boom"},
    ]
    table = summarize_report(results)
    lines = table.splitlines()
    assert lines[0].startswith("| case | score |")
    assert lines[0].endswith("| judge |")
    assert "| small-bugfix | 100 |" in table
    assert "5/5" in table
    assert "error: RuntimeError: boom" in table
    # Every row has the same number of cells, otherwise the markdown table breaks.
    assert len({line.count("|") for line in lines}) == 1
