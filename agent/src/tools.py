"""Backend chat tools. Built per invocation because LangGraph tools cannot read graph state.

`make_tools(state)` closes over the state dict the chat node is running with;
every tool reads `state["files"]`, `state["pr"]`, `state["brief"]` lazily so a
state that arrives without them degrades to "no PR loaded" instead of crashing.
"""

from __future__ import annotations

import json
import re
from typing import Annotated, Any

from langchain_core.tools import BaseTool, tool
from pydantic import TypeAdapter, ValidationError

from .analyze import coerce_visual
from .schema import Visual

SEARCH_LIMIT = 20
NO_PR = "No PR is loaded yet. Ask the user to paste a GitHub pull request URL."

_HUNK_RE = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")
_VISUAL_ADAPTER: TypeAdapter[Visual] = TypeAdapter(Visual)

VISUAL_SHAPE = (
    "Every visual has kind, title, caption (string or null) and refs ([{path, line|null}], new-file line numbers). "
    "Kinds and their extra fields: pseudocode/call_tree/component_tree/file_tree/mermaid → body (plain text, two-space "
    "indentation, no fences; mermaid must start with flowchart, sequenceDiagram or stateDiagram-v2); "
    "shape_diff → before, after; code_block → body, language; callout → body, tone (info|warn|danger)."
)


def _roles(state: dict) -> dict[str, str]:
    brief = state.get("brief") or {}
    return {entry["path"]: entry["role"] for entry in brief.get("change_map") or [] if "path" in entry}


def _iter_patch_lines(patch: str):
    """Yield (line_number, kind, text) for hunk lines; number is new-file for add/context, old-file for del."""
    old_line = new_line = 0
    in_hunk = False
    for raw in patch.splitlines():
        hunk = _HUNK_RE.match(raw)
        if hunk:
            old_line, new_line = int(hunk.group(1)), int(hunk.group(2))
            in_hunk = True
            continue
        if not in_hunk or raw.startswith("\\"):
            continue
        if raw.startswith("+"):
            yield new_line, "add", raw[1:]
            new_line += 1
        elif raw.startswith("-"):
            yield old_line, "del", raw[1:]
            old_line += 1
        else:
            yield new_line, "context", raw.removeprefix(" ")
            old_line += 1
            new_line += 1


def make_tools(state: dict[str, Any]) -> list[BaseTool]:
    @tool
    def list_files() -> str:
        """List every file in the PR with status, +/- counts and its role from the brief (if known)."""
        files = state.get("files") or []
        if not files:
            return NO_PR
        roles = _roles(state)
        rows = [
            {
                "path": file["path"],
                "status": file["status"],
                "additions": file["additions"],
                "deletions": file["deletions"],
                "role": roles.get(file["path"]),
            }
            for file in files
        ]
        return json.dumps(rows)

    @tool
    def get_file_diff(path: str) -> str:
        """Return the full unified diff for one file in the PR. Use the exact path from list_files."""
        files = state.get("files") or []
        if not files:
            return NO_PR
        for file in files:
            if file["path"] == path or file.get("previous_path") == path:
                return file["patch"] or f"{file['path']}: no textual patch (binary or omitted by GitHub)."
        return f"{path} is not in this PR."

    @tool
    def search_diff(query: str) -> str:
        """Search all patches for a substring (case-insensitive). Returns up to 20 hits as {path, line, text, kind} where kind is add, del or context."""
        files = state.get("files") or []
        if not files:
            return NO_PR
        needle = query.lower()
        hits: list[dict[str, Any]] = []
        for file in files:
            for line, kind, text in _iter_patch_lines(file.get("patch") or ""):
                if needle in text.lower():
                    hits.append({"path": file["path"], "line": line, "text": text, "kind": kind})
                    if len(hits) >= SEARCH_LIMIT:
                        return json.dumps(hits)
        return json.dumps(hits) if hits else f"No lines in the diff match {query!r}."

    @tool
    def get_pr_description() -> str:
        """Return the PR title and body as written by the author."""
        pr = state.get("pr")
        if not pr:
            return NO_PR
        body = (pr.get("body") or "").strip() or "(no description)"
        return f"# {pr.get('title', '')}\n\n{body}"

    @tool
    def show_visual(visual: Annotated[dict, VISUAL_SHAPE]) -> str:
        """Render a show-me visual inline in the chat. Use it for anything structural: logic (pseudocode), control flow (call_tree), UI structure (component_tree), file scope (file_tree), interactions (mermaid), before/after shapes (shape_diff), copyable code (code_block), or a key fact (callout)."""
        # Same tolerance as the Brief: aliases are absorbed, then the strict
        # schema decides, so the model only hears about genuinely missing parts.
        try:
            parsed = _VISUAL_ADAPTER.validate_python(coerce_visual(visual) or visual)
        except ValidationError as exc:
            problems = "; ".join(
                f"{'.'.join(str(part) for part in error['loc']) or 'visual'}: {error['msg']}" for error in exc.errors()
            )
            return f"Invalid visual — fix these and call show_visual again: {problems}. {VISUAL_SHAPE}"
        # Echo the validated shape so the frontend renders exactly what the model meant.
        return json.dumps(parsed.model_dump())

    return [list_files, get_file_diff, search_diff, get_pr_description, show_visual]


def backend_tool_names() -> set[str]:
    return {t.name for t in make_tools({})}
