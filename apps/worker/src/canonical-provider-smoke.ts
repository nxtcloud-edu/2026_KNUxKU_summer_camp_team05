import { FixtureAgentRuntime } from '@tm/agents';
import {
  createCandidateEvidenceExecutionPort,
  createDataAgent,
  providersFromEnv,
} from '@tm/data-agents';
import { createMemoryRepositories } from '@tm/db';
import { runCanonicalStayContractFixture } from './canonical-fixture-run.js';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
}

const setup = providersFromEnv();
if (!setup.adapters.some((adapter) => adapter.id === 'rakuten_travel')) {
  throw new Error('RAKUTEN_APPLICATION_ID와 RAKUTEN_ACCESS_KEY가 필요합니다.');
}

const repos = createMemoryRepositories();
try {
  const gateway = createDataAgent({
    cache: repos.cache,
    providers: setup.registry({
      'jp-osaka': { hotel: ['rakuten_travel'] },
    }),
  });
  const result = await runCanonicalStayContractFixture(
    new FixtureAgentRuntime(),
    createCandidateEvidenceExecutionPort(gateway),
  );
  const execution = result.providerExecution;
  if (execution === null || execution.status !== 'SUCCEEDED' || execution.candidates.length === 0) {
    throw new Error('공식 QueryPlan 경로에서 정규화 Candidate를 만들지 못했습니다.');
  }
  const providers = [...new Set(execution.receipts.map((receipt) => receipt.providerId))];
  const allUnverified = execution.candidates.every(
    (candidate) => candidate.poolEligibility === 'UNVERIFIED',
  );
  const allEvidenceUnknown = execution.evidence.every(
    (item) => item.status === 'UNKNOWN' && item.fieldStates['normalization'] === 'PASS',
  );
  if (!allUnverified || !allEvidenceUnknown) {
    throw new Error('후보 수집 결과가 검증 완료 상태로 잘못 승격되었습니다.');
  }
  console.log(JSON.stringify({
    status: 'LIVE_CANDIDATE_EVIDENCE_PATH_CLEAR',
    providerAuthentication: providers.map((providerId) => ({
      providerId,
      state: 'OBSERVED_SUCCESS_THIS_RUN',
    })),
    requestedQueryPlans: execution.requestedQueryPlans,
    executedProviderRequests: execution.executedProviderRequests,
    deduplicatedQueryPlans: execution.deduplicatedQueryPlans,
    normalizedCandidates: execution.candidates.length,
    evidenceSnapshots: execution.evidence.length,
    candidateState: 'UNVERIFIED',
    evidenceState: 'UNKNOWN',
    finalPlanState: result.finalPlan.status,
  }, null, 2));
} finally {
  await repos.close();
}
