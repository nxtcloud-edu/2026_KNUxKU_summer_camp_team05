import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCoverageIsHonest, destinationPackSchema } from '@tm/contracts';
import { closePool } from './client.js';
import { createPostgresRepositories } from './postgres.js';

/**
 * Destination Pack 동기화 — `packs/*.json` → `destination_packs`.
 *
 * Pack JSON이 원본이고 테이블은 런타임 사본이다. 이 스크립트가 없으면
 * "코드 배포 없이 목적지 추가"라는 설계가 성립하지 않는다 — 실행 중인 서비스는
 * 파일이 아니라 DB에서 읽기 때문이다.
 *
 *   npm run packs:sync --workspace @tm/db
 *
 * 스키마를 통과하지 못하거나 등급을 과대 표기한 Pack은 **넣지 않는다.**
 * 검증되지 않은 값이 DB에 들어가면 그 뒤로는 아무도 추정치인 줄 모른다.
 */

const packsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packs');

async function main(): Promise<void> {
  const files = readdirSync(packsDir).filter((name) => name.endsWith('.json'));
  if (files.length === 0) {
    console.log('packs/*.json 이 없습니다.');
    return;
  }

  const repos = createPostgresRepositories();
  let synced = 0;
  let rejected = 0;

  try {
    for (const file of files) {
      const raw = JSON.parse(readFileSync(join(packsDir, file), 'utf8')) as unknown;
      const parsed = destinationPackSchema.safeParse(raw);

      if (!parsed.success) {
        rejected += 1;
        const detail = parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(' / ');
        console.error(`  거부 ${file} — 스키마 위반: ${detail}`);
        continue;
      }

      try {
        // 등급 과대 표기는 조달 품질을 속이는 것과 같다.
        assertCoverageIsHonest(parsed.data);
      } catch (error) {
        rejected += 1;
        console.error(`  거부 ${file} — ${(error as Error).message}`);
        continue;
      }

      const row = await repos.packs.upsert(parsed.data);
      synced += 1;
      const unverified = parsed.data.verification.filter((ref) => ref.status !== 'verified').length;
      console.log(
        `  동기화 ${row.packId} (등급 ${row.coverage}, ${row.active ? '활성' : '비활성'}` +
          `${unverified > 0 ? `, 미확인 ${unverified}건` : ''})`,
      );
    }
  } finally {
    await repos.close();
  }

  console.log(`\n${synced}개 동기화${rejected > 0 ? `, ${rejected}개 거부` : ''}`);
  if (rejected > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`중단: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
