import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildGroundedIndex,
  checkUtterance,
  factcheckGate,
  type GroundedCandidate,
} from './factcheck.js';

/**
 * 발화 단위 팩트체크. 근거: agent-architecture.md 6.9 · 7장
 *
 * 핵심 규칙: 조달된 후보 밖의 '주소'와 '비용'은 발화에 나올 수 없다.
 */

const hotel: GroundedCandidate = {
  externalId: 'hotel_namba_01',
  amountsKrw: [82_000, 246_000],
  addresses: ['오사카시 주오구 난바 3-1-1'],
  times: ['15:00', '11:00'],
  durationsMin: [12],
};

const web: GroundedCandidate = {
  externalId: 'web_blog_02',
  amountsKrw: [50_000],
  advisory: true,
};

const rejected: GroundedCandidate = {
  externalId: 'hotel_far_03',
  amountsKrw: [60_000],
  disqualified: true,
};

const index = buildGroundedIndex([hotel, web, rejected]);

test('조달된 후보의 금액을 인용하면 통과한다', () => {
  const result = checkUtterance({
    speaker: 'referee',
    text: '난바 호텔은 1박 82,000원입니다.',
    claims: [{ kind: 'price', externalId: 'hotel_namba_01', value: 82_000 }],
    index,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test('조달되지 않은 후보를 근거로 들면 차단한다', () => {
  const result = checkUtterance({
    speaker: 'referee',
    text: '도톤보리 호텔이 더 좋습니다.',
    claims: [{ kind: 'reference', externalId: 'hotel_dotonbori_99' }],
    index,
  });

  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.kind, 'unknown_candidate');
  assert.equal(result.violations[0]?.severity, 'block');
});

test('후보에 없는 금액을 말하면 차단한다', () => {
  const result = checkUtterance({
    speaker: 'referee',
    text: '난바 호텔은 1박 70,000원입니다.',
    claims: [{ kind: 'price', externalId: 'hotel_namba_01', value: 70_000 }],
    index,
  });

  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.kind === 'price_mismatch'));
});

test('반올림 오차는 허용 오차 안에서 통과한다', () => {
  const result = checkUtterance({
    speaker: 'referee',
    text: '난바 호텔은 82,500원입니다.',
    claims: [{ kind: 'price', externalId: 'hotel_namba_01', value: 82_500 }],
    index,
  });

  assert.equal(result.ok, true);
});

test('주소는 후보의 주소와 정확히 대조한다', () => {
  const wrong = checkUtterance({
    speaker: 'referee',
    text: '주소는 오사카시 기타구 우메다 1-1입니다.',
    claims: [{ kind: 'address', externalId: 'hotel_namba_01', value: '오사카시 기타구 우메다 1-1' }],
    index,
  });
  assert.equal(wrong.ok, false);
  assert.ok(wrong.violations.some((violation) => violation.kind === 'address_not_grounded'));

  // 공백 차이는 같은 주소로 본다
  const spaced = checkUtterance({
    speaker: 'referee',
    text: '주소를 확인했습니다.',
    claims: [{ kind: 'address', externalId: 'hotel_namba_01', value: '오사카시 주오구  난바 3-1-1' }],
    index,
  });
  assert.equal(spaced.ok, true);
});

test('본문에만 슬쩍 들어간 금액도 잡는다', () => {
  // 주장으로는 제출하지 않고 문장에만 넣는 것이 실제 환각 경로다.
  const result = checkUtterance({
    speaker: 'referee',
    text: '난바 호텔(82,000원)이 좋고, 조식은 15,000원 정도 듭니다.',
    claims: [{ kind: 'price', externalId: 'hotel_namba_01', value: 82_000 }],
    index,
  });

  assert.equal(result.ok, false);
  const unsourced = result.violations.find((violation) => violation.kind === 'unsourced_number');
  assert.equal(unsourced?.observed, 15_000);
});

test('코드가 계산한 값은 allowedNumbers로 허용한다', () => {
  const result = checkUtterance({
    speaker: 'referee',
    text: '3박 합계는 246,000원, 1인당 61,500원입니다.',
    claims: [{ kind: 'price', externalId: 'hotel_namba_01', value: 246_000 }],
    index,
    allowedNumbers: [61_500],
  });

  assert.equal(result.ok, true);
});

test('만원 단위 표기도 인식한다', () => {
  const result = checkUtterance({
    speaker: 'referee',
    text: '숙소는 8.2만원입니다.',
    claims: [{ kind: 'price', externalId: 'hotel_namba_01', value: 82_000 }],
    index,
  });

  assert.equal(result.ok, true);
});

test('페르소나의 근거 없는 수치는 차단이 아니라 표기다', () => {
  // 페르소나는 선호를 말하는 자리다. 모든 숫자를 막으면 토론이 서지 않는다.
  const result = checkUtterance({
    speaker: 'persona',
    text: '저는 5만원 넘으면 부담스러워요.',
    claims: [],
    index,
  });

  assert.equal(result.ok, true);
  assert.equal(factcheckGate(result).decision, 'annotate');
});

test('심판의 근거 없는 수치는 차단이다', () => {
  const result = checkUtterance({
    speaker: 'referee',
    text: '평균 숙박비는 95,000원입니다.',
    claims: [],
    index,
  });

  assert.equal(result.ok, false);
  assert.equal(factcheckGate(result).decision, 'reject');
});

test('advisory(웹·RAG) 근거로 사실을 단정하면 심판은 차단된다', () => {
  const result = checkUtterance({
    speaker: 'referee',
    text: '블로그 기준 50,000원입니다.',
    claims: [{ kind: 'price', externalId: 'web_blog_02', value: 50_000 }],
    index,
  });

  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.kind === 'advisory_as_fact'));
});

