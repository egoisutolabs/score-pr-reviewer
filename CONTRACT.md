# score-pr-reviewer — build contract

The reviewer has fifteen minutes per PR, Brief included. Every part of the Brief is sized against that: it must be readable in three, and it tells the reviewer which files to open, in what order, for how long, and which to leave closed.

Paste a GitHub PR URL. A LangGraph agent (Python, Claude via langchain-anthropic)
fetches the PR through the `gh` CLI, reads the diff, and produces a **Brief**: a
compressed, visual page of what the PR does — rendered with show-me style
components (pseudocode, call trees, file trees, mermaid, before/after shapes,
callouts). The reviewer reads the Brief, browses a GitHub-style diff, and asks
the agent questions in a CopilotKit chat that can point at files and render
visuals inline.

This file is the single source of truth every builder codes against. The TS
types in `web/src/lib/types.ts` and the Pydantic models in `agent/src/schema.py`
mirror each other field-for-field. Do not invent fields; extend both if needed.

## Layout

```
score-pr-reviwer/
├── package.json          # root: `npm run dev` runs web + agent via concurrently
├── Makefile              # make dev | make check | make evals
├── .env.example          # PR_REVIEWER_PROVIDER, ANTHROPIC_API_KEY / ZAI_API_KEY, PR_REVIEWER_MODEL, AGENT_URL
├── web/                  # Next.js 16 (app router, src/, TS, Tailwind 4, shadcn base-nova)
│   └── src/
│       ├── app/
│       │   ├── layout.tsx                 # <CopilotKit runtimeUrl="/api/copilotkit" agent="pr_reviewer">
│       │   ├── page.tsx                   # the one page: hero → workspace
│       │   └── api/copilotkit/[[...path]]/route.ts  # CopilotRuntime + LangGraphHttpAgent(AGENT_URL); GET/POST/OPTIONS
│       ├── lib/
│       │   ├── types.ts                   # ReviewState, Brief, Visual, PRFile … (contract)
│       │   ├── utils.ts                   # shadcn cn()
│       │   └── review-nav.tsx             # ReviewNavProvider/useReviewNav: selected file/line, diff style
│       └── components/
│           ├── ui/                        # shadcn (already installed: button card badge tabs input scroll-area separator tooltip skeleton sheet collapsible table resizable dialog kbd toggle-group)
│           ├── show-me/                   # one component per Visual.kind + VisualRenderer
│           ├── diff/                      # FileTree, DiffViewer (per-file PatchDiff), DiffToolbar
│           └── review/                    # UrlForm, ReviewHeader, BriefPanel, Workspace, ChatPanel, ProgressCard
└── agent/                # Python 3.12, uv, FastAPI + LangGraph + CopilotKit (AG-UI)
    ├── main.py           # add_langgraph_fastapi_endpoint(app, LangGraphAGUIAgent(name="pr_reviewer", graph), path="/") on :8123
    ├── src/
    │   ├── schema.py     # Pydantic models + ReviewState(CopilotKitState)   (contract)
    │   ├── github.py     # gh CLI: fetch_pr(url) → (PRMeta, list[PRFile]); parse_unified_diff()
    │   ├── analyze.py    # Claude structured output → Brief; prompt lives here
    │   ├── tools.py      # backend chat tools (get_file_diff, list_files, search_diff, show_visual)
    │   └── agent.py      # StateGraph: route → fetch → analyze → chat ⇄ tool_node
    ├── tests/            # pytest, no network, no API key
    └── evals/            # cases/*.json + run.py + scoring.py (see Evals)
```

## Wire protocol

