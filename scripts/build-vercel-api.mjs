import { build } from 'esbuild';

const outfile = process.env['VERCEL_API_OUTFILE'] ?? 'api/index.mjs';

await build({
  entryPoints: ['api/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  sourcemap: true,
  external: ['pg-native'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
