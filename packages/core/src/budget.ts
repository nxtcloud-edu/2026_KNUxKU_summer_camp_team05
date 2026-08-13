/**
 * 토큰·비용 미터 — run 하나의 LLM 지출을 결정론적으로 집계하고 상한을 집행한다.
 *
 * 왜 코드가 하는가: 상한 집행을 LLM에게 맡기면 상한이 아니다. Supervisor는 "예산이
 * 얼마 남았는지" 서술할 수 있지만, 남은 금액을 계산하고 축약 모드로 강등하는 것은
 * 코드다 (agent-architecture.md 3.1 INV-1 · 4.3 V6).
 *
 * 단가·최소 캐시 프리픽스는 llm-runtime-config.md 2장·3.2의 표를 그대로 옮긴 것이다.
 * 실측 전까지 `RUN_COST_CAP_USD`는 예산이 아니라 가드레일이다 (3.3).
 */

export interface ModelPricing {
  /** 100만 입력 토큰당 USD */
  inputPerMTok: number;
  /** 100만 출력 토큰당 USD */
  outputPerMTok: number;
  /**
   * 프롬프트 캐싱이 걸리는 최소 프리픽스 길이(토큰).
   * 이 길이를 넘지 못하면 오류도 경고도 없이 캐시가 그냥 안 걸린다 (3.2).
   */
  minCachePrefixTokens: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25, minCachePrefixTokens: 512 },
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15, minCachePrefixTokens: 1024 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5, minCachePrefixTokens: 4096 },
};

/**
 * 단가표에 모델을 추가한다.
 *
 * 에이전트를 다른 게이트웨이(사내 ECS + 외부 Auth 계정 등)로 태우면 모델 이름이
 * `claude-*`가 아닐 수 있다. `costOfUsage`는 모르는 모델에 대해 **예외를 던지므로**
 * (조용히 0원으로 세면 상한이 무력화된다) 호출 전에 여기 등록해야 한다.
 *
 * 단가를 모르면 등록하지 않는 편이 낫다 — 실행이 실패하는 쪽이 원가가 소리 없이
 * 새는 쪽보다 낫다.
 */
export function registerModelPricing(model: string, pricing: ModelPricing): void {
  MODEL_PRICING[model] = pricing;
}

export function knownModels(): string[] {
  return Object.keys(MODEL_PRICING);
}

/** 캐시 읽기 0.1배 · 쓰기 1.25배(5분 TTL) · 배치 0.5배 (llm-runtime-config 3.1·3.2) */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const BATCH_MULTIPLIER = 0.5;

const PER_MTOK = 1_000_000;

export interface UsageSample {
  model: string;
  /** 캐시 히트가 아닌 입력 토큰 */
  inputTokens: number;
  outputTokens: number;
  /** 캐시에서 읽은 토큰. 0이면 캐싱이 걸리지 않은 것이다 */
  cacheReadTokens?: number;
  /** 캐시에 쓴 토큰 */
  cacheWriteTokens?: number;
  /** Batch API로 처리됐는가. 모든 토큰이 절반 단가다 */
  batch?: boolean;
}

/**
 * 호출 1건의 원가(USD).
 *
 * 모르는 모델은 0원이 아니라 예외다. 조용히 0으로 세면 상한이 무력화된다.
 */
export function costOfUsage(sample: UsageSample): number {
  const pricing = MODEL_PRICING[sample.model];
  if (pricing === undefined) {
    throw new Error(
      `단가를 모르는 모델입니다: ${sample.model}. MODEL_PRICING에 추가하세요 (llm-runtime-config.md 2장)`,
    );
  }

  const batch = sample.batch === true ? BATCH_MULTIPLIER : 1;
  const input = sample.inputTokens * pricing.inputPerMTok;
  const output = sample.outputTokens * pricing.outputPerMTok;
  const cacheRead = (sample.cacheReadTokens ?? 0) * pricing.inputPerMTok * CACHE_READ_MULTIPLIER;
  const cacheWrite = (sample.cacheWriteTokens ?? 0) * pricing.inputPerMTok * CACHE_WRITE_MULTIPLIER;

  return ((input + output + cacheRead + cacheWrite) / PER_MTOK) * batch;
}

/**
 * 공유 프리픽스가 모델의 최소 캐시 길이를 넘는지.
 * 페르소나를 haiku로 돌리면 4,096토큰을 넘지 않는 한 캐시가 아예 걸리지 않는다.
 */
export function cacheWillEngage(model: string, sharedPrefixTokens: number): boolean {
  const pricing = MODEL_PRICING[model];
  if (pricing === undefined) return false;
  return sharedPrefixTokens >= pricing.minCachePrefixTokens;
}

