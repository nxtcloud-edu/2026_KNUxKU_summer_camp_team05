import {
  candidateRecordSchema,
  capacityPlanSchema,
  evidenceSnapshotSchema,
  hotelCandidateSchema,
  tripCharterSchema,
  verificationReceiptSchema,
  type CandidateRecord,
  type EvidenceSnapshot,
  type TripCharter,
  type VerificationReceipt,
} from '@tm/contracts';

type VerificationStatus = VerificationReceipt['status'];
type CapacityPlan = ReturnType<typeof capacityPlanSchema.parse>;

export const STAY_EVIDENCE_FIELDS = {
  date: 'stay.date',
  partySize: 'stay.partySize',
  roomCapacity: 'stay.roomCapacity',
  roomAllocation: 'stay.roomAllocation',
  totalPrice: 'stay.totalPrice',
  availability: 'stay.availability',
  attributes: 'stay.attributes',
  cancellation: 'stay.cancellation',
  travelBurden: 'stay.travelBurden',
} as const;

export const STAY_VALIDATION_RULE_IDS = {
  providerDisqualification: 'stay.provider-disqualification',
  evidenceExistence: 'stay.evidence-existence',
  evidenceFreshness: 'stay.evidence-freshness',
  providerProvenance: 'stay.provider-provenance',
  dateMatch: 'stay.date-match',
  partySize: 'stay.party-size',
  roomCapacity: 'stay.room-capacity',
  roomAllocation: 'stay.room-allocation',
  roomSplitAuthority: 'stay.room-split-authority',
  totalPrice: 'stay.total-price',
  participantBudget: 'stay.participant-budget',
  availability: 'stay.availability',
  requiredAttributes: 'stay.required-attributes',
  forbiddenAttributes: 'stay.forbidden-attributes',
  cancellation: 'stay.cancellation',
  travelBurden: 'stay.travel-burden',
} as const;

export interface StayHardConstraint {
  readonly constraintId: string;
  readonly kind: 'REQUIRED_ATTRIBUTE' | 'FORBIDDEN_ATTRIBUTE';
  readonly attribute: string;
}

export interface StayCandidateValidationInput {
  readonly proposalId: string;
  readonly candidate: CandidateRecord;
  readonly evidence: readonly EvidenceSnapshot[];
  readonly charter: TripCharter;
  readonly capacityPlan: CapacityPlan | null;
  readonly hardConstraints: readonly StayHardConstraint[];
  readonly allowedRoomSplitAuthorityRefs: readonly string[];
  readonly checkedAt: string;
}

export interface EligibleStayCandidateValidation {
  readonly eligibility: 'ELIGIBLE';
  readonly proposalId: string;
  readonly candidate: CandidateRecord;
  readonly receipts: VerificationReceipt[];
  readonly capacityPlan: CapacityPlan;
  readonly costByParticipantKrw: Record<string, number>;
  readonly totalCostKrw: number;
  readonly attributesBp: Record<string, number>;
  readonly travelBurdenMinutes: number;
  readonly cancellationScoreBp: number;
  readonly evidenceQualityBp: number;
}

export interface IneligibleStayCandidateValidation {
  readonly eligibility: 'UNVERIFIED' | 'BLOCKED';
  readonly proposalId: string;
  readonly candidate: CandidateRecord;
  readonly receipts: VerificationReceipt[];
}

export type StayCandidateValidationResult =
  | EligibleStayCandidateValidation
  | IneligibleStayCandidateValidation;

interface StayVerificationPayload {
  readonly checkIn: string;
  readonly checkOut: string;
  readonly partySize: number;
  readonly available: boolean;
  readonly travelBurdenMinutes: number;
}

const statusPriority: Record<VerificationStatus, number> = {
  PASS: 0,
  UNKNOWN: 1,
  STALE: 2,
  FAIL: 3,
  CONTRADICTED: 4,
};

