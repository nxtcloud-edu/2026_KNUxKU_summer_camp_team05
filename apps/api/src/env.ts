import { z } from 'zod';

/**
 * 환경변수는 여기서 한 번만 읽고 검증한다.
 * 기본값이 있으므로 .env 없이도 로컬에서 기동된다.
 * 상한 기본값 근거: travel-mediation-plan.md 12.4 · 10.2, agent-architecture.md 11장
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('debug'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_HOST: z.string().default('127.0.0.1'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DATABASE_URL: z.string().optional(),
  /** 방 단위 이의 제기 상한 */
  OBJECTION_CAP_PER_ROOM: z.coerce.number().int().min(0).default(3),
  /** 1인 이의 제기 상한 */
  OBJECTION_CAP_PER_USER: z.coerce.number().int().min(0).default(1),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`환경변수 검증 실패 — ${detail}`);
  }
  return parsed.data;
}
