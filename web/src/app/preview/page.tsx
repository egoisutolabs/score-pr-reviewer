"use client";

import * as React from "react";
import { Workspace } from "@/components/review";
import { useReviewNav } from "@/lib/review-nav";
import demo from "@/lib/fixtures/demo-review.json";
import big from "@/lib/fixtures/demo-review-big.json";
import type { ReviewState } from "@/lib/types";

// A finished review captured from a real run (score#107), rendered without an
// agent or API key. Exists so the workspace can be designed, screenshotted,
// and smoke-tested deterministically; the chat sidebar is live but idle.
export default function PreviewPage() {
  const noop = React.useCallback(() => {}, []);
  const nav = useReviewNav();
  // /preview?big=1 loads a 24-file, ~100k-char PR with a stub brief: the diff
  // viewer's worst realistic case, for performance work without an agent.
  const isBig = React.useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("big") === "1",
    () => false,
  );
  const state = (isBig ? big : demo) as unknown as ReviewState;
  // /preview?tab=diff&file=<path> lands on the diff so screenshots and manual
  // QA can target either pane without clicking.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const file = params.get("file");
    if (file) nav.open(file);
    else if (params.get("tab") === "diff") nav.setTab("diff");
    // Run once on mount only: `nav` changes identity on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Workspace state={state} onReset={noop} onRetry={noop} />;
}
