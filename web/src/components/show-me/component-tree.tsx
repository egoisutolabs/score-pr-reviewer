"use client";

import type { ReactNode } from "react";

import type { Ref, Visual } from "@/lib/types";

import { MonoBlock } from "./mono-block";
import { VisualFrame } from "./visual-frame";

export type ComponentTreeVisual = Extract<Visual, { kind: "component_tree" }>;

export interface ComponentTreeProps {
  visual: ComponentTreeVisual;
  onRef?: (ref: Ref) => void;
  compact?: boolean;
}

// Captures `<Tag …>`, `</Tag>`, `<Tag />` and `useThing(…)` as alternating
// split() groups; everything between is annotation and stays muted.
const TOKEN = /(<\/?[A-Za-z][\w.:-]*(?:\s[^<>]*?)?\/?>|\buse[A-Z]\w*\([^)]*\))/g;

function renderLine(content: string): ReactNode {
  const parts = content.split(TOKEN);
  if (parts.length === 1) return <span className="text-muted-foreground">{content}</span>;
  return parts.map((part, i) => {
    if (part === "") return null;
    if (i % 2 === 0) return <span key={i} className="text-muted-foreground">{part}</span>;
    const isTag = part.startsWith("<");
    return (
      <span key={i} className={isTag ? "text-foreground" : "text-brand"}>
        {part}
      </span>
    );
  });
}

export function ComponentTree({ visual, onRef, compact }: ComponentTreeProps) {
  return (
    <VisualFrame
      kind="component_tree"
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
