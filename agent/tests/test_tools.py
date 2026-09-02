import json

import pytest
from langchain_core.messages import AIMessage

from src.agent import tool_node
from src.tools import NO_PR, backend_tool_names, make_tools

PATCH = (
    "diff --git a/src/app.py b/src/app.py\n"
    "--- a/src/app.py\n"
    "+++ b/src/app.py\n"
    "@@ -10,3 +10,4 @@\n"
    " import os\n"
    "-def main():\n"
    "+def main(name):\n"
    "+    retry()\n"
    " run()\n"
)

STATE = {
    "pr": {"title": "Add retries", "body": "Because gateways flake."},
    "files": [
        {"path": "src/app.py", "previous_path": None, "status": "modified", "additions": 2, "deletions": 1, "patch": PATCH},
        {"path": "logo.png", "previous_path": None, "status": "added", "additions": 0, "deletions": 0, "patch": ""},
    ],
    "brief": {"change_map": [{"path": "src/app.py", "role": "core", "summary": "s"}]},
}


def tools_by_name(state):
    return {t.name: t for t in make_tools(state)}


def test_tool_names_match_contract():
    assert backend_tool_names() == {"list_files", "get_file_diff", "search_diff", "get_pr_description", "show_visual"}


def test_tools_tolerate_empty_state():
    tools = tools_by_name({})
    assert tools["list_files"].invoke({}) == NO_PR
    assert tools["get_file_diff"].invoke({"path": "x"}) == NO_PR
    assert tools["search_diff"].invoke({"query": "x"}) == NO_PR
    assert tools["get_pr_description"].invoke({}) == NO_PR


def test_list_files_includes_roles_from_brief():
    rows = json.loads(tools_by_name(STATE)["list_files"].invoke({}))
    assert rows[0] == {"path": "src/app.py", "status": "modified", "additions": 2, "deletions": 1, "role": "core"}
    assert rows[1]["role"] is None


def test_get_file_diff_and_missing_path():
    tools = tools_by_name(STATE)
    assert tools["get_file_diff"].invoke({"path": "src/app.py"}) == PATCH
    assert "not in this PR" in tools["get_file_diff"].invoke({"path": "nope.py"})
    assert "no textual patch" in tools["get_file_diff"].invoke({"path": "logo.png"})


def test_search_diff_reports_new_file_line_numbers_and_kinds():
    hits = json.loads(tools_by_name(STATE)["search_diff"].invoke({"query": "main"}))
    assert hits == [
        {"path": "src/app.py", "line": 11, "text": "def main():", "kind": "del"},
        {"path": "src/app.py", "line": 11, "text": "def main(name):", "kind": "add"},
    ]
    retry = json.loads(tools_by_name(STATE)["search_diff"].invoke({"query": "RETRY"}))
    assert retry[0]["line"] == 12 and retry[0]["kind"] == "add"
    assert "No lines" in tools_by_name(STATE)["search_diff"].invoke({"query": "zzz"})


def test_get_pr_description():
    text = tools_by_name(STATE)["get_pr_description"].invoke({})
    assert text.startswith("# Add retries")
    assert "Because gateways flake." in text


def test_show_visual_echoes_valid_and_explains_invalid():
    show = tools_by_name(STATE)["show_visual"]
    visual = {"kind": "callout", "title": "Heads up", "body": "Retries a POST", "tone": "warn"}
    echoed = json.loads(show.invoke({"visual": visual}))
    assert echoed["kind"] == "callout" and echoed["tone"] == "warn"
    assert echoed["refs"] == [] and echoed["caption"] is None

    bad = show.invoke({"visual": {"kind": "shape_diff", "title": "t"}})
    assert bad.startswith("Invalid visual")
    assert "before" in bad and "after" in bad


@pytest.mark.asyncio
async def test_tool_node_runs_backend_calls_and_skips_frontend_calls():
    message = AIMessage(
        content="",
        tool_calls=[
            {"name": "get_pr_description", "args": {}, "id": "call-1"},
            {"name": "open_file", "args": {"path": "src/app.py"}, "id": "call-2"},
            {"name": "get_file_diff", "args": {"path": "nope.py"}, "id": "call-3"},
        ],
    )
    result = await tool_node({**STATE, "messages": [message]}, {})
    ids = [m.tool_call_id for m in result["messages"]]
    assert ids == ["call-1", "call-3"]
    assert result["messages"][0].content.startswith("# Add retries")
    assert "not in this PR" in result["messages"][1].content


@pytest.mark.asyncio
async def test_tool_node_with_no_messages_is_a_noop():
    assert await tool_node({}, {}) == {"messages": []}
