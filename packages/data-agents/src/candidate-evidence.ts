import { createHash } from 'node:crypto';
import {
  QuotaExceededError,
  VerificationUnavailableError,
  candidateEvidenceQueryPlanSchema,
  candidateRecordSchema,
  evidenceSnapshotSchema,
  tripCharterSchema,
  type AgentCategory,
  type CandidateEvidenceQueryPlan,
  type CandidateRecord,
  type DataRequest,
  type EvidenceSnapshot,
  type TripCharter,
} from '@tm/contracts';
import { assertAgentContextSafe } from '@tm/core';
import { canonicalize } from './canonical.js';
import {
  candidateEvidenceQueryPolicyIssue,
  type CandidateEvidenceQueryPolicyIssueCode,
} from './candidate-evidence-query-policy.js';
import type { DataAgentGateway } from './gateway.js';
import { extractCandidates } from './prefetch.js';
import { ProviderError } from './provider.js';

export type CandidateEvidenceExecutionFailureCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'QUOTA_EXCEEDED'
  | 'VERIFICATION_UNAVAILABLE'
  | 'GATEWAY_FAILED';

export interface CandidateEvidenceExecutionFailure {
  queryPlanIds: string[];
  code: CandidateEvidenceExecutionFailureCode;
  message: string;
}

export interface CandidateEvidenceExecutionReceipt {
  queryPlanIds: string[];
  sourceBriefIds: string[];
  requestId: string;
  status: 'SUCCEEDED' | 'NO_CANDIDATES';
  providerId: string;
  candidateIds: string[];
  evidenceIds: string[];
  cacheHit: boolean;
}

export interface CandidateEvidenceExecutionResult {
  status: 'SUCCEEDED' | 'PARTIAL' | 'NO_CANDIDATES' | 'FAILED';
  requestedQueryPlans: number;
  executedProviderRequests: number;
  deduplicatedQueryPlans: number;
  candidates: CandidateRecord[];
  evidence: EvidenceSnapshot[];
  receipts: CandidateEvidenceExecutionReceipt[];
  failures: CandidateEvidenceExecutionFailure[];
}

export interface CandidateEvidenceExecutionInput {
  runId: string;
  tripId: string;
  inputVersion: number;
  searchAttempt: 0 | 1;
  packId: string;
  category: AgentCategory;
  charter: TripCharter;
  queryPlans: readonly CandidateEvidenceQueryPlan[];
  expectedBriefIds: readonly string[];
  queryBudget: number;
  area: string;
  center: { lat: number; lng: number };
  roomCount: number;
  limit: number;
  searchRadiusKm: number;
}

export interface CandidateEvidenceExecutionPort {
  execute(input: CandidateEvidenceExecutionInput): Promise<CandidateEvidenceExecutionResult>;
}

export type CandidateEvidenceExecutionErrorCode =
  | CandidateEvidenceQueryPolicyIssueCode
  | 'INVALID_INPUT'
  | 'QUERY_BUDGET_EXCEEDED'
  | 'SENSITIVE_CONTEXT'
  | 'UNAPPROVED_RELAXATION'
  | 'HARD_CONTEXT_OVERRIDE'
  | 'UNSUPPORTED_QUERY_PLAN';

export class CandidateEvidenceExecutionError extends Error {
  constructor(
    readonly code: CandidateEvidenceExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CandidateEvidenceExecutionError';
  }
}

interface BoundPlan {
  plan: CandidateEvidenceQueryPlan;
  params: Record<string, unknown>;
}

interface BoundPlanGroup {
  plans: CandidateEvidenceQueryPlan[];
  params: Record<string, unknown>;
  providerOrder: string[];
}

const CONTROLLER_OWNED_PARAMS: Record<string, keyof Pick<
  CandidateEvidenceExecutionInput,
  'packId' | 'roomCount'
