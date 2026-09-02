"use client";

// The Diff tab: toolbar plus one <DiffFile> per changed file, ordered by the
// Brief's change-map role so the reviewer meets the core change first.

import { useEffect, useMemo } from "react";

import { useReviewNav } from "@/lib/review-nav";
import type { ChangeMapEntry, FileRole, PRFile, TimePlan } from "@/lib/types";
import { cn } from "@/lib/utils";

import { DiffFile, LARGE_PATCH_LINES, patchLineCount } from "./diff-file";
import { DiffToolbar } from "./diff-toolbar";

/** Files auto-expanded on first render; beyond this a big PR would stall the tab. */
const INITIAL_EXPANDED_FILES = 8;

export const ROLE_ORDER: readonly FileRole[] = [
  "core",
  "supporting",
  "config",
  "test",
  "docs",
  "generated",
];

function roleRank(role: FileRole | undefined): number {
  if (!role) return ROLE_ORDER.length;
  const index = ROLE_ORDER.indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
}

/** What the Brief's time plan says about one file, if anything. */
export type PlanMark = { kind: "read"; order: number; minutes: number; why: string } | { kind: "skip"; why: string };

export interface OrderedFile {
  file: PRFile;
  role: FileRole | undefined;
  summary: string | undefined;
  plan: PlanMark | undefined;
}

/** Shared by the viewer and the file tree so both agree on plan lookups. */
export function indexTimePlan(plan: TimePlan | undefined): Map<string, PlanMark> {
  const map = new Map<string, PlanMark>();
  plan?.read_first.forEach((step, i) => map.set(step.path, { kind: "read", order: i + 1, minutes: step.minutes, why: step.why }));
  for (const entry of plan?.skip ?? []) if (!map.has(entry.path)) map.set(entry.path, { kind: "skip", why: entry.why });
  return map;
}

// Plan first (in reading order), then everything unplanned by role, skips last.
function planRank(plan: PlanMark | undefined): number {
  if (!plan) return 1_000;
  return plan.kind === "read" ? plan.order : 2_000;
}

/** Shared by the viewer and the file tree so both agree on role lookups. */
export function indexChangeMap(changeMap: ChangeMapEntry[] | undefined): Map<string, ChangeMapEntry> {
  const map = new Map<string, ChangeMapEntry>();
  for (const entry of changeMap ?? []) map.set(entry.path, entry);
  return map;
}

export function orderFiles(
  files: PRFile[],
  changeMap: ChangeMapEntry[] | undefined,
  timePlan?: TimePlan,
): OrderedFile[] {
  const byPath = indexChangeMap(changeMap);
  const plans = indexTimePlan(timePlan);
  return files
    .map((file) => {
      const entry = byPath.get(file.path);
      return { file, role: entry?.role, summary: entry?.summary, plan: plans.get(file.path) };
    })
    .sort((a, b) => {
      const plan = planRank(a.plan) - planRank(b.plan);
      if (plan !== 0) return plan;
      const rank = roleRank(a.role) - roleRank(b.role);
      return rank !== 0 ? rank : a.file.path.localeCompare(b.file.path);
    });
}

export interface DiffViewerProps {
  files: PRFile[];
  changeMap?: ChangeMapEntry[];
  timePlan?: TimePlan;
  className?: string;
}

// Which set of files expansion was last seeded for. Module-level rather than
// a ref because the viewer unmounts whenever the Brief tab is active: a ref
// would reset on every tab switch and re-collapse the reviewer's sections.
let seededSignature: string | null = null;

export function DiffViewer({ files, changeMap, timePlan, className }: DiffViewerProps) {
  const { collapseAll, expandAll, selectedPath } = useReviewNav();

  const ordered = useMemo(() => orderFiles(files, changeMap, timePlan), [files, changeMap, timePlan]);
  const orderedFiles = useMemo(() => ordered.map((o) => o.file), [ordered]);

  // Agent state streams in repeatedly, so `files` changes identity without
  // changing content; seed expansion once per distinct set of paths, not per
  // emission, or the reviewer's collapses would keep getting undone.
  const signature = useMemo(() => files.map((f) => f.path).join("\n"), [files]);
  // selectedPath is a dependency only so the seed can see it; the signature
  // guard turns every later run into a no-op.
  useEffect(() => {
    if (seededSignature === signature) return;
    seededSignature = signature;
    // Files the plan says to skip start collapsed: the reviewer opens them on purpose.
    const initial = ordered
      .filter((o) => o.plan?.kind !== "skip")
      .slice(0, INITIAL_EXPANDED_FILES)
      .map((o) => o.file)
      .filter((f) => patchLineCount(f.patch) <= LARGE_PATCH_LINES)
      .map((f) => f.path);
    // open() may have selected a file before the viewer first mounted (a ref
    // chip on the Brief); seeding must not collapse the file it just opened.
    if (selectedPath && orderedFiles.some((f) => f.path === selectedPath)) {
      initial.push(selectedPath);
    }
    collapseAll();
    expandAll(initial);
  }, [signature, ordered, orderedFiles, selectedPath, collapseAll, expandAll]);

  if (files.length === 0) {
    return (
      <div className={cn("py-16 text-center text-sm text-muted-foreground", className)}>
        No changed files.
      </div>
    );
  }

  return (
    <div className={cn("[--diff-toolbar-h:2.5rem]", className)}>
      <DiffToolbar files={orderedFiles} />
      <div className="flex flex-col gap-3 py-3">
        {ordered.map(({ file, role, summary, plan }) => (
          <DiffFile key={file.path} file={file} role={role} summary={summary} plan={plan} />
        ))}
      </div>
    </div>
  );
}
