import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { numberPatch, snippetAt } from "./patch-snippet.ts";

const PATCH = [
  "diff --git a/x.ts b/x.ts",
  "--- a/x.ts",
  "+++ b/x.ts",
  "@@ -10,4 +10,5 @@ ctx",
  " a",
  "-b",
  "+B",
  "+C",
  " d",
  "@@ -40,2 +41,2 @@",
  " e",
  "-f",
  "+F",
].join("\n");

describe("numberPatch", () => {
  it("numbers both sides across hunks", () => {
    const lines = numberPatch(PATCH);
    assert.deepEqual(lines.map((l) => [l.kind, l.oldNo, l.newNo]), [
      ["ctx", 10, 10],
      ["del", 11, null],
      ["add", null, 11],
      ["add", null, 12],
      ["ctx", 12, 13],
      ["ctx", 40, 41],
      ["del", 41, null],
      ["add", null, 42],
    ]);
  });
});

describe("snippetAt", () => {
  it("windows around the cited new line", () => {
    assert.deepEqual(snippetAt(PATCH, 12, 1)?.map((l) => l.text), ["B", "C", "d"]);
  });
  it("is null for a line outside every hunk", () => {
    assert.equal(snippetAt(PATCH, 30), null);
  });
});
