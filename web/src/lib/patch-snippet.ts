// Cut a few lines of a unified diff around a new-file line number, so the
// Brief can show the code a checklist item points at without a tab switch.

export interface SnippetLine {
  kind: "add" | "del" | "ctx";
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Every body line of the patch with its old/new numbers; headers dropped. */
export function numberPatch(patch: string): SnippetLine[] {
  const out: SnippetLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    const hunk = HUNK.exec(raw);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || raw.startsWith("\\")) continue;
    const mark = raw[0];
    const text = raw.slice(1);
    if (mark === "+") out.push({ kind: "add", oldNo: null, newNo: newNo++, text });
    else if (mark === "-") out.push({ kind: "del", oldNo: oldNo++, newNo: null, text });
    else if (mark === " " || raw === "") out.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text });
    // Anything else is a stray header between hunks (diff --git, index, ---/+++).
    else inHunk = false;
  }
  return out;
}

/**
 * Lines around new-file `line`, `context` on each side. Null when the line is
 * not inside any hunk (the model may cite an untouched line).
 */
export function snippetAt(patch: string, line: number, context = 3): SnippetLine[] | null {
  const lines = numberPatch(patch);
  const at = lines.findIndex((l) => l.newNo === line);
  if (at === -1) return null;
  return lines.slice(Math.max(0, at - context), at + context + 1);
}
