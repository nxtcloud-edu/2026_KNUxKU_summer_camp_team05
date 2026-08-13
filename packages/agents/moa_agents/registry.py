"""AgentSpec, prompt, schema, Fixture 핸들러의 단일 registry."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from pydantic import BaseModel

from .handlers import (
    run_candidate_search, run_category_watcher, run_debate_supervisor,
    run_logic_auditor, run_participant_proxy, run_result_finalizer,
)
from .models import (
    AgentRole, CandidateSearchInput, CandidateSearchOutput,
    CategoryWatcherInput, CategoryWatcherOutput,
    DebateSupervisorInput, DebateSupervisorOutput,
    LogicAuditorInput, LogicAuditorOutput,
    ParticipantProxyInput, ParticipantProxyOutput,
    ResultFinalizerInput, ResultFinalizerOutput,
)
from .prompts import PROMPTS_BY_ROLE, PromptDefinition
from .specs import ALL_AGENT_SPECS, AgentSpec


@dataclass(frozen=True, slots=True)
class AgentDefinition:
    spec: AgentSpec
    prompt: PromptDefinition
    input_model: type[BaseModel]
    output_model: type[BaseModel]
    fixture_handler: Callable[[BaseModel], BaseModel]


_MODELS = {
    "PARTICIPANT_PROXY": (ParticipantProxyInput, ParticipantProxyOutput, run_participant_proxy),
    "CANDIDATE_SEARCH": (CandidateSearchInput, CandidateSearchOutput, run_candidate_search),
    "LOGIC_AUDITOR": (LogicAuditorInput, LogicAuditorOutput, run_logic_auditor),
    "CATEGORY_WATCHER": (CategoryWatcherInput, CategoryWatcherOutput, run_category_watcher),
    "DEBATE_SUPERVISOR": (DebateSupervisorInput, DebateSupervisorOutput, run_debate_supervisor),
    "RESULT_FINALIZER": (ResultFinalizerInput, ResultFinalizerOutput, run_result_finalizer),
}

AGENT_DEFINITIONS: dict[AgentRole, AgentDefinition] = {
    spec.role: AgentDefinition(
        spec=spec,
        prompt=PROMPTS_BY_ROLE[spec.role],
        input_model=_MODELS[spec.role][0],
        output_model=_MODELS[spec.role][1],
        fixture_handler=_MODELS[spec.role][2],
    )
    for spec in ALL_AGENT_SPECS
}


def get_agent_definition(role: AgentRole) -> AgentDefinition:
    try:
        return AGENT_DEFINITIONS[role]
    except KeyError as error:
        raise ValueError(f"등록되지 않은 Agent role입니다: {role}") from error