function worstStatus(statuses: readonly VerificationStatus[]): VerificationStatus {
  return statuses.reduce<VerificationStatus>(
    (worst, status) => statusPriority[status] > statusPriority[worst] ? status : worst,
    'PASS',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStayVerificationPayload(payload: Record<string, unknown>): StayVerificationPayload | null {
  const raw = payload['stayVerification'];
  if (!isRecord(raw)) return null;
  const checkIn = raw['checkIn'];
  const checkOut = raw['checkOut'];
  const partySize = raw['partySize'];
  const available = raw['available'];
  const travelBurdenMinutes = raw['travelBurdenMinutes'];
  if (
    typeof checkIn !== 'string' ||
    typeof checkOut !== 'string' ||
    typeof partySize !== 'number' ||
    !Number.isInteger(partySize) ||
    typeof available !== 'boolean' ||
    typeof travelBurdenMinutes !== 'number' ||
    !Number.isInteger(travelBurdenMinutes) ||
    travelBurdenMinutes < 0
  ) {
    return null;
  }
  return { checkIn, checkOut, partySize, available, travelBurdenMinutes };
}

function dateOnly(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (match?.[1] === undefined || Number.isNaN(Date.parse(`${match[1]}T00:00:00.000Z`))) {
    return null;
  }
  return match[1];
}

function nightsBetween(startDate: string, endDate: string): number {
  return Math.round(
    (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function receipt(
  proposalId: string,
  ruleId: string,
  status: VerificationStatus,
  evidenceIds: readonly string[],
  explanation: string,
): VerificationReceipt {
  return verificationReceiptSchema.parse({
    schemaVersion: 1,
    receiptId: `receipt:${proposalId}:${ruleId}`,
    proposalId,
    ruleId,
    status,
    evidenceIds: uniqueSorted(evidenceIds),
    explanation,
  });
}

function fieldEvidence(
  evidence: readonly EvidenceSnapshot[],
  field: string,
): { status: VerificationStatus; evidenceIds: string[] } {
  const matching = evidence.filter((item) => item.fieldStates[field] !== undefined);
  if (matching.length === 0) return { status: 'UNKNOWN', evidenceIds: [] };
  return {
    status: worstStatus(
      matching.flatMap((item) => [item.status, item.fieldStates[field] ?? 'UNKNOWN']),
    ),
    evidenceIds: matching.map((item) => item.evidenceId),
  };
}

function factWithEvidence(
  factStatus: VerificationStatus,
  evidenceStatus: VerificationStatus,
): VerificationStatus {
  return evidenceStatus === 'PASS' ? factStatus : evidenceStatus;
}

function equalKrwAllocation(totalCostKrw: number, participantIds: readonly string[]): Record<string, number> {
  const base = Math.floor(totalCostKrw / participantIds.length);
  const remainder = totalCostKrw % participantIds.length;
  return Object.fromEntries(
    participantIds.map((participantId, index) => [participantId, base + (index < remainder ? 1 : 0)]),
  );
}

function capacityStatuses(
  rawCapacityPlan: CapacityPlan | null,
  charter: TripCharter,
  candidateEvidenceIds: ReadonlySet<string>,
  allowedSplitRefs: ReadonlySet<string>,
): {
  capacityPlan: CapacityPlan | null;
  capacity: VerificationStatus;
  allocation: VerificationStatus;
  splitAuthority: VerificationStatus;
} {
  const parsed = capacityPlanSchema.safeParse(rawCapacityPlan);
  if (!parsed.success) {
    return { capacityPlan: null, capacity: 'UNKNOWN', allocation: 'UNKNOWN', splitAuthority: 'UNKNOWN' };
  }
  const plan = parsed.data;
  const allocationCapacity = plan.allocations.reduce(
    (sum, allocation) => sum + allocation.confirmedCapacity,
    0,
  );
  const capacity = plan.requestedPartySize !== charter.partySize || plan.confirmedCapacity < charter.partySize
    ? 'FAIL'
    : allocationCapacity !== plan.confirmedCapacity || plan.evidenceIds.some((id) => !candidateEvidenceIds.has(id))
      ? 'CONTRADICTED'
      : 'PASS';

  const assignedIds = plan.allocations.flatMap((allocation) => allocation.assignedParticipantIds);
  const assignedSet = new Set(assignedIds);
  const participantSet = new Set(charter.participantIds);
  const allocationInvalid =
    plan.allocations.length === 0 ||
    new Set(plan.allocations.map((allocation) => allocation.resourceUnitId)).size !== plan.allocations.length ||
    assignedSet.size !== assignedIds.length ||
    assignedIds.some((participantId) => !participantSet.has(participantId)) ||
    plan.allocations.some(
      (allocation) => allocation.assignedParticipantIds.length > allocation.confirmedCapacity,
    ) ||
    charter.participantIds.some((participantId) => !assignedSet.has(participantId)) ||
    plan.unassignedParticipantIds.length > 0;
  const allocation: VerificationStatus = allocationInvalid ? 'FAIL' : 'PASS';

  const needsSplitAuthority = plan.allocations.length > 1;
  const splitAuthority = plan.splitAuthorityRef === null
    ? needsSplitAuthority ? 'FAIL' : 'PASS'
    : allowedSplitRefs.has(plan.splitAuthorityRef) ? 'PASS' : 'FAIL';
  return { capacityPlan: plan, capacity, allocation, splitAuthority };
}

function hotelAttributes(hotel: ReturnType<typeof hotelCandidateSchema.parse>): Set<string> {
  const attributes = new Set(hotel.amenities.map((value) => value.trim().toLowerCase()));
  attributes.add(hotel.type.trim().toLowerCase());
  attributes.add(`type:${hotel.type.trim().toLowerCase()}`);
  if (hotel.accessibility.elevator === true) attributes.add('elevator');
  if (hotel.accessibility.wheelchair === true) attributes.add('wheelchair');
  if (hotel.accessibility.stepFree === true) attributes.add('step-free');
  return attributes;
}

function validateConstraintInput(constraints: readonly StayHardConstraint[]): void {
  const ids = constraints.map((constraint) => constraint.constraintId);
  if (ids.some((id) => id.trim().length === 0) || new Set(ids).size !== ids.length) {
    throw new Error('hard constraintId는 비어 있거나 중복될 수 없습니다.');
  }
  if (constraints.some((constraint) => constraint.attribute.trim().length === 0)) {
    throw new Error('hard constraint attribute는 비어 있을 수 없습니다.');
  }
}

export function validateStayCandidate(
  rawInput: StayCandidateValidationInput,
): StayCandidateValidationResult {
  if (rawInput.proposalId.trim().length === 0) throw new Error('proposalId가 필요합니다.');
  const checkedAtMs = Date.parse(rawInput.checkedAt);
  if (Number.isNaN(checkedAtMs)) throw new Error('checkedAt은 ISO date-time이어야 합니다.');
  validateConstraintInput(rawInput.hardConstraints);

  const charter = tripCharterSchema.parse(rawInput.charter);
  const candidate = candidateRecordSchema.parse(rawInput.candidate);
  if (candidate.category !== 'stay') throw new Error('stay validator에는 stay CandidateRecord만 입력할 수 있습니다.');
  const allEvidence = rawInput.evidence.map((item) => evidenceSnapshotSchema.parse(item));
  const evidenceById = new Map(allEvidence.map((item) => [item.evidenceId, item]));
  const duplicateEvidenceRefs = new Set(candidate.evidenceIds).size !== candidate.evidenceIds.length;
  const referencedEvidence = candidate.evidenceIds
    .map((evidenceId) => evidenceById.get(evidenceId))
    .filter((item): item is EvidenceSnapshot => item !== undefined);
  const missingEvidenceIds = candidate.evidenceIds.filter((evidenceId) => !evidenceById.has(evidenceId));
  const candidateEvidenceIdSet = new Set(candidate.evidenceIds);
  const receipts: VerificationReceipt[] = [];

  const providerDisqualified = candidate.poolEligibility === 'BLOCKED' || candidate.exclusionReasons.length > 0;
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.providerDisqualification,
    providerDisqualified ? 'FAIL' : 'PASS',
    candidate.evidenceIds,
    providerDisqualified ? 'Provider가 후보를 사전 실격했습니다.' : 'Provider 사전 실격 표시가 없습니다.',
  ));

  const existenceStatus: VerificationStatus = duplicateEvidenceRefs
    ? 'CONTRADICTED'
    : missingEvidenceIds.length > 0 ? 'UNKNOWN' : 'PASS';
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.evidenceExistence,
    existenceStatus,
    referencedEvidence.map((item) => item.evidenceId),
    missingEvidenceIds.length === 0
      ? 'Candidate가 참조한 EvidenceSnapshot이 모두 존재합니다.'
      : `누락 EvidenceSnapshot: ${missingEvidenceIds.join(',')}`,
  ));

  const freshnessStatuses: VerificationStatus[] = referencedEvidence.map((item) => {
    const retrievedAtMs = Date.parse(item.retrievedAt);
    if (retrievedAtMs > checkedAtMs) return 'CONTRADICTED';
    if (item.validUntil === null) return item.status === 'PASS' ? 'UNKNOWN' : item.status;
    if (Date.parse(item.validUntil) < checkedAtMs) return worstStatus([item.status, 'STALE']);
    if (item.confidence === 'unknown') return worstStatus([item.status, 'UNKNOWN']);
    return item.status;
  });
  const freshnessStatus = referencedEvidence.length === 0
    ? 'UNKNOWN'
    : worstStatus(freshnessStatuses);
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.evidenceFreshness,
    freshnessStatus,
    referencedEvidence.map((item) => item.evidenceId),
    freshnessStatus === 'PASS' ? '모든 근거가 검사 시각에 유효합니다.' : '근거가 미확인·만료·모순 상태입니다.',
  ));

  const provenanceMismatch = referencedEvidence.some(
    (item) =>
      item.providerId !== candidate.providerId ||
      item.providerCandidateId !== candidate.providerCandidateId ||
      (candidate.sourceMode !== 'fixture' && item.confidence !== candidate.sourceMode),
  ) ||
    candidate.payload['source'] !== candidate.providerId ||
    candidate.payload['id'] !== candidate.providerCandidateId;
  const provenanceStatus: VerificationStatus = referencedEvidence.length === 0
    ? 'UNKNOWN'
    : provenanceMismatch ? 'CONTRADICTED' : 'PASS';
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.providerProvenance,
    provenanceStatus,
    referencedEvidence.map((item) => item.evidenceId),
    provenanceStatus === 'PASS' ? 'Provider와 providerCandidateId 계보가 일치합니다.' : 'Provider 계보를 확인할 수 없습니다.',
  ));

  const parsedHotel = hotelCandidateSchema.safeParse(candidate.payload);
  const hotel = parsedHotel.success ? parsedHotel.data : null;
  const stayVerification = parseStayVerificationPayload(candidate.payload);
  const capacity = capacityStatuses(
    rawInput.capacityPlan,
    charter,
    candidateEvidenceIdSet,
    new Set(rawInput.allowedRoomSplitAuthorityRefs),
  );

  const dateEvidence = fieldEvidence(referencedEvidence, STAY_EVIDENCE_FIELDS.date);
  const dateFactStatus: VerificationStatus = stayVerification === null
    ? 'UNKNOWN'
    : stayVerification.checkIn === charter.startDate && stayVerification.checkOut === charter.endDate
      ? 'PASS'
      : 'FAIL';
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.dateMatch,
    factWithEvidence(dateFactStatus, dateEvidence.status),
    dateEvidence.evidenceIds,
    dateFactStatus === 'PASS' ? '숙박 날짜가 TripCharter와 일치합니다.' : '숙박 날짜가 없거나 TripCharter와 다릅니다.',
  ));

  const partyEvidence = fieldEvidence(referencedEvidence, STAY_EVIDENCE_FIELDS.partySize);
  const partyFactStatus: VerificationStatus = stayVerification === null
    ? 'UNKNOWN'
    : stayVerification.partySize === charter.partySize ? 'PASS' : 'FAIL';
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.partySize,
    factWithEvidence(partyFactStatus, partyEvidence.status),
    partyEvidence.evidenceIds,
    partyFactStatus === 'PASS' ? '조회 인원이 TripCharter와 일치합니다.' : '조회 인원이 없거나 TripCharter와 다릅니다.',
  ));

  const roomCapacityEvidence = fieldEvidence(referencedEvidence, STAY_EVIDENCE_FIELDS.roomCapacity);
  const roomCapacityFactStatus: VerificationStatus = hotel === null || !hotel.roomCombinationVerified
    ? 'UNKNOWN'
    : hotel.capacity.maxGuests < charter.partySize
      ? 'FAIL'
      : capacity.capacityPlan !== null && capacity.capacityPlan.confirmedCapacity > hotel.capacity.maxGuests
        ? 'CONTRADICTED'
        : capacity.capacity;
  const roomCapacityStatus = factWithEvidence(roomCapacityFactStatus, roomCapacityEvidence.status);
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.roomCapacity,
    roomCapacityStatus,
    roomCapacityEvidence.evidenceIds,
    roomCapacityStatus === 'PASS' ? '확인 정원이 전체 인원을 수용합니다.' : '전체 인원 정원을 확인할 수 없습니다.',
  ));

  const roomAllocationEvidence = fieldEvidence(referencedEvidence, STAY_EVIDENCE_FIELDS.roomAllocation);
  const roomAllocationFactStatus: VerificationStatus = hotel === null || !hotel.roomCombinationVerified
    ? 'UNKNOWN'
    : capacity.allocation;
  const roomAllocationStatus = factWithEvidence(roomAllocationFactStatus, roomAllocationEvidence.status);
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.roomAllocation,
    roomAllocationStatus,
    roomAllocationEvidence.evidenceIds,
    roomAllocationStatus === 'PASS' ? '모든 참여자가 확인 객실에 정확히 한 번 배정됐습니다.' : '객실 배정이 불완전하거나 모순됩니다.',
  ));
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.roomSplitAuthority,
    capacity.splitAuthority,
    capacity.capacityPlan?.evidenceIds ?? [],
    capacity.splitAuthority === 'PASS' ? '객실 분리 권한 경계가 충족됐습니다.' : '객실 분리에 필요한 사용자 권한이 없습니다.',
  ));

  const nights = nightsBetween(charter.startDate, charter.endDate);
  let totalCostKrw: number | null = null;
  let priceFactStatus: VerificationStatus = 'UNKNOWN';
  if (hotel !== null) {
    const allInKnown = hotel.price.currency === 'KRW' && hotel.price.taxesIncluded && hotel.allInPriceVerified;
    if (allInKnown) {
      const priceValues = [
        hotel.price.perNightPerPerson,
        hotel.price.totalPerPerson,
        hotel.price.groupTotal,
      ];
      const expectedPerParticipant = hotel.price.perNightPerPerson * nights;
      const expectedGroupTotal = hotel.price.totalPerPerson * charter.partySize;
      if (
        priceValues.some((value) => !Number.isInteger(value) || value < 0) ||
        expectedPerParticipant !== hotel.price.totalPerPerson ||
        expectedGroupTotal !== hotel.price.groupTotal
      ) {
        priceFactStatus = 'CONTRADICTED';
      } else {
        priceFactStatus = 'PASS';
        totalCostKrw = hotel.price.groupTotal;
      }
    }
  }
  const priceEvidence = fieldEvidence(referencedEvidence, STAY_EVIDENCE_FIELDS.totalPrice);
  const totalPriceStatus = factWithEvidence(priceFactStatus, priceEvidence.status);
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.totalPrice,
    totalPriceStatus,
    priceEvidence.evidenceIds,
    totalPriceStatus === 'PASS' ? '세금 포함 총 숙박비가 박수·인원 합계와 일치합니다.' : 'KRW 기준 세금 포함 총 숙박비를 확정할 수 없습니다.',
  ));

  const costByParticipantKrw = totalCostKrw === null
    ? null
    : equalKrwAllocation(totalCostKrw, charter.participantIds);
  const participantBudgetStatus: VerificationStatus = costByParticipantKrw === null
    ? 'UNKNOWN'
    : charter.participantIds.some(
      (participantId) =>
        (costByParticipantKrw[participantId] ?? Number.POSITIVE_INFINITY) >
        charter.budgetMaxByParticipantKrw[participantId]!,
    ) ? 'FAIL' : 'PASS';
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.participantBudget,
    factWithEvidence(participantBudgetStatus, priceEvidence.status),
    priceEvidence.evidenceIds,
    participantBudgetStatus === 'PASS' ? '균등 배분 비용이 모든 참여자의 절대 예산 이내입니다.' : '참여자별 절대 예산을 통과하지 못했습니다.',
  ));

  const availabilityEvidence = fieldEvidence(referencedEvidence, STAY_EVIDENCE_FIELDS.availability);
  const availabilityFactStatus: VerificationStatus = stayVerification === null
    ? 'UNKNOWN'
    : stayVerification.available ? 'PASS' : 'FAIL';
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.availability,
    factWithEvidence(availabilityFactStatus, availabilityEvidence.status),
    availabilityEvidence.evidenceIds,
    availabilityFactStatus === 'PASS' ? '정확한 날짜·인원 조건의 가용성이 확인됐습니다.' : '정확한 날짜·인원 조건의 가용성이 없습니다.',
  ));

  const attributes = hotel === null ? null : hotelAttributes(hotel);
  const required = rawInput.hardConstraints.filter((constraint) => constraint.kind === 'REQUIRED_ATTRIBUTE');
  const forbidden = rawInput.hardConstraints.filter((constraint) => constraint.kind === 'FORBIDDEN_ATTRIBUTE');
  const requiredFactStatus: VerificationStatus = attributes === null
    ? 'UNKNOWN'
    : required.every((constraint) => attributes.has(constraint.attribute.trim().toLowerCase()))
      ? 'PASS'
      : 'FAIL';
  const forbiddenFactStatus: VerificationStatus = attributes === null
    ? 'UNKNOWN'
    : forbidden.every((constraint) => !attributes.has(constraint.attribute.trim().toLowerCase()))
      ? 'PASS'
      : 'FAIL';
  const attributeEvidence = fieldEvidence(referencedEvidence, STAY_EVIDENCE_FIELDS.attributes);
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.requiredAttributes,
    factWithEvidence(requiredFactStatus, attributeEvidence.status),
    attributeEvidence.evidenceIds,
    requiredFactStatus === 'PASS' ? '필수 숙소 속성이 모두 존재합니다.' : '필수 숙소 속성이 누락됐습니다.',
  ));
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.forbiddenAttributes,
    factWithEvidence(forbiddenFactStatus, attributeEvidence.status),
    attributeEvidence.evidenceIds,
    forbiddenFactStatus === 'PASS' ? '금지 숙소 속성이 없습니다.' : '금지 숙소 속성이 존재합니다.',
  ));

  let cancellationScoreBp: number | null = null;
  let cancellationFactStatus: VerificationStatus = 'UNKNOWN';
  if (hotel?.cancelPolicy.freeUntil !== null && hotel?.cancelPolicy.freeUntil !== undefined) {
    const freeUntil = dateOnly(hotel.cancelPolicy.freeUntil);
    if (freeUntil !== null) {
      cancellationScoreBp = freeUntil >= charter.startDate ? 10_000 : 0;
      cancellationFactStatus = 'PASS';
    }
  }
  const cancellationEvidence = fieldEvidence(referencedEvidence, STAY_EVIDENCE_FIELDS.cancellation);
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.cancellation,
    factWithEvidence(cancellationFactStatus, cancellationEvidence.status),
    cancellationEvidence.evidenceIds,
    cancellationFactStatus === 'PASS' ? '취소 가능 점수를 확인된 무료 취소일에서 계산했습니다.' : '취소 조건 점수를 계산할 근거가 없습니다.',
  ));

  const travelBurdenMinutes = stayVerification?.travelBurdenMinutes ?? null;
  const travelFactStatus: VerificationStatus = travelBurdenMinutes === null ? 'UNKNOWN' : 'PASS';
  const travelEvidence = fieldEvidence(referencedEvidence, STAY_EVIDENCE_FIELDS.travelBurden);
  receipts.push(receipt(
    rawInput.proposalId,
    STAY_VALIDATION_RULE_IDS.travelBurden,
    factWithEvidence(travelFactStatus, travelEvidence.status),
    travelEvidence.evidenceIds,
    travelFactStatus === 'PASS' ? '이동 부담 분이 검증 입력에 존재합니다.' : '이동 부담 분을 확인할 수 없습니다.',
  ));

  const nonPassReceipts = receipts.filter((item) => item.status !== 'PASS');
  const eligibility: CandidateRecord['poolEligibility'] = nonPassReceipts.some(
    (item) => item.status === 'FAIL' || item.status === 'CONTRADICTED',
  ) ? 'BLOCKED' : nonPassReceipts.length > 0 ? 'UNVERIFIED' : 'ELIGIBLE';
  const exclusionReasons = eligibility === 'ELIGIBLE'
    ? []
    : uniqueSorted([
      ...candidate.exclusionReasons,
      ...nonPassReceipts.map((item) => `${item.ruleId}:${item.status}`),
    ]);
  const validatedCandidate = candidateRecordSchema.parse({
    ...candidate,
    poolEligibility: eligibility,
    exclusionReasons,
  });

  if (eligibility === 'ELIGIBLE') {
    if (
      capacity.capacityPlan === null ||
      costByParticipantKrw === null ||
      totalCostKrw === null ||
      travelBurdenMinutes === null ||
      cancellationScoreBp === null
    ) {
      throw new Error('PASS 영수증과 승격 입력이 일치하지 않습니다.');
    }
    const attributesBp = Object.fromEntries(
      rawInput.hardConstraints.map((constraint) => [constraint.constraintId, 10_000]),
    );
    const evidenceQualityBp = Math.min(
      ...referencedEvidence.map((item) => item.confidence === 'live' ? 10_000 : item.confidence === 'estimated' ? 5_000 : 0),
    );
    return {
      eligibility,
      proposalId: rawInput.proposalId,
      candidate: validatedCandidate,
      receipts,
      capacityPlan: capacity.capacityPlan,
      costByParticipantKrw,
      totalCostKrw,
      attributesBp,
      travelBurdenMinutes,
      cancellationScoreBp,
      evidenceQualityBp,
    };
  }
  return { eligibility, proposalId: rawInput.proposalId, candidate: validatedCandidate, receipts };
}
