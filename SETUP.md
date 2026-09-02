# Setup guide

How to get score-pr-reviewer running on a fresh machine and show it as an MVP.
Read top to bottom the first time; the demo section is what you rehearse.

## 1. What you need

| Tool | Why | Check |
|---|---|---|
| Node 20 or newer (built on 26) | web app, CopilotKit runtime | `node --version` |
| `uv` | installs Python 3.12 and the agent's packages | `uv --version` |
| GitHub CLI, logged in | the agent reads PRs through `gh pr view` / `gh pr diff` | `gh auth status` |
| A model API key | writes the Brief and answers questions | see step 3 |
| Chrome or any modern browser | the UI | |

The account `gh` is logged in with decides which PRs the agent can read.
Private work repos need that account to have access to them. Only
`github.com` URLs are accepted; GitHub Enterprise Server hosts are not.

## 2. Get the code onto the machine

The project is one folder, `score-pr-reviwer`, with a `web/` and an
`agent/` half. Nothing is committed yet, so commit and push it to a remote
you control before moving it, or copy the folder without `node_modules`,
`web/.next` and `agent/.venv`.

`.env` is gitignored and holds the API key. It never travels with the code;
recreate it on every machine (step 3).

## 3. Configure `.env`

```sh
cp .env.example .env
```

Then set the provider. For work, use Anthropic: PR contents are sent to the
model provider, so pick the one your company has approved.

```ini
PR_REVIEWER_PROVIDER=anthropic
PR_REVIEWER_MODEL=claude-opus-5
ANTHROPIC_API_KEY=sk-ant-...
PR_REVIEWER_THINKING=off
```

| Setting | Values | Notes |
|---|---|---|
| `PR_REVIEWER_PROVIDER` | `anthropic`, `zai` | `zai` is Z.AI's GLM via an OpenAI-compatible endpoint |
| `PR_REVIEWER_MODEL` | `claude-opus-5`, `glm-5.3` | model id for the chosen provider |
| `PR_REVIEWER_THINKING` | `off` (default), `on` | `off` is about five times faster on GLM (16 s vs 75 s per Brief on a 2-file PR) with slightly fewer visuals; `on` for hard PRs |
| `ZAI_BASE_URL` | coding-plan endpoint by default | pay-as-you-go keys use `https://api.z.ai/api/paas/v4` |
| `AGENT_URL` | `http://localhost:8123` | where the web runtime finds the Python agent |

Everything so far was exercised end to end with the `zai` provider. The
`anthropic` path is implemented and unit-tested but has not run against a
live key yet. Before the demo, run `make evals` once with your Anthropic key
(step 5); it exercises exactly the structured-output call the review uses.

## 4. Install and run

```sh
make install     # npm install for web, uv sync for agent
make dev         # web on :3000, agent on :8123, one terminal
```

Open http://localhost:3000. Sanity order:

1. http://localhost:3000/preview renders a captured real review with no key
   and no agent. If this page looks right, the web half works.
2. Paste a small PR URL on the home page and press Enter. A two-file PR
   finishes in under a minute with thinking off. Progress shows fetch,
   read, draft.
3. Ask the chat something, or click a suggestion chip. Answers can open the
   diff at a line or draw a visual inline.

## 5. Verify before you show it

```sh
make check          # lint, typecheck, web tests, ruff, agent tests. Free.
scripts/smoke.sh    # boots both servers and probes them. Free.
make evals          # three PR fixtures scored for brief quality. Costs model calls.
```

Evals print a score per case; they were 100/100/100 on GLM with thinking on.
A number below the gates (schema valid, every file mapped) means the model
or provider config is wrong, not the UI.

## 6. Demo mode

Run the production build. `next dev` is measurably slower to respond and is
the wrong thing to show.

```sh
# terminal 1: agent, no autoreload
cd agent && uv run uvicorn main:app --host 127.0.0.1 --port 8123

# terminal 2: web
cd web && npm run build && npm start
```

Rehearsal checklist:

- Run one real review before people arrive. The first review pays the
  diff highlighter's startup and warms everything; the second one is what
  you want them to see.
- Pick the PR in advance: two to six files, a real change with tests. Big
  PRs work (24 files, 100k characters took about five minutes) but nobody
  wants to watch that live.
- Deep links start a review on load:
  `http://localhost:3000/?pr=https://github.com/org/repo/pull/123`. Keep one
  in a bookmark.
- Show `/preview` first if the room is short on time: it is the finished
  shape without waiting on a model.
- Use the light theme in a bright room. The sun/moon button in the header
  switches it and the choice sticks.

A demo narrative that lands in five minutes:

1. Paste the PR. While it runs, say the one rule: the reviewer has fifteen
   minutes, Brief included.
2. Brief tab: headline, verdict, the time plan (which files, in what order,
   how long, which to skip), the visuals, and the checklist with the diff
   shown inline under each item.
3. Diff tab: files ordered by the time plan, `read 1 · 6 min` badges,
   skipped files collapsed at the bottom.
4. Chat: click "Riskiest part", then ask a follow-up. Point out that the
   answer jumped the diff to a line.

## 7. Known limits

Say these before someone asks.

- Nothing is stored. A page refresh loses the review; the deep link reruns it.
- One user, no login. Whoever runs the agent's `gh` is the identity.
- The PR's diff and description are sent to the model provider.
- `github.com` only. Enterprise Server URLs are rejected at the form.
- Model latency is the wait. CopilotKit adds nothing measurable; the
  model's reasoning does. Thinking off is the lever.

## 8. When something is off

| Symptom | Cause | Fix |
|---|---|---|
| Page loads but nothing reacts to clicks | dev server bound to `localhost`, opened as `127.0.0.1` or vice versa | already allowed in `web/next.config.ts`; restart `make dev` |
| "Runtime did not answer within 5000ms" | agent not running or `AGENT_URL` wrong | `curl localhost:8123/healthz` should return `{"ok":true}` |
| "The GitHub CLI is not installed" or a PR not found | `gh` missing, logged out, or no access | `gh auth login`, then `gh pr view <url>` by hand |
| "insufficient balance" from Z.AI | coding-plan key on the pay-as-you-go endpoint | set `ZAI_BASE_URL` to the coding endpoint |
| Review ends in a validation error | the model drifted on the visual schema, retried once, failed again | press Retry; rare with thinking on |
| Empty diff bodies in `next dev` | React StrictMode double mount aborts the diff renderer | already off in `web/next.config.ts` |
| Turbopack crash after deleting `web/.next` | deleted while dev was running | restart `make dev` |
