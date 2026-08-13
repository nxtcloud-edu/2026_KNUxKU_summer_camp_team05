// pg는 CommonJS 모듈이라 ESM 네임드 임포트를 제공하지 않는다. default에서 꺼낸다.
import pg from 'pg';
import type { Pool as PgPool, PoolClient, QueryResultRow } from 'pg';

const { Pool } = pg;
type Pool = PgPool;

/**
 * 연결 풀은 프로세스당 하나만 만든다.
 * DATABASE_URL이 없으면 연결하지 않는다 — API는 인메모리 저장소로 폴백한다.
 */
let pool: Pool | null = null;

export function getPool(databaseUrl = process.env['DATABASE_URL']): Pool {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL이 설정되지 않았습니다');
  }
  pool ??= new Pool({ connectionString: databaseUrl, max: 10 });
  return pool;
}

export function isDatabaseConfigured(databaseUrl = process.env['DATABASE_URL']): boolean {
  return databaseUrl !== undefined && databaseUrl.length > 0;
}

export async function query<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(sql, params);
  return rows[0];
}

/**
 * 트랜잭션. 이의 접수와 잡 등록처럼 함께 성공해야 하는 작업에 쓴다.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool === null) return;
  await pool.end();
  pool = null;
}
