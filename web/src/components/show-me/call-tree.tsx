"use client";

import type { ReactNode } from "react";

import type { Ref, Visual } from "@/lib/types";

import { MonoBlock } from "./mono-block";
import { VisualFrame } from "./visual-frame";

export type CallTreeVisual = Extract<Visual, { kind: "call_tree" }>;

export interface CallTreeProps {
  visual: CallTreeVisual;
  onRef?: (ref: Ref) => void;
  compact?: boolean;
}

// `name(args) trailer` — the callee name carries the meaning; arguments and any
// trailing annotation (“→ retries”, “// on 5xx”) are context, so they recede.
const CALL = /^([\w.$#:<>[\]-]+)(\(.*?\))(.*)$/;

function renderLine(content: string): ReactNode {
  const match = CALL.exec(content);
  if (!match) return content;
  return (
    <>
      <span className="text-foreground">{match[1]}</span>
      <span className="text-muted-foreground">{match[2]}</span>
      {match[3] && <span className="text-muted-foreground">{match[3]}</span>}
    </>
  );
}

export function CallTree({ visual, onRef, compact }: CallTreeProps) {
  return (
    <VisualFrame
      kind="call_tree"
      title={visual.title}
      caption={visual.caption}
      refs={visual.refs}
      onRef={onRef}
      compact={compact}
    >
      <MonoBlock body={visual.body} compact={compact} renderLine={renderLine} />
    </VisualFrame>
  );
}
