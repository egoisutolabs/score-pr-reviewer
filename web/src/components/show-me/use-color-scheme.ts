"use client";

import { useSyncExternalStore } from "react";

export type ColorScheme = "light" | "dark";

const QUERY = "(prefers-color-scheme: dark)";

// The app's Tailwind dark variant keys off `html.dark`, so an explicit class is
// the source of truth; the media query only matters when no class was set.
function read(): ColorScheme {
  const cls = document.documentElement.classList;
  if (cls.contains("dark")) return "dark";
  if (cls.contains("light")) return "light";
  return window.matchMedia(QUERY).matches ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

// Server snapshot is "light" so hydration matches the CSS default; consumers
// that paint scheme-dependent pixels (mermaid) do so in effects, after hydration.
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, read, () => "light");
}
