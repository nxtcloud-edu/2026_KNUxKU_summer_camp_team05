import {
  capacityPlanSchema,
  neutralSearchBriefSchema,
  proposalEvaluationSchema,
  type CandidateRecord,
  type CategoryProposalSet,
  type EvidenceSnapshot,
  type ProposalEvaluation,
  type TripCharter,
  type UserProxyProfileView,
} from '@tm/contracts';
import {
  CandidatePoolBuildError,
  buildCandidatePoolVersion,
  buildStayCategoryProposalSet,
  stayProposalId,
  validateStayCandidate,
} from '@tm/core';
import {
  buildStructuredSearchContext,
  loadPackKnowledge,
  toCandidateEvidenceExecutionContext,
  type PackKnowledgeSource,
} from '@tm/data-agents';
import type {
  CandidateValidationPort,
  ProposalSetPort,
  StructuredSearchPort,
} from './canonical-live-run.js';

type CapacityPlan = ReturnType<typeof capacityPlanSchema.parse>;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function createB1StructuredSearchPort(
  packSource: PackKnowledgeSource,
): StructuredSearchPort {
  return {
    async build({ room, charter, briefs, profiles }) {
      const knowledge = await loadPackKnowledge(packSource, room.packId);
      const neutralBrief = neutralSearchBriefSchema.parse({
        schemaVersion: 1,
        briefId: `brief:neutral:${room.category}:${charter.charterVersion}`,
        category: room.category,
        charterVersion: charter.charterVersion,
        hardConstraintRefs: uniqueSorted([
          'charter:party-size',
          'charter:participant-budget',
          ...briefs.flatMap((brief) => brief.mustKeepRefs),
        ]),
        searchTerms: [`${room.destination} ${charter.partySize}명 숙소`],
      });
      const context = buildStructuredSearchContext({
        category: room.category,
        charter,
        proxyBriefs: briefs,
        neutralBrief,
        participantProfiles: profiles,
        knowledge,
      });
      const execution = toCandidateEvidenceExecutionContext(context);
      const hardConstraints = [
        ...context.intent.hard.requiredAmenities.map((constraint) => ({
          constraintId: `constraint:required:${constraint.token}`,
          kind: 'REQUIRED_ATTRIBUTE' as const,
          attribute: constraint.token,
        })),
        ...context.intent.hard.forbiddenTraits.map((constraint) => ({
          constraintId: `constraint:forbidden:${constraint.token}`,
          kind: 'FORBIDDEN_ATTRIBUTE' as const,
          attribute: constraint.token,
        })),
      ];
      return {
        neutralBrief,
        availableProviderIds: [...context.allowedProviderIds],
        providerExecution: {
          packId: execution.packId,
          area: execution.area,
          center: execution.center,
          roomCount: execution.roomCount,
          limit: execution.limit,
          searchRadiusKm: execution.searchRadiusKm,
          queryBudget: execution.queryBudget,
        },
        hardConstraints,
        allowedRoomSplitAuthorityRefs: [],
        representativeBriefIdByParticipantId: Object.fromEntries(
          briefs.map((brief) => [brief.participantId, brief.briefId]),
        ),
      };
    },
  };
}

export interface StayCapacityProjectionInput {
  candidate: CandidateRecord;
  evidence: readonly EvidenceSnapshot[];
  charter: TripCharter;
}

export interface B4CandidateValidationOptions {
  capacityPlanForCandidate(
    input: StayCapacityProjectionInput,
  ): CapacityPlan | null | Promise<CapacityPlan | null>;
  now?: () => Date;
}

export function createB4CandidateValidationPort(
  options: B4CandidateValidationOptions,
): CandidateValidationPort {
  const now = options.now ?? (() => new Date());
  return {
    async validate({ runId, charter, execution, searchContext }) {
      const checkedAt = now().toISOString();
      const validations = await Promise.all(
        execution.candidates.map(async (candidate) => {
          const candidateEvidence = execution.evidence.filter((item) =>
            candidate.evidenceIds.includes(item.evidenceId),
          );
          const capacityPlan = await options.capacityPlanForCandidate({
            candidate,
            evidence: candidateEvidence,
            charter,
          });
          return validateStayCandidate({
            proposalId: stayProposalId(candidate.candidateId, 1),
            candidate,
            evidence: candidateEvidence,
            charter,
            capacityPlan,
            hardConstraints: searchContext.hardConstraints,
            allowedRoomSplitAuthorityRefs: searchContext.allowedRoomSplitAuthorityRefs,
            checkedAt,
          });
        }),
      );
      const candidates = validations.map((validation) => validation.candidate);
      const receipts = validations.flatMap((validation) => validation.receipts);
      if (!validations.some((validation) => validation.eligibility === 'ELIGIBLE')) {
        return {
          status: 'BLOCKED',
          candidatePool: null,
          candidates,
          evidence: [...execution.evidence],
          receipts,
          validations,
          reason: '검증 영수증이 모두 PASS인 숙소 후보가 없습니다.',
        };
      }
      try {
        const candidatePool = buildCandidatePoolVersion({
          poolId: `pool:${runId}:stay:1`,
          version: 1,
          charter,
          validations,
          representativeBriefIdByParticipantId: searchContext.representativeBriefIdByParticipantId,
          neutralBriefIds: [searchContext.neutralBrief.briefId],
          createdAt: checkedAt,
        }).pool;
        return {
          status: 'READY',
          candidatePool,
          candidates,
          evidence: [...execution.evidence],
          receipts,
          validations,
          reason: null,
        };
      } catch (error) {
        if (!(error instanceof CandidatePoolBuildError)) throw error;
        return {
          status: 'BLOCKED',
          candidatePool: null,
          candidates,
          evidence: [...execution.evidence],
          receipts,
          validations,
          reason: error.message,
        };
      }
    },
  };
}

export interface ProposalEvaluationInput {
  profile: UserProxyProfileView;
  proposalSet: CategoryProposalSet;
  evidence: readonly EvidenceSnapshot[];
}

export interface B4ProposalSetOptions {
  evaluate(input: ProposalEvaluationInput):
    | readonly ProposalEvaluation[]
    | Promise<readonly ProposalEvaluation[]>;
  now?: () => Date;
}

export function createB4ProposalSetPort(options: B4ProposalSetOptions): ProposalSetPort {
  const now = options.now ?? (() => new Date());
  return {
    async create({ runId, profiles, candidatePool, evidence, validations }) {
      const proposalSet = buildStayCategoryProposalSet({
        proposalSetId: `proposal-set:${runId}:stay:1`,
        proposalSetVersion: 1,
        pool: candidatePool,
        validations,
        sealedAt: now().toISOString(),
      });
      const entries = await Promise.all(
        profiles.map(async (profile) => {
          const evaluations = (await options.evaluate({ profile, proposalSet, evidence })).map(
            (evaluation) => proposalEvaluationSchema.parse(evaluation),
          );
          const expected = proposalSet.proposals.map((proposal) => proposal.proposalId).sort();
          const actual = evaluations.map((evaluation) => evaluation.proposalId).sort();
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`${profile.participantId}의 평가는 sealed ProposalSet 전체를 포함해야 합니다.`);
          }
          return [profile.participantId, evaluations] as const;
        }),
      );
      return {
        proposalSet,
        evaluationsByParticipantId: Object.fromEntries(entries),
      };
    },
  };
}
