"""The pr_reviewer graph: route → fetch → analyze → END, or route → chat ⇄ tool_node.

Review fields on the state are plain dicts (see schema.ReviewState) because
AG-UI serializes them straight to the browser; Pydantic models are rebuilt at
the edges where the analysis code needs them.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Literal

from copilotkit.langgraph import copilotkit_customize_config, copilotkit_emit_state
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from .analyze import analyze, make_model
from .github import PR_URL_RE, GhError, fetch_pr
from .schema import EMPTY_REVIEW, PRFile, PRMeta, ReviewState
from .tools import make_tools
from .util import should_route_to_tool_node

REVIEW_KEYS = tuple(EMPTY_REVIEW)


def review_snapshot(state: dict, **updates: Any) -> dict:
    """The seven review fields with `updates` applied — what the UI expects in a STATE_SNAPSHOT."""
    snapshot = {key: state.get(key, EMPTY_REVIEW[key]) for key in REVIEW_KEYS}
    snapshot.update(updates)
    return snapshot


_REVIEW_COMMAND_RE = re.compile(r"^\s*review\s+(\S+)\s*$", re.IGNORECASE)


def requested_url(state: dict) -> str | None:
    """The PR to review: `pr_url` from state, else the URL in a trailing `Review <url>` user turn.

    The page sets `pr_url` before appending that message, but `setState` is a
    no-op until the frontend has discovered the agent, so a submit in the first
    second can arrive with an empty state. The message itself always carries
    the URL, so it is the fallback source rather than a reason to answer in chat.
    """
    if state.get("pr_url"):
        return state["pr_url"]
    messages = state.get("messages") or []
    last = messages[-1] if messages else None
    if not isinstance(last, HumanMessage) or not isinstance(last.content, str):
        return None
    match = _REVIEW_COMMAND_RE.match(last.content)
    if match and PR_URL_RE.match(match.group(1)):
        return match.group(1)
    return None


def route(state: dict) -> Literal["fetch", "chat"]:
    """Start a review only when a URL is set and nothing has been fetched for it yet.

    `error` counts as restartable so the user can fix `gh auth` and retry with
    the same URL; `fetching`/`analyzing` never reach here because those runs
    finish before a new one starts.
    """
    status = state.get("status")
    if requested_url(state) and status in (None, "idle", "error") and not state.get("files"):
        return "fetch"
    return "chat"


def _explain_gh_error(message: str) -> str:
    lowered = message.lower()
    if "not installed" in lowered or "not on path" in lowered:
        hint = "Install the GitHub CLI from https://cli.github.com, run `gh auth login`, then submit the URL again."
    elif "auth" in lowered or "login" in lowered or "token" in lowered or "401" in lowered:
        hint = "Run `gh auth login` in a terminal (the agent uses your gh credentials), then submit the URL again."
    elif "could not resolve" in lowered or "not found" in lowered or "404" in lowered:
        hint = "Check that the URL points at an existing pull request you have access to, then submit it again."
    else:
        hint = "Fix the problem `gh` reported and submit the URL again."
    return f"I couldn't fetch that pull request.\n\n```\n{message}\n```\n\n{hint}"


async def fetch_node(state: dict, config: RunnableConfig) -> dict:
    url = requested_url(state) or ""
    # Write pr_url back so a review started from the message alone still leaves
    # the state the page expects (its Workspace keys off pr_url).
    state = {**state, "pr_url": url}
    await copilotkit_emit_state(config, review_snapshot(state, status="fetching", progress=f"Fetching {url}…", error=None))
    try:
        # subprocess is blocking; keep the event loop free so AG-UI keeps streaming.
        meta, files = await asyncio.to_thread(fetch_pr, url)
    except GhError as exc:
        message = str(exc)
        update = review_snapshot(state, status="error", progress=None, error=message, pr=None, files=[], brief=None)
        await copilotkit_emit_state(config, update)
        return {**update, "messages": [AIMessage(content=_explain_gh_error(message))]}

    update = review_snapshot(
        state,
        status="fetching",
        progress=f"Reading {len(files)} files…",
        error=None,
        pr=meta.model_dump(),
        files=[file.model_dump() for file in files],
        brief=None,
    )
    await copilotkit_emit_state(config, update)
    return update


def after_fetch(state: dict) -> Literal["analyze", "__end__"]:
    return "analyze" if state.get("status") != "error" and state.get("pr") else END


async def analyze_node(state: dict, config: RunnableConfig) -> dict:
    raw_files = state.get("files") or []
    diff_kchars = sum(len(file.get("patch", "")) for file in raw_files) // 1000
    # Reasoning models spend minutes on big diffs; say what "big" means so a
    # quiet spinner reads as work, not a hang.
    progress = f"Drafting the brief from {len(raw_files)} files ({diff_kchars}k chars of diff)…"
    if diff_kchars > 60:
        progress += " Large PRs take several minutes."
    await copilotkit_emit_state(config, review_snapshot(state, status="analyzing", progress=progress, error=None))

    # The structured-output call streams JSON tokens; without this the Brief
    # would appear in the chat as a half-formed assistant message. copilotkit
    # writes `copilotkit:emit-*` keys while ag-ui-langgraph reads bare
    # `emit-*`, so both are set.
    quiet = copilotkit_customize_config(config, emit_messages=False, emit_tool_calls=False)
    quiet["metadata"].update({"emit-messages": False, "emit-tool-calls": False})

    try:
        pr = PRMeta.model_validate(state.get("pr") or {})
        files = [PRFile.model_validate(file) for file in state.get("files") or []]
        brief = await analyze(pr, files, config=quiet)
    except Exception as exc:  # noqa: BLE001 — any failure here must become UI state, not a dead run
        message = f"Analysis failed: {type(exc).__name__}: {exc}"
        update = review_snapshot(state, status="error", progress=None, error=message)
        await copilotkit_emit_state(config, update)
        return {
            **update,
            "messages": [
                AIMessage(
                    content=f"I fetched the PR but could not draft the brief.\n\n```\n{message}\n```\n\n"
                    "The diff is still available on the Diff tab. Submit the URL again to retry."
                )
            ],
        }

    update = review_snapshot(state, status="ready", progress=None, error=None, brief=brief.model_dump())
    await copilotkit_emit_state(config, update)
    return {**update, "messages": [AIMessage(content=f"Review ready — {brief.headline}. Ask me anything about it.")]}


def build_chat_system_prompt(state: dict) -> str:
    pr = state.get("pr")
    brief = state.get("brief")
    files = state.get("files") or []

    parts = [
        (
            "You are a senior engineer helping a reviewer understand one pull request. "
            "You have the full diff through tools; the reviewer sees a Brief tab and a Diff tab beside this chat."
        ),
        "",
        "How to answer:",
        "- The reviewer has about fifteen minutes for this whole PR. Answer in under 120 words unless asked for depth; lead with the answer, then the evidence.",
        "- When you cite code, call open_file(path, line) so the reviewer lands on it; line is the new-file line number.",
        "- Prefer show_visual over prose for anything structural: control flow, data flow, a type before/after, file scope.",
        "- Use get_file_diff and search_diff before asserting what code does; do not rely on the Brief alone.",
        "- Never claim to have run code or tests. Say what the diff shows and what remains unverified.",
        (
            "- Frontend actions (open_file, switch_tab) run in the browser: call them in a turn by themselves, "
            "after any backend tool calls have returned."
        ),
        "",
    ]
    if not pr:
        parts.append("No PR is loaded yet. Ask the reviewer to paste a GitHub pull request URL.")
        return "\n".join(parts)

    parts.extend(
        [
            "## Pull request",
            f"{pr.get('owner')}/{pr.get('repo')}#{pr.get('number')}: {pr.get('title')}",
            (
                f"author {pr.get('author')} · {pr.get('head_ref')} -> {pr.get('base_ref')} · {pr.get('state')} · "
                f"+{pr.get('additions')} -{pr.get('deletions')} across {pr.get('changed_files')} files"
            ),
            f"url: {pr.get('url')}",
            "",
        ]
    )
    if brief:
        parts.extend(["## Brief (JSON)", json.dumps(brief, ensure_ascii=False), ""])
    else:
        parts.append("The brief is not ready yet; answer from the diff.\n")

    roles = {entry["path"]: entry["role"] for entry in (brief or {}).get("change_map") or [] if "path" in entry}
    parts.append("## Files")
    for file in files:
        role = roles.get(file["path"])
        parts.append(
            f"- {file['path']} [{file['status']}{f', {role}' if role else ''}] +{file['additions']} -{file['deletions']}"
        )
    return "\n".join(parts)


async def chat_node(state: dict, config: RunnableConfig) -> dict:
    messages = state.get("messages") or []
    if not messages:
        # A run started to set state (e.g. a URL without a question) has nothing to answer.
        return {}
    backend_tools = make_tools(state)
    frontend_actions = (state.get("copilotkit") or {}).get("actions") or []
    model = make_model().bind_tools([*backend_tools, *frontend_actions])
    response = await model.ainvoke([SystemMessage(content=build_chat_system_prompt(state)), *messages], config)
    return {"messages": [response]}


def after_chat(state: dict) -> Literal["tool_node", "__end__"]:
    messages = state.get("messages") or []
    if not messages:
        return END
    names = {t.name for t in make_tools(state)}
    return "tool_node" if should_route_to_tool_node(messages[-1], names) else END


async def tool_node(state: dict, config: RunnableConfig) -> dict:
    """Execute backend tool calls from the last AIMessage. Frontend calls are left for the UI."""
    messages = state.get("messages") or []
    last = messages[-1] if messages else None
    tool_calls = getattr(last, "tool_calls", None) or []
    tools = {t.name: t for t in make_tools(state)}
    results: list[ToolMessage] = []
    for call in tool_calls:
        tool = tools.get(call.get("name"))
        if tool is None:
            continue
        try:
            content = await tool.ainvoke(call.get("args") or {})
        except Exception as exc:  # noqa: BLE001 — the model should see the failure and retry, not crash the run
            content = f"Error running {call.get('name')}: {type(exc).__name__}: {exc}"
        results.append(ToolMessage(content=str(content), tool_call_id=call["id"], name=call.get("name")))
    return {"messages": results}


def build_graph() -> StateGraph:
    workflow = StateGraph(ReviewState)
    workflow.add_node("fetch", fetch_node)
    workflow.add_node("analyze", analyze_node)
    workflow.add_node("chat", chat_node)
    workflow.add_node("tool_node", tool_node)

    workflow.add_conditional_edges(START, route, {"fetch": "fetch", "chat": "chat"})
    workflow.add_conditional_edges("fetch", after_fetch, {"analyze": "analyze", END: END})
    workflow.add_edge("analyze", END)
    workflow.add_conditional_edges("chat", after_chat, {"tool_node": "tool_node", END: END})
    workflow.add_edge("tool_node", "chat")
    return workflow


graph = build_graph().compile(checkpointer=MemorySaver())
