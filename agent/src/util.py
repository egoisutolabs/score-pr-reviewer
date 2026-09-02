"""Small pure helpers shared by the graph nodes."""

from __future__ import annotations

from collections.abc import Iterable

from langchain_core.messages import BaseMessage


def should_route_to_tool_node(response: BaseMessage, backend_tool_names: Iterable[str]) -> bool:
    """True when the model called at least one tool the backend executes.

    Frontend tools (open_file, switch_tab) are executed by the browser, so a
    turn that only calls those must end and hand control to the UI — routing it
    to the tool node would leave dangling tool calls with no result.
    """
    names = set(backend_tool_names)
    tool_calls = getattr(response, "tool_calls", None) or []
    return any(call.get("name") in names for call in tool_calls)
