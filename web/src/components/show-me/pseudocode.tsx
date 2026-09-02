"use client";

import type { ReactNode } from "react";

import type { Ref, Visual } from "@/lib/types";

import { MonoBlock } from "./mono-block";
import { VisualFrame } from "./visual-frame";

export type PseudocodeVisual = Extract<Visual, { kind: "pseudocode" }>;

export interface PseudocodeProps {
  visual: PseudocodeVisual;
  onRef?: (ref: Ref) => void;
  compact?: boolean;
}

// A comment marker only counts at line start or after whitespace, and must be
// followed by a space, so `#retry` tags and URLs inside pseudocode stay intact.
const COMMENT = /^(.*?)((?:^|\s)(?:\/\/|#)\s.*)$/;

function renderLine(content: string): ReactNode {
  const match = COMMENT.exec(content);
  if (!match) return content;
  return (
    <>
      {match[1]}
      <span className="text-muted-foreground italic">{match[2]}</span>
    </>
  );
}

export function Pseudocode({ visual, onRef, compact }: PseudocodeProps) {
  return (
    <VisualFrame
      kind="pseudocode"
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
