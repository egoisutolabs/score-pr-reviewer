"""Run the analyzer over evals/cases and score the Briefs.

    uv run python -m evals.run [--case NAME] [--judge] [--model MODEL]

Needs ANTHROPIC_API_KEY (or ZAI_API_KEY with PR_REVIEWER_PROVIDER=zai). Writes evals/reports/<timestamp>.json and exits 1 when
any case scores under PASS_THRESHOLD so `make evals` can gate CI.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import traceback
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from evals.scoring import score_case, summarize_report
from src.schema import Brief, PRFile, PRMeta

EVALS_DIR = Path(__file__).resolve().parent
AGENT_DIR = EVALS_DIR.parent
CASES_DIR = EVALS_DIR / "cases"
REPORTS_DIR = EVALS_DIR / "reports"

PASS_THRESHOLD = 60
DEFAULT_MODEL = "claude-opus-5"

# Mirrors the per-file cap in analyze so the judge sees the same diff the
# analyzer saw, not a longer one it could not have been faithful to.
PATCH_CHAR_CAP = 40_000


class JudgeVerdict(BaseModel):
    faithfulness: int = Field(ge=0, le=5, description="5 = every claim is grounded in the diff; 0 = mostly invented.")
    rationale: str = Field(description="Two or three sentences naming any claim not supported by the diff.")


def load_cases(only: str | None) -> list[dict[str, Any]]:
    cases = [json.loads(p.read_text()) for p in sorted(CASES_DIR.glob("*.json"))]
    if only is not None:
        cases = [c for c in cases if c.get("name") == only]
        if not cases:
            names = ", ".join(sorted(json.loads(p.read_text())["name"] for p in CASES_DIR.glob("*.json")))
            sys.exit(f"no case named {only!r}; available: {names}")
    return cases


def to_dict(brief: Any) -> Any:
    return brief.model_dump(mode="json") if isinstance(brief, BaseModel) else brief


def clip_patch(patch: str) -> str:
    if len(patch) <= PATCH_CHAR_CAP:
        return patch
    return patch[:PATCH_CHAR_CAP] + "\n[... patch truncated for length ...]\n"


def judge_prompt(pr: PRMeta, files: list[PRFile], brief: dict[str, Any]) -> str:
    diff = "\n\n".join(clip_patch(f.patch) for f in files)
    return (
        "You are auditing a code-review brief for faithfulness to the pull request diff.\n"
        "Score 5 when every statement about behaviour, files, and risk is supported by the diff "
        "or the PR description. Deduct for invented behaviour, files or functions that do not "
        "appear in the diff, wrong direction of a change (added vs removed), or risks that the "
        "diff does not evidence. Do not grade writing quality or completeness, only faithfulness.\n\n"
        f"PR #{pr.number}: {pr.title}\n\n{pr.body}\n\n"
        f"=== DIFF ===\n{diff}\n\n"
        f"=== BRIEF (JSON) ===\n{json.dumps(brief, indent=2)}\n"
    )


async def judge_brief(model_name: str, pr: PRMeta, files: list[PRFile], brief: dict[str, Any]) -> dict[str, Any]:
    from src import llm

    model = llm.make_chat_model()
    verdict = await model.with_structured_output(JudgeVerdict, method=llm.structured_output_method()).ainvoke(
        judge_prompt(pr, files, brief)
    )
    return to_dict(verdict)


async def run_case(case: dict[str, Any], model_name: str, judge: bool) -> dict[str, Any]:
    # Imported here so scoring (and the unit tests) stay usable when analyze
    # is broken or its model dependencies are missing.
    from src.analyze import analyze

    pr = PRMeta.model_validate(case["pr"])
    files = [PRFile.model_validate(f) for f in case["files"]]
    result: dict[str, Any] = {
        "case": case["name"],
        "description": case.get("description", ""),
        "brief": None,
        "scores": None,
        "judge": None,
        "error": None,
    }
    try:
        brief = to_dict(await analyze(pr, files))
    except Exception as exc:  # noqa: BLE001 — one bad case must not abort the run
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["scores"] = score_case(case, None)
        traceback.print_exc()
        return result
    result["brief"] = brief
    result["scores"] = score_case(case, brief)
    if judge and result["scores"]["schema_valid"]:
        try:
            result["judge"] = await judge_brief(model_name, pr, files, Brief.model_validate(brief).model_dump(mode="json"))
        except Exception as exc:  # noqa: BLE001
            result["judge"] = {"faithfulness": None, "rationale": f"judge failed: {type(exc).__name__}: {exc}"}
    return result


def write_report(results: list[dict[str, Any]], model_name: str, judged: bool) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(UTC)
    path = REPORTS_DIR / f"{now.strftime('%Y%m%d-%H%M%S')}.json"
    path.write_text(
        json.dumps(
            {"generated_at": now.isoformat(), "model": model_name, "judged": judged, "results": results},
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )
    return path


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="evals.run", description=__doc__.split("\n\n")[0])
    parser.add_argument("--case", help="run only the case with this name (the `name` field in cases/*.json)")
    parser.add_argument("--judge", action="store_true", help="add an LLM-as-judge faithfulness score (0-5)")
    parser.add_argument("--model", help="override PR_REVIEWER_MODEL for both analyze and the judge")
    args = parser.parse_args(argv)

    # Agent-local .env first so it wins over the repo root (load_dotenv never overrides).
    load_dotenv(AGENT_DIR / ".env")
    load_dotenv(AGENT_DIR.parent / ".env")
    from src import llm

    try:
        llm.require_api_key()
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 2

    # analyze reads the model name from the environment, so overriding there is
    # the one path that works whatever its optional `model` parameter expects.
    if args.model:
        os.environ["PR_REVIEWER_MODEL"] = args.model
    model_name = llm.model_name()

    cases = load_cases(args.case)
    results: list[dict[str, Any]] = []
    for case in cases:
        print(f"[{case['name']}] analyzing with {model_name}…", file=sys.stderr)
        results.append(await run_case(case, model_name, args.judge))

    print(summarize_report(results))
    report = write_report(results, model_name, args.judge)
    print(f"\nreport: {report.relative_to(AGENT_DIR)}")

    failing = [r["case"] for r in results if (r["scores"] or {}).get("score", 0) < PASS_THRESHOLD]
    if failing:
        print(f"below {PASS_THRESHOLD}: {', '.join(failing)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
