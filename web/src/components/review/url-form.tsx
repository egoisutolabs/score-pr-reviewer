"use client";

import * as React from "react";
import { ArrowRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { parsePrUrl } from "@/lib/types";
import { cn } from "@/lib/utils";

const RECENT_KEY = "pr-reviewer:recent-urls";
const RECENT_LIMIT = 5;

// localStorage is unavailable in private windows, during SSR, and under some
// privacy settings that throw on access — every touch is guarded so the form
// still works with no history at all. History is exposed through
// useSyncExternalStore so the server render sees "no history" and the client
// hydrates to the real list without an effect-driven second render.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

// Snapshot is the raw string: a primitive stays referentially stable between
// reads, which useSyncExternalStore requires to avoid re-render loops.
function getSnapshot(): string | null {
  try {
    return window.localStorage.getItem(RECENT_KEY);
  } catch {
    return null;
  }
}

function getServerSnapshot(): string | null {
  return null;
}

function parseRecent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(urls: string[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(urls.slice(0, RECENT_LIMIT)));
  } catch {
    // Best-effort convenience; losing history is not an error worth surfacing.
  }
  listeners.forEach((notify) => notify());
}

/** Short label for a recent chip: `owner/repo#42`. */
function shortLabel(url: string): string {
  const parsed = parsePrUrl(url);
  return parsed ? `${parsed.owner}/${parsed.repo}#${parsed.number}` : url;
}

export interface UrlFormProps {
  onSubmit: (url: string) => void;
  busy?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function UrlForm({ onSubmit, busy = false, autoFocus = false, className }: UrlFormProps) {
  const [value, setValue] = React.useState("");
  const [invalid, setInvalid] = React.useState(false);
  const rawRecent = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const recent = React.useMemo(() => parseRecent(rawRecent), [rawRecent]);

  const submit = React.useCallback(
    (raw: string) => {
      const url = raw.trim();
      const parsed = parsePrUrl(url);
      if (!parsed) {
        setInvalid(true);
        return;
      }
      // Normalize so `?diff=split#discussion` variants collapse into one chip.
      const canonical = `https://github.com/${parsed.owner}/${parsed.repo}/pull/${parsed.number}`;
      writeRecent([canonical, ...recent.filter((u) => u !== canonical)]);
      setInvalid(false);
      setValue(canonical);
      onSubmit(canonical);
    },
    [onSubmit, recent],
  );

  const forget = (url: string) => writeRecent(recent.filter((u) => u !== url));

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <form
        className="flex w-full items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) submit(value);
        }}
        noValidate
      >
        <div className="relative flex-1">
          <Input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocus}
            aria-label="Pull request URL"
            aria-invalid={invalid || undefined}
            placeholder="https://github.com/owner/repo/pull/123"
            value={value}
            disabled={busy}
            onChange={(e) => {
              setValue(e.target.value);
              if (invalid) setInvalid(false);
            }}
            className="h-11 pr-14 font-mono text-sm md:text-sm"
          />
          <Kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 sm:inline-flex">
            ↵
          </Kbd>
        </div>
        <Button type="submit" size="lg" disabled={busy || value.trim().length === 0} className="h-11 px-4">
          {busy ? "Working…" : "Review"}
          {!busy && <ArrowRight data-icon="inline-end" />}
        </Button>
      </form>

      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          That doesn&apos;t look like a pull request. Expected{" "}
          <code className="font-mono text-[0.85em]">https://github.com/owner/repo/pull/123</code>.
        </p>
      )}

      {recent.length > 0 && !invalid && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Recent</span>
          {recent.map((url) => (
            <span
              key={url}
              className="group/chip inline-flex h-6 items-center rounded-md border border-border bg-muted/40 pl-2 font-mono text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => submit(url)}
                className="disabled:opacity-50"
                title={url}
              >
                {shortLabel(url)}
              </button>
              <button
                type="button"
                aria-label={`Forget ${shortLabel(url)}`}
                onClick={() => forget(url)}
                className="ml-1 inline-flex h-full items-center px-1.5 opacity-0 transition-opacity group-hover/chip:opacity-100 focus-visible:opacity-100"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
