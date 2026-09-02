import os
import warnings

import uvicorn
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import LangGraphAGUIAgent
from dotenv import load_dotenv
from fastapi import FastAPI

from src.agent import graph

# Load the repo-root .env first so one file configures both web and agent; a
# local agent/.env still wins because load_dotenv never overrides.
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv()

app = FastAPI(title="pr_reviewer")

class QuietLangGraphAgent(LangGraphAGUIAgent):
    """LangGraphAGUIAgent without RAW event forwarding.

    By default every LangGraph stream event is re-emitted to the browser as an
    AG-UI RAW event — about 7,000 token chunks and 9 MB per review, all of
    which the frontend discards. CopilotKit's subclass does not expose the
    flag, and ag-ui's per-request clone() refuses a flag the constructor cannot
    accept, so the flag has to be a real constructor parameter here. Nothing
    the UI consumes (state, messages, tool calls, steps) travels as RAW.
    """

    def __init__(self, *, name, graph, description=None, config=None, emit_raw_events=False):
        super().__init__(name=name, graph=graph, description=description, config=config)
        self.emit_raw_events = emit_raw_events


add_langgraph_fastapi_endpoint(
    app=app,
    agent=QuietLangGraphAgent(
        name="pr_reviewer",
        description="Reads a GitHub pull request and produces a compressed, visual brief; answers reviewer questions.",
        graph=graph,
    ),
    path="/",
)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


def main() -> None:
    port = int(os.getenv("PORT", "8123"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)


warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")
if __name__ == "__main__":
    main()
