import { documentGate, runValidationPass, type ItineraryItem, type ValidationReport } from '@tm/core';
import type { Repositories } from '@tm/db';
import {
  stateCeilingForRound,
  type RoundStateEvidence,
} from './state-ceiling.js';

/**
 * 계획서 발행 — 마무리 에이전트가 붙는 자리.
 *
 * 역할 분리가 핵심이다:
 *   에이전트   무엇을 어떤 순서로 담을지 정하고 문장을 쓴다
 *   코드       조달 근거 대조 · 예산 정합성 · 일정 실현 가능성 · fail-closed 검증,
 *              그리고 **발행 여부 판정**
 *
 * 문서 에이전트에 검증을 맡기지 않는다. 환각·모순·실현 불가능은 기계 판정이어야 하고,
 * 에이전트는 **검증된 사실을 서술**하는 역할이다 (agent-architecture.md 9.1).
 */

export interface PlanDraft {
  /** 검증 대상 항목. 계획서에 실린 모든 것이 조달된 후보를 참조해야 한다 */
  items: ItineraryItem[];
  budget: {
    declaredTotalPerPersonKrw: number;
    /** 그룹 상한 = 최저 예산 참여자의 상한 (기획서 8.4) */
    groupCapPerPersonKrw: number;
  };
  /** 계획서 본문. 형식은 문서 에이전트가 정한다 */
  plan: unknown;
  budgetSummary?: unknown;
}

/** 마무리 에이전트가 구현한다. 없으면 계획서를 만들지 않는다 */
export interface DocumentPort {
  draft(input: { runId: string; roomId: string }): Promise<PlanDraft | null>;
}

export interface FinalizeResult {
  itineraryId: string | null;
  /** VERIFIED만 예약 행동을 유도할 수 있다. PARTIAL은 표기만 한다 */
  badge: 'VERIFIED' | 'PROVISIONAL' | 'PARTIAL' | 'NONE';
  published: boolean;
  report: ValidationReport | null;
  reason: string | null;
}

/**
 * 초안을 검증하고 계획서를 저장한다.
 *
 * 검증에 실패해도 **저장은 한다.** 사용자가 아무것도 못 받는 것보다 "이 항목은 확인하지
 * 못했습니다"가 붙은 부분 계획서를 받는 편이 낫다. 다만 발행(publish)은 하지 않는다 —
 * PARTIAL은 예약 행동을 유도하지 않는다 (테스트 A20).
 */
export async function finalizeRun(
  repos: Repositories,
  input: {
    runId: string;
    roomId: string;
    draft: PlanDraft | null;
    evidenceState: RoundStateEvidence;
  },
): Promise<FinalizeResult> {
  if (input.draft === null) {
    return {
      itineraryId: null,
      badge: 'NONE',
      published: false,
      report: null,
      reason: '문서 생성 에이전트가 아직 없어 계획서를 만들지 못했습니다.',
    };
  }

  // 조달 근거의 원본은 candidates 테이블이다. 에이전트가 준 목록을 믿지 않는다.
  const sourcedExternalIds = await repos.candidates.sourcedExternalIds(input.runId);
  const report = runValidationPass({
    items: input.draft.items,
    sourcedExternalIds,
    budget: input.draft.budget,
  });
  const gate = documentGate(report);
  const evidenceCeiling = stateCeilingForRound(input.evidenceState);
  const publishAllowed = gate.allowed && evidenceCeiling.status === 'VERIFIED';

  const itinerary = await repos.itineraries.save({
    roomId: input.roomId,
    runId: input.runId,
    plan: input.draft.plan,
    ...(input.draft.budgetSummary === undefined ? {} : { budgetSummary: input.draft.budgetSummary }),
    validationReport: { ...report, evidenceState: evidenceCeiling },
  });

  if (publishAllowed) await repos.itineraries.publish(itinerary.itineraryId);

  return {
    itineraryId: itinerary.itineraryId,
    badge: gate.allowed ? (publishAllowed ? 'VERIFIED' : 'PROVISIONAL') : 'PARTIAL',
    published: publishAllowed,
    report,
    reason: gate.allowed && !publishAllowed
      ? '문서 검증은 통과했지만 LIVE 검증 영수증이 없어 PROVISIONAL입니다.'
      : gate.reason,
  };
}
