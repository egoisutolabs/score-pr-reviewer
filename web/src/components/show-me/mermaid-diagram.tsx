"use client";

import { useEffect, useId, useState } from "react";

import type { Ref, Visual } from "@/lib/types";
import { cn } from "@/lib/utils";

import { MonoBlock } from "./mono-block";
import { type ColorScheme, useColorScheme } from "./use-color-scheme";
import { VisualFrame } from "./visual-frame";

export type MermaidVisual = Extract<Visual, { kind: "mermaid" }>;

export interface MermaidDiagramProps {
  visual: MermaidVisual;
  onRef?: (ref: Ref) => void;
  compact?: boolean;
}

const FONT = "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

// Hex approximations of the oklch tokens in globals.css: mermaid's base theme
// derives the rest of its palette with khroma, which cannot parse oklch().
// Brand is used only for notes and activations so diagrams stay quiet.
const THEME_VARIABLES: Record<ColorScheme, Record<string, string>> = {
  light: {
    background: "#ffffff",
    primaryColor: "#f5f5f5",
    primaryTextColor: "#252525",
    primaryBorderColor: "#c9c9c9",
    secondaryColor: "#ebebeb",
    tertiaryColor: "#fafafa",
    lineColor: "#6f6f6f",
    textColor: "#252525",
    mainBkg: "#f5f5f5",
    nodeBorder: "#c9c9c9",
    clusterBkg: "#fafafa",
    clusterBorder: "#e5e5e5",
    edgeLabelBackground: "#ffffff",
    actorBkg: "#f5f5f5",
    actorBorder: "#c9c9c9",
    actorTextColor: "#252525",
    actorLineColor: "#c9c9c9",
    signalColor: "#6f6f6f",
    signalTextColor: "#252525",
    labelBoxBkgColor: "#f5f5f5",
    labelBoxBorderColor: "#c9c9c9",
    labelTextColor: "#252525",
    loopTextColor: "#252525",
    noteBkgColor: "#fdf2ee",
    noteTextColor: "#252525",
    noteBorderColor: "#d95a3c",
    activationBkgColor: "#fdf2ee",
    activationBorderColor: "#d95a3c",
    sequenceNumberColor: "#ffffff",
  },
  dark: {
    background: "#2e2e2e",
    primaryColor: "#3d3d3d",
    primaryTextColor: "#fafafa",
    primaryBorderColor: "#5a5a5a",
    secondaryColor: "#474747",
    tertiaryColor: "#333333",
    lineColor: "#a3a3a3",
    textColor: "#fafafa",
    mainBkg: "#3d3d3d",
    nodeBorder: "#5a5a5a",
    clusterBkg: "#333333",
    clusterBorder: "#474747",
    edgeLabelBackground: "#2e2e2e",
    actorBkg: "#3d3d3d",
    actorBorder: "#5a5a5a",
    actorTextColor: "#fafafa",
    actorLineColor: "#5a5a5a",
    signalColor: "#a3a3a3",
    signalTextColor: "#fafafa",
    labelBoxBkgColor: "#3d3d3d",
    labelBoxBorderColor: "#5a5a5a",
    labelTextColor: "#fafafa",
    loopTextColor: "#fafafa",
    noteBkgColor: "#4a2f27",
    noteTextColor: "#fafafa",
    noteBorderColor: "#ef7a5e",
    activationBkgColor: "#4a2f27",
    activationBorderColor: "#ef7a5e",
    sequenceNumberColor: "#2e2e2e",
  },
};

type RenderResult = { key: string } & ({ status: "ok"; svg: string } | { status: "error"; message: string });
type RenderState = RenderResult | { status: "loading" };

// mermaid.render ids must be unique per call and valid CSS selectors; React ids
// contain punctuation, and a re-render of the same component must not reuse an
// id mermaid may still be tearing down.
let sequence = 0;

export function MermaidDiagram({ visual, onRef, compact }: MermaidDiagramProps) {
  const scheme = useColorScheme();
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // Keyed by body + scheme rather than reset in the effect: a result for a
  // previous input simply stops matching and the skeleton shows again.
  const key = `${scheme}\u0000${visual.body}`;
  const [result, setResult] = useState<RenderResult | null>(null);
  const state: RenderState = result?.key === key ? result : { status: "loading" };

  useEffect(() => {
    let cancelled = false;
    const renderId = `mmd-${reactId}-${++sequence}`;
    (async () => {
      try {
        // Imported here, never at module top level: mermaid touches window on load.
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: THEME_VARIABLES[scheme],
          fontFamily: FONT,
          // Parse errors are shown in our own fallback; mermaid must not inject
          // its bomb SVG into the document body.
          suppressErrorRendering: true,
        });
        const { svg } = await mermaid.render(renderId, visual.body.trim());
        if (!cancelled) setResult({ key, status: "ok", svg });
      } catch (err) {
        if (!cancelled) {
          setResult({ key, status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, visual.body, scheme, reactId]);

  return (
    <VisualFrame
      kind="mermaid"
      title={visual.title}
      caption={visual.caption}
      refs={visual.refs}
      onRef={onRef}
      compact={compact}
    >
      {state.status === "error" ? (
        <div>
          <div
            className={cn(
              "border-b border-border font-mono text-[11px] text-muted-foreground",
              compact ? "px-3 py-1.5" : "px-4 py-2",
            )}
          >
            diagram failed to render
            <span className="ml-2 text-muted-foreground/70">{firstLine(state.message)}</span>
          </div>
          <MonoBlock body={visual.body} compact={compact} guides={false} />
        </div>
      ) : state.status === "loading" ? (
        <div className={cn(compact ? "px-3 py-2" : "px-4 py-3")} aria-busy>
          <div className={cn("animate-pulse rounded-md bg-muted/60", compact ? "h-20" : "h-32")} />
        </div>
      ) : (
        <div
          className={cn(
            "flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full",
            compact ? "px-3 py-2" : "px-4 py-4",
          )}
          // Safe: the markup is mermaid's own output rendered under securityLevel "strict".
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      )}
    </VisualFrame>
  );
}

function firstLine(message: string): string {
  const line = message.split("\n")[0].trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}
