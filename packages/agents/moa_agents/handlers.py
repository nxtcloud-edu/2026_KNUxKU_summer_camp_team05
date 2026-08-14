"""LLM 없이 계약과 전달 순서를 검증하는 결정론적 Fixture 핸들러."""

from __future__ import annotations

import re

from .models import (
    CandidateSearchInput,
    CandidateSearchOutput,
    CategoryWatcherInput,
    CategoryWatcherOutput,
    DebateAction,
    DebateSupervisorInput,
    DebateSupervisorOutput,
    ItineraryOutputItem,
    LogicAuditorInput,
    LogicAuditorOutput,
    ParticipantOutcome,
    ParticipantProxyInput,
    ParticipantProxyOutput,
    ProofArgument,
    ProofReview,
    ProxyVote,
    Concession,
    ResultFinalizerInput,
    ResultFinalizerOutput,
    SearchQueryPlan,
)


_UNSAFE_RELAXATION_TERMS = (
    "allergy", "allergen", "health", "safety", "accessibility", "wheelchair",
    "mandatory", "hard constraint", "\uc54c\ub808\ub974\uae30", "\uac74\uac15", "\uc548\uc804",
    "\uc811\uadfc\uc131", "\ud720\uccb4\uc5b4", "\uc720\ubaa8\ucc28", "\ud544\uc218", "\uc808\ub300 \uc870\uac74",
)


def _contains_unsafe_relaxation(value: str) -> bool:
    normalized = value.casefold()
    return any(term in normalized for term in _UNSAFE_RELAXATION_TERMS)


def run_participant_proxy(data: ParticipantProxyInput) -> ParticipantProxyOutput:
    participant = data.participant
    eligible = [
        option for option in data.options
        if option.validation_status == "VERIFIED" and option.hard_constraints_satisfied
    ]
    if not eligible:
        raise ValueError("Participant Proxy received no VERIFIED, hard-safe proposal.")
    ranked = sorted(
        eligible,
        key=lambda option: (-option.participant_satisfaction_bp.get(participant.participant_id, 0), option.proposal_id),
    )
    preferred = ranked[0]
    satisfaction = preferred.participant_satisfaction_bp.get(participant.participant_id, 0)
    missing_objectives = [
        objective_id
        for objective_id in participant.protected_objective_ids
        if objective_id not in preferred.protected_objective_ids_satisfied
    ]
    hard_failure = not preferred.hard_constraints_satisfied
    below_floor = satisfaction < 5_000 and participant.goal_mode == "CONTENT_IS_GOAL"

    if hard_failure:
        decision, reason = "OPPOSE", "HARD_CONSTRAINT"
    elif missing_objectives:
        decision, reason = "USER_CONFIRMATION_REQUIRED", "PROTECTED_OBJECTIVE"
    elif below_floor:
        decision, reason = "OPPOSE", "MIN_SATISFACTION"
    elif satisfaction >= 7_000:
        decision, reason = "SUPPORT", "NONE"
    else:
        decision, reason = "ACCEPTABLE", "NONE"

    five_point_ids = [item.preference_id for item in participant.preferences if item.importance == 5]
    affected = missing_objectives if missing_objectives else (five_point_ids if decision == "OPPOSE" else [])
    return ParticipantProxyOutput(
        role="PARTICIPANT_PROXY",
        preferred_proposal_id=preferred.proposal_id,
        vote=ProxyVote(
            participant_id=participant.participant_id,
            proposal_id=preferred.proposal_id,
            decision=decision,
            reason_code=reason,
            affected_preference_ids=affected,
            evidence_ids=preferred.evidence_ids,
            explanation=f"{preferred.summary}의 계산된 만족도는 {satisfaction}bp이며 필수조건 충족 여부는 {preferred.hard_constraints_satisfied}입니다.",
        ),
        concession=Concession(
            allowed=decision in {"SUPPORT", "ACCEPTABLE"},
            preference_ids=[item.preference_id for item in participant.preferences if item.importance < 5],
            condition="5점 선호와 보호 목적을 유지하는 범위에서 양보 가능" if decision == "ACCEPTABLE" else None,
        ),
        argument=ProofArgument(
            argument_id=f"{data.run_id}:argument",
            actor_agent_run_id=data.run_id,
            premise_fact_ids=[f"fact:{evidence_id}" for evidence_id in preferred.evidence_ids],
            rule_id=("rule.hard-constraint" if hard_failure else "rule.protected-objective" if missing_objectives else "rule.preference-score"),
            claimed_participant_id=participant.participant_id,
            claimed_proposal_id=preferred.proposal_id,
            claimed_decision=decision,
            conclusion=f"{participant.participant_id}는 {preferred.proposal_id}에 대해 {decision}한다.",
            evidence_ids=preferred.evidence_ids,
        ),
    )


