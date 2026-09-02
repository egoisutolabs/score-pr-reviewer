"use client";

import * as React from "react";

import { VisualRenderer } from "@/components/show-me";
import {
  REVIEW_BUDGET_MINUTES,
  type Brief,
  type ChangeMapEntry,
  type FileRole,
  type PRFile,
  type PRMeta,
  type Ref,
  type RiskLevel,
  type Severity,
  type Verdict,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { DiffSnippet } from "./diff-snippet";

// Reading order for the change map: what the PR is about first, scaffolding last.
const ROLE_ORDER: FileRole[] = ["core", "supporting", "test", "config", "docs", "generated"];

const ROLE_LABEL: Record<FileRole, string> = {
  core: "Core",
  supporting: "Supporting",
  test: "Tests",
  config: "Config",
  docs: "Docs",
  generated: "Generated",
};

const RISK_LABEL: Record<RiskLevel, string> = { low: "Low risk", medium: "Medium risk", high: "High risk" };

/** Shared with the header so the brief and the top bar never disagree on how risk looks. */
export function RiskPill({ level, className }: { level: RiskLevel; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap",
        level === "high" && "border-brand bg-brand text-brand-foreground",
        level === "medium" && "border-brand/60 text-brand",
        level === "low" && "border-border text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          level === "high" && "bg-brand-foreground",
          level === "medium" && "bg-brand",
          level === "low" && "bg-muted-foreground",
        )}
      />
      {RISK_LABEL[level]}
    </span>
  );
}

// One accent only: severity is expressed through weight and fill, not hue.
const VERDICT_LABEL: Record<Verdict, string> = {
  approve: "Approve",
  approve_with_nits: "Approve with nits",
  needs_changes: "Needs changes",
  needs_discussion: "Needs discussion",
};

export function VerdictPill({ verdict, className }: { verdict: Verdict; className?: string }) {
  const tone =
    verdict === "approve"
      ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
      : verdict === "approve_with_nits"
        ? "border-emerald-500/30 text-emerald-700/90 dark:text-emerald-300/90"
        : verdict === "needs_changes"
          ? "border-red-500/40 text-red-600 dark:text-red-400"
          : "border-amber-500/40 text-amber-700 dark:text-amber-400";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", tone, className)}>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

function SeverityMark({ severity }: { severity: Severity }) {
  return (
    <span
      aria-label={severity}
      title={severity}
      className={cn(
        "mt-[7px] inline-block size-2 shrink-0 rounded-full border",
        severity === "block" && "border-brand bg-brand",
        severity === "warn" && "border-brand bg-transparent",
        severity === "info" && "border-muted-foreground/60 bg-transparent",
      )}
    />
  );
}

function RefChip({ path, line, onRef }: Ref & { onRef: (ref: Ref) => void }) {
  return (
    <button
      type="button"
      onClick={() => onRef({ path, line })}
      className="inline-flex h-5 max-w-full items-center rounded border border-border bg-muted/40 px-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      title={`Open ${path}${line !== null ? `:${line}` : ""}`}
    >
      <span className="truncate">{path}</span>
      {line !== null && <span className="text-foreground/70">:{line}</span>}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{children}</h2>
  );
}

function groupByRole(entries: ChangeMapEntry[]): { role: FileRole; entries: ChangeMapEntry[] }[] {
  const groups = new Map<FileRole, ChangeMapEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.role) ?? [];
    list.push(entry);
    groups.set(entry.role, list);
  }
  return ROLE_ORDER.filter((role) => groups.has(role)).map((role) => ({ role, entries: groups.get(role)! }));
}

export interface BriefPanelProps {
  brief: Brief;
  pr: PRMeta;
  /** The PR's patches; a checklist item that cites a line shows its diff inline. */
  files?: PRFile[];
  onRef: (ref: Ref) => void;
  className?: string;
}