- Agent name: **`pr_reviewer`**. Python serves AG-UI at `http://localhost:8123/`.
- Next.js route `/api/copilotkit/[[...path]]` (optional catch-all) uses the **v2 runtime**: `CopilotRuntime` + `createCopilotEndpoint` from `@copilotkit/runtime/v2` served through `hono/vercel`, with `pr_reviewer: new LangGraphHttpAgent({ url: process.env.AGENT_URL ?? "http://localhost:8123" })`. It answers the client's GET `/info` probe and streams runs at `/agent/pr_reviewer/run`. POSTs to `/agent/*/connect` are answered 204 at the route: each subscribing hook opens its own join stream, which starves the browser's six-connection HTTP/1.1 limit and makes the periodic `/info` probe time out; the run stream already carries every event a single tab needs.
- Frontend reads/writes agent state with `useCoAgent<ReviewState>({ name: "pr_reviewer", initialState })` from `@copilotkit/react-core`.
- Starting a review: the URL form calls `setState({ ...EMPTY, pr_url })` then `run()` from `useCoAgent`. No chat message is sent and no headless chat hook is used (`useCopilotChatHeadless_c` is license-gated; the deprecated `appendMessage` drops messages on this runtime). The graph's `route` node sees `pr_url` set with `status` in `idle|error` and no `files` → goes to `fetch`; it also accepts a trailing `Review <url>` user message as the source of the URL. The page keeps the submitted URL in local state until the first state snapshot echoes it back.
- Backend emits progress with `copilotkit_emit_state(config, state)` after each step so the UI updates before the run ends.
- Chat questions go through the same agent; the `chat` node has backend tools and receives frontend tools via `state["copilotkit"]["actions"]` (the starter's `should_route_to_tool_node` pattern).

## State (shared, camel-free: snake_case everywhere, identical in TS and Python)

```ts
type ReviewStatus = "idle" | "fetching" | "analyzing" | "ready" | "error";

interface ReviewState {
  pr_url: string | null;
  status: ReviewStatus;
  progress: string | null;        // "Fetching PR #42…", "Reading 12 files…", "Drafting the brief…"
  error: string | null;
  pr: PRMeta | null;
  files: PRFile[];
  brief: Brief | null;
}

interface PRMeta {
  owner: string; repo: string; number: number; url: string;
  title: string; body: string; author: string;
  base_ref: string; head_ref: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  additions: number; deletions: number; changed_files: number;
  created_at: string;             // ISO
  labels: string[];
}

interface PRFile {
  path: string;
  previous_path: string | null;   // renames
  status: "added" | "modified" | "removed" | "renamed";
  additions: number; deletions: number;
  patch: string;                  // this file's full unified diff INCLUDING the `diff --git a/.. b/..` header — @pierre/diffs <PatchDiff patch> renders it directly
  language: string | null;        // shiki id guessed from extension ("ts", "py", "go" …)
}

type RiskLevel = "low" | "medium" | "high";
type FileRole = "core" | "supporting" | "test" | "config" | "docs" | "generated";
type Severity = "info" | "warn" | "block";

interface Brief {
  headline: string;               // ≤ 120 chars, one sentence, what the PR does
  intent: string;                 // 2–4 sentences: what changed and why, plain language
  risk: RiskLevel;
  risk_reasons: string[];         // 1–5 short bullets
  change_map: { path: string; role: FileRole; summary: string }[];   // EVERY changed file appears exactly once
  visuals: Visual[];              // 1–6 show-me blocks, most important first
  checklist: { item: string; path: string | null; line: number | null; severity: Severity }[];  // what a reviewer should verify
  questions_for_author: string[]; // 0–3
  testing: string;                // what tests changed / what is untested
  verdict: "approve" | "approve_with_nits" | "needs_changes" | "needs_discussion";
  verdict_reason: string;         // one sentence
  time_plan: {                    // the reviewer has 15 minutes for the whole PR, Brief included
    budget_minutes: number;       // 15
    read_first: { path: string; minutes: number; why: string }[];  // 1–5 files in order; minutes sum ≤ budget − 3
    skip: { path: string; why: string }[];                          // files not worth opening in this budget
  };
}
// checklist items also carry `minutes: number | null`. Caps enforced by the prompt and scored by the evals:
// intent ≤ 3 sentences, risk_reasons ≤ 4, visuals ≤ 4, checklist ≤ 6, questions ≤ 3.

interface Ref { path: string; line: number | null; }   // line = new-file line number

type Visual =
  | { kind: "pseudocode";     title: string; body: string; caption: string | null; refs: Ref[] }
  | { kind: "call_tree";      title: string; body: string; caption: string | null; refs: Ref[] }
  | { kind: "component_tree"; title: string; body: string; caption: string | null; refs: Ref[] }
  | { kind: "file_tree";      title: string; body: string; caption: string | null; refs: Ref[] }
  | { kind: "mermaid";        title: string; body: string; caption: string | null; refs: Ref[] }   // flowchart | sequenceDiagram | stateDiagram-v2
  | { kind: "shape_diff";     title: string; before: string; after: string; caption: string | null; refs: Ref[] }
  | { kind: "code_block";     title: string; body: string; language: string; caption: string | null; refs: Ref[] }
  | { kind: "callout";        title: string; body: string; tone: "info" | "warn" | "danger"; caption: string | null; refs: Ref[] };
```

show-me vocabulary (from humanlayer's show-me skill): **pseudocode** for logic,
**call_tree** for runtime control flow (indented names), **component_tree** for
UI structure (`<Comp>` + hooks, indented), **file_tree** for responsibility
scope (`├──` style), **mermaid** for interaction/data flow, **shape_diff** for
before/after of a shape (a type, a call tree, a layout), **code_block** for
copyable new code when ownership matters, **callout** for a warning or key
fact. Smallest view that clarifies the point; body is plain text, indentation
by two spaces; no markdown fences inside `body`.

## Backend tools (chat node)

| name | args | returns |
|---|---|---|
| `list_files` | — | `[{path, status, additions, deletions, role?}]` |
| `get_file_diff` | `path: str` | that file's `patch` (or "not in this PR") |
| `search_diff` | `query: str` | up to 20 matching lines `{path, line, text, kind}` across patches |
| `get_pr_description` | — | title + body |
| `show_visual` | `visual: Visual` (JSON) | echoes the visual; the frontend renders it inline via `useRenderToolCall({ name: "show_visual" })` |

Frontend tools (declared in the page with `useFrontendTool`, forwarded to the graph automatically):

| name | args | effect |
|---|---|---|
| `open_file` | `path: string, line?: number` | switches to the Diff tab, scrolls to the file, highlights the line |
| `switch_tab` | `tab: "brief" \| "diff"` | changes the center tab |

## Frontend component contracts

- `ReviewNavProvider` / `useReviewNav()` → `{ tab, setTab, selectedPath, selectedLine, open(path, line?), diffStyle: "unified"|"split", setDiffStyle, expandedPaths: Set<string>, toggleExpanded(path) }`. Plain React context, no extra deps.
- `<VisualRenderer visual={Visual} onRef?={(ref: Ref) => void} compact?={boolean} />` dispatches on `kind` to `<Pseudocode/>`, `<CallTree/>`, `<ComponentTree/>`, `<FileTreeVisual/>`, `<MermaidDiagram/>`, `<ShapeDiff/>`, `<CodeBlock/>`, `<Callout/>`. Each takes the matching `visual` prop plus `onRef`. Refs render as small chips (`path:line`) that call `onRef`.
- `<DiffViewer files={PRFile[]} />` renders one collapsible section per file using `@pierre/diffs` `PatchDiff` (`import { PatchDiff } from "@pierre/diffs/react"`), honoring `diffStyle`, with `id={`file-${slug(path)}`}` anchors, a sticky per-file header (path, +/-, status badge), and `selectedLines` from nav. Only expanded files mount a PatchDiff (perf).
- `<FileTree files={PRFile[]} changeMap={Brief["change_map"] | undefined} />` groups by directory, shows role badges and +/- counts, click → `open(path)`.
- `<BriefPanel brief={Brief} pr={PRMeta} onRef />` — headline, intent, risk, change map by role, visuals, checklist, questions, testing.
- `<UrlForm onSubmit={(url) => void} busy />` — validates `https://github.com/{owner}/{repo}/pull/{n}`.
- `<ProgressCard state={ReviewState} />` — rendered inside chat with `useCoAgentStateRender` while `status` is fetching/analyzing.
- Chat: `CopilotSidebar` from `@copilotkit/react-ui` (import its `styles.css` in layout), `defaultOpen`, suggestions tuned to PR review.

## Model & prompts

- `agent/src/llm.py` is the only place a chat model is constructed: `make_chat_model()` returns `ChatAnthropic(model, max_tokens=16000, thinking={"type": "adaptive"})` for `PR_REVIEWER_PROVIDER=anthropic` (default) or `ChatOpenAI(model, base_url=ZAI_BASE_URL, max_tokens=16000, temperature=0.2)` for `zai`. `model_name()`, `require_api_key()`, and `structured_output_method()` live beside it.
- Analyze: `model.with_structured_output(Brief, method=llm.structured_output_method())` — `json_schema` on Anthropic, `function_calling` on Z.AI (GLM answers `response_format` requests with prose). Input = PR meta + every file patch (truncate a single file's patch at 40k chars with a marker; if the whole diff exceeds ~350k chars, include the largest files' patches first and list the rest as names only, and say so in `testing`/`risk_reasons`). Never silently drop files from `change_map`.
- Chat system prompt includes: PR meta, the Brief (JSON), the file list with roles, and instructions to use `open_file` when citing code and `show_visual` for anything structural.

## Evals (basic, deterministic first)

- `agent/evals/cases/*.json`: `{ "name", "pr": PRMeta, "files": PRFile[], "expect": { "risk_in": ["low","medium"], "must_mention": ["retry", "timeout"], "must_not_mention": ["As an AI"], "min_visuals": 1, "roles": {"src/x.py": "core"} } }`. Three hand-written cases: a small bug fix, a refactor touching tests, a risky migration.
- `agent/evals/scoring.py`: pure functions → per-case `{ schema_valid, files_covered, headline_ok, mentions, forbidden, visuals_ok, mermaid_ok, risk_ok, score }`.
- `agent/evals/run.py`: `uv run python -m evals.run [--case name] [--judge]` runs `analyze` for each case (needs `ANTHROPIC_API_KEY`), prints a markdown table and writes `evals/reports/<timestamp>.json`. `--judge` adds an LLM-as-judge faithfulness score (0–5) with rationale.
- `agent/tests/`: unit tests for the diff parser, schema round-trip, scoring (uses a canned Brief), and the router. No network.

## Conventions

- TypeScript strict; `npm run lint` and `npx tsc --noEmit` clean. Python: `uv run ruff check` and `uv run pytest` clean.
- No new npm/pip dependencies beyond what is installed (`@copilotkit/*`, `@pierre/diffs`, `shiki`, `mermaid`, `zod`, shadcn; `copilotkit`, `ag-ui-langgraph`, `langgraph`, `langchain`, `langchain-anthropic`, `fastapi`, `uvicorn`, `pydantic`, `python-dotenv`) — ask before adding.
- Comments explain constraints and why, not what.
- Design: quiet, typographic, one accent (`--accent`), dense but airy, dark and light. Monospace for anything code-shaped. Think GitHub's PR page redesigned by someone who cares.
