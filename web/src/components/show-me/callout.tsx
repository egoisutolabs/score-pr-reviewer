"use client";

import { Info, OctagonAlert, TriangleAlert } from "lucide-react";
import type { ComponentType } from "react";

import type { Ref, Visual } from "@/lib/types";
import { cn } from "@/lib/utils";

import { VisualFrame } from "./visual-frame";

export type CalloutVisual = Extract<Visual, { kind: "callout" }>;

export interface CalloutProps {
  visual: CalloutVisual;
  onRef?: (ref: Ref) => void;
  compact?: boolean;
}

// info stays neutral; the brand color is reserved for warn so a danger callout
// (destructive token) reads as a distinct, rarer signal rather than a louder warn.
const TONES: Record<
  CalloutVisual["tone"],
  { label: string; Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; border: string; icon: string }
> = {
  info: { label: "Note", Icon: Info, border: "border-l-foreground/25", icon: "text-muted-foreground" },
  warn: { label: "Warning", Icon: TriangleAlert, border: "border-l-brand", icon: "text-brand" },
  danger: { label: "Danger", Icon: OctagonAlert, border: "border-l-destructive", icon: "text-destructive" },
};

function paragraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function Callout({ visual, onRef, compact }: CalloutProps) {
  const tone = TONES[visual.tone] ?? TONES.info;
  return (
    <VisualFrame
      kind="callout"
      label={tone.label}
      title={visual.title}
      caption={visual.caption}
      refs={visual.refs}
      onRef={onRef}
      compact={compact}
      className={cn("border-l-2", tone.border)}
    >
      <div className={cn("flex gap-3", compact ? "px-3 py-2" : "px-4 py-3")}>
        <tone.Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone.icon)} />
        <div className={cn("min-w-0 flex-1 space-y-2 text-foreground/90", compact ? "text-xs leading-5" : "text-[13px] leading-relaxed")}>
          {paragraphs(visual.body).map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
        </div>
      </div>
    </VisualFrame>
  );
}
