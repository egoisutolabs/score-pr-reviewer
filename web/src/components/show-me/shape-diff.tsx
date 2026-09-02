"use client";

import { type DiffLine, diffLines } from "@/lib/line-diff";
import type { Ref, Visual } from "@/lib/types";
import { cn } from "@/lib/utils";

import { VisualFrame } from "./visual-frame";

export type ShapeDiffVisual = Extract<Visual, { kind: "shape_diff" }>;

export interface ShapeDiffProps {
  visual: ShapeDiffVisual;
  onRef?: (ref: Ref) => void;
  compact?: boolean;
}

function Column({
  heading,
  lines,
  tint,
  compact,
}: {
  heading: string;
  lines: DiffLine[];
  tint: "del" | "add";
  compact?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "border-b border-border font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase",
          compact ? "px-3 py-1" : "px-4 py-1.5",
        )}
      >
        {heading}
      </div>
      <div
        className={cn(
          "overflow-x-auto font-mono proportional-nums text-foreground/90",
          compact ? "py-1.5 text-xs leading-5" : "py-2 text-[13px] leading-6",
        )}
      >
        <div className="min-w-max">
          {lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre",
                compact ? "px-3" : "px-4",
                line.kind === tint && (tint === "del" ? "bg-diff-del" : "bg-diff-add"),
              )}
            >
              {line.text === "" ? " " : line.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ShapeDiff({ visual, onRef, compact }: ShapeDiffProps) {
  const diff = diffLines(visual.before, visual.after);
  const before = diff.filter((l) => l.kind !== "add");
  const after = diff.filter((l) => l.kind !== "del");
  return (
    <VisualFrame
      kind="shape_diff"
      title={visual.title}
      caption={visual.caption}
      refs={visual.refs}
      onRef={onRef}
      compact={compact}
    >
      {/* Container query, not viewport: the brief lives in a resizable panel and
          in chat bubbles, so the column split follows the frame's own width. */}
      <div className="@container">
        <div className="grid grid-cols-1 divide-y divide-border @xl:grid-cols-2 @xl:divide-x @xl:divide-y-0">
          <Column heading="Before" lines={before} tint="del" compact={compact} />
          <Column heading="After" lines={after} tint="add" compact={compact} />
        </div>
      </div>
    </VisualFrame>
  );
}
