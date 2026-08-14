import assert from 'node:assert/strict';
import { test } from 'node:test';
import { providerStatuses } from './status.js';

test('Key가 없으면 Adapter와 인증을 완료로 표시하지 않는다', () => {
  const statuses = providerStatuses({} as NodeJS.ProcessEnv);
  assert.equal(statuses.length, 6);
  assert.equal(statuses.every((status) => status.credentialState === 'MISSING'), true);
  assert.equal(statuses.every((status) => status.adapterState === 'NOT_CREATED'), true);
  assert.equal(statuses.every((status) => status.authenticationState === 'NOT_CHECKED'), true);
});

test('Key가 있어도 실제 인증과 자동 연결은 미확인으로 남긴다', () => {
  const statuses = providerStatuses({ ODSAY_API_KEY: 'secret-value' } as NodeJS.ProcessEnv);
  const odsay = statuses.find((status) => status.providerId === 'odsay');
  assert.equal(odsay?.credentialState, 'PRESENT_UNVERIFIED');
  assert.equal(odsay?.adapterState, 'CREATED_UNVERIFIED');
  assert.equal(odsay?.authenticationState, 'NOT_CHECKED');
  assert.equal(odsay?.candidateNormalization, 'TRANSPORT');
  assert.equal(odsay?.automaticCandidateSupply, 'NOT_CHECKED');
  assert.equal(JSON.stringify(statuses).includes('secret-value'), false);
});
