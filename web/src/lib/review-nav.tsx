"use client";

// Review navigation: which center tab is showing, which file/line is
// selected, how diffs are laid out, and which file sections are expanded.
// Plain React context — the Brief, the diff viewer, the file tree and the
// agent's frontend tools (open_file / switch_tab) all steer through this one
// object, so cross-panel navigation never needs prop drilling.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { fileAnchor } from "@/lib/types";

export type ReviewTab = "brief" | "diff";
export type DiffStyle = "unified" | "split";

export interface ReviewNav {
  tab: ReviewTab;
  setTab: (tab: ReviewTab) => void;
  selectedPath: string | null;
  /** New-file line number, or null when a whole file is selected. */
  selectedLine: number | null;
  /** Switch to the Diff tab, select and expand the file, scroll it into view. */
  open: (path: string, line?: number | null) => void;
  diffStyle: DiffStyle;
  setDiffStyle: (style: DiffStyle) => void;
  expandedPaths: Set<string>;
  toggleExpanded: (path: string) => void;
  /** Additive: every given path becomes expanded; others keep their state. */
  expandAll: (paths: string[]) => void;
  collapseAll: () => void;
}

const ReviewNavContext = createContext<ReviewNav | null>(null);

// ---------------------------------------------------------------------------
// diffStyle persistence. Modelled as an external store rather than
// useState + effect so hydration is clean: React renders the server snapshot
// ("unified") during hydration and re-renders with the stored value after,
// with no mismatch warning. localStorage can throw (Safari private mode,
// blocked storage), so an in-memory copy is the source of truth and storage
// is best-effort on both sides.

const STORAGE_KEY = "pr-reviewer:diff-style";
const DEFAULT_DIFF_STYLE: DiffStyle = "unified";

let memoryDiffStyle: DiffStyle | null = null;
const diffStyleListeners = new Set<() => void>();

function isDiffStyle(value: unknown): value is DiffStyle {
  return value === "unified" || value === "split";
}

function readDiffStyle(): DiffStyle {
  if (memoryDiffStyle) return memoryDiffStyle;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isDiffStyle(stored)) {
      memoryDiffStyle = stored;
      return stored;
    }
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return DEFAULT_DIFF_STYLE;
}

function writeDiffStyle(style: DiffStyle): void {
  memoryDiffStyle = style;
  try {
    window.localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // Best-effort only; the in-memory value still drives the UI this session.
  }
  diffStyleListeners.forEach((listener) => listener());
}

function subscribeDiffStyle(listener: () => void): () => void {
  diffStyleListeners.add(listener);
  // Another tab changing the preference should be reflected here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      memoryDiffStyle = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    diffStyleListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getServerDiffStyle(): DiffStyle {
  return DEFAULT_DIFF_STYLE;
}

// ---------------------------------------------------------------------------

interface ScrollRequest {
  path: string;
  /** Monotonic so opening the same path twice scrolls twice. */
  seq: number;
}

// Scrolling waits for the section to exist: when open() also switches tabs,
// the diff tab mounts in the same commit, but a section can still be a frame
// or two away (lazy tab panels, streaming state). A short bounded retry keeps
// the call fire-and-forget without ever spinning forever.
const SCROLL_RETRY_FRAMES = 12;

export function ReviewNavProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<ReviewTab>("brief");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null);

  const diffStyle = useSyncExternalStore(subscribeDiffStyle, readDiffStyle, getServerDiffStyle);
  const setDiffStyle = useCallback((style: DiffStyle) => writeDiffStyle(style), []);

  const toggleExpanded = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = useCallback((paths: string[]) => {
    setExpandedPaths((prev) => {
      if (paths.every((p) => prev.has(p))) return prev;
      const next = new Set(prev);
      for (const p of paths) next.add(p);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedPaths((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const open = useCallback((path: string, line?: number | null) => {
    setTab("diff");
    setSelectedPath(path);
    setSelectedLine(typeof line === "number" && line > 0 ? line : null);
    setExpandedPaths((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
    setScrollRequest((prev) => ({ path, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!scrollRequest) return;
    const id = fileAnchor(scrollRequest.path);
    let frame = 0;
    let attempts = 0;
    const tick = () => {
      const el = document.getElementById(id);
      if (el) {
        // The section carries scroll-margin-top for the sticky toolbar, so
        // block:"start" lands the file header just below it.
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (++attempts < SCROLL_RETRY_FRAMES) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [scrollRequest]);

  const value = useMemo<ReviewNav>(
    () => ({
      tab,
      setTab,
      selectedPath,
      selectedLine,
      open,
      diffStyle,
      setDiffStyle,
      expandedPaths,
      toggleExpanded,
      expandAll,
      collapseAll,
    }),
    [
      tab,
      selectedPath,
      selectedLine,
      open,
      diffStyle,
      setDiffStyle,
      expandedPaths,
      toggleExpanded,
      expandAll,
      collapseAll,
    ],
  );

  return <ReviewNavContext.Provider value={value}>{children}</ReviewNavContext.Provider>;
}

export function useReviewNav(): ReviewNav {
  const ctx = useContext(ReviewNavContext);
  if (!ctx) {
    throw new Error("useReviewNav must be used inside <ReviewNavProvider> (mounted in app/layout.tsx)");
  }
  return ctx;
}
