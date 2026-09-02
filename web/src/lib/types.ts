// Shared agent state — mirrors agent/src/schema.py field-for-field (see CONTRACT.md).

export type ReviewStatus = "idle" | "fetching" | "analyzing" | "ready" | "error";

export interface PRMeta {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  author: string;
  base_ref: string;
  head_ref: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  additions: number;
  deletions: number;
  changed_files: number;
  created_at: string;
  labels: string[];
}

export type FileStatus = "added" | "modified" | "removed" | "renamed";

export interface PRFile {
  path: string;
  previous_path: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** Full unified diff for this file including the `diff --git` header. */
  patch: string;
  language: string | null;
}

export type RiskLevel = "low" | "medium" | "high";
export type FileRole = "core" | "supporting" | "test" | "config" | "docs" | "generated";
export type Severity = "info" | "warn" | "block";

export interface Ref {
  path: string;
  /** New-file line number; null when the ref is to the whole file. */
  line: number | null;
}

interface VisualBase {
  title: string;
  caption: string | null;
  refs: Ref[];
}

export type Visual =
  | ({ kind: "pseudocode"; body: string } & VisualBase)
  | ({ kind: "call_tree"; body: string } & VisualBase)
  | ({ kind: "component_tree"; body: string } & VisualBase)
  | ({ kind: "file_tree"; body: string } & VisualBase)
  | ({ kind: "mermaid"; body: string } & VisualBase)
  | ({ kind: "shape_diff"; before: string; after: string } & VisualBase)
  | ({ kind: "code_block"; body: string; language: string } & VisualBase)
  | ({ kind: "callout"; body: string; tone: "info" | "warn" | "danger" } & VisualBase);

export type VisualKind = Visual["kind"];

export interface ChangeMapEntry {
  path: string;
  role: FileRole;
  summary: string;
}

export interface ChecklistItem {
  item: string;
  path: string | null;
  line: number | null;
  severity: Severity;
  /** Estimated minutes to verify this item. */
  minutes?: number | null;
}

export type Verdict = "approve" | "approve_with_nits" | "needs_changes" | "needs_discussion";

/** The reader's whole budget for this PR, Brief included. */
export const REVIEW_BUDGET_MINUTES = 15;

export interface ReadStep {
  path: string;
  minutes: number;
  why: string;
}

export interface SkipEntry {
  path: string;
  why: string;
}

/** How to spend the budget: files to open in order, and the ones not to. */
export interface TimePlan {
  budget_minutes: number;
  read_first: ReadStep[];
  skip: SkipEntry[];
}

export interface Brief {
  headline: string;
  intent: string;
  risk: RiskLevel;
  risk_reasons: string[];
  change_map: ChangeMapEntry[];
  visuals: Visual[];
  checklist: ChecklistItem[];
  questions_for_author: string[];
  testing: string;
  /** Optional on older briefs; the panel falls back gracefully. */
  verdict?: Verdict;
  verdict_reason?: string;
  time_plan?: TimePlan;
}

export interface ReviewState {
  pr_url: string | null;
  status: ReviewStatus;
  progress: string | null;
  error: string | null;
  pr: PRMeta | null;
  files: PRFile[];
  brief: Brief | null;
}

export const EMPTY_REVIEW_STATE: ReviewState = {
  pr_url: null,
  status: "idle",
  progress: null,
  error: null,
  pr: null,
  files: [],
  brief: null,
};

export const AGENT_NAME = "pr_reviewer";

const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/;

export function parsePrUrl(input: string): { owner: string; repo: string; number: number } | null {
  const match = input.trim().match(PR_URL);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}

/** Stable DOM id for a file section in the diff viewer. */
export function fileAnchor(path: string): string {
  return `file-${path.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}
