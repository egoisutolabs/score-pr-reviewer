"use client";

import type { ReactNode } from "react";

import type { Ref, Visual } from "@/lib/types";

import { Callout } from "./callout";
import { CallTree } from "./call-tree";
import { CodeBlock } from "./code-block";
import { ComponentTree } from "./component-tree";
import { FileTreeVisual } from "./file-tree-visual";
import { MermaidDiagram } from "./mermaid-diagram";
import { Pseudocode } from "./pseudocode";
import { ShapeDiff } from "./shape-diff";

export interface VisualRendererProps {
  visual: Visual;
  onRef?: (ref: Ref) => void;
  compact?: boolean;
}

// Typed `never` so adding a kind to `Visual` fails typecheck here until it has a
// component. At runtime an unknown kind can still arrive from a model response
// that slipped validation; render nothing rather than crash the brief.
function assertNever(value: never): ReactNode {
  console.error("VisualRenderer: unhandled visual kind", value);
  return null;
}

export function VisualRenderer({ visual, onRef, compact }: VisualRendererProps) {
  switch (visual.kind) {
    case "pseudocode":
      return <Pseudocode visual={visual} onRef={onRef} compact={compact} />;
    case "call_tree":
      return <CallTree visual={visual} onRef={onRef} compact={compact} />;
    case "component_tree":
      return <ComponentTree visual={visual} onRef={onRef} compact={compact} />;
    case "file_tree":
      return <FileTreeVisual visual={visual} onRef={onRef} compact={compact} />;
    case "mermaid":
      return <MermaidDiagram visual={visual} onRef={onRef} compact={compact} />;
    case "shape_diff":
      return <ShapeDiff visual={visual} onRef={onRef} compact={compact} />;
    case "code_block":
      return <CodeBlock visual={visual} onRef={onRef} compact={compact} />;
    case "callout":
      return <Callout visual={visual} onRef={onRef} compact={compact} />;
    default:
      return assertNever(visual);
  }
}
