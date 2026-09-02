import pytest
from pydantic import TypeAdapter, ValidationError

from src.schema import Brief, Callout, Mermaid, ShapeDiff, Visual

CANNED_BRIEF = {
    "headline": "Add retry with backoff to the payment client",
    "intent": "Wraps outbound payment calls in a retry loop. Timeouts are now configurable per call.",
    "risk": "medium",
    "risk_reasons": ["Retries a non-idempotent POST", "No test for the backoff ceiling"],
    "change_map": [
        {"path": "src/payments/client.py", "role": "core", "summary": "Adds retry loop"},
        {"path": "tests/test_client.py", "role": "test", "summary": "Covers happy path"},
    ],
    "visuals": [
        {
            "kind": "pseudocode",
            "title": "Retry loop",
            "body": "for attempt in 1..3\n  try call\n  on timeout sleep(2^attempt)",
            "caption": None,
            "refs": [{"path": "src/payments/client.py", "line": 42}],
        },
        {
            "kind": "shape_diff",
            "title": "charge() signature",
            "before": "charge(amount)",
            "after": "charge(amount, timeout=5.0)",
            "caption": "New keyword is optional",
            "refs": [{"path": "src/payments/client.py", "line": None}],
        },
        {
            "kind": "callout",
            "title": "POST is retried",
            "body": "Duplicate charges are possible if the first request succeeded but timed out.",
            "tone": "danger",
            "caption": None,
            "refs": [],
        },
    ],
    "checklist": [{"item": "Confirm idempotency key is sent", "path": "src/payments/client.py", "line": 51, "severity": "block"}],
    "questions_for_author": ["Is the gateway idempotent on retries?"],
    "testing": "Happy path covered; the backoff ceiling and timeout path are untested.",
}


def test_brief_round_trips_through_validate_and_dump():
    brief = Brief.model_validate(CANNED_BRIEF)
    # Fields the canned brief predates dump with their defaults.
    expected = {
        **CANNED_BRIEF,
        "checklist": [{**item, "minutes": None} for item in CANNED_BRIEF["checklist"]],
        "verdict": "needs_discussion",
        "verdict_reason": "",
        "time_plan": {"budget_minutes": 15, "read_first": [], "skip": []},
    }
    assert brief.model_dump() == expected
    assert Brief.model_validate(brief.model_dump()) == brief


def test_brief_dump_matches_contract_keys():
    dumped = Brief.model_validate(CANNED_BRIEF).model_dump()
    assert set(dumped) == {
        "headline",
        "intent",
        "risk",
        "risk_reasons",
        "change_map",
        "visuals",
        "checklist",
        "questions_for_author",
        "testing",
        "verdict",
        "verdict_reason",
        "time_plan",
    }


def test_visual_union_discriminates_on_kind():
    adapter: TypeAdapter[Visual] = TypeAdapter(Visual)
    base = {"title": "t", "caption": None, "refs": []}
    assert isinstance(adapter.validate_python({**base, "kind": "callout", "body": "x", "tone": "warn"}), Callout)
    assert isinstance(adapter.validate_python({**base, "kind": "shape_diff", "before": "a", "after": "b"}), ShapeDiff)
    assert isinstance(adapter.validate_python({**base, "kind": "mermaid", "body": "flowchart TD\n  A --> B"}), Mermaid)


def test_visual_union_rejects_unknown_kind_and_missing_fields():
    adapter: TypeAdapter[Visual] = TypeAdapter(Visual)
    with pytest.raises(ValidationError):
        adapter.validate_python({"kind": "table", "title": "t", "body": "x"})
    with pytest.raises(ValidationError):
        # shape_diff without before/after must not silently validate as another kind.
        adapter.validate_python({"kind": "shape_diff", "title": "t", "body": "x"})


def test_brief_rejects_bad_risk_and_role():
    with pytest.raises(ValidationError):
        Brief.model_validate({**CANNED_BRIEF, "risk": "critical"})
    with pytest.raises(ValidationError):
        Brief.model_validate(
            {**CANNED_BRIEF, "change_map": [{"path": "a.py", "role": "main", "summary": "s"}]}
        )
