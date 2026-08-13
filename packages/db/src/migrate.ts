import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool } from './client.js';

/**
 * 최소 마이그레이션 러너. 적용된 버전을 schema_migrations에 기록하고 미적용분만 실행한다.
 * 각 파일은 하나의 트랜잭션으로 적용된다 — 절반만 적용된 스키마를 만들지 않는다.
 */
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function main(): Promise<void> {
  const pool = getPool();
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );

  const applied = new Set(
    (await pool.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
      (row) => row.version,
    ),
  );

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) {
      console.log(`skip  ${version}`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      console.log(`apply ${version}`);
      count += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`마이그레이션 실패 ${version}: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }

  console.log(count === 0 ? '변경 없음' : `${count}개 적용 완료`);
}

try {
  await main();
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
