"use client";

import type { ReactNode } from "react";

import type { Ref, VisualKind } from "@/lib/types";
import { cn } from "@/lib/utils";

import { RefChips } from "./ref-chips";

export const KIND_LABELS: Record<VisualKind, string> = {
  pseudocode: "Pseudocode",
  call_tree: "Call tree",
  component_tree: "Component tree",
  file_tree: "File tree",
  mermaid: "Diagram",
  shape_diff: "Before / after",
  code_block: "Code",
  callout: "Note",
};

export interface VisualFrameProps {
  kind: VisualKind;
  title: string;
  caption: string | null;
  refs: Ref[];
  onRef?: (ref: Ref) => void;
  /** Inside chat bubbles: tighter padding, no kind label. */
  compact?: boolean;
  /** Overrides the kind label — callouts label by tone. */
  label?: string;
  /** Right-aligned header extras (language tag, copy button). */
  actions?: ReactNode;
  /** Applied to the outer card, e.g. a tone border for callouts. */
  className?: string;
  children: ReactNode;
}

export function VisualFrame({
  kind,
  title,
  caption,
  refs,
  onRef,
  compact = false,
  label,
  actions,
  className,
  children,
}: VisualFrameProps) {
  const pad = compact ? "px-3 py-2" : "px-4 py-3";
  const hasFooter = Boolean(caption) || refs.length > 0;
  return (
    <figure
      data-visual-kind={kind}
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border border-border bg-card text-card-foreground",
        className,
      )}
    >
      <div className={cn("flex items-start justify-between gap-3 border-b border-border", pad)}>
        <div className="min-w-0">
          {!compact && (
            <div className="mb-0.5 font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              {label ?? KIND_LABELS[kind]}
            </div>
          )}
          <h3 className={cn("font-medium leading-snug text-foreground", compact ? "text-[13px]" : "text-sm")}>
            {title}
          </h3>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className="min-w-0">{children}</div>
      {hasFooter && (
        <figcaption className={cn("flex flex-col gap-2 border-t border-border", pad)}>
          {caption && (
            <p className={cn("text-muted-foreground", compact ? "text-xs leading-5" : "text-[13px] leading-relaxed")}>
              {caption}
            </p>
          )}
          <RefChips refs={refs} onRef={onRef} compact={compact} />
        </figcaption>
      )}
    </figure>
  );
}