def run_candidate_search(data: CandidateSearchInput) -> CandidateSearchOutput:
    unsafe = any(re.search(r"알레르기|건강|접근성|필수", value, re.IGNORECASE) for value in data.allowed_relaxations)
    unsafe = any(_contains_unsafe_relaxation(value) for value in data.allowed_relaxations)
    terms = [term.strip() for term in data.unresolved_free_text if term.strip()]
    if not terms or unsafe:
        return CandidateSearchOutput(
            role="CANDIDATE_SEARCH",
            status="NO_SAFE_QUERY",
            query_plans=[],
            warning="필수·안전 조건을 완화하는 검색은 생성하지 않았습니다." if unsafe else "구조화할 자유 입력이 없습니다.",
        )
    keywords = list(dict.fromkeys([data.category, *terms]))
    return CandidateSearchOutput(
        role="CANDIDATE_SEARCH",
        status="QUERY_PLAN_PROPOSED",
        query_plans=[SearchQueryPlan(
            query_id=f"{data.run_id}:query:1",
            keywords=keywords,
            filters=data.canonical_constraints,
            relaxation_changes=data.allowed_relaxations[:1],
            rationale=f"{data.shortage_reason} 상태의 자유 입력을 Data Gateway 검색으로 정규화합니다.",
        )],
        warning=None,
    )


def run_logic_auditor(data: LogicAuditorInput) -> LogicAuditorOutput:
    facts = {item.fact_id: item for item in data.facts}
    rules = {item.rule_id for item in data.rules}
    evidence = {item.evidence_id: item for item in data.evidence}
    expected_votes = {
        (item.participant_id, item.proposal_id, item.decision)
        for item in data.expected_votes
    }
    reviews: list[ProofReview] = []
    requested_evidence: list[str] = []
    for argument in data.arguments:
        issues: list[str] = []
        if any(fact_id not in facts for fact_id in argument.premise_fact_ids):
            issues.append("MISSING_FACT")
        for fact_id in argument.premise_fact_ids:
            fact = facts.get(fact_id)
            if fact is not None and not set(fact.evidence_ids) <= set(argument.evidence_ids):
                issues.append("MISSING_EVIDENCE")
        if argument.rule_id not in rules:
            issues.append("UNKNOWN_RULE")
        missing_evidence_ids: list[str] = []
        for evidence_id in argument.evidence_ids:
            item = evidence.get(evidence_id)
            if item is None or item.verification_status == "UNVERIFIED":
                issues.append("MISSING_EVIDENCE")
                missing_evidence_ids.append(evidence_id)
            elif item.verification_status == "STALE":
                issues.append("STALE_EVIDENCE")
                missing_evidence_ids.append(evidence_id)
            elif item.verification_status == "CONTRADICTED":
                issues.append("CONTRADICTED_EVIDENCE")
        match = re.fullmatch(
            r"(.+)는 (.+)에 대해 (SUPPORT|ACCEPTABLE|OPPOSE|USER_CONFIRMATION_REQUIRED)한다\.",
            argument.conclusion,
        )
        if match is None:
            issues.append("CONCLUSION_NOT_DERIVED")
        elif expected_votes and (match.group(1), match.group(2), match.group(3)) not in expected_votes:
            issues.append("CONCLUSION_NOT_DERIVED")
        # 표시용 자연어 conclusion의 문구·언어는 판정 근거로 사용하지 않는다.
        # 구조화 claim과 expectedVotes의 정확 일치만 결론 도출 여부를 결정한다.
        issues = [code for code in issues if code != "CONCLUSION_NOT_DERIVED"]
        structured_claim = (
            argument.claimed_participant_id,
            argument.claimed_proposal_id,
            argument.claimed_decision,
        )
        if structured_claim not in expected_votes:
            issues.append("CONCLUSION_NOT_DERIVED")
        issues = list(dict.fromkeys(issues))
        invalid = any(code in issues for code in {
            "UNKNOWN_RULE", "CONTRADICTED_EVIDENCE", "CONCLUSION_NOT_DERIVED",
        })
        verdict = "INVALID" if invalid else "NEEDS_EVIDENCE" if issues else "VALID"
        if verdict == "NEEDS_EVIDENCE":
            requested_evidence.extend(missing_evidence_ids)
        reviews.append(ProofReview(
            argument_id=argument.argument_id,
            verdict=verdict,
            issue_codes=issues or ["NONE"],
            explanation="등록된 사실·규칙·검증 근거가 모두 연결됩니다." if verdict == "VALID" else f"검증 보완이 필요합니다: {', '.join(issues)}",
        ))
    return LogicAuditorOutput(
        role="LOGIC_AUDITOR",
        reviews=reviews,
        accepted_argument_ids=[item.argument_id for item in reviews if item.verdict == "VALID"],
        rejected_argument_ids=[item.argument_id for item in reviews if item.verdict == "INVALID"],
        requested_evidence_ids=list(dict.fromkeys(requested_evidence)),
    )


