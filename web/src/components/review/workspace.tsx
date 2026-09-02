"use client";

import { RotateCcw } from "lucide-react";

import { DiffViewer, FileTree } from "@/components/diff";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useReviewNav } from "@/lib/review-nav";
import type { ReviewState } from "@/lib/types";
import { cn } from "@/lib/utils";

import { BriefPanel } from "./brief-panel";
import { ReviewSidebar } from "./chat-panel";
import { ReviewHeader } from "./review-header";

type Tab = "brief" | "diff";

const STEPS = ["Fetch the pull request", "Read the diff", "Draft the brief"] as const;

function activeStep(state: ReviewState): number {
  // "idle" with a pr_url is the frame between submit and the graph's first emission.
  if (state.status === "idle" || state.status === "fetching") return 0;
  // The graph flips to `analyzing` once files exist; before that the diff is still streaming in.
  if (state.status === "analyzing") return state.files.length > 0 ? 2 : 1;
  return STEPS.length;
}

function ProgressSteps({ state }: { state: ReviewState }) {
  const current = activeStep(state);
  const where = state.pr ? `${state.pr.owner}/${state.pr.repo}#${state.pr.number}` : state.pr_url;
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm">
        {where && <p className="mb-6 truncate font-mono text-xs text-muted-foreground">{where}</p>}
        <ol className="space-y-3">
          {STEPS.map((label, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={label} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-[7px] size-1.5 shrink-0 rounded-full",
                    done && "bg-foreground",
                    active && "animate-pulse bg-brand",
                    !done && !active && "bg-border",
                  )}
                />
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm leading-6",
                      active && "font-medium text-foreground",
                      done && "text-foreground/70",
                      !done && !active && "text-muted-foreground",
                    )}
                  >
                    {label}
                    {i === 1 && state.files.length > 0 && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground tabular-nums">
                        {state.files.length} files
                      </span>
                    )}
                  </p>
                  {active && state.progress && (
                    <p className="text-xs leading-5 text-muted-foreground">{state.progress}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md">
        <p className="text-sm font-medium">The review didn&apos;t finish.</p>
        <p className="mt-2 font-mono text-xs leading-5 break-words text-destructive">
          {message ?? "Unknown error."}
        </p>
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          <RotateCcw data-icon="inline-start" />
          Retry
        </Button>
      </div>
    </div>
  );
}

export interface WorkspaceProps {
  state: ReviewState;
  onReset: () => void;
  onRetry: () => void;
}

export function Workspace({ state, onReset, onRetry }: WorkspaceProps) {
  const nav = useReviewNav();
  const { pr, brief, files, status } = state;
  const ready = status === "ready" && pr !== null && brief !== null;

  return (
    <ReviewSidebar>
      <div className="flex h-full min-h-0 flex-col">
        {pr ? (
          <ReviewHeader pr={pr} brief={brief} onReset={onReset} />
        ) : (
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
            <span className="truncate font-mono text-xs text-muted-foreground">{state.pr_url}</span>
            <Button variant="ghost" size="sm" onClick={onReset}>
              Cancel
            </Button>
          </header>
        )}

        {status === "error" && <ErrorState message={state.error} onRetry={onRetry} />}
        {(status === "fetching" || status === "analyzing" || status === "idle") && <ProgressSteps state={state} />}

        {ready && (
          <Tabs
            value={nav.tab}
            onValueChange={(value) => nav.setTab(value as Tab)}
            className="min-h-0 flex-1 gap-0"
          >
            <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
              <TabsList variant="line" className="h-full">
                <TabsTrigger value="brief">Brief</TabsTrigger>
                <TabsTrigger value="diff">
                  Diff
                  <span className="ml-1 font-mono text-[11px] text-muted-foreground tabular-nums">
                    {files.length}
                  </span>
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="brief" className="min-h-0 flex-1 overflow-y-auto">
              <BriefPanel brief={brief} pr={pr} files={files} onRef={(ref) => nav.open(ref.path, ref.line)} />
            </TabsContent>
            {/* The file tree is a diff-browsing control, so it exists only here;
                the Brief keeps the full width for reading. */}
            <TabsContent value="diff" className="min-h-0 flex-1">
              <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0">
                <ResizablePanel defaultSize={272} minSize={240} maxSize={320} className="min-h-0">
                  <div className="h-full overflow-y-auto">
                    <FileTree files={files} changeMap={brief.change_map} timePlan={brief.time_plan} />
                  </div>
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel className="min-h-0 min-w-0 overflow-y-auto">
                  <DiffViewer files={files} changeMap={brief.change_map} timePlan={brief.time_plan} />
                </ResizablePanel>
              </ResizablePanelGroup>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </ReviewSidebar>
  );
}