> | 'partySize' | 'startDate' | 'endDate' | 'latitude' | 'longitude'> = {
  packId: 'packId',
  guests: 'partySize',
  pax: 'partySize',
  adultNum: 'partySize',
  rooms: 'roomCount',
  roomNum: 'roomCount',
  checkIn: 'startDate',
  checkinDate: 'startDate',
  checkOut: 'endDate',
  checkoutDate: 'endDate',
  latitude: 'latitude',
  lat: 'latitude',
  longitude: 'longitude',
  lng: 'longitude',
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function stableId(prefix: string, parts: readonly string[]): string {
  const digest = createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
  return `${prefix}:${digest}`;
}

function controllerValue(
  key: (typeof CONTROLLER_OWNED_PARAMS)[string],
  input: CandidateEvidenceExecutionInput,
  charter: TripCharter,
): string | number {
  if (key === 'partySize') return charter.partySize;
  if (key === 'startDate') return charter.startDate;
  if (key === 'endDate') return charter.endDate;
  if (key === 'latitude') return input.center.lat;
  if (key === 'longitude') return input.center.lng;
  return input[key];
}

function matchesControllerValue(value: unknown, expected: string | number): boolean {
  if (typeof expected === 'number') return Number(value) === expected;
  return value === expected;
}

function validateInput(input: CandidateEvidenceExecutionInput): TripCharter {
  const charter = tripCharterSchema.parse(input.charter);
  if (
    input.runId.trim().length === 0 ||
    input.tripId.trim().length === 0 ||
    input.packId.trim().length === 0 ||
    input.area.trim().length === 0 ||
    !Number.isInteger(input.inputVersion) ||
    input.inputVersion < 0 ||
    !Number.isInteger(input.roomCount) ||
    input.roomCount < 1 ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 20 ||
    !Number.isFinite(input.center.lat) ||
    !Number.isFinite(input.center.lng) ||
    !Number.isFinite(input.searchRadiusKm) ||
    input.searchRadiusKm < 0.1 ||
    input.searchRadiusKm > 3
  ) {
    throw new CandidateEvidenceExecutionError('INVALID_INPUT', 'Provider 실행 context가 유효하지 않습니다.');
  }
  if (
    !Number.isInteger(input.queryBudget) ||
    input.queryBudget < 1 ||
    input.queryBudget > 4 ||
    input.queryPlans.length > input.queryBudget
  ) {
    throw new CandidateEvidenceExecutionError(
      'QUERY_BUDGET_EXCEEDED',
      'CandidateEvidence QueryPlan 호출 예산을 초과했습니다.',
    );
  }
  if (input.queryPlans.length === 0) {
    throw new CandidateEvidenceExecutionError('INVALID_INPUT', '실행할 QueryPlan이 없습니다.');
  }
  return charter;
}

function bindStayPlan(
  rawPlan: CandidateEvidenceQueryPlan,
  input: CandidateEvidenceExecutionInput,
  charter: TripCharter,
): BoundPlan {
  const plan = candidateEvidenceQueryPlanSchema.parse(rawPlan);
  try {
    assertAgentContextSafe(plan);
  } catch {
    throw new CandidateEvidenceExecutionError(
      'SENSITIVE_CONTEXT',
      'QueryPlan에는 API Key, 인증정보 또는 Provider 원문을 포함할 수 없습니다.',
    );
  }
  if (plan.category !== input.category || plan.category !== 'stay' || plan.queryClass !== 'hotel.search') {
    throw new CandidateEvidenceExecutionError(
      'UNSUPPORTED_QUERY_PLAN',
      '현재 제품 연결은 stay의 hotel.search만 지원합니다.',
    );
  }
  if (plan.relaxationChanges.length > 0) {
    throw new CandidateEvidenceExecutionError(
      'UNAPPROVED_RELAXATION',
      '승인 정보가 없는 조건 완화 QueryPlan은 실행할 수 없습니다.',
    );
  }
  for (const [paramName, inputKey] of Object.entries(CONTROLLER_OWNED_PARAMS)) {
    const value = plan.params[paramName];
    if (
      value !== undefined &&
      !matchesControllerValue(value, controllerValue(inputKey, input, charter))
    ) {
      throw new CandidateEvidenceExecutionError(
        'HARD_CONTEXT_OVERRIDE',
        `QueryPlan이 RunController 소유 파라미터를 변경했습니다: ${paramName}`,
      );
    }
  }

  const params = Object.fromEntries(
    Object.entries(plan.params).filter(
      ([key]) => CONTROLLER_OWNED_PARAMS[key] === undefined && key !== 'searchAttempt',
    ),
  );
  const area = typeof params['area'] === 'string' && params['area'].trim().length > 0
    ? params['area'].trim()
    : input.area;
  const type = typeof params['type'] === 'string' && params['type'].trim().length > 0
    ? params['type'].trim()
    : 'hotel';
  return {
    plan,
    params: {
      ...params,
      packId: input.packId,
      area,
      type,
      guests: charter.partySize,
      pax: charter.partySize,
      adultNum: charter.partySize,
      rooms: input.roomCount,
      roomNum: input.roomCount,
      checkIn: charter.startDate,
      checkinDate: charter.startDate,
      checkOut: charter.endDate,
      checkoutDate: charter.endDate,
      latitude: input.center.lat,
      longitude: input.center.lng,
      searchRadius: input.searchRadiusKm,
      limit: input.limit,
    },
  };
}

function groupBoundPlans(boundPlans: readonly BoundPlan[]): BoundPlanGroup[] {
  const groups = new Map<string, BoundPlanGroup>();
  for (const bound of boundPlans) {
    const providerOrder = [...bound.plan.providerOrder];
    const key = JSON.stringify([
      bound.plan.queryClass,
      providerOrder,
      canonicalize(bound.params),
    ]);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { plans: [bound.plan], params: bound.params, providerOrder });
    } else {
      existing.plans.push(bound.plan);
    }
  }
  return [...groups.values()];
}

