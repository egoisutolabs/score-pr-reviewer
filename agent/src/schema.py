"""Shared review models — mirrors web/src/lib/types.ts field-for-field (see CONTRACT.md).

Pydantic here because the analyze step asks Claude for structured output against
this schema; the TypedDict at the bottom is what LangGraph/CopilotKit stream to
the frontend as agent state.
"""

from __future__ import annotations

from typing import Annotated, Literal

from copilotkit import CopilotKitState
from pydantic import BaseModel, Field

ReviewStatus = Literal["idle", "fetching", "analyzing", "ready", "error"]
FileStatus = Literal["added", "modified", "removed", "renamed"]
RiskLevel = Literal["low", "medium", "high"]
FileRole = Literal["core", "supporting", "test", "config", "docs", "generated"]
Severity = Literal["info", "warn", "block"]
Verdict = Literal["approve", "approve_with_nits", "needs_changes", "needs_discussion"]
# The reader's whole budget for this PR, Brief included. Everything the model
# writes is sized against it.
REVIEW_BUDGET_MINUTES = 15


class PRMeta(BaseModel):
    owner: str
    repo: str
    number: int
    url: str
    title: str
    body: str = ""
    author: str
    base_ref: str
    head_ref: str
    state: Literal["OPEN", "MERGED", "CLOSED"]
    additions: int
    deletions: int
    changed_files: int
    created_at: str
    labels: list[str] = Field(default_factory=list)


class PRFile(BaseModel):
    path: str
    previous_path: str | None = None
    status: FileStatus
    additions: int
    deletions: int
    patch: str = Field(description="Full unified diff for this file including the `diff --git` header.")
    language: str | None = None


class Ref(BaseModel):
    path: str
    line: int | None = Field(default=None, description="New-file line number, or null for the whole file.")


class VisualBase(BaseModel):
    title: str
    caption: str | None = None
    refs: list[Ref] = Field(default_factory=list)


class Pseudocode(VisualBase):
    kind: Literal["pseudocode"] = "pseudocode"
    body: str


class CallTree(VisualBase):
    kind: Literal["call_tree"] = "call_tree"
    body: str


class ComponentTree(VisualBase):
    kind: Literal["component_tree"] = "component_tree"
    body: str


class FileTree(VisualBase):
    kind: Literal["file_tree"] = "file_tree"
    body: str


class Mermaid(VisualBase):
    kind: Literal["mermaid"] = "mermaid"
    body: str = Field(description="A flowchart, sequenceDiagram, or stateDiagram-v2 definition. No code fences.")


class ShapeDiff(VisualBase):
    kind: Literal["shape_diff"] = "shape_diff"
    before: str
    after: str


class CodeBlock(VisualBase):
    kind: Literal["code_block"] = "code_block"
    body: str
    language: str


class Callout(VisualBase):
    kind: Literal["callout"] = "callout"
    body: str
    tone: Literal["info", "warn", "danger"] = "info"


# Discriminated on `kind`: validation errors then name the one variant that
# failed instead of listing every variant's missing fields, and the JSON schema
# tells the model exactly which fields go with which kind.
Visual = Annotated[
    Pseudocode | CallTree | ComponentTree | FileTree | Mermaid | ShapeDiff | CodeBlock | Callout,
    Field(discriminator="kind"),
]


class ChangeMapEntry(BaseModel):
    path: str
    role: FileRole
    summary: str


class ChecklistItem(BaseModel):
    item: str
    path: str | None = None
    line: int | None = None
    severity: Severity = "info"
    minutes: int | None = Field(default=None, description="Estimated minutes to verify this item.")


class ReadStep(BaseModel):
    path: str
    minutes: int = Field(ge=1, le=REVIEW_BUDGET_MINUTES, description="Minutes to spend on this file.")
    why: str = Field(description="One clause: what to look for there.")


class SkipEntry(BaseModel):
    path: str
    why: str = Field(description="One clause: why it is safe not to open.")


class TimePlan(BaseModel):
    """How to spend the budget: the files to open in order, and the ones not to."""

    budget_minutes: int = REVIEW_BUDGET_MINUTES
    read_first: list[ReadStep] = Field(default_factory=list, description="Ordered, at most five; minutes sum to at most budget minus three.")
    skip: list[SkipEntry] = Field(default_factory=list, description="Files not worth opening in this budget, with the reason.")


class Brief(BaseModel):
    headline: str = Field(description="One sentence, at most 120 characters, saying what the PR does.")
    intent: str = Field(description="Two to four plain-language sentences: what changed and why.")
    risk: RiskLevel
    risk_reasons: list[str] = Field(description="One to five short bullets.")
    change_map: list[ChangeMapEntry] = Field(description="Every changed file exactly once, with its role and a one-line summary.")
    visuals: list[Visual] = Field(description="One to six show-me visuals, most important first.")
    checklist: list[ChecklistItem] = Field(description="What a reviewer should verify, anchored to files and lines where possible.")
    questions_for_author: list[str] = Field(default_factory=list)
    testing: str = Field(description="What tests changed and what is untested.")
    verdict: Verdict = Field(default="needs_discussion", description="The recommended outcome for a reviewer who follows the time plan.")
    verdict_reason: str = Field(default="", description="One sentence justifying the verdict.")
    time_plan: TimePlan = Field(default_factory=TimePlan)


class ReviewState(CopilotKitState):
    """LangGraph state streamed to the frontend. Plain dicts, not models, so AG-UI can serialize it."""

    pr_url: str | None
    status: ReviewStatus
    progress: str | None
    error: str | None
    pr: dict | None
    files: list[dict]
    brief: dict | None


EMPTY_REVIEW: dict = {
    "pr_url": None,
    "status": "idle",
    "progress": None,
    "error": None,
    "pr": None,
    "files": [],
    "brief": None,
}
