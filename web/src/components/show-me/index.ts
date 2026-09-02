// show-me — the visual vocabulary a Brief is written in: one component per
// Visual.kind plus the VisualRenderer that dispatches on it. Owns rendering
// only; it never fetches, never knows about the agent, and never navigates —
// refs are surfaced through `onRef` for the host to act on.

export * from "./callout";
export * from "./call-tree";
export * from "./code-block";
export * from "./component-tree";
export * from "./demo-visuals";
export * from "./file-tree-visual";
export * from "./mermaid-diagram";
export * from "./mono-block";
export * from "./pseudocode";
export * from "./ref-chips";
export * from "./shape-diff";
export * from "./use-color-scheme";
export * from "./visual-frame";
export * from "./visual-renderer";
