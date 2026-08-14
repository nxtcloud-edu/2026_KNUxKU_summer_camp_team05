"""외부 API와 DB 없이 Agent 흐름을 재현하는 입력 fixture."""

from .models import (
    CandidateSearchInput, EvidenceRef, ItineraryInputItem, ParticipantSummary,
    ParticipantProxyInput, PlanOption, Preference, ProxyParticipant, ResultFinalizerInput,
)

DEMO_EVIDENCE = [
    EvidenceRef(evidence_id="ev.hotel.price", fact_summary="호텔 총액과 세금 포함 여부가 확인되었습니다.", verification_status="VERIFIED", authority_tier=2, valid_until="2099-08-15T12:00:00Z"),
    EvidenceRef(evidence_id="ev.hotel.location", fact_summary="호텔에서 주요 목적지까지 이동시간이 확인되었습니다.", verification_status="VERIFIED", authority_tier=2, valid_until="2099-09-01T00:00:00Z"),
]

DEMO_PLAN_OPTIONS = [
    PlanOption(
        proposal_id="proposal.balanced", summary="광안리 뷰 숙소와 식도락을 결합한 균형 일정",
        candidate_ids=["hotel.gwangalli", "dining.local-course"],
        participant_satisfaction_bp={"alice": 8_200, "bob": 7_800}, hard_constraints_satisfied=True,
        protected_objective_ids_satisfied=["objective.alice.food", "objective.bob.view"],
        cost_amount=1_100_000, currency="KRW", daily_travel_minutes=75,
        evidence_ids=["ev.hotel.price", "ev.hotel.location"], validation_status="VERIFIED",
    ),
    PlanOption(
        proposal_id="proposal.activity", summary="액티비티를 늘리고 숙소 비용을 낮춘 일정",
        candidate_ids=["hotel.city", "activity.surfing"],
        participant_satisfaction_bp={"alice": 6_100, "bob": 7_200}, hard_constraints_satisfied=True,
        protected_objective_ids_satisfied=["objective.alice.food"],
        cost_amount=980_000, currency="KRW", daily_travel_minutes=105,
        evidence_ids=["ev.hotel.price"], validation_status="PARTIAL",
    ),
]

_BASE = dict(
    trip_id="trip.demo", plan_version=1, debate_issue_id="issue.accommodation.1",
    category="accommodation", iteration=0, options=DEMO_PLAN_OPTIONS, evidence=DEMO_EVIDENCE,
)

DEMO_PROXY_INPUTS = [
    ParticipantProxyInput(
        **_BASE, run_id="run.proxy.alice",
        participant=ProxyParticipant(
            participant_id="alice", goal_mode="CONTENT_IS_GOAL", protected_objective_ids=["objective.alice.food"],
            preferences=[
                Preference(preference_id="pref.alice.food", category="dining", importance=5, rank_within_tier=1, statement="현지 음식 코스를 원함"),
                Preference(preference_id="pref.alice.view", category="accommodation", importance=3, rank_within_tier=1, statement="바다 전망 선호"),
            ], hard_constraint_summaries=["GROUP_SAFETY_CONSTRAINT"], current_satisfaction_bp=None,
        ),
    ),
    ParticipantProxyInput(
        **_BASE, run_id="run.proxy.bob",
        participant=ProxyParticipant(
            participant_id="bob", goal_mode="TRAVEL_IS_GOAL", protected_objective_ids=["objective.bob.view"],
            preferences=[
                Preference(preference_id="pref.bob.view", category="accommodation", importance=5, rank_within_tier=1, statement="광안리 뷰 숙소를 원함"),
                Preference(preference_id="pref.bob.activity", category="activity", importance=1, rank_within_tier=1, statement="가벼운 체험이면 충분"),
            ], hard_constraint_summaries=["GROUP_SAFETY_CONSTRAINT"], current_satisfaction_bp=None,
        ),
    ),
]

DEMO_CANDIDATE_SEARCH_INPUT = CandidateSearchInput(
    trip_id="trip.demo", run_id="run.search.1", plan_version=1, category="accommodation",
    unresolved_free_text=["광안대교 야경이 잘 보이는 숙소"], shortage_reason="UNSTRUCTURED_REQUEST",
    canonical_constraints={"city": "부산", "max_group_price_krw": 1_200_000},
    allowed_relaxations=["도보 이동 5분 증가"], current_candidates=[],
)

DEMO_FINALIZER_INPUT = ResultFinalizerInput(
    trip_id="trip.demo", run_id="run.finalizer.1", plan_version=1, selected_plan=DEMO_PLAN_OPTIONS[0],
    itinerary=[ItineraryInputItem(day=1, title="광안리 체크인과 로컬 디너", candidate_ids=["hotel.gwangalli", "dining.local-course"], note="두 참가자의 목적급 콘텐츠를 같은 동선에 배치했습니다.")],
    participant_summaries=[
        ParticipantSummary(participant_id="alice", satisfaction_bp=8_200, fulfilled_preference_ids=["pref.alice.food", "pref.alice.view"], concession_summary=None),
        ParticipantSummary(participant_id="bob", satisfaction_bp=7_800, fulfilled_preference_ids=["pref.bob.view"], concession_summary="액티비티 수를 줄이는 데 동의했습니다."),
    ],
    evidence=DEMO_EVIDENCE, unresolved_issues=[], previous_plan_version=None, change_summary=[],
)
