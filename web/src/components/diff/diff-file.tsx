"use client";

// One collapsible file section of the diff viewer. Owns the sticky per-file
// header and mounts @pierre/diffs' <PatchDiff> only while expanded and only
// on the client: the component renders into a custom element with a shadow
// root, so it cannot run during SSR and it is too heavy to keep alive for
// every file of a large PR.

import { Component, useEffect, useRef, useState, useSyncExternalStore, type ErrorInfo, type ReactNode, type RefObject } from "react";
import { ChevronRight } from "lucide-react";
import { PatchDiff } from "@pierre/diffs/react";

import { Badge } from "@/components/ui/badge";
import { fileAnchor, type FileRole, type FileStatus, type PRFile } from "@/lib/types";
import { useReviewNav } from "@/lib/review-nav";
import { cn } from "@/lib/utils";

import type { PlanMark } from "./diff-viewer";

/** Patches longer than this start collapsed; rendering them is seconds, not ms. */
export const LARGE_PATCH_LINES = 2000;

export function patchLineCount(patch: string): number {
  if (!patch) return 0;
  let count = 1;
  for (let i = 0; i < patch.length; i++) if (patch.charCodeAt(i) === 10) count++;
  return count;
}

// PatchDiff throws synchronously on a patch that does not parse to exactly
// one file with hunks — binary files and mode-only changes arrive as a bare
// header or an empty string, so we never hand those to it.
export function isRenderablePatch(patch: string): boolean {
  return patch.trim().length > 0 && patch.includes("\n@@");
}

export const ROLE_LABEL: Record<FileRole, string> = {
  core: "core",
  supporting: "supporting",
  test: "test",
  config: "config",
  docs: "docs",
  generated: "generated",
};

const STATUS_LABEL: Record<FileStatus, string> = {
  added: "added",
  modified: "modified",
  removed: "removed",
  renamed: "renamed",
};

const STATUS_CLASS: Record<FileStatus, string> = {
  added: "border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  removed: "border-red-600/25 bg-red-500/10 text-red-700 dark:text-red-400",
  modified: "border-border bg-muted/60 text-muted-foreground",
  renamed: "border-sky-600/25 bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

// ---------------------------------------------------------------------------
// Theme detection. The app toggles a `dark` class on <html> (see the
// @custom-variant in globals.css); when no explicit class is present we fall
// back to the OS preference. Modelled as an external store so the diff
// re-renders on change without a setState-in-effect.

function readIsDark(): boolean {
  const classes = document.documentElement.classList;
  if (classes.contains("dark")) return true;
  if (classes.contains("light")) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribeIsDark(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", listener);
  };
}

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribeIsDark, readIsDark, () => false);
}

// Hydration-safe "am I on the client" flag: the server snapshot is false, the
// client snapshot is true, and React reconciles the two without a mismatch.
const noopSubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

// ---------------------------------------------------------------------------

interface BoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

// PatchDiff parses inside render; a malformed patch would otherwise take the
// whole page down. Keyed by patch at the call site so a new PR resets it.
class PatchErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("PatchDiff failed to render", error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-6 text-center font-mono text-xs text-muted-foreground">{children}</div>
  );
}

function PatchBody({ file, selectedLine }: { file: PRFile; selectedLine: number | null }) {
  const { diffStyle } = useReviewNav();
  const isDark = useIsDark();

  return (
    <PatchErrorBoundary
      key={file.patch}
      fallback={<Placeholder>This diff could not be rendered.</Placeholder>}
    >
      <PatchDiff
        patch={file.patch}
        className="block font-mono text-[12.5px] leading-5"
        options={{
          diffStyle,
          theme: { light: "github-light", dark: "github-dark" },
          themeType: isDark ? "dark" : "light",
          lineDiffType: "word",
          hunkSeparators: "line-info",
          stickyHeader: false,
          disableFileHeader: true,
          overflow: "scroll",
        }}
        // Refs carry new-file line numbers, which only exist on the additions
        // side; a removed file has nothing to point at.
        selectedLines={
          selectedLine && file.status !== "removed"
            ? { start: selectedLine, end: selectedLine, side: "additions" }
            : null
        }
      />
    </PatchErrorBoundary>
  );
}

// ---------------------------------------------------------------------------

/** "read 1 · 6 min" or "skip", with the plan's reason on hover. */
export function PlanBadge({ plan, className }: { plan: PlanMark; className?: string }) {
  return (
    <Badge
      variant={plan.kind === "read" ? "default" : "outline"}
      title={plan.why}
      className={cn(
        "h-[18px] px-1.5 font-mono text-[10px] font-normal",
        plan.kind === "read" ? "bg-brand text-brand-foreground" : "text-muted-foreground line-through",
        className,
      )}
    >
      {plan.kind === "read" ? `read ${plan.order} · ${plan.minutes} min` : "skip"}
    </Badge>
  );
}

function splitPath(path: string): { dir: string; base: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1
    ? { dir: "", base: path }
    : { dir: path.slice(0, slash + 1), base: path.slice(slash + 1) };
}

