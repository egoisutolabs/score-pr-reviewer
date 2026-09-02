// Server-safe half of the theme feature: app/layout.tsx (a server component)
// inlines THEME_BOOT_SCRIPT, so nothing here may import React hooks.

export const THEME_STORAGE_KEY = "pr-reviewer:theme";

export type Theme = "light" | "dark";

/** Runs before hydration: apply the stored preference, else the OS one. */
export const THEME_BOOT_SCRIPT =
  "(function(){var k='" +
  THEME_STORAGE_KEY +
  "';var c=document.documentElement.classList;var m=matchMedia('(prefers-color-scheme: dark)');" +
  "function s(){var t=null;try{t=localStorage.getItem(k)}catch(e){}var d=t==='dark'||(t!=='light'&&m.matches);" +
  "c.toggle('dark',d);c.toggle('light',!d)}s();m.addEventListener('change',s)})();";
