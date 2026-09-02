"""One place to construct the chat model.

Two providers: Anthropic (default, `langchain_anthropic`) and Z.AI's GLM models
through their OpenAI-compatible endpoint (`langchain_openai`). Everything else
in the agent asks for a model here so a provider swap is an env change, not a
code change. Constructed lazily: importing this module never needs a key.
"""

from __future__ import annotations

import os
from typing import Any, Literal

Provider = Literal["anthropic", "zai"]

DEFAULT_MODELS: dict[Provider, str] = {"anthropic": "claude-opus-5", "zai": "glm-5.3"}
# Coding-plan keys are only valid on the /coding/ endpoint; pay-as-you-go keys
# use /api/paas/v4. Overridable so either kind of key works.
ZAI_DEFAULT_BASE_URL = "https://api.z.ai/api/coding/paas/v4"
# GLM reasons before answering and its reasoning tokens count against the
# completion budget, so this must be generous or the answer is cut off.
MAX_TOKENS = 16000


def provider() -> Provider:
    value = os.environ.get("PR_REVIEWER_PROVIDER", "anthropic").strip().lower()
    if value not in DEFAULT_MODELS:
        raise ValueError(f"PR_REVIEWER_PROVIDER must be one of {sorted(DEFAULT_MODELS)}, got {value!r}")
    return value  # type: ignore[return-value]


def model_name() -> str:
    return os.environ.get("PR_REVIEWER_MODEL") or DEFAULT_MODELS[provider()]


def api_key_env() -> str:
    return "ZAI_API_KEY" if provider() == "zai" else "ANTHROPIC_API_KEY"


def require_api_key() -> None:
    """Fail with a one-line instruction instead of a stack trace deep in a request."""
    name = api_key_env()
    if not os.environ.get(name):
        raise RuntimeError(
            f"{name} is not set (provider {provider()!r}). Put it in the repo-root .env or agent/.env — see .env.example."
        )


def thinking_enabled() -> bool:
    """PR_REVIEWER_THINKING=on|off. Reasoning is where the time goes: on GLM the
    same Brief took 75 s with it on and 16 s with it off, at a modest quality
    cost the evals measure. Off by default; turn it on for hard PRs."""
    return os.environ.get("PR_REVIEWER_THINKING", "off").strip().lower() in {"on", "true", "1", "yes"}


def structured_output_method() -> Literal["json_schema", "function_calling"]:
    # Z.AI's endpoint accepts response_format but GLM answers with prose
    # instead of JSON, so its structured output rides on tool calling, which
    # it honours reliably. Anthropic's native JSON schema mode is exact.
    return "function_calling" if provider() == "zai" else "json_schema"


def make_chat_model(**overrides: Any):
    require_api_key()
    if provider() == "zai":
        from langchain_openai import ChatOpenAI

        params: dict[str, Any] = {
            "model": model_name(),
            "api_key": os.environ["ZAI_API_KEY"],
            "base_url": os.environ.get("ZAI_BASE_URL", ZAI_DEFAULT_BASE_URL),
            "max_tokens": MAX_TOKENS,
            "temperature": 0.2,
        }
        if not thinking_enabled():
            # GLM's OpenAI-compatible endpoint takes the switch in the body.
            params["extra_body"] = {"thinking": {"type": "disabled"}}
        params.update(overrides)
        return ChatOpenAI(**params)

    from langchain_anthropic import ChatAnthropic

    params = {
        "model": model_name(),
        "max_tokens": MAX_TOKENS,
        "thinking": {"type": "adaptive"},
    }
    if not thinking_enabled():
        # Disabling thinking outright on Opus 5 has known failure modes (tool
        # calls written as text); low effort is the sanctioned fast setting.
        params["output_config"] = {"effort": "low"}
    params.update(overrides)
    return ChatAnthropic(**params)
