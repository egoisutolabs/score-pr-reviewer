"""The time plan is what makes the Brief fit fifteen minutes; repair must keep it honest and never empty."""

from src.analyze import repair_brief, repair_time_plan
from src.schema import Brief, ChangeMapEntry, PRFile, ReadStep, SkipEntry, TimePlan

FILES = [
    PRFile(path="src/core.py", status="modified", additions=10, deletions=2, patch="diff --git a/src/core.py b/src/core.py\n+x\n", language="py"),
    PRFile(path="tests/test_core.py", status="added", additions=20, deletions=0, patch="diff --git a/tests/test_core.py b/tests/test_core.py\n+y\n", language="py"),
    PRFile(path="package-lock.json", status="modified", additions=300, deletions=300, patch="diff --git a/package-lock.json b/package-lock.json\n", language="json"),
]
CHANGE_MAP = [
    ChangeMapEntry(path="src/core.py", role="core", summary="the change"),
    ChangeMapEntry(path="tests/test_core.py", role="test", summary="pins it"),
    ChangeMapEntry(path="package-lock.json", role="generated", summary="lockfile"),
]
KNOWN = {f.path for f in FILES}


def test_unknown_paths_and_duplicates_are_dropped_and_minutes_scaled_into_budget():
    plan = TimePlan(
        read_first=[
            ReadStep(path="src/core.py", minutes=10, why="a"),
            ReadStep(path="src/core.py", minutes=5, why="dup"),
            ReadStep(path="ghost.py", minutes=5, why="invented"),
            ReadStep(path="tests/test_core.py", minutes=10, why="b"),
        ],
        skip=[SkipEntry(path="package-lock.json", why="lock"), SkipEntry(path="nope.md", why="invented")],
    )
    fixed = repair_time_plan(plan, CHANGE_MAP, KNOWN)
    assert [s.path for s in fixed.read_first] == ["src/core.py", "tests/test_core.py"]
    assert sum(s.minutes for s in fixed.read_first) <= fixed.budget_minutes - 3
    assert [s.path for s in fixed.skip] == ["package-lock.json"]


def test_missing_plan_is_synthesised_from_roles():
    fixed = repair_time_plan(TimePlan(), CHANGE_MAP, KNOWN)
    assert [s.path for s in fixed.read_first] == ["src/core.py", "tests/test_core.py"]
    assert all(s.minutes == 3 for s in fixed.read_first)
    assert [s.path for s in fixed.skip] == ["package-lock.json"]
    assert fixed.budget_minutes == 15


def test_repair_brief_sanitises_checklist_paths_and_keeps_the_plan():
    brief = Brief(
        headline="h", intent="i", risk="low", risk_reasons=["r"], change_map=CHANGE_MAP, visuals=[],
        checklist=[{"item": "x", "path": "ghost.py", "line": 3, "severity": "info", "minutes": 2}],
        questions_for_author=[], testing="t", verdict="approve", verdict_reason="fine",
        time_plan=TimePlan(budget_minutes=999, read_first=[ReadStep(path="src/core.py", minutes=4, why="a")]),
    )
    fixed = repair_brief(brief, FILES)
    assert fixed.checklist[0].path is None and fixed.checklist[0].minutes == 2
    assert fixed.time_plan.budget_minutes == 15
    assert fixed.time_plan.read_first[0].path == "src/core.py"
    assert fixed.verdict == "approve"
