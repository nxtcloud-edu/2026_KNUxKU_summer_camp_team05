from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Protocol, cast
from urllib.parse import urlsplit, urlunsplit
from collections.abc import Mapping

from .backend import JsonObject, LLMRequest, to_jsonable
from .contracts import AgentContractError


class GatewayTransport(Protocol):
    def post_json(
        self,
        url: str,
        body: JsonObject,
        timeout_seconds: float,
    ) -> JsonObject:
        ...


@dataclass(frozen=True, slots=True)
class AgentCoreGatewayConfig:
    gateway_url: str
    model: str = "openai/gpt-5.4-mini"
    reasoning_effort: str = "low"
    max_output_tokens: int = 4096
    timeout_seconds: float = 90.0

    def __post_init__(self) -> None:
        parsed = urlsplit(self.gateway_url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise AgentContractError("AgentCore Gateway URL must use HTTPS")
        if parsed.query or parsed.fragment or parsed.path.rstrip("/") not in {"", "/mcp"}:
            raise AgentContractError("gateway URL must be the Gateway origin or its /mcp URL")
        if not self.model.startswith("openai/"):
            raise AgentContractError("model must be pinned to the openai gateway target")
        if self.reasoning_effort not in {"none", "low", "medium", "high", "xhigh"}:
            raise AgentContractError("unsupported reasoning effort")
        if self.max_output_tokens <= 0 or self.timeout_seconds <= 0:
            raise AgentContractError("gateway limits must be positive")

    @property
    def responses_url(self) -> str:
        parsed = urlsplit(self.gateway_url)
        origin = urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
        return f"{origin}/inference/v1/responses"


class AgentCoreGatewayBackend:
    def __init__(
        self,
        config: AgentCoreGatewayConfig,
        transport: GatewayTransport,
    ) -> None:
        self.config = config
        self.transport = transport

    async def complete_json(self, request: LLMRequest) -> JsonObject:
        schema = to_jsonable(request.response_schema)
        payload = to_jsonable(request.payload)
        if not isinstance(schema, dict) or not isinstance(payload, dict):
            raise AgentContractError("LLM request schema and payload must be JSON objects")
        body: JsonObject = {
            "model": self.config.model,
            "input": [
                {
                    "role": "system",
                    "content": [{"type": "input_text", "text": request.system_prompt}],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": json.dumps(
                                payload,
                                ensure_ascii=False,
                                sort_keys=True,
                                separators=(",", ":"),
                            ),
                        }
                    ],
                },
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "moa_agent_response",
                    "schema": schema,
                    "strict": True,
                }
            },
            "reasoning": {"effort": self.config.reasoning_effort},
            "max_output_tokens": self.config.max_output_tokens,
            "store": False,
        }
        response = await asyncio.to_thread(
            self.transport.post_json,
            self.config.responses_url,
            body,
            self.config.timeout_seconds,
        )
        return extract_structured_output(response)


def extract_structured_output(response: JsonObject) -> JsonObject:
    error = response.get("error")
    if error is not None:
        raise AgentContractError("AgentCore Gateway returned an inference error")
    status = response.get("status")
    if status is not None and status != "completed":
        raise AgentContractError("Responses inference did not complete")
    output = response.get("output")
    if not isinstance(output, list):
        raise AgentContractError("Responses payload has no output list")
    for item in output:
        if not isinstance(item, Mapping) or item.get("type") != "message":
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, Mapping) or part.get("type") != "output_text":
                continue
            text = part.get("text")
            if not isinstance(text, str):
                continue
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError as exc:
                raise AgentContractError("model output is not valid JSON") from exc
            if not isinstance(parsed, Mapping) or not all(
                isinstance(key, str) for key in parsed
            ):
                raise AgentContractError("model output must be a JSON object")
            return cast(JsonObject, parsed)
    raise AgentContractError("Responses payload has no structured output text")
