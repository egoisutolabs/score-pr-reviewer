"use client";

import type { ReactNode } from "react";

import type { Ref, Visual } from "@/lib/types";

import { MonoBlock } from "./mono-block";
import { VisualFrame } from "./visual-frame";

export type FileTreeVisual = Extract<Visual, { kind: "file_tree" }>;

export interface FileTreeVisualProps {
  visual: FileTreeVisual;
  onRef?: (ref: Ref) => void;
  compact?: boolean;
}

const GLYPHS = /([│├└┌┐┘┬┴┼─]+)/g;
// A name ends at two+ spaces or an explicit marker; the rest is the annotation
// the agent attaches to a file (“core”, “# new”, “— retry loop”).
const ANNOTATION = /^(.*?\S)(\s{2,}.*|\s(?:#|\/\/|—|–|→).*)$/;

function renderName(name: string): ReactNode {
  const isDir = name.endsWith("/");
  return <span className={isDir ? "font-medium text-foreground" : undefined}>{name}</span>;
}

function renderLine(content: string): ReactNode {
  const parts = content.split(GLYPHS);
  return parts.map((part, i) => {
    if (part === "") return null;
    if (i % 2 === 1) return <span key={i} className="text-muted-foreground/60">{part}</span>;
    const match = ANNOTATION.exec(part);
    if (!match) return <span key={i}>{renderName(part)}</span>;
    return (
      <span key={i}>
        {renderName(match[1])}
        <span className="text-muted-foreground">{match[2]}</span>
      </span>
    );
  });
}

export function FileTreeVisual({ visual, onRef, compact }: FileTreeVisualProps) {
  return (
    <VisualFrame
      kind="file_tree"
      title={visual.title}
      caption={visual.caption}
      refs={visual.refs}
      onRef={onRef}
      compact={compact}
    >
      {/* The │ connectors already draw the structure; indentation guides would double it. */}
      <MonoBlock body={visual.body} compact={compact} guides={false} renderLine={renderLine} />
    </VisualFrame>
  );
}
