"use client";

// Sidebar directory tree of the PR's files. Directory chains with a single
// child collapse into one row ("src/components/ui") the way GitHub does, so
// deep monorepo paths stay one line each.

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useReviewNav } from "@/lib/review-nav";
import type { ChangeMapEntry, FileRole, FileStatus, PRFile, TimePlan } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ROLE_LABEL } from "./diff-file";
import { indexChangeMap, indexTimePlan, type PlanMark } from "./diff-viewer";

export const ROLE_LETTER: Record<FileRole, string> = {
  core: "C",
  supporting: "S",
  test: "T",
  config: "K",
  docs: "D",
  generated: "G",
};

const STATUS_DOT: Record<FileStatus, string> = {
  added: "bg-emerald-500",
  removed: "bg-red-500",
  modified: "bg-amber-500",
  renamed: "bg-sky-500",
};

interface DirNode {
  kind: "dir";
  /** Display name; joined segments after chain collapsing ("src/lib"). */
  name: string;
  /** Full path from the root, used as the collapse key. */
  path: string;
  dirs: DirNode[];
  files: PRFile[];
}

function buildTree(files: PRFile[]): DirNode {
  const root: DirNode = { kind: "dir", name: "", path: "", dirs: [], files: [] };
  for (const file of files) {
    const segments = file.path.split("/");
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      let child = node.dirs.find((d) => d.name === segment);
      if (!child) {
        child = {
          kind: "dir",
          name: segment,
          path: node.path ? `${node.path}/${segment}` : segment,
          dirs: [],
          files: [],
        };
        node.dirs.push(child);
      }
      node = child;
    }
    node.files.push(file);
  }
  return collapseChains(root, true);
}

// A directory whose only content is one subdirectory merges with it; the
// merged node keeps the deepest path as its collapse key.
function mergeChain(node: DirNode): DirNode {
  let current = node;
  while (current.files.length === 0 && current.dirs.length === 1) {
    const only = current.dirs[0]!;
    current = { ...only, name: `${current.name}/${only.name}` };
  }
  return current;
}

// The root is exempt from merging so a PR touching one deep folder still
// shows a tree rather than a single long row.
function collapseChains(node: DirNode, isRoot: boolean): DirNode {
  const merged = isRoot ? node : mergeChain(node);
  const dirs = merged.dirs
    .map((d) => collapseChains(d, false))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = [...merged.files].sort((a, b) => a.path.localeCompare(b.path));
  return { ...merged, dirs, files };
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

// ---------------------------------------------------------------------------

function RoleBadge({ role }: { role: FileRole }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={`${ROLE_LABEL[role]} file`}
            className={cn(
              "inline-flex size-4 shrink-0 items-center justify-center rounded-sm border font-mono text-[10px] leading-none",
              role === "core"
                ? "border-brand/40 text-brand"
                : "border-border text-muted-foreground",
            )}
          />
        }
      >
        {ROLE_LETTER[role]}
      </TooltipTrigger>
      <TooltipContent side="right">{ROLE_LABEL[role]}</TooltipContent>
    </Tooltip>
  );
}

function FileRow({
  file,
  entry,
  plan,
  depth,
}: {
  file: PRFile;
  entry: ChangeMapEntry | undefined;
  plan: PlanMark | undefined;
  depth: number;
}) {
  const { selectedPath, open } = useReviewNav();
  const active = selectedPath === file.path;

  return (
    <li role="none">
      <div
        className={cn(
          "group flex h-7 items-center gap-1.5 rounded-md pr-1.5 text-[13px]",
          active ? "bg-brand/10 text-brand" : "hover:bg-muted/70",
        )}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        <button
          type="button"
          role="treeitem"
          aria-selected={active}
          aria-current={active ? "true" : undefined}
          title={plan?.why ?? entry?.summary ?? file.path}
          onClick={() => open(file.path)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            plan?.kind === "skip" && "opacity-50",
          )}
        >
          {plan?.kind === "read" && (
            <span
              aria-label={`Read ${plan.order}`}
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-brand font-mono text-[10px] leading-none text-brand-foreground"
            >
              {plan.order}
            </span>
          )}
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[file.status])}
          />
          <span
            className={cn(
              "truncate font-mono",
              file.status === "removed" && "line-through decoration-muted-foreground/50",
              !active && "text-foreground",
            )}
          >
            {basename(file.path)}
          </span>
        </button>
        {entry && <RoleBadge role={entry.role} />}
        <span className="shrink-0 font-mono text-[11px] tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>{" "}
          <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
        </span>
      </div>
    </li>
  );
}

function DirRows({
  node,
  depth,
  byPath,
  plans,
  collapsed,
  onToggle,
}: {
  node: DirNode;
  depth: number;
  byPath: Map<string, ChangeMapEntry>;
  plans: Map<string, PlanMark>;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isOpen = !collapsed.has(node.path);
  return (
    <li role="none">
      <button
        type="button"
        role="treeitem"
        aria-selected={false}
        aria-expanded={isOpen}
        onClick={() => onToggle(node.path)}
        className="flex h-7 w-full items-center gap-1 rounded-md pr-1.5 text-left text-[13px] text-muted-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 shrink-0 transition-transform", isOpen && "rotate-90")}
        />
        <span className="truncate font-mono">{node.name}</span>
      </button>
      {isOpen && (
        <ul role="group" className="m-0 list-none p-0">
          {node.dirs.map((dir) => (
            <DirRows
              key={dir.path}
              node={dir}
              depth={depth + 1}
              byPath={byPath}
              plans={plans}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
          {node.files.map((file) => (
            <FileRow key={file.path} file={file} entry={byPath.get(file.path)} plan={plans.get(file.path)} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export interface FileTreeProps {
  files: PRFile[];
  changeMap?: ChangeMapEntry[];
  timePlan?: TimePlan;
  className?: string;
}

export function FileTree({ files, changeMap, timePlan, className }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const byPath = useMemo(() => indexChangeMap(changeMap), [changeMap]);
  const plans = useMemo(() => indexTimePlan(timePlan), [timePlan]);
  // Everything starts open; a reviewer collapses noise on purpose.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const onToggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  if (files.length === 0) {
    return <p className={cn("px-2 py-4 text-xs text-muted-foreground", className)}>No files.</p>;
  }

  return (
    <TooltipProvider>
      <nav aria-label="Changed files" className={cn("min-w-0 text-sm", className)}>
        <ul role="tree" className="m-0 list-none p-0">
          {tree.dirs.map((dir) => (
            <DirRows
              key={dir.path}
              node={dir}
              depth={0}
              byPath={byPath}
              plans={plans}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
          {tree.files.map((file) => (
            <FileRow key={file.path} file={file} entry={byPath.get(file.path)} plan={plans.get(file.path)} depth={0} />
          ))}
        </ul>
      </nav>
    </TooltipProvider>
  );
}
