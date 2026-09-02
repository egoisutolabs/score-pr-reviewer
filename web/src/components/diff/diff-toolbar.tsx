"use client";

// Sticky strip above the file sections: totals, unified/split toggle,
// expand/collapse all, and the j/k keyboard hint. The key handler lives here
// (not in the provider) so it is only active while a diff viewer is mounted.

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useReviewNav, type DiffStyle } from "@/lib/review-nav";
import type { PRFile } from "@/lib/types";
import { cn } from "@/lib/utils";

import { DiffCounts } from "./diff-file";

export interface DiffToolbarProps {
  /** In display order — j/k walk this list. */
  files: PRFile[];
  className?: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function DiffToolbar({ files, className }: DiffToolbarProps) {
  const { tab, diffStyle, setDiffStyle, selectedPath, open, expandAll, collapseAll } =
    useReviewNav();

  const additions = files.reduce((sum, f) => sum + f.additions, 0);
  const deletions = files.reduce((sum, f) => sum + f.deletions, 0);

  useEffect(() => {
    // Only steal j/k while the diff is the active tab; the chat and the URL
    // form are inputs and are excluded by isTypingTarget regardless.
    if (tab !== "diff" || files.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "j" && event.key !== "k") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      const index = selectedPath ? files.findIndex((f) => f.path === selectedPath) : -1;
      const delta = event.key === "j" ? 1 : -1;
      const next =
        index === -1
          ? delta === 1
            ? 0
            : files.length - 1
          : Math.min(files.length - 1, Math.max(0, index + delta));
      if (next !== index) open(files[next]!.path);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab, files, selectedPath, open]);

  return (
    <div
      role="toolbar"
      aria-label="Diff controls"
      className={cn(
        "sticky top-0 z-20 flex h-[var(--diff-toolbar-h,2.5rem)] items-center gap-3 border-b bg-background/95 px-1 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className,
      )}
    >
      <p className="flex min-w-0 items-baseline gap-2 text-sm">
        <span className="font-medium tabular-nums">
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
        <span aria-hidden className="text-muted-foreground/60">·</span>
        <DiffCounts additions={additions} deletions={deletions} />
      </p>

      <div className="ml-auto flex items-center gap-2">
        <ToggleGroup
          aria-label="Diff layout"
          variant="outline"
          size="sm"
          spacing={0}
          value={[diffStyle]}
          onValueChange={(value) => {
            // base-ui allows deselecting the pressed item; we want exactly one
            // layout active at all times, so ignore an empty change.
            const next = value[0] as DiffStyle | undefined;
            if (next) setDiffStyle(next);
          }}
        >
          <ToggleGroupItem value="unified" aria-label="Unified layout" className="text-xs">
            Unified
          </ToggleGroupItem>
          <ToggleGroupItem value="split" aria-label="Split layout" className="text-xs">
            Split
          </ToggleGroupItem>
        </ToggleGroup>

        <span className="flex items-center">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => expandAll(files.map((f) => f.path))}
            className="text-muted-foreground"
          >
            Expand all
          </Button>
          <Button variant="ghost" size="xs" onClick={collapseAll} className="text-muted-foreground">
            Collapse all
          </Button>
        </span>

        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
          <KbdGroup>
            <Kbd>j</Kbd>
            <Kbd>k</Kbd>
          </KbdGroup>
          <span>file</span>
        </span>
      </div>
    </div>
  );
}
