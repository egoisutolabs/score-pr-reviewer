"use client";

// Theme preference: "light" | "dark", or unset to follow the OS. Persisted in
// localStorage and mirrored onto <html class> before first paint by the
// inline script in app/layout.tsx; useIsDark/useColorScheme already watch that
// class, so flipping it re-themes diffs, shiki and mermaid with no extra wiring.

import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY, type Theme } from "./theme-boot";

const listeners = new Set<() => void>();

function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  const c = document.documentElement.classList;
  c.toggle("dark", theme === "dark");
  c.toggle("light", theme === "light");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked: the class still drives this session.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => {
    listeners.delete(listener);
    observer.disconnect();
  };
}

// Server snapshot is "light" to match the CSS default; the boot script has
// already set the real class by the time the client snapshot is read.
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "light");
}
