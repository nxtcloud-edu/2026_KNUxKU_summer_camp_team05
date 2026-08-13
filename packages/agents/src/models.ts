import { registerModelPricing } from '@tm/core';

/**
 * 모델 배분과 단가 등록 — Gemini 무료 티어.
 *
 * 제공자를 Anthropic에서 Gemini 무료 티어로 바꾸면 **상한의 성질이 바뀐다.**
 * 종량제에서는 돈이 상한이었지만, 무료 티어에서 run을 죽이는 것은 비용이 아니라
 * 레이트리밋(429)이다. 그래서 `RUN_COST_CAP_USD`는 여기서 사실상 무의미해지고,
 * 실제 가드레일은 `rate-limit.ts`의 RPM·RPD다.
 *
 * 그럼에도 단가를 **명시적으로 0으로 등록한다.** `costOfUsage`는 모르는 모델에
 * 예외를 던지는데(조용히 0으로 세면 상한이 무력화되므로) 그 안전장치를 우회하지
 * 않으면서 "무료임을 알고 있다"는 사실을 코드로 남기는 방법이 이것뿐이다.
 * 토큰 수는 계속 원장(`llm_usage`)에 쌓인다 — 레이트리밋 튜닝의 원본이 그 값이다.
 *
 * 근거: docs/llm-runtime-config.md (2장·3장은 Anthropic 종량제 전제라 이 파일이 대체한다)
 */

/** 역할. 원장의 `purpose` 접두사와 같다 */
export const agentRoles = ['supervisor', 'referee', 'persona', 'document'] as const;
export type AgentRole = (typeof agentRoles)[number];

/**
 * 역할별 기본 모델.
 *
 * 배분 근거: 페르소나가 발화 수로 압도적이므로 가장 가벼운 모델에 둔다. 심판은
 * 판결문의 품질이 곧 서비스 품질이라 한 단계 위다. Supervisor는 호출이 드물지만
 * 순서 판단이 틀리면 라운드 전체가 어긋나므로 심판과 같은 티어에 둔다.
 *
 * **확정이 아니다.** 품질이 부족하면 티어를 올리는 것이 먼저다 (llm-runtime-config 2장).
 */
export const defaultModels: Record<AgentRole, string> = {
  supervisor: 'gemini-2.5-flash',
  referee: 'gemini-2.5-flash',
  persona: 'gemini-2.5-flash-lite',
  document: 'gemini-2.5-flash',
};

/**
 * 무료 티어 모델의 단가 — 전부 0이다.
 *
 * `minCachePrefixTokens`를 0으로 두는 이유: Anthropic의 "최소 프리픽스를 넘지
 * 못하면 캐시가 조용히 안 걸린다"는 제약은 Gemini의 암묵적 캐싱과 조건이 다르다.
 * 확인하지 못한 값을 그럴듯하게 적어두면 `cacheWillEngage`가 거짓을 말하게 되므로,
 * **모른다는 뜻으로 0을 둔다.** 유료 전환 시 실측해서 채운다.
 */
export const freeTierModels = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
] as const;

let registered = false;

/**
 * 단가표에 무료 티어 모델을 등록한다. 호출하지 않으면 `costOfUsage`가 예외를 던진다.
 * 프로세스당 한 번이면 충분하고, 여러 번 불러도 안전하다.
 */
export function registerFreeTierPricing(): void {
  if (registered) return;
  for (const model of freeTierModels) {
    registerModelPricing(model, {
      inputPerMTok: 0,
      outputPerMTok: 0,
      // 0 = "확인하지 못했다". 추정값을 넣으면 cacheWillEngage가 거짓말을 한다.
      minCachePrefixTokens: 0,
    });
  }
  registered = true;
}

/**
 * 무료 티어 레이트리밋 기본값.
 *
 * **이 숫자는 검증 대상이다.** 무료 티어 한도는 Google이 수시로 바꾸고 모델마다
 * 다르다. 그래서 실제 한도를 여기 단정하지 않고 **보수적인 값**을 기본으로 두고
 * 환경변수로 덮어쓰게 한다. 넘겨 잡으면 429를 맞고, 낮게 잡으면 느릴 뿐이다 —
 * 둘 중 안전한 쪽을 기본으로 한다.
 *
 * 실제 한도는 https://ai.google.dev/gemini-api/docs/rate-limits 에서 확인하고
 * `GEMINI_RPM` · `GEMINI_RPD`로 올린다.
 */
export const conservativeRateLimits = {
  requestsPerMinute: 10,
  requestsPerDay: 200,
} as const;

export interface ModelConfig {
  apiKey: string;
  models: Record<AgentRole, string>;
  requestsPerMinute: number;
  requestsPerDay: number;
}

/** 키가 없으면 만들지 않는다. 무엇이 빠졌는지 알려주고 호출자가 판단한다 */
export function modelConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { config: ModelConfig } | { missing: string[] } {
  const apiKey = env['GEMINI_API_KEY'] ?? '';
  if (apiKey.length === 0) return { missing: ['GEMINI_API_KEY'] };

  const positive = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  };

  return {
    config: {
      apiKey,
      models: {
        supervisor: env['GEMINI_MODEL_SUPERVISOR'] ?? defaultModels.supervisor,
        referee: env['GEMINI_MODEL_REFEREE'] ?? defaultModels.referee,
        persona: env['GEMINI_MODEL_PERSONA'] ?? defaultModels.persona,
        document: env['GEMINI_MODEL_DOCUMENT'] ?? defaultModels.document,
      },
      requestsPerMinute: positive(env['GEMINI_RPM'], conservativeRateLimits.requestsPerMinute),
      requestsPerDay: positive(env['GEMINI_RPD'], conservativeRateLimits.requestsPerDay),
    },
  };
}
