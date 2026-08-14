import { runCanonicalStayContractFixture } from './canonical-fixture-run.js';

const result = await runCanonicalStayContractFixture();
console.log(JSON.stringify(result, null, 2));
