"use client";

import * as React from "react";
import { CopilotSidebar } from "@copilotkit/react-ui";

/** Labels and suggestions tuned to PR review; shared so the page and workspace agree. */
export const CHAT_LABELS = {
  title: "Ask the reviewer",
  initial: "I've read the whole diff. Ask about any file, flow, or risk — I can open code and draw the shape of a change.",
  placeholder: "Ask about this pull request…",
} as const;

export const CHAT_SUGGESTIONS = [
  { title: "Riskiest part", message: "What's the riskiest part?" },
  { title: "Call flow", message: "Walk me through the call flow" },
  { title: "Before / after", message: "Show me the before/after shape of the main change" },
  { title: "Manual tests", message: "What should I test manually?" },
];

// CopilotKit ships its own palette; these overrides are scoped to the sidebar
// root so the app tokens (and their .dark variants) flow in without touching
// the vendor stylesheet. `.copilotKitSidebarContentWrapper` is a sibling of the
// sidebar, not a descendant, so it gets its own rule for the margin override.
const CHAT_CSS = `
.copilotKitSidebar {
  --copilot-kit-primary-color: var(--brand);
  --copilot-kit-contrast-color: var(--brand-foreground);
  --copilot-kit-background-color: var(--background);
  --copilot-kit-input-background-color: var(--background);
  --copilot-kit-secondary-color: var(--card);
  --copilot-kit-secondary-contrast-color: var(--foreground);
  --copilot-kit-separator-color: var(--border);
  --copilot-kit-muted-color: var(--muted-foreground);
  --copilot-kit-shadow-sm: none;
  --copilot-kit-shadow-md: none;
  --copilot-kit-shadow-lg: none;
  font-family: var(--font-sans), ui-sans-serif, system-ui, sans-serif;
  color: var(--foreground);
}
.copilotKitSidebar .copilotKitWindow {
  border-left: 1px solid var(--border);
  box-shadow: none;
}
.copilotKitSidebar .copilotKitHeader {
  background: var(--background);
  color: var(--foreground);
  border-bottom: 1px solid var(--border);
  font-weight: 500;
  font-size: 0.875rem;
}
.copilotKitSidebar .copilotKitMessages {
  background: var(--background);
}
.copilotKitSidebar .copilotKitAssistantMessage {
  background: transparent;
  color: var(--foreground);
}
.copilotKitSidebar .copilotKitUserMessage {
  background: var(--muted);
  color: var(--foreground);
}
.copilotKitSidebar .copilotKitInputContainer {
  background: var(--background);
  border-top: 1px solid var(--border);
}
.copilotKitSidebar .copilotKitInput {
  background: var(--background);
  color: var(--foreground);
  border-color: var(--border);
}
.copilotKitSidebar .copilotKitCodeBlock,
.copilotKitSidebar .copilotKitInlineCode {
  font-family: var(--font-geist-mono), ui-monospace, monospace;
  font-size: 0.8125rem;
}
.copilotKitSidebar .copilotKitCodeBlock {
  background: var(--muted);
  color: var(--foreground);
  border: 1px solid var(--border);
}
.copilotKitSidebar .copilotKitMarkdownElement a {
  color: var(--brand);
}
.copilotKitSidebar .copilotKitButton {
  box-shadow: none;
}
.copilotKitSidebar .poweredBy { display: none; }
`;

/**
 * Injects the palette override once. React 19 hoists a `<style>` with `href` +
 * `precedence` into the document head and de-duplicates it, so mounting this
 * in several places is safe.
 */
export function ChatStyles() {
  return (
    <style href="review-chat-palette" precedence="default">
      {CHAT_CSS}
    </style>
  );
}

export interface ReviewSidebarProps {
  children: React.ReactNode;
}

/**
 * The chat rail. Wraps the workspace so CopilotKit can shift the content over
 * when the sidebar is open; `fullHeightChildren` lets the workspace fill the
 * viewport and scroll inside its own panels instead of the page.
 */
export function ReviewSidebar({ children }: ReviewSidebarProps) {
  return (
    <>
      <ChatStyles />
      <CopilotSidebar
        defaultOpen
        fullHeightChildren
        clickOutsideToClose={false}
        labels={CHAT_LABELS}
        suggestions={CHAT_SUGGESTIONS}
      >
        {children}
      </CopilotSidebar>
    </>
  );
}
