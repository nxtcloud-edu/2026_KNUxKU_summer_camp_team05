from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import Mapping, Sequence
from dataclasses import fields, is_dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Protocol, cast

from .contracts import AgentContractError


JsonValue = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject = Mapping[str, Any]


class LLMBackend(Protocol):
    async def complete_json(self, request: "LLMRequest") -> JsonObject:
        ...


class LLMRequest:
    def __init__(
        self,
        *,
        agent_name: str,
        system_prompt: str,
        payload: JsonObject,
        response_schema: JsonObject,
    ) -> None:
        self.agent_name = agent_name
        self.system_prompt = system_prompt
        self.payload = payload
        self.response_schema = response_schema


class ScriptedLLMBackend:
    def __init__(self, responses: Mapping[str, Sequence[JsonObject]]) -> None:
        self._responses = {name: deque(items) for name, items in responses.items()}
        self.requests: list[LLMRequest] = []

    async def complete_json(self, request: LLMRequest) -> JsonObject:
        self.requests.append(request)
        await asyncio.sleep(0)
        queue = self._responses.get(request.agent_name)
        if queue is None or not queue:
            raise AgentContractError(f"no scripted response for {request.agent_name}")
        return dict(queue.popleft())


def to_jsonable(value: Any) -> JsonValue:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Enum):
        return cast(str, value.value)
    if is_dataclass(value) and not isinstance(value, type):
        return {
            item.name: to_jsonable(getattr(value, item.name))
            for item in fields(value)
        }
    if isinstance(value, Mapping):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [to_jsonable(item) for item in value]
    raise TypeError(f"cannot convert {type(value).__name__} to JSON")


def require_string(data: JsonObject, key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value:
        raise AgentContractError(f"{key} must be a non-empty string")
    return value


def optional_string(data: JsonObject, key: str) -> str | None:
    value = data.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise AgentContractError(f"{key} must be null or a non-empty string")
    return value


def require_string_list(data: JsonObject, key: str) -> tuple[str, ...]:
    value = data.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise AgentContractError(f"{key} must be a list of strings")
    return tuple(value)


def require_mapping(data: JsonObject, key: str) -> Mapping[str, Any]:
    value = data.get(key)
    if not isinstance(value, Mapping) or not all(isinstance(item, str) for item in value):
        raise AgentContractError(f"{key} must be an object with string keys")
    return cast(Mapping[str, Any], value)
