"""DB/도메인 객체를 Agent 최소 context로 축소한다."""

from __future__ import annotations

from typing import Any

from .models import ParticipantProxyInput


def project_participant_proxy_context(source: dict[str, Any]) -> ParticipantProxyInput:
    """타인 원본, Provider 원본, credential은 읽지도 전달하지도 않는다."""
    return ParticipantProxyInput.model_validate({
        "trip_id": source["meta"]["trip_id"],
        "run_id": source["meta"]["run_id"],
        "plan_version": source["meta"]["plan_version"],
        "debate_issue_id": source["meta"]["debate_issue_id"],
        "category": source["meta"]["category"],
        "iteration": source["meta"]["iteration"],
        "participant": source["own_profile"],
        "options": source["options"],
        "evidence": source["evidence"],
    })