function PathLabel({ path, className }: { path: string; className?: string }) {
  const { dir, base } = splitPath(path);
  return (
    <span className={cn("font-mono text-[13px]", className)}>
      {dir && <span className="text-muted-foreground">{dir}</span>}
      <span className="font-semibold text-foreground">{base}</span>
    </span>
  );
}

export function DiffCounts({
  additions,
  deletions,
  className,
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  return (
    <span className={cn("shrink-0 font-mono text-xs tabular-nums", className)}>
      <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>
      <span className="mx-1 text-muted-foreground/60">·</span>
      <span className="text-red-600 dark:text-red-400">−{deletions}</span>
    </span>
  );
}

export interface DiffFileProps {
  file: PRFile;
  role?: FileRole;
  summary?: string;
  /** From the Brief's time plan: read (with order and minutes) or skip. */
  plan?: PlanMark;
}

// A section mounts its highlighter only once it is within ~one screen of the
// viewport, and then stays mounted. Eight files highlighting at once on tab
// switch produced second-long main-thread stalls; the reviewer only ever looks
// at one or two at a time.
function useNearViewport<T extends Element>(active: boolean, margin = "900px"): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!active || near || !ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: margin },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [active, near, margin]);
  return [ref, near];
}

export function DiffFile({ file, role, summary, plan }: DiffFileProps) {
  const { selectedPath, selectedLine, expandedPaths, toggleExpanded } = useReviewNav();
  const mounted = useMounted();

  const anchor = fileAnchor(file.path);
  const bodyId = `${anchor}-body`;
  const expanded = expandedPaths.has(file.path);
  const selected = selectedPath === file.path;
  const renderable = isRenderablePatch(file.patch);
  const lines = patchLineCount(file.patch);
  const large = lines > LARGE_PATCH_LINES;
  // The selected file mounts at once: open() is about to scroll to it, and
  // the observer would only fire after the scroll lands.
  const [bodyRef, near] = useNearViewport<HTMLDivElement>(expanded && renderable && !selected);
  const shouldMount = mounted && renderable && (selected || near);

  return (
    <section
      id={anchor}
      data-path={file.path}
      data-selected={selected || undefined}
      data-expanded={expanded || undefined}
      // Toolbar height is published by DiffViewer as --diff-toolbar-h so a
      // programmatic scroll lands the header just below the sticky toolbar.
      className={cn(
        "scroll-mt-[calc(var(--diff-toolbar-h,0px)+0.5rem)] rounded-lg border bg-card transition-colors",
        selected && "border-brand/50",
      )}
    >
      <header
        className={cn(
          "sticky top-[var(--diff-toolbar-h,0px)] z-10 flex min-w-0 items-center gap-2 rounded-t-lg bg-card/95 px-2 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-card/85",
          expanded && "border-b",
        )}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => toggleExpanded(file.path)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {file.status === "renamed" && file.previous_path && (
              <>
                <PathLabel path={file.previous_path} className="text-muted-foreground line-through decoration-muted-foreground/40 [&_span]:text-muted-foreground [&_span]:font-normal" />
                <span aria-hidden className="text-muted-foreground">→</span>
              </>
            )}
            <PathLabel path={file.path} className="truncate" />
          </span>
        </button>

        <span className="flex shrink-0 items-center gap-1.5">
          {plan && <PlanBadge plan={plan} />}
          <Badge
            variant="outline"
            className={cn("h-[18px] px-1.5 font-mono text-[10px] font-normal", STATUS_CLASS[file.status])}
          >
            {STATUS_LABEL[file.status]}
          </Badge>
          {role && (
            <Badge
              variant="outline"
              className="h-[18px] px-1.5 font-mono text-[10px] font-normal text-brand border-brand/30"
            >
              {ROLE_LABEL[role]}
            </Badge>
          )}
          {summary && (
            <span
              title={summary}
              className="hidden max-w-[28ch] truncate text-xs text-muted-foreground xl:inline"
            >
              {summary}
            </span>
          )}
          <DiffCounts additions={file.additions} deletions={file.deletions} className="pl-1" />
        </span>
      </header>

      <div id={bodyId} ref={bodyRef} hidden={!expanded} className="overflow-hidden rounded-b-lg">
        {expanded && (
          <>
            {large && (
              <p className="border-b bg-muted/40 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                large diff · {patchLineCount(file.patch).toLocaleString()} lines
              </p>
            )}
            {!renderable ? (
              <Placeholder>
                {file.status === "removed"
                  ? "File removed — no textual diff (binary or empty)."
                  : "No textual diff (binary file or mode-only change)."}
              </Placeholder>
            ) : shouldMount ? (
              <PatchBody file={file} selectedLine={selected ? selectedLine : null} />
            ) : (
              // Roughly one row per patch line keeps the scroll height honest
              // before the real diff replaces it.
              <div style={{ minHeight: Math.min(lines, 80) * 20 }}>
                <Placeholder>Loading diff…</Placeholder>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
