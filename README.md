# score-pr-reviewer

Paste a pull request. Understand it in a minute. Ask anything.

Built around one assumption: **the reviewer has fifteen minutes for this PR,
Brief included.** The Brief is sized to be read in three, ends in a verdict,
and opens with a time plan: which files to open, in what order, for how long,
and which to leave closed.

A LangGraph agent (Python) fetches the PR through the `gh` CLI, reads the whole
diff, and writes a **Brief**: what the PR does in one sentence, why, how risky
it is, a map of every changed file by role, and a handful of *show-me* visuals
(call trees, before/after shapes, mermaid flows, callouts) that explain the
structural change faster than prose. The reviewer reads the Brief, walks a
GitHub-style diff, and asks the agent questions in a chat that can jump the
diff to a file and line, or draw a new visual inline.

```
web/    Next.js 16 · TypeScript · Tailwind 4 · shadcn · CopilotKit · @pierre/diffs · shiki · mermaid
agent/  Python 3.12 · uv · FastAPI · LangGraph · langchain-anthropic (Claude) · CopilotKit AG-UI
```

## Run it

Prerequisites: Node 20+, `uv`, and the GitHub CLI logged in (`gh auth status`).

```sh
cp .env.example .env        # pick a provider and add its key (see below)
make install                # npm install (web) + uv sync (agent)
make dev                    # web on :3000, agent on :8123
```

Providers, chosen with `PR_REVIEWER_PROVIDER` in `.env`:

| provider | key | default model | notes |
|---|---|---|---|
| `anthropic` (default) | `ANTHROPIC_API_KEY` | `claude-opus-5` | adaptive thinking, native JSON-schema structured output |
| `zai` | `ZAI_API_KEY` | `glm-5.3` | Z.AI's OpenAI-compatible endpoint; coding-plan keys need `ZAI_BASE_URL=https://api.z.ai/api/coding/paas/v4` (the default) |

A review of a ~100-line PR takes about two minutes on either. `make dev`
prints `http://localhost:3000`; both `localhost` and `127.0.0.1` work.

Open http://localhost:3000, paste something like
`https://github.com/vercel/next.js/pull/12345`, press Enter.

`make check` runs lint, typecheck, ruff, and the Python tests. `make evals`
runs the brief-quality evals against the live model (see `agent/evals/README.md`).
`web/scripts` has nothing; `scripts/smoke.sh` boots both servers and probes them.

`/preview` renders a captured real review (score#107) without an agent or key,
for design work and screenshots; `/preview?tab=diff` lands on the diff.
`/?pr=<github pr url>` starts a review on load, so review links are shareable.

## How it works

```
UrlForm ──setState({pr_url}) + run()──▶ CopilotKit runtime ──AG-UI──▶ LangGraph (agent/src/agent.py)
                                                                 route ─▶ fetch (gh pr view + gh pr diff)
                                                                       ─▶ analyze (Claude, structured output → Brief)
                                                                       ─▶ chat ⇄ tools (list_files, get_file_diff,
                                                                                         search_diff, show_visual)
BriefPanel / DiffViewer / FileTree ◀──shared state (useCoAgent)──┘
Chat renders show_visual tool calls with the same show-me components (useRenderToolCall);
the agent can call open_file(path, line) to move the diff viewer (useFrontendTool).
```

The state shape shared by both sides is the contract in `CONTRACT.md`,
mirrored in `web/src/lib/types.ts` and `agent/src/schema.py`.

The Brief reads full-width; the file tree only exists on the Diff tab. A
checklist item that cites a line shows the diff around that line inline
(`lib/patch-snippet.ts`), and the Diff tab orders files by the Brief's time
plan: `read N · M min` badges first, unplanned files by role, `skip` files
last and collapsed. The sun/moon button in the header switches light and
dark; the choice is stored in `localStorage` and applied before first paint.

## Evals

`agent/evals/cases/*.json` hold hand-written PRs with expectations (risk band,
must-mention terms, roles, minimum visuals). `uv run python -m evals.run`
scores each Brief deterministically (schema validity, every file covered,
headline length, mermaid sanity, refs resolve) and optionally with an
LLM judge (`--judge`) for faithfulness. Reports land in `agent/evals/reports/`.

## Layout

See `CONTRACT.md` for the directory map, component contracts, tool tables, and
conventions.

## Performance notes

- The agent does not forward LangGraph's raw token events (`emit_raw_events`
  is off in `agent/main.py`); a review streams a few hundred KB, not 9 MB.
- The diff viewer mounts a file's highlighter only when that file nears the
  viewport; the first mount pays the highlighter's one-time startup (~0.5 s).
- `next dev` is measurably slower than `next build && next start`; if the page
  feels sluggish while developing, try the production build.
- `/preview?big=1` is a 24-file, ~100k-char real PR for diff-viewer profiling.
- CopilotKit's runtime sends usage events (instance, request and stream
  lifecycle, agent counts, an anonymous id; never content) to
  `telemetry.copilotkit.ai` unless `COPILOTKIT_TELEMETRY_DISABLED=true`.
  The root `.env` sets it and `next.config.ts` loads that file, so both
  servers read the same `.env`.
- `reactStrictMode` is off: StrictMode's dev-only double mount aborts
  `@pierre/diffs`' Lit render and leaves diff bodies empty in `next dev`.