test('실격된 후보를 근거로 삼으면 차단한다', () => {
  const result = checkUtterance({
    speaker: 'referee',
    text: '이 숙소가 가장 쌉니다.',
    claims: [{ kind: 'reference', externalId: 'hotel_far_03' }],
    index,
  });

  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.kind === 'disqualified_candidate'));
});

test('체크인 시각은 후보 값과 대조한다', () => {
  const ok = checkUtterance({
    speaker: 'referee',
    text: '체크인은 15:00입니다.',
    claims: [{ kind: 'time', externalId: 'hotel_namba_01', value: '15:00' }],
    index,
  });
  assert.equal(ok.ok, true);

  const wrong = checkUtterance({
    speaker: 'referee',
    text: '체크인은 14:00입니다.',
    claims: [{ kind: 'time', externalId: 'hotel_namba_01', value: '14:00' }],
    index,
  });
  assert.equal(wrong.ok, false);
});

test('소요시간 불일치는 경고로 남긴다 (측정 오차가 있다)', () => {
  const result = checkUtterance({
    speaker: 'referee',
    text: '역에서 40분 걸립니다.',
    claims: [{ kind: 'duration', externalId: 'hotel_namba_01', value: 40 }],
    index,
  });

  assert.equal(result.ok, true, '차단은 아니다');
  assert.equal(factcheckGate(result).decision, 'annotate');
});

test('게이트는 재발화 사유를 만들어준다', () => {
  const result = checkUtterance({
    speaker: 'referee',
    text: '난바 호텔은 70,000원입니다.',
    claims: [{ kind: 'price', externalId: 'hotel_namba_01', value: 70_000 }],
    index,
  });
  const gate = factcheckGate(result);

  assert.equal(gate.decision, 'reject');
  assert.ok(gate.retryHint !== null);
  assert.match(gate.retryHint as string, /조달된 후보/);
});

test('위반이 없으면 그대로 통과시킨다', () => {
  const gate = factcheckGate(
    checkUtterance({ speaker: 'system', text: '라운드를 시작합니다.', index }),
  );

  assert.equal(gate.decision, 'accept');
  assert.equal(gate.retryHint, null);
});
