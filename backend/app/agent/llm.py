"""Claude client and a LangSmith-traced structured-output call."""

from functools import lru_cache
from typing import Any, TypeVar

import anthropic
from langsmith import traceable
from pydantic import BaseModel

from app.config import get_settings

T = TypeVar("T", bound=BaseModel)


class ModelRefusal(RuntimeError):
    pass


@lru_cache
def get_client() -> anthropic.AsyncAnthropic:
    key = get_settings().anthropic_api_key or None  # None → SDK reads the environment
    return anthropic.AsyncAnthropic(api_key=key)


def _trace_outputs(response: Any) -> dict:
    """What LangSmith shows for a Claude call: parsed output, stop reason, token usage."""
    usage = response.usage
    return {
        "output": response.parsed_output.model_dump() if response.parsed_output else None,
        "stop_reason": response.stop_reason,
        "model": response.model,
        "usage_metadata": {
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "total_tokens": usage.input_tokens + usage.output_tokens,
        },
    }


# langsmith.wrappers.wrap_anthropic patches `client.completions`, which the
# Anthropic SDK 1.x no longer has, so the call is traced with @traceable instead.
@traceable(
    run_type="llm",
    name="claude",
    metadata={"ls_provider": "anthropic"},
    process_outputs=_trace_outputs,
)
async def _parse(**params: Any):
    return await get_client().beta.messages.parse(**params)


async def structured_call(system: str, user: str, schema: type[T], *, effort: str | None = None) -> T:
    settings = get_settings()
    response = await _parse(
        model=settings.claude_model,
        max_tokens=16000,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_format=schema,
        output_config={"effort": effort or settings.claude_effort},
        # If a safety classifier declines, the API retries on a suitable fallback model.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        langsmith_extra={"metadata": {"ls_model_name": settings.claude_model}},
    )
    if response.stop_reason == "refusal":
        detail = response.stop_details.explanation if response.stop_details else ""
        raise ModelRefusal(f"Claude declined this request. {detail}".strip())
    if response.parsed_output is None:
        raise RuntimeError(f"No structured output (stop_reason={response.stop_reason})")
    return response.parsed_output
