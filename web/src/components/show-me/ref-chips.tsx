"use client";

import type { Ref } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_PATH_CHARS = 36;

/** Shortens from the left, keeping whole trailing segments: `…/dir/file.ts`. */
export function truncatePath(path: string, max = MAX_PATH_CHARS): string {
  if (path.length <= max) return path;
  const parts = path.split("/");
  let kept = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    const candidate = `${parts[i]}/${kept}`;
    if (candidate.length + 2 > max) break;
    kept = candidate;
  }
  return `…/${kept}`;
}

export function refLabel(ref: Ref): string {
  return ref.line === null ? ref.path : `${ref.path}:${ref.line}`;
}

export interface RefChipsProps {
  refs: Ref[];
  onRef?: (ref: Ref) => void;
  compact?: boolean;
  className?: string;
}

export function RefChips({ refs, onRef, compact, className }: RefChipsProps) {
  if (refs.length === 0) return null;
  const chip = cn(
    "inline-flex max-w-full items-center rounded-md border border-border bg-muted/50 font-mono text-muted-foreground",
    compact ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs",
  );
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {refs.map((ref, i) => {
        const full = refLabel(ref);
        const inner = (
          <>
            <span className="truncate">{truncatePath(ref.path)}</span>
            {ref.line !== null && <span className="text-foreground/70">:{ref.line}</span>}
          </>
        );
        return (
          <li key={`${full}-${i}`} className="min-w-0">
            {onRef ? (
              <button
                type="button"
                title={full}
                onClick={() => onRef(ref)}
                className={cn(
                  chip,
                  "cursor-pointer transition-colors hover:border-brand/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
                )}
              >
                {inner}
              </button>
            ) : (
              <span title={full} className={chip}>
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
