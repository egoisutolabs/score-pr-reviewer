"use client";

import * as React from "react";
import {
  useCoAgent,
  useCoAgentStateRender,
  useCopilotChat,
  useFrontendTool,
  useRenderToolCall,
} from "@copilotkit/react-core";

import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import { EmptyState, ProgressCard, Workspace } from "@/components/review";
import { VisualRenderer } from "@/components/show-me";
import { Skeleton } from "@/components/ui/skeleton";
import { useReviewNav } from "@/lib/review-nav";
import { AGENT_NAME, EMPTY_REVIEW_STATE, parsePrUrl, type ReviewState, type Visual, type VisualKind } from "@/lib/types";

const VISUAL_KINDS: ReadonlySet<string> = new Set<VisualKind>([
  "pseudocode",
  "call_tree",
  "component_tree",
  "file_tree",
  "mermaid",
  "shape_diff",
  "code_block",
  "callout",
]);

/**
 * Tool args arrive incrementally while the model streams JSON, so `visual` can
 * be `{}` or `{ kind: "call_tree" }` for a few frames. Only hand the renderer a
 * value whose kind-specific required text is present; optional fields are
 * defaulted so a still-streaming `refs` never reaches `.map`.
 */
function coerceVisual(input: unknown): Visual | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.kind !== "string" || !VISUAL_KINDS.has(raw.kind)) return null;
  if (typeof raw.title !== "string") return null;
  const hasText =
    raw.kind === "shape_diff"
      ? typeof raw.before === "string" && typeof raw.after === "string"
      : typeof raw.body === "string";
  if (!hasText) return null;
  const withDefaults: Record<string, unknown> = {
    caption: null,
    refs: [],
    ...(raw.kind === "callout" ? { tone: "info" } : {}),
    ...(raw.kind === "code_block" ? { language: "text" } : {}),
    ...raw,
  };
  if (!Array.isArray(withDefaults.refs)) withDefaults.refs = [];
  return withDefaults as unknown as Visual;
}

function VisualSkeleton() {
  return (
    <div className="my-1 w-full rounded-lg border border-border p-3">
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="mt-3 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-5/6" />
      <Skeleton className="mt-2 h-3 w-2/3" />
    </div>
  );
}

export default function Home() {
  const nav = useReviewNav();
  const { state, setState, running } = useCoAgent<ReviewState>({
    name: AGENT_NAME,
    initialState: EMPTY_REVIEW_STATE,
  });
  const { appendMessage, reset: resetChat } = useCopilotChat();
  // The URL we asked to review, held locally: agent state only reflects it
  // once the first STATE_SNAPSHOT streams back, and the workspace must not
  // sit on the hero until then.
  const [pendingUrl, setPendingUrl] = React.useState<string | null>(null);

  // Before the first run the agent's state is `{}`, and mid-run emissions may
  // carry a subset of keys; filling from EMPTY keeps every consumer free of
  // optional chaining on fields the contract says are present.
  const review = React.useMemo<ReviewState>(
    () => ({ ...EMPTY_REVIEW_STATE, ...state, pr_url: state?.pr_url ?? pendingUrl }),
    [state, pendingUrl],
  );

  const startReview = React.useCallback(
    async (url: string) => {
      // `status` stays "idle" on purpose: the graph's router enters `fetch`
      // when it sees pr_url with status idle|error and no files. The trigger
      // is a chat message, not run(): run() races the client's agent
      // registration on the first interaction and can drop the run, while a
      // message always starts one — and the router reads the URL from the
      // message too, so the review starts even if setState landed early.
      setPendingUrl(url);
      setState({ ...EMPTY_REVIEW_STATE, pr_url: url });
      nav.setTab("brief");
      await appendMessage(new TextMessage({ role: Role.User, content: `Review ${url}` }));
    },
    [appendMessage, nav, setState],
  );

  // Shareable links: /?pr=<url> starts the review on load, and every review
  // writes its URL back so the address bar is always a link to what is shown.
  // The agent is discovered asynchronously after mount, so the auto-start
  // waits a beat instead of racing setState against discovery.
  const autoStarted = React.useRef(false);
  React.useEffect(() => {
    if (autoStarted.current) return;
    const fromQuery = new URLSearchParams(window.location.search).get("pr");
    if (!fromQuery || !parsePrUrl(fromQuery) || review.pr_url) return;
    autoStarted.current = true;
    const timer = window.setTimeout(() => void startReview(fromQuery), 800);
    return () => window.clearTimeout(timer);
  }, [review.pr_url, startReview]);
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (review.pr_url) url.searchParams.set("pr", review.pr_url);
    else url.searchParams.delete("pr");
    window.history.replaceState(null, "", url.toString());
  }, [review.pr_url]);

  const resetReview = React.useCallback(() => {
    setPendingUrl(null);
    setState(EMPTY_REVIEW_STATE);
    resetChat();
    nav.setTab("brief");
  }, [nav, resetChat, setState]);

  const retryReview = React.useCallback(() => {
    if (review.pr_url) void startReview(review.pr_url);
  }, [review.pr_url, startReview]);

  useFrontendTool(
    {
      name: "open_file",
      description:
        "Open a file changed in this pull request in the diff view, optionally scrolled to a line of the new file. Use it whenever you cite code.",
      parameters: [
        { name: "path", type: "string", description: "Path of a changed file, exactly as listed", required: true },
        { name: "line", type: "number", description: "New-file line number to highlight", required: false },
      ],
      handler: async ({ path, line }) => {
        nav.open(path, line ?? undefined);
        return `Opened ${path}${line ? `:${line}` : ""}`;
      },
    },
    [nav],
  );

  useFrontendTool(
    {
      name: "switch_tab",
      description: "Switch the center panel between the Brief and the Diff.",
      parameters: [{ name: "tab", type: "string", enum: ["brief", "diff"], required: true }],
      handler: async ({ tab }) => {
        nav.setTab(tab);
        return `Switched to ${tab}`;
      },
    },
    [nav],
  );

  useRenderToolCall(
    {
      name: "show_visual",
      description: "Render a show-me visual (pseudocode, call tree, mermaid, shape diff, …) inline in the chat.",
      parameters: [
        { name: "visual", type: "object", description: "A Visual object per the review schema", required: true },
      ],
      render: ({ args, status }) => {
        const visual = coerceVisual(args.visual);
        if (!visual) return status === "complete" ? <></> : <VisualSkeleton />;
        return (
          <div className="my-1 w-full min-w-0">
            <VisualRenderer visual={visual} compact onRef={(ref) => nav.open(ref.path, ref.line)} />
          </div>
        );
      },
    },
    [nav],
  );

  useCoAgentStateRender<Partial<ReviewState>>(
    {
      name: AGENT_NAME,
      render: ({ state: emitted }) => {
        const snapshot: ReviewState = { ...EMPTY_REVIEW_STATE, ...emitted };
        if (snapshot.status !== "fetching" && snapshot.status !== "analyzing") return null;
        return <ProgressCard state={snapshot} />;
      },
    },
    [],
  );

  if (review.pr_url === null) {
    return <EmptyState onSubmit={(url) => void startReview(url)} busy={running} />;
  }
  return <Workspace state={review} onReset={resetReview} onRetry={retryReview} />;
}
