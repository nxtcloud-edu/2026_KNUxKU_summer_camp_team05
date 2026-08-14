import { readFileSync } from 'node:fs';
import { mvpStayFixtureInputSchema } from '@tm/contracts';
import { runMvpStayFixture } from './mvp-fixture-run.js';

const fixture = mvpStayFixtureInputSchema.parse(
  JSON.parse(
    readFileSync(
      new URL(
        '../../../packages/contracts/fixtures/mvp-agent-runtime/osaka-stay-run.v1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as unknown,
);

const result = await runMvpStayFixture(fixture);
console.log(JSON.stringify(result, null, 2));
