"use client";

import type { ReviewState, ReviewStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<ReviewStatus, string> = {
  idle: "Waiting",
  fetching: "Fetching",
  analyzing: "Analyzing",
  ready: "Ready",
  error: "Failed",
};

export interface ProgressCardProps {
  state: ReviewState;
}

/**
 * Compact status line for the chat transcript. It is rendered by
 * `useCoAgentStateRender` on every state emission, so it must stay cheap and
 * must not assume `pr` or `files` are populated yet.
 */
export function ProgressCard({ state }: ProgressCardProps) {
  const { status, progress, pr, files, error } = state;
  const live = status === "fetching" || status === "analyzing";
  const fileCount = files.length > 0 ? files.length : (pr?.changed_files ?? null);
  const where = pr ? `${pr.owner}/${pr.repo}#${pr.number}` : state.pr_url ? state.pr_url.replace(/^https:\/\/github\.com\//, "") : null;

  return (
    <div className="my-1 w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            live && "animate-pulse bg-brand",
            status === "ready" && "bg-foreground",
            status === "error" && "bg-destructive",
            status === "idle" && "bg-muted-foreground",
          )}
        />
        <span className="font-medium">{STATUS_LABEL[status]}</span>
        {where && <span className="truncate font-mono text-xs text-muted-foreground">{where}</span>}
      </div>
      {(progress || error) && (
        <p className={cn("mt-1 text-xs", status === "error" ? "text-destructive" : "text-muted-foreground")}>
          {status === "error" ? error ?? "Something went wrong." : progress}
        </p>
      )}
      {fileCount !== null && status !== "error" && (
        <p className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
          {fileCount} {fileCount === 1 ? "file" : "files"}
          {pr && (
            <>
              {" · "}
              <span className="text-foreground/80">+{pr.additions}</span>
              {" "}
              <span className="text-foreground/80">−{pr.deletions}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
