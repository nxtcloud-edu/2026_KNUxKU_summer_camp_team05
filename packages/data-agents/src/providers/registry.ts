import { createStaticRegistry, type ProviderAdapter, type ProviderRegistry } from '../provider.js';
import { hotPepperFromEnv } from './hotpepper.js';
import { kakaoFromEnv } from './kakao.js';
import { odsayFromEnv } from './odsay.js';
import { rakutenFromEnv } from './rakuten.js';
import { tourApiFromEnv } from './tourapi.js';
import { travelpayoutsFromEnv } from './travelpayouts.js';

/**
 * 환경변수에 키가 있는 제공자만 모아 레지스트리를 만든다.
 *
 * 키가 없으면 어댑터를 만들지 않고 **어느 제공자가 빠졌는지 보고한다.** 조용히 빠지면
 * "후보가 하나도 없는 이유"를 아무도 모르는 채 라운드가 돈다 (침묵 금지, 11장).
 *
 * ── 여기 없는 제공자와 그 이유 (2026-08-14 재조사) ──────────────────────────
 *   · `amadeus`  — Self-Service 포털이 2026-07-17에 완전 종료됐다. 신규 등록 불가,
 *                  기존 키 비활성화. 어댑터를 지웠다.
 *   · `gurunavi` — 무료 API가 2021-06-30에 종료되고 법인 유료로 바뀌었다.
 *   · `navitime` — 상용 유료. 무료 티어가 없다.
 *   · `jnto`     — 공개 셀프서비스 API가 확인되지 않는다.
 *   · `google_*` — SKU별 무료 한도는 있으나 결제 계정(카드) 등록이 전제다.
 *                  캠프 기간에는 켜지 않는다.
 *
 * 빈 슬롯은 사실처럼 메우지 않는다. 발표를 위해서는 `demo-fixture`가 가짜임을
 * 드러낸 채로 채운다 (providers/demo.ts).
 */

export interface ProviderSetup {
  adapters: ProviderAdapter[];
  /** 키가 없어 제외된 제공자와 필요한 환경변수 */
  missing: { id: string; envVars: string[] }[];
  registry(packProviders?: Record<string, Record<string, readonly string[]>>): ProviderRegistry;
}

const SOURCES: { id: string; envVars: string[]; create: (env: NodeJS.ProcessEnv) => ProviderAdapter | null }[] = [
  { id: 'kakao', envVars: ['KAKAO_REST_API_KEY'], create: kakaoFromEnv },
  { id: 'odsay', envVars: ['ODSAY_API_KEY'], create: odsayFromEnv },
  { id: 'tourapi', envVars: ['TOURAPI_SERVICE_KEY'], create: tourApiFromEnv },
  { id: 'rakuten_travel', envVars: ['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY'], create: rakutenFromEnv },
  { id: 'hotpepper', envVars: ['HOTPEPPER_API_KEY'], create: hotPepperFromEnv },
  { id: 'travelpayouts', envVars: ['TRAVELPAYOUTS_TOKEN'], create: travelpayoutsFromEnv },
];

export function providersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  extra: readonly ProviderAdapter[] = [],
): ProviderSetup {
  const adapters: ProviderAdapter[] = [...extra];
  const missing: ProviderSetup['missing'] = [];

  for (const source of SOURCES) {
    const adapter = source.create(env);
    if (adapter === null) missing.push({ id: source.id, envVars: source.envVars });
    else adapters.push(adapter);
  }

  return {
    adapters,
    missing,
    registry(packProviders = {}) {
      return createStaticRegistry(adapters, packProviders);
    },
  };
}
