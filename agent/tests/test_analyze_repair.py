import pytest

from src.analyze import (
    HEADLINE_LIMIT,
    SINGLE_PATCH_LIMIT,
    TOTAL_BUDGET,
    analyze,
    build_analysis_input,
    guess_role,
    repair_brief,
)
from src.schema import Brief, PRFile, PRMeta

PR = PRMeta(
    owner="acme",
    repo="widgets",
    number=7,
    url="https://github.com/acme/widgets/pull/7",
    title="Add retries",
    body="Retries the gateway call.",
    author="jo",
    base_ref="main",
    head_ref="retries",
    state="OPEN",
    additions=10,
    deletions=2,
    changed_files=3,
    created_at="2026-01-01T00:00:00Z",
    labels=["backend"],
)


def make_file(path: str, patch: str = "", status: str = "modified") -> PRFile:
    return PRFile(
        path=path,
        previous_path=None,
        status=status,
        additions=1,
        deletions=0,
        patch=patch or f"diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -1 +1 @@\n-a\n+b\n",
        language=None,
    )


def make_brief(**overrides) -> Brief:
    base = {
        "headline": "Add retries",
        "intent": "Adds retries.",
        "risk": "low",
        "risk_reasons": ["small"],
        "change_map": [],
        "visuals": [{"kind": "callout", "title": "t", "body": "b", "tone": "info", "caption": None, "refs": []}],
        "checklist": [],
        "questions_for_author": [],
        "testing": "none",
    }
    return Brief.model_validate({**base, **overrides})


def test_repair_adds_missing_files_with_guessed_roles():
    files = [
        make_file("src/client.py"),
        make_file("tests/test_client.py"),
        make_file("README.md"),
        make_file("package-lock.json"),
        make_file("pyproject.toml"),
    ]
    brief = make_brief(change_map=[{"path": "src/client.py", "role": "core", "summary": "retry loop"}])
    repaired = repair_brief(brief, files)
    by_path = {entry.path: entry for entry in repaired.change_map}
    assert list(by_path) == [file.path for file in files]
    assert by_path["src/client.py"].summary == "retry loop"
    assert by_path["tests/test_client.py"].role == "test"
    assert by_path["README.md"].role == "docs"
    assert by_path["package-lock.json"].role == "generated"
    assert by_path["pyproject.toml"].role == "config"
    for path in ("tests/test_client.py", "README.md", "package-lock.json", "pyproject.toml"):
        assert by_path[path].summary == "(not described by the model)"


def test_repair_drops_unknown_paths_and_duplicates():
    files = [make_file("src/a.py")]
    brief = make_brief(
        change_map=[
            {"path": "src/a.py", "role": "core", "summary": "first"},
            {"path": "src/a.py", "role": "supporting", "summary": "dup"},
            {"path": "src/ghost.py", "role": "core", "summary": "hallucinated"},
        ]
    )
    repaired = repair_brief(brief, files)
    assert [(e.path, e.summary) for e in repaired.change_map] == [("src/a.py", "first")]


def test_repair_clamps_headline_and_strips_mermaid_fences():
    brief = make_brief(
        headline="x" * 200,
        visuals=[
            {
                "kind": "mermaid",
                "title": "flow",
                "body": "```mermaid\nflowchart TD\n  A --> B\n```",
                "caption": None,
                "refs": [],
            }
        ],
    )
    repaired = repair_brief(brief, [make_file("src/a.py")])
    assert len(repaired.headline) <= HEADLINE_LIMIT
    assert repaired.headline.endswith("…")
    assert repaired.visuals[0].body == "flowchart TD\n  A --> B"


def test_guess_role_fallback_is_supporting():
    assert guess_role("src/lib/thing.go") == "supporting"
    assert guess_role("internal/foo_test.go") == "test"
    assert guess_role("web/src/app.test.tsx") == "test"
    assert guess_role(".github/workflows/ci.yml") == "config"
    assert guess_role("api/v1/service_pb2.py") == "generated"


def test_single_patch_truncation_marker():
    big = "diff --git a/big.py b/big.py\n" + ("+" + "x" * 99 + "\n") * 1000
    assert len(big) > SINGLE_PATCH_LIMIT
    text = build_analysis_input(PR, [make_file("big.py", patch=big)])
    dropped = len(big) - SINGLE_PATCH_LIMIT
    assert f"[truncated {dropped} chars]" in text
    assert "### big.py" in text
    assert "- big.py [modified] +1 -0" in text


def test_total_budget_keeps_largest_and_lists_the_rest():
    line = "+" + "y" * 98 + "\n"
    # Exactly the per-file limit so no single-file truncation muddies the arithmetic.
    patch = ("diff --git a/f b/f\n" + line * 400)[:SINGLE_PATCH_LIMIT]
    files = [make_file(f"pkg/file{i}.py", patch=patch) for i in range(10)]
    assert 10 * SINGLE_PATCH_LIMIT > TOTAL_BUDGET
    text = build_analysis_input(PR, files)
    included = TOTAL_BUDGET // SINGLE_PATCH_LIMIT
    assert text.count("### pkg/file") == included
    assert "## Omitted patches (name only)" in text
    omitted_section = text.split("## Omitted patches (name only)")[1]
    assert omitted_section.count("- pkg/file") == 10 - included
    assert "exceeds the" in text
    # Every file is still in the index regardless of budget.
    for file in files:
        assert f"- {file.path} [modified]" in text


def test_small_diff_has_no_budget_note():
    text = build_analysis_input(PR, [make_file("a.py"), make_file("b.py")])
    assert "Omitted patches" not in text
    assert text.index("### a.py") < text.index("### b.py")
    assert "Retries the gateway call." in text


class _StubModel:
    def __init__(self, result):
        self.result = result
        self.calls = []

    async def ainvoke(self, messages, config=None):
        self.calls.append((messages, config))
        return self.result


@pytest.mark.asyncio
async def test_analyze_uses_injected_model_and_repairs():
    files = [make_file("src/a.py"), make_file("docs/guide.md")]
    stub = _StubModel(make_brief(change_map=[{"path": "src/a.py", "role": "core", "summary": "s"}]))
    brief = await analyze(PR, files, model=stub)
    assert [entry.path for entry in brief.change_map] == ["src/a.py", "docs/guide.md"]
    (messages, _config), = stub.calls
    assert messages[0].type == "system"
    assert "### src/a.py" in messages[1].content


@pytest.mark.asyncio
async def test_analyze_accepts_dict_results():
    stub = _StubModel(make_brief().model_dump())
    brief = await analyze(PR, [make_file("src/a.py")], model=stub)
    assert isinstance(brief, Brief)
    assert brief.change_map[0].path == "src/a.py"
