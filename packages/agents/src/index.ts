/**
 * LLM 에이전트 계층.
 *
 * 경계는 하나로 정리된다: **무엇을 찾고 무엇을 쓸지는 에이전트가, 정책·상한·검증·저장은 코드가.**
 *
 * 이 패키지는 후보를 선택하지 않고 수치를 만들지 않는다 (INV-2). 만족도·승자·예산은
 * `@tm/core`가 계산하고, 에이전트는 그 결과를 **서술**한다.
 */
export {
  legacyGeminiRoles,
  conservativeRateLimits,
  defaultModels,
  freeTierModels,
  modelConfigFromEnv,
  registerFreeTierPricing,
  type LegacyGeminiRole,
  type ModelConfig,
} from './models.js';

export {
  createRateLimiter,
  RateLimitExhaustedError,
  type RateLimiter,
  type RateLimiterOptions,
  type RateLimitSnapshot,
} from './rate-limit.js';

export {
  createGeminiClient,
  LlmIncompleteError,
  LlmRequestError,
  type GeminiClientOptions,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
} from './client.js';

export {
  buildPersonaCard,
  buildPersonaFacts,
  describePersona,
  fallbackVoice,
  type PersonaCardInput,
  type PersonaFactsInput,
} from './persona.js';

export { createStubClient, type StubClient, type StubClientOptions } from './testing.js';

export {
  CodexGatewayHttpError,
  CodexGatewayResponseError,
  createCodexGatewayClient,
  type CodexGatewayClient,
  type CodexGatewayClientOptions,
} from './codex-gateway.js';

export {
  AgentRuntimeError,
  CodexGatewayAgentRuntime,
  FixtureAgentRuntime,
  type AgentRuntime,
  type CodexGatewayAgentRuntimeOptions,
} from './runtime.js';

export {
  runRound,
  toCandidateCard,
  type RefereeDeps,
  type RefereeStore,
  type RoundInput,
  type RoundOutcome,
  type RoundParticipant,
} from './referee.js';

export {
  proposeDispatch,
  type SupervisorDeps,
  type SupervisorState,
} from './supervisor.js';

export {
  draftPlan,
  type DocumentDeps,
  type DocumentDraft,
  type DocumentInput,
  type DocumentStore,
} from './document.js';

export {
  proposeSearches,
  type ProposedSearch,
  type SearchDeps,
  type SearchInput,
} from './search.js';

export { FixtureMvpAgentRuntime, type MvpAgentRuntime } from './mvp-runtime.js';
