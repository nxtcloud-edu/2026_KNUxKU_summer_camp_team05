import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataRequest } from '@tm/contracts';
import { cacheKey, canonicalize, missingKeyParams } from './canonical.js';

const base = (params: Record<string, unknown>, queryClass = 'hotel.vacancy_price'): DataRequest =>
  ({
    requestId: 'rq_1',
    runId: 'run_1',
    roundId: 'r_2',
    callerId: 'referee:accommodation',
    queryClass,
    purpose: 'exploration',
    packId: 'jp-osaka',
    params,
  }) as DataRequest;

test('키 순서가 달라도 같은 캐시 키가 나온다', () => {
  const a = base({ hotelId: 'H1', checkIn: '2026-10-16', checkOut: '2026-10-18', guests: 6 });
  const b = base({ guests: 6, checkOut: '2026-10-18', checkIn: '2026-10-16', hotelId: 'H1' });
  assert.equal(cacheKey(a), cacheKey(b));
});

test('A11: 인원수가 다르면 캐시 키가 다르다', () => {
  const one = base({ hotelId: 'H1', checkIn: '2026-10-16', checkOut: '2026-10-18', guests: 1 });
  const six = base({ hotelId: 'H1', checkIn: '2026-10-16', checkOut: '2026-10-18', guests: 6 });
  assert.notEqual(cacheKey(one), cacheKey(six));
});

test('좌표는 5자리로 반올림해 캐시가 쪼개지지 않는다', () => {
  const a = canonicalize({ lat: 34.693737, lng: 135.502253 });
  const b = canonicalize({ lat: 34.6937371, lng: 135.5022534 });
  assert.deepEqual(a, b);
  assert.equal(a['lat'], 34.69374);
});

test('배열은 정렬된다 — 알레르겐 순서가 캐시를 쪼개지 않는다', () => {
  const a = canonicalize({ allergens: ['땅콩', '갑각류'] });
  const b = canonicalize({ allergens: ['갑각류', '땅콩'] });
  assert.deepEqual(a, b);
});

test('ISO 시각의 밀리초는 키에 들어가지 않는다', () => {
  const a = canonicalize({ departAt: '2026-10-16T09:30:00.123Z' });
  const b = canonicalize({ departAt: '2026-10-16T09:30:00.999Z' });
  assert.deepEqual(a, b);
});

test('필수 캐시 키 파라미터 누락을 잡아낸다', () => {
  const missing = missingKeyParams(base({ hotelId: 'H1', checkIn: '2026-10-16' }));
  assert.deepEqual(missing.sort(), ['checkOut', 'guests']);
  assert.deepEqual(
    missingKeyParams(base({ hotelId: 'H1', checkIn: '2026-10-16', checkOut: '2026-10-18', guests: 6 })),
    [],
  );
});
