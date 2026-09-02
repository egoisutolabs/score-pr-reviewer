"use client";

import { ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Brief, PRMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

import { RiskPill, VerdictPill } from "./brief-panel";
import { ThemeToggle } from "./theme-toggle";

const STATE_ICON = {
  OPEN: GitPullRequest,
  MERGED: GitMerge,
  CLOSED: GitPullRequestClosed,
} as const;

export interface ReviewHeaderProps {
  pr: PRMeta;
  brief: Brief | null;
  onReset: () => void;
  className?: string;
}

export function ReviewHeader({ pr, brief, onReset, className }: ReviewHeaderProps) {
  const StateIcon = STATE_ICON[pr.state];
  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {pr.owner}/{pr.repo}
          <span className="text-foreground/70"> #{pr.number}</span>
        </span>
        <Separator orientation="vertical" className="h-4" />
        <h2 className="min-w-0 truncate text-sm font-medium" title={pr.title}>
          {pr.title}
        </h2>
        <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">
          by <span className="text-foreground/80">{pr.author}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 font-mono text-xs text-muted-foreground xl:inline-flex">
          <span className="rounded bg-muted px-1 py-px">{pr.base_ref}</span>
          <span aria-hidden>←</span>
          <span className="rounded bg-muted px-1 py-px">{pr.head_ref}</span>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="font-mono text-xs tabular-nums">
          <span className="text-foreground/80">+{pr.additions}</span>{" "}
          <span className="text-muted-foreground">−{pr.deletions}</span>
        </span>
        <Badge variant={pr.state === "OPEN" ? "outline" : "secondary"} className="gap-1 font-mono text-[11px] uppercase">
          <StateIcon aria-hidden />
          {pr.state.toLowerCase()}
        </Badge>
        {brief && <RiskPill level={brief.risk} />}
        {brief?.verdict && <VerdictPill verdict={brief.verdict} />}
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<a href={pr.url} target="_blank" rel="noreferrer noopener" aria-label="Open on GitHub" />}
        >
          <ExternalLink />
        </Button>
        <ThemeToggle />
        <Separator orientation="vertical" className="h-4" />
        <Button variant="outline" size="sm" onClick={onReset}>
          <Plus data-icon="inline-start" />
          New PR
        </Button>
      </div>
    </header>
  );
}
