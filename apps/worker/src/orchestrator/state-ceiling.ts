import type { Confidence, NodeStatus } from '@tm/contracts';

export interface RoundStateEvidence {
  blocked: boolean;
  verificationReceiptsPassed: boolean;
  unresolvedEvidenceCount: number;
  evidenceMode: 'LIVE' | 'MIXED' | 'FIXTURE';
}

export interface RoundStateCeiling {
  status: NodeStatus;
  confidence: Confidence;
}

export function stateCeilingForRound(input: RoundStateEvidence): RoundStateCeiling {
  if (input.blocked) return { status: 'BLOCKED', confidence: 'unknown' };
  if (
    input.verificationReceiptsPassed &&
    input.unresolvedEvidenceCount === 0 &&
    input.evidenceMode === 'LIVE'
  ) {
    return { status: 'VERIFIED', confidence: 'live' };
  }
  return { status: 'PROVISIONAL', confidence: 'unknown' };
}
