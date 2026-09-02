"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import type { BundledLanguage } from "shiki";

import { Button } from "@/components/ui/button";
import type { Ref, Visual } from "@/lib/types";
import { cn } from "@/lib/utils";

import { MonoBlock } from "./mono-block";
import { truncatePath } from "./ref-chips";
import { VisualFrame } from "./visual-frame";

import "./show-me.css";

export type CodeBlockVisual = Extract<Visual, { kind: "code_block" }>;

export interface CodeBlockProps {
  visual: CodeBlockVisual;
  onRef?: (ref: Ref) => void;
  compact?: boolean;
}

export function CodeBlock({ visual, onRef, compact }: CodeBlockProps) {
  // Keyed by input rather than reset in the effect: a stale result for a
  // previous body simply stops matching, so no synchronous setState is needed.
  const key = `${visual.language}\u0000${visual.body}`;
  const [result, setResult] = useState<{ key: string; html: string } | null>(null);
  const html = result?.key === key ? result.html : null;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Client-only dynamic import: the full bundle is large and lazily loads
        // one grammar per language, so nothing is paid until a block mounts.
        const { codeToHtml, bundledLanguages } = await import("shiki");
        const requested = visual.language.trim().toLowerCase();
        // An unknown id (the agent guesses from extensions) must degrade to
        // plain text rather than reject the whole block.
        const lang: BundledLanguage | "text" =
          requested in bundledLanguages ? (requested as BundledLanguage) : "text";
        const out = await codeToHtml(visual.body, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        });
        if (!cancelled) setResult({ key, html: out });
      } catch {
        // Highlighting is decoration; the plain block below stays up.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, visual.body, visual.language]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const path = visual.refs[0]?.path;

  const actions = (
    <>
      {path && (
        <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline" title={path}>
          {truncatePath(path, 28)}
        </span>
      )}
      <span className="font-mono text-[11px] text-muted-foreground">{visual.language}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? "Copied" : "Copy code"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(visual.body);
            setCopied(true);
          } catch {
            // Clipboard is unavailable in insecure contexts; the text stays selectable.
          }
        }}
      >
        {copied ? <Check className="text-brand" /> : <Copy />}
      </Button>
    </>
  );

  return (
    <VisualFrame
      kind="code_block"
      title={visual.title}
      caption={visual.caption}
      refs={visual.refs}
      onRef={onRef}
      compact={compact}
      actions={actions}
    >
      {html ? (
        <div
          className={cn(
            "show-me-shiki overflow-x-auto font-mono proportional-nums",
            compact ? "px-3 py-2 text-xs leading-5" : "px-4 py-3 text-[13px] leading-6",
          )}
          // Safe: shiki escapes the source; only its own span/style markup is emitted.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <MonoBlock body={visual.body} compact={compact} guides={false} />
      )}
    </VisualFrame>
  );
}
