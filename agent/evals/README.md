# Evals

Deterministic checks that the analyzer produces a usable Brief for three
hand-written PRs, plus an optional LLM-as-judge faithfulness score.

## Run

```sh
cd agent
uv run python -m evals.run                 # all cases
uv run python -m evals.run --case small-bugfix
uv run python -m evals.run --judge         # adds faithfulness 0-5 per case
uv run python -m evals.run --model claude-sonnet-4-5
```

From the repo root, `make evals` / `npm run evals` do the same.

`ANTHROPIC_API_KEY` is required; it is read from `agent/.env`, then the repo
root `.env`, then the environment. The run prints a markdown table, writes
`evals/reports/<YYYYMMDD-HHMMSS>.json` (briefs, scores, judge verdicts), and
exits 1 if any case scores below 60. Reports are local artifacts, not fixtures.

`evals/scoring.py` has no dependency on `src/analyze.py`, so
`tests/test_evals_scoring.py` runs without a key and the scorer can be pointed
at a saved report when the analyzer is mid-change.

## Metrics

Two metrics are gates: if either fails the case scores 0.

| metric | gate | weight | meaning |
|---|---|---|---|
| `schema_valid` | yes | — | `Brief.model_validate` accepts the output. |
| `files_covered` | yes | — | Every file in the case appears in `change_map` exactly once, and `change_map` lists no file the PR does not touch. |
| `headline_ok` | | 10 | Non-empty and at most 120 characters. |
| `mentions` | | 20 | Fraction of `expect.must_mention` terms found (case-insensitive) in headline, intent, risk reasons, and visual bodies. Scored fractionally. |
| `mentions_any_ok` | | 10 | At least one of `expect.must_mention_any` appears in the same text. True when the list is empty. |
| `forbidden_ok` | | 10 | None of `expect.must_not_mention` appears anywhere in the serialized Brief. |
| `visuals_ok` | | 15 | At least `expect.min_visuals` visuals, and each one validates against the `Visual` union. |
| `mermaid_ok` | | 10 | Every mermaid body starts (first non-empty line) with `flowchart`, `graph`, `sequenceDiagram`, `stateDiagram`, `classDiagram`, or `erDiagram`, and contains no code fences. True when there are no mermaid visuals. |
| `refs_ok` | | 10 | Every visual `refs[].path` and every non-null checklist `path` is a file in the PR. |
| `risk_ok` | | 10 | `brief.risk` is in `expect.risk_in`. |
| `roles_ok` | | 5 | For each path in `expect.roles`, `change_map` assigns that role. |
| `score` | | | Weighted sum, 0–100. |

`--judge` asks the same model for `{faithfulness: 0–5, rationale}` — does the
Brief only claim things the diff supports? It is recorded alongside the
deterministic scores but does not affect `score` or the exit code; it is there
to catch confident, well-formed, wrong briefs that the shape checks cannot see.

## Adding a case

Create `cases/<name>.json`:

```json
{
  "name": "kebab-case-name",
  "description": "One paragraph: what the PR does and what a good brief must get right.",
  "pr": { "...": "PRMeta — see CONTRACT.md" },
  "files": [ { "...": "PRFile with a full unified diff in `patch`" } ],
  "expect": {
    "risk_in": ["low", "medium"],
    "must_mention": ["retry", "backoff"],
    "must_mention_any": ["split", "rename"],
    "must_not_mention": ["As an AI"],
    "min_visuals": 1,
    "roles": { "src/x.py": "core", "tests/test_x.py": "test" }
  }
}
```

Guidelines that keep a case honest:

- `patch` must be a real unified diff starting with `diff --git a/<path> b/<path>`,
  with hunk headers whose line counts match the body. Verify with
  `git apply --numstat <<< "$patch"`; the numbers it prints must equal the
  file's `additions` / `deletions`. Renamed files carry `rename from` /
  `rename to` lines and set `previous_path`.
- Keep patches 20–80 lines: long enough to have a shape, short enough that a
  wrong brief is obviously wrong.
- `must_mention` terms are substrings, so prefer stems (`retry`, not `retries`).
  Use `must_mention_any` when several phrasings are equally right.
- Only put a path in `roles` when the role is unambiguous; the model is
  allowed to disagree about `supporting` vs `core` on a judgement call.
- Every `expect` key is optional; missing keys are treated as "no constraint".
