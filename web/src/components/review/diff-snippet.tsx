"use client";

import { useMemo } from "react";

import { snippetAt } from "@/lib/patch-snippet";
import type { Ref } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface DiffSnippetProps {
  patch: string;
  path: string;
  line: number;
  onRef: (ref: Ref) => void;
  className?: string;
}

/** A few diff lines around a cited line; click anywhere to open it in the Diff tab. */
export function DiffSnippet({ patch, path, line, onRef, className }: DiffSnippetProps) {
  const lines = useMemo(() => snippetAt(patch, line), [patch, line]);
  if (!lines) return null;
  return (
    <button
      type="button"
      onClick={() => onRef({ path, line })}
      title={`Open ${path}:${line} in the diff`}
      className={cn(
        "block w-full overflow-x-auto rounded-md border border-border bg-card text-left font-mono text-[12px] leading-5 transition-colors hover:border-foreground/30",
        className,
      )}
    >
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((l, i) => (
            <tr
              key={i}
              className={cn(
                l.kind === "add" && "bg-diff-add",
                l.kind === "del" && "bg-diff-del",
                l.newNo === line && "outline-1 -outline-offset-1 outline-brand/60",
              )}
            >
              <td className="w-10 select-none pr-2 pl-2 text-right text-muted-foreground/70 tabular-nums">
                {l.newNo ?? ""}
              </td>
              <td className="w-3 select-none text-muted-foreground">
                {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
              </td>
              <td className="pr-3 whitespace-pre text-foreground/90">{l.text || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </button>
  );
}
