from __future__ import annotations

import asyncio
import hmac
import json
import os
from datetime import date
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, cast
from collections.abc import Mapping

from .agentcore_backend import AgentCoreGatewayBackend, AgentCoreGatewayConfig
from .arbitrators import build_category_arbiters
from .aws_transport import AwsSigV4GatewayTransport
from .backend import JsonObject, LLMBackend, to_jsonable
from .contracts import (
    AgentContractError,
    CapacityAllocation,
    CapacityPlan,
    Category,
    CategoryProposal,
    DeterministicSelection,
    ProfileFact,
    TripCharter,
    UserProfileView,
    VerificationReceipt,
    VerificationStatus,
)
from .proxy import UserProxyAgent
from .runtime import run_category_draft
from .supervisor import TripSupervisorAgent


MAX_REQUEST_BYTES = 2 * 1024 * 1024


async def run_category_payload(payload: JsonObject, backend: LLMBackend) -> JsonObject:
    charter = _charter(_object(payload.get("charter"), "charter"))
    profiles = tuple(
        _profile(item) for item in _object_list(payload.get("profiles"), "profiles")
    )
    category = _category(payload.get("category"))
    proposals = tuple(
        _proposal(item, category)
        for item in _object_list(payload.get("proposals"), "proposals")
    )
    receipts = tuple(
        _receipt(item) for item in _object_list(payload.get("receipts"), "receipts")
    )
    selection = _selection(_object(payload.get("selection"), "selection"))
    prior_obligations = _strings(payload.get("prior_obligations", []), "prior_obligations")
    arbiters = build_category_arbiters(backend)
    proxies = {
        profile.user_id: UserProxyAgent(profile, backend) for profile in profiles
    }
    result = await run_category_draft(
        charter=charter,
        profiles=profiles,
        proposals=proposals,
        receipts=receipts,
        selection=selection,
        proxies=proxies,
        arbiter=arbiters[category],
        supervisor=TripSupervisorAgent(backend),
        prior_obligations=prior_obligations,
    )
    serialized = to_jsonable(result)
    if not isinstance(serialized, dict):
        raise AgentContractError("category result serialization failed")
    return cast(JsonObject, serialized)


def create_backend_from_env() -> AgentCoreGatewayBackend:
    gateway_url = os.environ.get("MOA_AGENTCORE_GATEWAY_URL", "")
    region = (
        os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or ""
    )
    config = AgentCoreGatewayConfig(
        gateway_url=gateway_url,
        model=os.environ.get("MOA_MODEL", "openai/gpt-5.4-mini"),
        reasoning_effort=os.environ.get("MOA_REASONING_EFFORT", "low"),
        max_output_tokens=_env_int("MOA_MAX_OUTPUT_TOKENS", 4096),
        timeout_seconds=float(os.environ.get("MOA_GATEWAY_TIMEOUT_SECONDS", "90")),
    )
    return AgentCoreGatewayBackend(config, AwsSigV4GatewayTransport(region))


