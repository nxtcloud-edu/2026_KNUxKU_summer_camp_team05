"""MOA 역할별 Agent 패키지."""

from .fixtures import DEMO_CANDIDATE_SEARCH_INPUT, DEMO_FINALIZER_INPUT, DEMO_PROXY_INPUTS
from .projections import project_participant_proxy_context
from .registry import AGENT_DEFINITIONS, get_agent_definition
from .runtime import CodexAgentRuntime, CodexGatewayClient, FixtureAgentRuntime, require_agent_output
from .simulator import run_demo_debate
from .specs import ALL_AGENT_SPECS

__all__ = [
    "AGENT_DEFINITIONS",
    "ALL_AGENT_SPECS",
    "CodexAgentRuntime",
    "CodexGatewayClient",
    "DEMO_CANDIDATE_SEARCH_INPUT",
    "DEMO_FINALIZER_INPUT",
    "DEMO_PROXY_INPUTS",
    "FixtureAgentRuntime",
    "get_agent_definition",
    "project_participant_proxy_context",
    "require_agent_output",
    "run_demo_debate",
]
