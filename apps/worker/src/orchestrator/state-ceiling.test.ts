import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stateCeilingForRound } from './state-ceiling.js';

test('토론 결론만 있고 검증 영수증이 없으면 PROVISIONAL이다', () => {
  assert.deepEqual(
    stateCeilingForRound({
      blocked: false,
      verificationReceiptsPassed: false,
      unresolvedEvidenceCount: 0,
      evidenceMode: 'LIVE',
    }),
    { status: 'PROVISIONAL', confidence: 'unknown' },
  );
});

test('fixture는 모든 검사 결과가 좋아도 VERIFIED가 아니다', () => {
  assert.deepEqual(
    stateCeilingForRound({
      blocked: false,
      verificationReceiptsPassed: true,
      unresolvedEvidenceCount: 0,
      evidenceMode: 'FIXTURE',
    }),
    { status: 'PROVISIONAL', confidence: 'unknown' },
  );
});

test('LIVE 근거와 검증 영수증이 모두 통과한 경우에만 VERIFIED다', () => {
  assert.deepEqual(
    stateCeilingForRound({
      blocked: false,
      verificationReceiptsPassed: true,
      unresolvedEvidenceCount: 0,
      evidenceMode: 'LIVE',
    }),
    { status: 'VERIFIED', confidence: 'live' },
  );
});

test('명시적 차단은 다른 상태보다 우선한다', () => {
  assert.deepEqual(
    stateCeilingForRound({
      blocked: true,
      verificationReceiptsPassed: true,
      unresolvedEvidenceCount: 0,
      evidenceMode: 'LIVE',
    }),
    { status: 'BLOCKED', confidence: 'unknown' },
  );
});