def serve() -> None:
    token = os.environ.get("MOA_SERVICE_TOKEN", "")
    if len(token) < 32:
        raise AgentContractError("MOA_SERVICE_TOKEN must contain at least 32 characters")
    backend = create_backend_from_env()
    port = _env_int("PORT", 8080)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path != "/health":
                self._send(404, {"error": "not_found"})
                return
            self._send(200, {"status": "ok"})

        def do_POST(self) -> None:
            if self.path != "/v1/category-runs":
                self._send(404, {"error": "not_found"})
                return
            supplied = self.headers.get("Authorization", "")
            if not hmac.compare_digest(supplied, f"Bearer {token}"):
                self._send(401, {"error": "unauthorized"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._send(400, {"error": "invalid_content_length"})
                return
            if size <= 0 or size > MAX_REQUEST_BYTES:
                self._send(413, {"error": "request_size_not_allowed"})
                return
            try:
                parsed = json.loads(self.rfile.read(size))
                if not isinstance(parsed, Mapping) or not all(
                    isinstance(key, str) for key in parsed
                ):
                    raise AgentContractError("request body must be a JSON object")
                result = asyncio.run(run_category_payload(cast(JsonObject, parsed), backend))
            except (AgentContractError, json.JSONDecodeError, InvalidOperation, ValueError):
                self._send(422, {"error": "invalid_or_unsafe_category_run"})
                return
            self._send(200, result)

        def _send(self, status: int, body: JsonObject) -> None:
            encoded = json.dumps(
                to_jsonable(body), ensure_ascii=False, separators=(",", ":")
            ).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, format: str, *args: object) -> None:
            return

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.serve_forever()


def _charter(value: JsonObject) -> TripCharter:
    participants = _strings(value.get("participants"), "charter.participants")
    budgets = _decimal_map(value.get("budget_max_by_user"), "budget_max_by_user")
    return TripCharter(
        version=_string(value.get("version"), "charter.version"),
        destination=_string(value.get("destination"), "charter.destination"),
        start_date=date.fromisoformat(_string(value.get("start_date"), "start_date")),
        end_date=date.fromisoformat(_string(value.get("end_date"), "end_date")),
        participants=participants,
        party_size=_integer(value.get("party_size"), "party_size"),
        pace=_string(value.get("pace"), "pace"),
        budget_max_by_user=budgets,
    )


def _profile(value: JsonObject) -> UserProfileView:
    facts = tuple(
        ProfileFact(
            fact_id=_string(item.get("fact_id"), "fact_id"),
            statement=_string(item.get("statement"), "statement"),
            importance=_integer(item.get("importance", 3), "importance"),
            hard=_boolean(item.get("hard", False), "hard"),
        )
        for item in _object_list(value.get("facts"), "facts")
    )
    return UserProfileView(
        user_id=_string(value.get("user_id"), "user_id"),
        facts=facts,
    )


def _proposal(value: JsonObject, category: Category) -> CategoryProposal:
    capacity = _object(value.get("capacity_plan"), "capacity_plan")
    allocations = tuple(
        CapacityAllocation(
            resource_unit_id=_string(item.get("resource_unit_id"), "resource_unit_id"),
            confirmed_capacity=_integer(item.get("confirmed_capacity"), "confirmed_capacity"),
            assigned_user_ids=_strings(item.get("assigned_user_ids"), "assigned_user_ids"),
        )
        for item in _object_list(capacity.get("allocations"), "allocations")
    )
    capacity_plan = CapacityPlan(
        requested_party_size=_integer(
            capacity.get("requested_party_size"), "requested_party_size"
        ),
        confirmed_capacity=_integer(
            capacity.get("confirmed_capacity"), "confirmed_capacity"
        ),
        allocations=allocations,
        unassigned_user_ids=_strings(
            capacity.get("unassigned_user_ids", []), "unassigned_user_ids"
        ),
        evidence_refs=_strings(capacity.get("evidence_refs"), "evidence_refs"),
        split_authority_ref=_optional_string(capacity.get("split_authority_ref")),
    )
    proposal_category = _category(value.get("category"))
    if proposal_category is not category:
        raise AgentContractError("proposal category differs from request category")
    return CategoryProposal(
        proposal_id=_string(value.get("proposal_id"), "proposal_id"),
        category=proposal_category,
        proposal_set_version=_string(
            value.get("proposal_set_version"), "proposal_set_version"
        ),
        summary=_string(value.get("summary"), "summary"),
        cost_by_user=_decimal_map(value.get("cost_by_user"), "cost_by_user"),
        evidence_refs=_strings(value.get("evidence_refs"), "evidence_refs"),
        capacity_plan=capacity_plan,
    )


def _receipt(value: JsonObject) -> VerificationReceipt:
    try:
        status = VerificationStatus(_string(value.get("status"), "status"))
    except ValueError as exc:
        raise AgentContractError("invalid verification status") from exc
    return VerificationReceipt(
        receipt_id=_string(value.get("receipt_id"), "receipt_id"),
        proposal_id=_string(value.get("proposal_id"), "proposal_id"),
        rule_id=_string(value.get("rule_id"), "rule_id"),
        status=status,
        evidence_refs=_strings(value.get("evidence_refs"), "evidence_refs"),
        explanation=_string(value.get("explanation"), "explanation"),
    )


def _selection(value: JsonObject) -> DeterministicSelection:
    raw_scores = _object(
        value.get("satisfaction_by_proposal", {}), "satisfaction_by_proposal"
    )
    scores: dict[str, tuple[float, ...]] = {}
    for proposal_id, raw_items in raw_scores.items():
        if not isinstance(raw_items, list) or not all(
            isinstance(item, (int, float)) and not isinstance(item, bool)
            for item in raw_items
        ):
            raise AgentContractError("satisfaction scores must be numeric arrays")
        scores[proposal_id] = tuple(float(item) for item in raw_items)
    return DeterministicSelection(
        selected_proposal_id=_optional_string(value.get("selected_proposal_id")),
        satisfaction_by_proposal=scores,
        trace=_strings(value.get("trace", []), "selection.trace"),
    )


def _object(value: object, label: str) -> JsonObject:
    if not isinstance(value, Mapping) or not all(isinstance(key, str) for key in value):
        raise AgentContractError(f"{label} must be an object")
    return cast(JsonObject, value)


def _object_list(value: object, label: str) -> tuple[JsonObject, ...]:
    if not isinstance(value, list):
        raise AgentContractError(f"{label} must be a list")
    return tuple(_object(item, label) for item in value)


def _string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise AgentContractError(f"{label} must be a non-empty string")
    return value


def _optional_string(value: object) -> str | None:
    if value is None:
        return None
    return _string(value, "optional string")


def _strings(value: object, label: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise AgentContractError(f"{label} must be a string list")
    return tuple(value)


def _integer(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise AgentContractError(f"{label} must be an integer")
    return value


def _boolean(value: object, label: str) -> bool:
    if not isinstance(value, bool):
        raise AgentContractError(f"{label} must be boolean")
    return value


def _decimal_map(value: object, label: str) -> Mapping[str, Decimal]:
    raw = _object(value, label)
    result: dict[str, Decimal] = {}
    for key, item in raw.items():
        if not isinstance(item, (str, int, float)) or isinstance(item, bool):
            raise AgentContractError(f"{label} values must be decimal strings or numbers")
        result[key] = Decimal(str(item))
    return result


def _category(value: object) -> Category:
    try:
        return Category(_string(value, "category"))
    except ValueError as exc:
        raise AgentContractError("unsupported category") from exc


def _env_int(name: str, default: int) -> int:
    value = int(os.environ.get(name, str(default)))
    if value <= 0:
        raise AgentContractError(f"{name} must be positive")
    return value


if __name__ == "__main__":
    serve()
