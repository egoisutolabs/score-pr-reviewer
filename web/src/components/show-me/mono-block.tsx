"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// show-me bodies indent by two spaces (CONTRACT.md); one guide per level.
const INDENT = 2;

export interface MonoBlockProps {
  body: string;
  /** Renders the de-indented content of a line; plain text when omitted. */
  renderLine?: (content: string, index: number) => ReactNode;
  /** Off for bodies that draw their own structure (file trees with │ glyphs). */
  guides?: boolean;
  compact?: boolean;
  className?: string;
}

function normalize(body: string): string[] {
  const lines = body.replace(/\r\n?/g, "\n").replace(/\t/g, " ".repeat(INDENT)).split("\n");
  while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

function depthOf(line: string): number {
  return Math.floor((/^ */.exec(line)?.[0].length ?? 0) / INDENT);
}

// Blank lines carry no indentation of their own; continuing the guides of the
// surrounding block keeps a paragraph break from visually closing the block.
function depths(lines: string[]): number[] {
  const own = lines.map((line) => (line.trim() === "" ? -1 : depthOf(line)));
  const out = own.slice();
  for (let i = 0; i < own.length; i++) {
    if (own[i] !== -1) continue;
    let prev = 0;
    for (let k = i - 1; k >= 0; k--) if (own[k] !== -1) { prev = own[k]; break; }
    let next = 0;
    for (let k = i + 1; k < own.length; k++) if (own[k] !== -1) { next = own[k]; break; }
    out[i] = Math.min(prev, next);
  }
  return out;
}

export function MonoBlock({ body, renderLine, guides = true, compact, className }: MonoBlockProps) {
  const lines = normalize(body);
  const levels = guides ? depths(lines) : lines.map(() => 0);
  return (
    <div
      className={cn(
        "overflow-x-auto font-mono proportional-nums text-foreground/90",
        compact ? "px-3 py-2 text-xs leading-5" : "px-4 py-3 text-[13px] leading-6",
        className,
      )}
    >
      <div className="min-w-max">
        {lines.map((line, i) => {
          const depth = levels[i];
          const content = guides ? line.slice(Math.min(line.length, depth * INDENT)) : line;
          return (
            <div key={i} className="flex whitespace-pre">
              {/* Guides wrap the real indentation spaces so a copy keeps the shape. */}
              {Array.from({ length: depth }, (_, level) => (
                <span key={level} className="shrink-0 border-l border-border">
                  {" ".repeat(INDENT)}
                </span>
              ))}
              <span>{content === "" ? " " : renderLine ? renderLine(content, i) : content}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
