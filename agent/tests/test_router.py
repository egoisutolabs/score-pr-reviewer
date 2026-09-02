from langchain_core.messages import AIMessage, HumanMessage

from src.agent import (
    after_chat,
    after_fetch,
    build_chat_system_prompt,
    requested_url,
    review_snapshot,
    route,
)
from src.schema import EMPTY_REVIEW

URL = "https://github.com/acme/widgets/pull/7"


def test_route_fetches_when_url_is_new():
    assert route({**EMPTY_REVIEW, "pr_url": URL}) == "fetch"
    assert route({**EMPTY_REVIEW, "pr_url": URL, "status": "error"}) == "fetch"
    # A first message may arrive with no review keys at all.
    assert route({"pr_url": URL}) == "fetch"


def test_route_falls_back_to_review_command_in_last_message():
    # setState can be a no-op before the agent is discovered; the message still carries the URL.
    from_message = {"messages": [HumanMessage(content=f"Review {URL}")]}
    assert requested_url(from_message) == URL
    assert route(from_message) == "fetch"
    assert route({**EMPTY_REVIEW, **from_message}) == "fetch"
    # Only a bare `Review <url>` turn counts; a question mentioning a URL is chat.
    assert route({"messages": [HumanMessage(content=f"What does {URL} change?")]}) == "chat"
    assert route({"messages": [HumanMessage(content="Review https://example.com/x")]}) == "chat"
    # State wins over the message once it is populated.
    assert requested_url({"pr_url": URL, **from_message}) == URL


def test_route_chats_without_a_url():
    assert route({}) == "chat"
    assert route(EMPTY_REVIEW) == "chat"
    assert route({**EMPTY_REVIEW, "pr_url": None, "messages": [HumanMessage(content="hi")]}) == "chat"


def test_route_chats_once_files_are_loaded():
    loaded = {**EMPTY_REVIEW, "pr_url": URL, "status": "ready", "files": [{"path": "a.py"}]}
    assert route(loaded) == "chat"
    # Files present but status still idle (state restored from a previous run) must not refetch.
    assert route({**loaded, "status": "idle"}) == "chat"


def test_after_fetch_ends_on_error():
    assert after_fetch({"status": "error"}) == "__end__"
    assert after_fetch({"status": "fetching", "pr": {"number": 1}}) == "analyze"
    assert after_fetch({"status": "fetching", "pr": None}) == "__end__"


def test_after_chat_routes_only_backend_tool_calls():
    backend = AIMessage(content="", tool_calls=[{"name": "get_file_diff", "args": {"path": "a.py"}, "id": "1"}])
    frontend = AIMessage(content="", tool_calls=[{"name": "open_file", "args": {"path": "a.py"}, "id": "2"}])
    plain = AIMessage(content="done")
    assert after_chat({"messages": [backend]}) == "tool_node"
    assert after_chat({"messages": [frontend]}) == "__end__"
    assert after_chat({"messages": [plain]}) == "__end__"
    assert after_chat({}) == "__end__"


def test_review_snapshot_fills_missing_keys():
    snap = review_snapshot({"pr_url": URL}, status="fetching")
    assert set(snap) == set(EMPTY_REVIEW)
    assert snap["status"] == "fetching"
    assert snap["files"] == []
    assert "messages" not in snap


def test_chat_prompt_tolerates_missing_pr_and_includes_roles():
    assert "No PR is loaded" in build_chat_system_prompt({})
    state = {
        "pr": {
            "owner": "acme",
            "repo": "widgets",
            "number": 7,
            "title": "Add retries",
            "author": "jo",
            "head_ref": "retries",
            "base_ref": "main",
            "state": "OPEN",
            "additions": 1,
            "deletions": 0,
            "changed_files": 1,
            "url": URL,
        },
        "files": [{"path": "src/a.py", "status": "modified", "additions": 1, "deletions": 0}],
        "brief": {"headline": "h", "change_map": [{"path": "src/a.py", "role": "core", "summary": "s"}]},
    }
    prompt = build_chat_system_prompt(state)
    assert "acme/widgets#7" in prompt
    assert "- src/a.py [modified, core] +1 -0" in prompt
    assert "open_file" in prompt and "show_visual" in prompt
