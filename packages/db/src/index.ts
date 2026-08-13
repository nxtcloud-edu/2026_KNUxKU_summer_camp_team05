import { isDatabaseConfigured } from './client.js';
import { createMemoryRepositories } from './memory.js';
import { createPostgresRepositories } from './postgres.js';
import type { Repositories } from './ports.js';

export * from './ports.js';
export { isDatabaseConfigured, getPool, query, queryOne, withTransaction, closePool } from './client.js';
export { createMemoryRepositories } from './memory.js';
export { createPostgresRepositories } from './postgres.js';

/**
 * DATABASE_URL이 있으면 PostgreSQL, 없으면 인메모리.
 * 폴백을 조용히 하지 않는다 — 어느 저장소를 쓰는지 로그로 드러낸다.
 */
export function createRepositories(databaseUrl = process.env['DATABASE_URL']): Repositories {
  return isDatabaseConfigured(databaseUrl)
    ? createPostgresRepositories()
    : createMemoryRepositories();
}