def run_category_watcher(data: CategoryWatcherInput) -> CategoryWatcherOutput:
    checks = data.mechanical_checks
    invalid_options = [
        option.proposal_id for option in data.options
        if option.validation_status != "VERIFIED" or not option.hard_constraints_satisfied
    ]
    affected = invalid_options or [option.proposal_id for option in data.options]
    if invalid_options:
        return CategoryWatcherOutput(
            role="CATEGORY_WATCHER", verdict="BLOCK", affected_proposal_ids=invalid_options,
            reason_codes=["HARD_CONSTRAINT"],
            requested_changes=["검증되지 않았거나 필수조건을 위반한 계획안을 제거해야 합니다."],
            evidence_ids=[], explanation="비교 대상에 실행 불가능한 계획안이 포함되어 있습니다.",
        )
    if checks.hard_constraint_failures or not checks.budget_valid or not checks.schedule_valid:
        reasons = []
        if checks.hard_constraint_failures:
            reasons.append("HARD_CONSTRAINT")
        if not checks.budget_valid:
            reasons.append("BUDGET")
        if not checks.schedule_valid:
            reasons.append("SCHEDULE")
        return CategoryWatcherOutput(
            role="CATEGORY_WATCHER", verdict="BLOCK", affected_proposal_ids=affected,
            reason_codes=reasons, requested_changes=["결정론적 검증 실패 항목을 수정한 새 일정안이 필요합니다."],
            evidence_ids=[], explanation="필수 실행 가능성 검사에 실패했습니다.",
        )
    invalid = any(review.verdict == "INVALID" for review in data.proof_reviews)
    insufficient = checks.evidence_coverage_bp < 8_000 or any(review.verdict == "NEEDS_EVIDENCE" for review in data.proof_reviews)
    if invalid or insufficient:
        return CategoryWatcherOutput(
            role="CATEGORY_WATCHER", verdict="REVISE", affected_proposal_ids=affected,
            reason_codes=["INVALID_ARGUMENT" if invalid else "EVIDENCE"],
            requested_changes=["무효 주장을 제거하거나 다시 도출해야 합니다." if invalid else "누락된 검증 근거를 보강해야 합니다."],
            evidence_ids=[], explanation="논리 또는 근거 품질 보완이 필요합니다.",
        )
    return CategoryWatcherOutput(
        role="CATEGORY_WATCHER", verdict="PASS", affected_proposal_ids=[], reason_codes=["NONE"],
        requested_changes=[], evidence_ids=[], explanation=f"{data.category} 분야 규칙과 검증 조건을 충족합니다.",
    )