function titleOf(candidate: ReturnType<typeof extractCandidates>[number]['payload']): string {
  const record = candidate as Record<string, unknown>;
  if (typeof record['name'] === 'string') return record['name'];
  if (typeof record['label'] === 'string') return record['label'];
  const outbound = record['outbound'];
  if (typeof outbound === 'object' && outbound !== null) {
    const carrier = (outbound as Record<string, unknown>)['carrier'];
    if (typeof carrier === 'object' && carrier !== null) {
      const name = (carrier as Record<string, unknown>)['name'];
      if (typeof name === 'string') return name;
    }
  }
  return '정규화 후보';
}

function sourceUrlOf(candidate: Record<string, unknown>): string | null {
  const value = candidate['bookingUrl'];
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function failureOf(
  queryPlanIds: string[],
  error: unknown,
): CandidateEvidenceExecutionFailure {
  if (error instanceof QuotaExceededError) {
    return {
      queryPlanIds,
      code: 'QUOTA_EXCEEDED',
      message: 'Provider 호출 예산을 초과해 남은 QueryPlan 실행을 중단했습니다.',
    };
  }
  if (error instanceof VerificationUnavailableError) {
    return {
      queryPlanIds,
      code: 'VERIFICATION_UNAVAILABLE',
      message: '필수 검증 Provider 응답을 얻지 못했습니다.',
    };
  }
  if (error instanceof ProviderError) {
    return {
      queryPlanIds,
      code: 'PROVIDER_UNAVAILABLE',
      message: '승인된 Provider에서 응답을 얻지 못했습니다.',
    };
  }
  return {
    queryPlanIds,
    code: 'GATEWAY_FAILED',
    message: 'Provider Gateway 실행에 실패했습니다.',
  };
}

export function createCandidateEvidenceExecutionPort(
  gateway: DataAgentGateway,
): CandidateEvidenceExecutionPort {
  return {
    async execute(input) {
      const charter = validateInput(input);
      const plans = input.queryPlans.map((plan) => candidateEvidenceQueryPlanSchema.parse(plan));
      const policyIssue = candidateEvidenceQueryPolicyIssue(plans, input.expectedBriefIds);
      if (policyIssue !== null) {
        throw new CandidateEvidenceExecutionError(policyIssue.code, policyIssue.message);
      }
      const boundPlans = plans.map((plan) => bindStayPlan(plan, input, charter));
      const groups = groupBoundPlans(boundPlans);
      const candidateMap = new Map<string, CandidateRecord>();
      const evidence: EvidenceSnapshot[] = [];
      const receipts: CandidateEvidenceExecutionReceipt[] = [];
      const failures: CandidateEvidenceExecutionFailure[] = [];
      let attemptedProviderRequests = 0;

      for (const [index, group] of groups.entries()) {
        const queryPlanIds = group.plans.map((plan) => plan.queryPlanId);
        const sourceBriefIds = unique(group.plans.flatMap((plan) => plan.sourceBriefIds));
        const requestId = `ce:${input.runId}:${input.category}:${input.searchAttempt}:${index + 1}`;
        const request: DataRequest = {
          requestId,
          runId: input.runId,
          roundId: `candidate-evidence:${input.category}:${input.inputVersion}:${input.searchAttempt}`,
          callerId: 'run-controller:candidate-evidence',
          queryClass: group.plans[0]?.queryClass ?? 'hotel.search',
          purpose: 'exploration',
          packId: input.packId,
          providerOrder: group.providerOrder,
          params: group.params,
        };

        attemptedProviderRequests += 1;
        try {
          const response = await gateway.resolve(request);
          const normalized = extractCandidates(response.payload, response.evidence.source);
          const groupEvidenceIds: string[] = [];
          const groupCandidateIds: string[] = [];

          if (normalized.length === 0) {
            for (const plan of group.plans) {
              const evidenceId = stableId('evidence', [
                plan.queryPlanId,
                response.evidence.source,
                'no-candidate',
              ]);
              evidence.push(evidenceSnapshotSchema.parse({
                schemaVersion: 1,
                evidenceId,
                queryPlanId: plan.queryPlanId,
                providerId: response.evidence.source,
                providerCandidateId: null,
                sourceUrl: null,
                retrievedAt: response.evidence.retrievedAt,
                validUntil: response.evidence.validUntil,
                confidence: response.evidence.confidence,
                status: 'UNKNOWN',
                termsRef: response.evidence.termsRef || 'provider-terms-unavailable',
                fieldStates: { normalization: 'UNKNOWN', verification: 'UNKNOWN' },
              }));
              groupEvidenceIds.push(evidenceId);
            }
          } else {
            for (const normalizedCandidate of normalized) {
              const payload = normalizedCandidate.payload as Record<string, unknown>;
              const candidateId = stableId('candidate', [
                response.evidence.source,
                normalizedCandidate.externalId,
              ]);
              const candidateEvidenceIds: string[] = [];
              for (const plan of group.plans) {
                const evidenceId = stableId('evidence', [
                  plan.queryPlanId,
                  response.evidence.source,
                  normalizedCandidate.externalId,
                ]);
                evidence.push(evidenceSnapshotSchema.parse({
                  schemaVersion: 1,
                  evidenceId,
                  queryPlanId: plan.queryPlanId,
                  providerId: response.evidence.source,
                  providerCandidateId: normalizedCandidate.externalId,
                  sourceUrl: sourceUrlOf(payload),
                  retrievedAt: response.evidence.retrievedAt,
                  validUntil: response.evidence.validUntil,
                  confidence: response.evidence.confidence,
                  status: 'UNKNOWN',
                  termsRef: response.evidence.termsRef || 'provider-terms-unavailable',
                  fieldStates: { normalization: 'PASS', verification: 'UNKNOWN' },
                }));
                candidateEvidenceIds.push(evidenceId);
                groupEvidenceIds.push(evidenceId);
              }

              const disqualified = payload['disqualified'] === true;
              const disqualifyReason = typeof payload['disqualifyReason'] === 'string'
                ? payload['disqualifyReason']
                : null;
              const next = candidateRecordSchema.parse({
                schemaVersion: 1,
                candidateId,
                category: input.category,
                sourceBriefIds,
                providerId: response.evidence.source,
                providerCandidateId: normalizedCandidate.externalId,
                title: titleOf(normalizedCandidate.payload),
                sourceMode: response.evidence.confidence,
                poolEligibility: disqualified ? 'BLOCKED' : 'UNVERIFIED',
                exclusionReasons: disqualifyReason === null ? [] : [disqualifyReason],
                evidenceIds: candidateEvidenceIds,
                payload,
              });
              const existing = candidateMap.get(candidateId);
              candidateMap.set(
                candidateId,
                existing === undefined
                  ? next
                  : candidateRecordSchema.parse({
                      ...existing,
                      sourceBriefIds: unique([...existing.sourceBriefIds, ...next.sourceBriefIds]),
                      evidenceIds: unique([...existing.evidenceIds, ...next.evidenceIds]),
                      poolEligibility:
                        existing.poolEligibility === 'BLOCKED' || next.poolEligibility === 'BLOCKED'
                          ? 'BLOCKED'
                          : 'UNVERIFIED',
                      exclusionReasons: unique([
                        ...existing.exclusionReasons,
                        ...next.exclusionReasons,
                      ]),
                    }),
              );
              groupCandidateIds.push(candidateId);
            }
          }

          receipts.push({
            queryPlanIds,
            sourceBriefIds,
            requestId,
            status: normalized.length === 0 ? 'NO_CANDIDATES' : 'SUCCEEDED',
            providerId: response.evidence.source,
            candidateIds: unique(groupCandidateIds),
            evidenceIds: unique(groupEvidenceIds),
            cacheHit: response.evidence.cacheHit,
          });
        } catch (error) {
          failures.push(failureOf(queryPlanIds, error));
          if (error instanceof QuotaExceededError) break;
        }
      }

      const candidates = [...candidateMap.values()];
      const status = failures.length > 0
        ? receipts.length > 0
          ? 'PARTIAL'
          : 'FAILED'
        : candidates.length > 0
          ? 'SUCCEEDED'
          : 'NO_CANDIDATES';
      return {
        status,
        requestedQueryPlans: plans.length,
        executedProviderRequests: attemptedProviderRequests,
        deduplicatedQueryPlans: plans.length - groups.length,
        candidates,
        evidence,
        receipts,
        failures,
      };
    },
  };
}
