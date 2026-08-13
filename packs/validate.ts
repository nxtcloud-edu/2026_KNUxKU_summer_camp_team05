import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertCoverageIsHonest, destinationPackSchema, maxAllowedCoverage } from '@tm/contracts';

const dir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = readdirSync(dir).filter((name) => name.endsWith('.json'));

let failed = 0;
for (const file of files) {
  const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;
  const parsed = destinationPackSchema.safeParse(raw);
  if (!parsed.success) {
    failed += 1;
    console.error(`FAIL ${file}`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    continue;
  }
  try {
    assertCoverageIsHonest(parsed.data);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${file}: ${(error as Error).message}`);
    continue;
  }
  const pending = parsed.data.verification.filter((ref) => ref.status !== 'verified').length;
  console.log(
    `ok   ${file}  coverage=${parsed.data.coverage} (max ${maxAllowedCoverage(parsed.data)}) 미검증 ${pending}건`,
  );
}

if (failed > 0) process.exit(1);
