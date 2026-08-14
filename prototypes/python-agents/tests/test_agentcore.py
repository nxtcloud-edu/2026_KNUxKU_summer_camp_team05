from __future__ import annotations

import json
import unittest
from datetime import date
from decimal import Decimal

from moa_agents.agentcore_backend import (
    AgentCoreGatewayBackend,
    AgentCoreGatewayConfig,
    GatewayTransport,
)
from moa_agents.arbitrators import StayArbiterAgent
from moa_agents.backend import JsonObject, LLMRequest, ScriptedLLMBackend, to_jsonable
from moa_agents.contracts import (
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
from moa_agents.service import run_category_payload


class RecordingTransport(GatewayTransport):
    def __init__(self, response: JsonObject) -> None:
        self.response = response
        self.calls: list[tuple[str, JsonObject, float]] = []

    def post_json(
        self,
        url: str,
        body: JsonObject,
        timeout_seconds: float,
    ) -> JsonObject:
        self.calls.append((url, body, timeout_seconds))
        return self.response


class AgentCoreBackendTests(unittest.IsolatedAsyncioTestCase):
    async def test_gateway_backend_uses_qualified_model_and_structured_output(self) -> None:
        transport = RecordingTransport(
            {
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": json.dumps({"answer": "ok"}),
                            }
                        ],
                    }
                ]
            }
        )
        backend = AgentCoreGatewayBackend(
            AgentCoreGatewayConfig(
                "https://gateway.example/mcp",
                model="openai/gpt-5.4-mini",
                timeout_seconds=12,
            ),
            transport,
        )
        response = await backend.complete_json(
            LLMRequest(
                agent_name="fixture-agent",
                system_prompt="return the schema",
                payload={"private": "payload"},
                response_schema={
                    "type": "object",
                    "properties": {"answer": {"type": "string"}},
                    "required": ["answer"],
                    "additionalProperties": False,
                },
            )
        )
        self.assertEqual(response, {"answer": "ok"})
        url, body, timeout = transport.calls[0]
        self.assertEqual(
            url,
            "https://gateway.example/inference/v1/responses",
        )
        self.assertEqual(body["model"], "openai/gpt-5.4-mini")
        self.assertEqual(body["store"], False)
        self.assertEqual(timeout, 12)
        self.assertNotIn("OPENAI_API_KEY", str(body))
        self.assertEqual(body["text"]["format"]["strict"], True)

    async def test_gateway_backend_rejects_missing_structured_output(self) -> None:
        backend = AgentCoreGatewayBackend(
            AgentCoreGatewayConfig("https://gateway.example"),
            RecordingTransport({"output": []}),
        )
        with self.assertRaises(AgentContractError):
            await backend.complete_json(
                LLMRequest(
                    agent_name="fixture-agent",
                    system_prompt="fixture",
                    payload={},
                    response_schema={"type": "object"},
                )
            )

    async def test_gateway_backend_rejects_incomplete_output_text(self) -> None:
        backend = AgentCoreGatewayBackend(
            AgentCoreGatewayConfig("https://gateway.example"),
            RecordingTransport(
                {
                    "status": "incomplete",
                    "output": [
                        {
                            "type": "message",
                            "content": [
                                {"type": "output_text", "text": '{"answer":"partial"}'}
                            ],
                        }
                    ],
                }
            ),
        )
        with self.assertRaises(AgentContractError):
            await backend.complete_json(
                LLMRequest(
                    agent_name="fixture-agent",
                    system_prompt="fixture",
                    payload={},
                    response_schema={"type": "object"},
                )
            )

    async def test_wire_payload_runs_proxy_arbiter_and_supervisor(self) -> None:
        user_id = "u1"
        charter = TripCharter(
            version="charter-v1",
            destination="osaka",
            start_date=date(2026, 9, 10),
            end_date=date(2026, 9, 12),
            participants=(user_id,),
            party_size=1,
            pace="balanced",
            budget_max_by_user={user_id: Decimal("50000")},
        )
        profile = UserProfileView(
            user_id=user_id,
            facts=(ProfileFact("u1-stay", "prefers quiet rooms", 5),),
        )
        proposal = CategoryProposal(
            proposal_id="stay-a",
            category=Category.STAY,
            proposal_set_version="set-v1",
            summary="one verified room",
            cost_by_user={user_id: Decimal("30000")},
            evidence_refs=("evidence:stay-a",),
            capacity_plan=CapacityPlan(
                requested_party_size=1,
                confirmed_capacity=1,
                allocations=(
                    CapacityAllocation("room-a", 1, (user_id,)),
                ),
                evidence_refs=("evidence:stay-a",),
            ),
        )
        arbiter = StayArbiterAgent(ScriptedLLMBackend({}))
        receipts = tuple(
            VerificationReceipt(
                receipt_id=f"receipt:{rule_id}",
                proposal_id="stay-a",
                rule_id=rule_id,
                status=VerificationStatus.PASS,
                evidence_refs=("evidence:stay-a",),
                explanation="verified fixture",
            )
            for rule_id in arbiter.policy.required_receipt_rule_ids
        )
        backend = ScriptedLLMBackend(
            {
                "user-proxy:u1": [
                    {
                        "rankedProposalIds": ["stay-a"],
                        "stances": {"stay-a": "support"},
                        "profileFactRefs": ["u1-stay"],
                        "conditionalTerms": [],
                        "rationale": "quiet room",
                    }
                ],
                "stay-arbiter": [
                    {
                        "outcome": "CONCLUDED",
                        "selectedProposalId": "stay-a",
                        "summary": "verified selection",
                        "unresolvedIssues": [],
                        "obligationsForNextCategory": [],
                        "blockReason": None,
                    }
                ],
                "trip-supervisor": [
                    {
                        "guardStatus": "CLEAR",
                        "observedSelectedProposalId": "stay-a",
                        "findings": [],
                        "recheckTargets": [],
                        "summary": "clear",
                    }
                ],
            }
        )
        raw_payload = {
            "charter": to_jsonable(charter),
            "profiles": to_jsonable((profile,)),
            "category": "stay",
            "proposals": to_jsonable((proposal,)),
            "receipts": to_jsonable(receipts),
            "selection": to_jsonable(DeterministicSelection("stay-a")),
            "prior_obligations": [],
        }
        result = await run_category_payload(raw_payload, backend)
        self.assertEqual(result["draft"]["outcome"], "CONCLUDED")
        self.assertEqual(result["draft"]["selected_proposal_id"], "stay-a")
        self.assertEqual(result["supervisor_report"]["guard_status"], "CLEAR")


if __name__ == "__main__":
    unittest.main()
