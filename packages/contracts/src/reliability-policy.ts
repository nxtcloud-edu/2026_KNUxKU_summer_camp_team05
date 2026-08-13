import { z } from 'zod';

export const evidenceAuthorityTiers = [0, 1, 2, 3] as const;
export type EvidenceAuthorityTier = (typeof evidenceAuthorityTiers)[number];

export const readinessStatuses = ['PROVISIONAL', 'VERIFIED', 'BOOKABLE', 'BOOKED'] as const;
export type ReadinessStatus = (typeof readinessStatuses)[number];

export const readinessRank: Record<ReadinessStatus, number> = {
  PROVISIONAL: 0,
  VERIFIED: 1,
  BOOKABLE: 2,
  BOOKED: 3,
};

/** BOOKED는 사용자 행동 결과이며 Agent나 비교기가 승격할 수 없다. */
export const reliabilityPolicyV1 = {
  reservationRequiredMinimumStatus: 'BOOKABLE',
  reservationNotRequiredMinimumStatus: 'VERIFIED',
  priceInventoryMinimumAuthorityTier: 2,
  comparisonOrder: [
    'requiredFieldsComplete',
    'readinessRank',
    'minimumAuthorityTier',
    'minimumFreshnessBp',
    'nonDegraded',
    'optionalCoverageBp',
    'canonicalCandidateId',
  ],
  aggregation: 'LEXICOGRAPHIC_NOT_WEIGHTED_SUM',
} as const;

export const reliabilityEvidenceInputSchema = z.object({
  evidenceId: z.string().min(1),
  authorityTier: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
  retrievedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  degraded: z.boolean(),
  core: z.boolean(),
});
export type ReliabilityEvidenceInput = z.infer<typeof reliabilityEvidenceInputSchema>;

export const reliabilityKeySchema = z.object({
  requiredFieldsComplete: z.boolean(),
  readinessRank: z.number().int().min(0).max(3),
  minimumAuthorityTier: z.number().int().min(0).max(3),
  minimumFreshnessBp: z.number().int().min(0).max(10_000),
  nonDegraded: z.boolean(),
  optionalCoverageBp: z.number().int().min(0).max(10_000),
  canonicalCandidateId: z.string().min(1),
});
export type ReliabilityKey = z.infer<typeof reliabilityKeySchema>;

export function calculateFreshnessRemainingBp(
  retrievedAt: string,
  expiresAt: string,
  comparisonAt: string,
): number {
  const retrievedMs = Date.parse(retrievedAt);
  const expiresMs = Date.parse(expiresAt);
  const comparisonMs = Date.parse(comparisonAt);
  const ttlMs = expiresMs - retrievedMs;
  if (![retrievedMs, expiresMs, comparisonMs].every(Number.isFinite) || ttlMs <= 0) return 0;
  return Math.round(Math.max(0, Math.min(10_000, (10_000 * (expiresMs - comparisonMs)) / ttlMs)));
}

/** 양수면 a, 음수면 b를 선택한다. 마지막 ID는 재현성만 위한 오름차순 타이브레이커다. */
export function compareReliabilityKeys(a: ReliabilityKey, b: ReliabilityKey): number {
  const descending: Array<keyof Omit<ReliabilityKey, 'canonicalCandidateId'>> = [
    'requiredFieldsComplete',
    'readinessRank',
    'minimumAuthorityTier',
    'minimumFreshnessBp',
    'nonDegraded',
    'optionalCoverageBp',
  ];
  for (const key of descending) {
    const aValue = typeof a[key] === 'boolean' ? Number(a[key]) : a[key];
    const bValue = typeof b[key] === 'boolean' ? Number(b[key]) : b[key];
    if (aValue !== bValue) return Number(aValue) - Number(bValue);
  }
  return b.canonicalCandidateId.localeCompare(a.canonicalCandidateId);
}