def run_debate_supervisor(data: DebateSupervisorInput) -> DebateSupervisorOutput:
    def legal(preferred: DebateAction) -> DebateAction:
        if preferred not in data.legal_moves:
            raise ValueError(f"Required fail-closed action is not legal: {preferred}")
        return preferred

    confirmation = [vote for vote in data.votes if vote.decision == "USER_CONFIRMATION_REQUIRED"]
    opposition = [vote for vote in data.votes if vote.decision == "OPPOSE"]
    proposal_ids = list(dict.fromkeys(vote.proposal_id for vote in data.votes))
    if data.watcher_verdict.verdict == "BLOCK":
        return DebateSupervisorOutput(role="DEBATE_SUPERVISOR", next_action=legal("BLOCK"), target_participant_ids=[], referenced_proposal_ids=proposal_ids, reason_code="WATCHER_BLOCK", rationale=data.watcher_verdict.explanation)
    if confirmation:
        return DebateSupervisorOutput(role="DEBATE_SUPERVISOR", next_action=legal("WAIT_FOR_USER"), target_participant_ids=[vote.participant_id for vote in confirmation], referenced_proposal_ids=proposal_ids, reason_code="USER_AUTHORITY_REQUIRED", rationale="보호 목적 변경에는 참가자 본인의 확인이 필요합니다.")
    hard_opposition = [vote for vote in opposition if vote.reason_code == "HARD_CONSTRAINT"]
    protected_opposition = [
        vote for vote in opposition
        if vote.reason_code in {"PROTECTED_OBJECTIVE", "MIN_SATISFACTION", "FIVE_POINT_PREFERENCE"}
    ]
    if hard_opposition:
        return DebateSupervisorOutput(role="DEBATE_SUPERVISOR", next_action=legal("BLOCK"), target_participant_ids=[vote.participant_id for vote in hard_opposition], referenced_proposal_ids=proposal_ids, reason_code="ITERATION_LIMIT", rationale="하드 제약 반대는 다수결이나 사용자 승인으로 덮을 수 없습니다.")
    if opposition and data.iteration + 1 < data.max_iterations:
        return DebateSupervisorOutput(role="DEBATE_SUPERVISOR", next_action=legal("PROPOSE_COMPROMISE"), target_participant_ids=[vote.participant_id for vote in opposition], referenced_proposal_ids=proposal_ids, reason_code="OPPOSITION_REMAINS", rationale="반대 사유를 보존한 새 절충안이 필요합니다.")
    if protected_opposition:
        return DebateSupervisorOutput(role="DEBATE_SUPERVISOR", next_action=legal("WAIT_FOR_USER"), target_participant_ids=[vote.participant_id for vote in protected_opposition], referenced_proposal_ids=proposal_ids, reason_code="ITERATION_LIMIT", rationale="반복 한도 안에 보호 목적 또는 최소 만족도를 해결하지 못해 당사자 확인이 필요합니다.")
    if opposition:
        return DebateSupervisorOutput(role="DEBATE_SUPERVISOR", next_action=legal("END_DEBATE"), target_participant_ids=[vote.participant_id for vote in opposition], referenced_proposal_ids=proposal_ids, reason_code="ITERATION_LIMIT", rationale="반복 한도에 도달해 미해결 양보를 보고합니다.")
    return DebateSupervisorOutput(role="DEBATE_SUPERVISOR", next_action=legal("END_DEBATE"), target_participant_ids=[], referenced_proposal_ids=proposal_ids, reason_code="CONSENSUS", rationale="모든 투표가 수용 가능 이상이고 감시 검증을 통과했습니다.")


def run_result_finalizer(data: ResultFinalizerInput) -> ResultFinalizerOutput:
    verified = {item.evidence_id for item in data.evidence if item.verification_status == "VERIFIED"}
    invalid = data.selected_plan.validation_status == "INVALID" or not data.selected_plan.hard_constraints_satisfied
    warnings = list(data.unresolved_issues)
    if data.selected_plan.validation_status == "PARTIAL":
        warnings.append("일부 항목의 최신 검증이 필요합니다.")
    return ResultFinalizerOutput(
        role="RESULT_FINALIZER",
        status="BLOCKED" if invalid else "READY_WITH_WARNINGS" if warnings else "READY",
        overview="현재 일정안은 확정할 수 없습니다." if invalid else f"{data.selected_plan.summary}을 최종 추천안으로 정리했습니다.",
        selected_proposal_id=data.selected_plan.proposal_id,
        itinerary=[ItineraryOutputItem(day=item.day, title=item.title, candidate_ids=item.candidate_ids, explanation=item.note) for item in data.itinerary],
        participant_outcomes=[ParticipantOutcome(
            participant_id=item.participant_id,
            satisfaction_bp=item.satisfaction_bp,
            summary=item.concession_summary or f"{len(item.fulfilled_preference_ids)}개 선호가 반영되었습니다.",
        ) for item in data.participant_summaries],
        warnings=warnings,
        next_actions=["실패 조건을 수정한 일정안을 다시 생성하세요." if invalid else "가격과 재고를 예약 직전에 다시 확인하세요."],
        evidence_ids=[item for item in data.selected_plan.evidence_ids if item in verified],
    )
