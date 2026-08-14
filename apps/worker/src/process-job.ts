import { createRepositories, isDatabaseConfigured, type Repositories } from '@tm/db';
import { executeRun, sharedLegacyGeminiRuntime } from './run-once.js';
import { executeCanonicalProductionRun } from './canonical-production-run.js';
import { alreadyApplied, recordFailure } from './run-recorder.js';
import type { JobPayload } from './queue.js';

export async function processJobPayload(repos: Repositories, payload: JobPayload) {
  const applied = await alreadyApplied(repos, payload);
  if (applied !== null) {
    return { skipped: true, canonical: payload.kind === 'full_run' } as const;
  }

  if (payload.kind === 'full_run') {
    const result = await executeCanonicalProductionRun(repos, payload);
    return {
      skipped: false,
      canonical: true,
      executionStatus: result.executionStatus,
      resultStatus: result.resultStatus,
    } as const;
  }

  sharedLegacyGeminiRuntime();
  const result = await executeRun(repos, payload);
  return {
    skipped: false,
    canonical: false,
    completedRounds: result.completedRounds,
    fallbackCount: result.fallbackCount,
  } as const;
}

export async function executeServerlessJob(payload: JobPayload) {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL이 없습니다. Worker는 인메모리 저장소로 실행할 수 없습니다.');
  }

  const repos = createRepositories();
  try {
    return await processJobPayload(repos, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordFailure(repos, payload, message);
    throw error;
  } finally {
    await repos.close();
  }
}