/**
 * 지출 모드.
 * - `normal`   평소대로
 * - `reduced`  축약 모드. V6가 제안을 강등시키는 지점 (발화 길이·후보 수를 줄인다)
 * - `exhausted` 더 쓸 수 없다. 남은 라운드는 기존 결과로 마감한다
 */
export type SpendMode = 'normal' | 'reduced' | 'exhausted';

export interface MeterSnapshot {
  usdCap: number;
  usdSpent: number;
  usdRemaining: number;
  turnsCap: number;
  turnsUsed: number;
  turnsRemaining: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  mode: SpendMode;
}

/** 원장에 그대로 넣을 수 있는 형태. `llm_usage` 컬럼과 맞춘다 */
export interface MeterCharge {
  requestId: string;
  purpose: string;
  model: string;
  promptVersion: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
  batch: boolean;
}

export interface ChargeInput extends UsageSample {
  /** 멱등 키. 같은 requestId를 두 번 청구하면 두 번째는 무시된다 */
  requestId: string;
  /** 'supervisor.dispatch' | 'referee.flight' | 'persona.statement' 등 */
  purpose: string;
  promptVersion?: string | null;
  /** 이 호출이 소비한 턴 수. 기본 1 */
  turns?: number;
}

export interface RunMeter {
  /** 지출을 기록한다. 상한을 넘어도 던지지 않는다 — 기록은 남기고 모드로 알린다 */
  charge(input: ChargeInput): { charge: MeterCharge; snapshot: MeterSnapshot; duplicate: boolean };
  /** 이 호출을 하면 상한을 넘는가. 호출 **전에** 묻는다 */
  wouldExceed(sample: UsageSample): boolean;
  /** 상한을 넘으면 던진다. 넘어서는 안 되는 호출 앞에서만 쓴다 */
  guard(sample: UsageSample): void;
  snapshot(): MeterSnapshot;
}

export class BudgetExceededError extends Error {
  constructor(
    readonly usdCap: number,
    readonly usdSpent: number,
  ) {
    super(`원가 상한 초과: $${usdSpent.toFixed(4)} / $${usdCap.toFixed(2)}`);
    this.name = 'BudgetExceededError';
  }
}

export interface MeterOptions {
  usdCap: number;
  turnsCap: number;
  /** 이 비율을 넘으면 축약 모드로 강등한다. 기본 0.8 */
  reducedAt?: number;
}

const DEFAULT_REDUCED_AT = 0.8;

export function createRunMeter(options: MeterOptions): RunMeter {
  const reducedAt = options.reducedAt ?? DEFAULT_REDUCED_AT;
  const charged = new Set<string>();

  let usdSpent = 0;
  let turnsUsed = 0;
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;

  const modeOf = (): SpendMode => {
    if (usdSpent >= options.usdCap || turnsUsed >= options.turnsCap) return 'exhausted';
    if (usdSpent >= options.usdCap * reducedAt) return 'reduced';
    return 'normal';
  };

  const snapshot = (): MeterSnapshot => ({
    usdCap: options.usdCap,
    usdSpent,
    usdRemaining: Math.max(0, options.usdCap - usdSpent),
    turnsCap: options.turnsCap,
    turnsUsed,
    turnsRemaining: Math.max(0, options.turnsCap - turnsUsed),
    calls,
    inputTokens,
    outputTokens,
    cacheTokens,
    mode: modeOf(),
  });

  return {
    charge(input) {
      const costUsd = costOfUsage(input);
      const cache = (input.cacheReadTokens ?? 0) + (input.cacheWriteTokens ?? 0);
      const charge: MeterCharge = {
        requestId: input.requestId,
        purpose: input.purpose,
        model: input.model,
        promptVersion: input.promptVersion ?? null,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cacheTokens: cache,
        costUsd,
        batch: input.batch === true,
      };

      // 잡 재시도로 같은 호출이 두 번 들어오면 원가를 두 번 세지 않는다.
      if (charged.has(input.requestId)) {
        return { charge, snapshot: snapshot(), duplicate: true };
      }

      charged.add(input.requestId);
      usdSpent += costUsd;
      turnsUsed += input.turns ?? 1;
      calls += 1;
      inputTokens += input.inputTokens;
      outputTokens += input.outputTokens;
      cacheTokens += cache;

      return { charge, snapshot: snapshot(), duplicate: false };
    },

    wouldExceed(sample) {
      return usdSpent + costOfUsage(sample) > options.usdCap;
    },

    guard(sample) {
      const projected = usdSpent + costOfUsage(sample);
      if (projected > options.usdCap) throw new BudgetExceededError(options.usdCap, projected);
    },

    snapshot,
  };
}