export function BriefPanel({ brief, pr, files = [], onRef, className }: BriefPanelProps) {
  const groups = React.useMemo(() => groupByRole(brief.change_map), [brief.change_map]);
  const patchByPath = React.useMemo(() => new Map(files.map((f) => [f.path, f.patch])), [files]);
  const readFirst = brief.time_plan?.read_first ?? [];
  const skip = brief.time_plan?.skip ?? [];

  return (
    <article className={cn("mx-auto w-full max-w-4xl px-6 py-10 sm:px-10", className)}>
      {/* Prose is capped at ~72ch for reading; visuals below may use the full column. */}
      <div className="max-w-[72ch]">
        <p className="mb-3 font-mono text-xs text-muted-foreground">
          {pr.owner}/{pr.repo} #{pr.number}
        </p>
        <h1 className="text-[1.75rem] leading-[1.2] font-semibold tracking-tight text-balance sm:text-[2rem]">
          {brief.headline}
        </h1>
        <p className="mt-5 text-[15px] leading-7 text-foreground/85">{brief.intent}</p>

        {/* The reviewer's budget comes before everything else: what to open, in what
            order, for how long, and what to leave closed. */}
        <section className="mt-8 rounded-xl border border-border bg-card/60 p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <SectionLabel>Your {brief.time_plan?.budget_minutes ?? REVIEW_BUDGET_MINUTES} minutes</SectionLabel>
            {brief.verdict && <VerdictPill verdict={brief.verdict} className="mb-3" />}
          </div>
          {brief.verdict_reason && <p className="mb-4 text-sm leading-6 text-foreground/85">{brief.verdict_reason}</p>}
          {readFirst.length > 0 ? (
            <ol className="space-y-2.5">
              {readFirst.map((step, i) => (
                <li
                  key={step.path}
                  className="grid grid-cols-[1.25rem_minmax(0,1fr)_max-content] items-baseline gap-x-3 text-sm leading-5"
                >
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onRef({ path: step.path, line: null })}
                      className="font-mono text-[13px] text-foreground underline-offset-4 hover:text-brand hover:underline"
                      title={`Open ${step.path}`}
                    >
                      {step.path}
                    </button>
                    <span className="ml-2 text-muted-foreground">{step.why}</span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{step.minutes} min</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No reading plan on this brief.</p>
          )}
          {skip.length > 0 && (
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              <span className="font-medium text-foreground/70">Skip</span>{" "}
              {skip.map((entry, i) => (
                <span key={entry.path} title={entry.why}>
                  <span className="font-mono">{entry.path}</span>
                  {i < skip.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>
          )}
        </section>

        <section className="mt-8">
          <div className="flex items-center gap-3">
            <SectionLabel>Risk</SectionLabel>
            <RiskPill level={brief.risk} className="mb-3" />
          </div>
          {brief.risk_reasons.length > 0 && (
            <ul className="space-y-1.5 text-sm leading-6">
              {brief.risk_reasons.map((reason, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className="mt-[11px] size-1 shrink-0 rounded-full bg-foreground/50" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-10">
        <SectionLabel>Change map</SectionLabel>
        <div className="grid gap-5 sm:grid-cols-[max-content_1fr]">
          {groups.map(({ role, entries }) => (
            <React.Fragment key={role}>
              <div className="pt-0.5 text-xs font-medium text-muted-foreground sm:text-right">
                {ROLE_LABEL[role]}
                <span className="ml-1 font-mono tabular-nums text-muted-foreground/70">{entries.length}</span>
              </div>
              <ul className="space-y-2">
                {entries.map((entry) => (
                  <li key={entry.path} className="text-sm leading-5">
                    <button
                      type="button"
                      onClick={() => onRef({ path: entry.path, line: null })}
                      className="font-mono text-[13px] text-foreground underline-offset-4 hover:text-brand hover:underline"
                      title={`Open ${entry.path}`}
                    >
                      {entry.path}
                    </button>
                    <span className="ml-2 text-muted-foreground">{entry.summary}</span>
                  </li>
                ))}
              </ul>
            </React.Fragment>
          ))}
        </div>
      </section>

      {brief.visuals.length > 0 && (
        <section className="mt-12 space-y-8">
          <SectionLabel>Shape of the change</SectionLabel>
          {brief.visuals.map((visual, i) => (
            <VisualRenderer key={`${visual.kind}-${i}`} visual={visual} onRef={onRef} />
          ))}
        </section>
      )}

      <div className="max-w-[72ch]">
        {brief.checklist.length > 0 && (
          <section className="mt-12">
            <SectionLabel>Review checklist</SectionLabel>
            <ol className="space-y-3">
              {brief.checklist.map((item, i) => (
                <li key={i} className="flex gap-3 text-sm leading-6">
                  <SeverityMark severity={item.severity} />
                  <div className="min-w-0 flex-1">
                    <span>{item.item}</span>
                    {typeof item.minutes === "number" && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground tabular-nums">{item.minutes} min</span>
                    )}
                    {item.path && (
                      <span className="ml-2 inline-flex align-middle">
                        <RefChip path={item.path} line={item.line} onRef={onRef} />
                      </span>
                    )}
                    {item.path && item.line !== null && patchByPath.has(item.path) && (
                      <DiffSnippet
                        patch={patchByPath.get(item.path)!}
                        path={item.path}
                        line={item.line}
                        onRef={onRef}
                        className="mt-2 mb-1"
                      />
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {brief.questions_for_author.length > 0 && (
          <section className="mt-12">
            <SectionLabel>Questions for the author</SectionLabel>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 marker:font-mono marker:text-xs marker:text-muted-foreground">
              {brief.questions_for_author.map((q, i) => (
                <li key={i} className="pl-1">
                  {q}
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="mt-12">
          <SectionLabel>Testing</SectionLabel>
          <p className="text-sm leading-6 text-foreground/85">{brief.testing}</p>
        </section>
      </div>
    </article>
  );
}
