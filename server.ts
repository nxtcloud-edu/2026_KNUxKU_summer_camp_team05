import Fastify from 'fastify';
import { loadEnv } from './apps/api/src/env.js';
import { createInlineWorkerQueue } from './apps/api/src/queue.js';
import { buildServer } from './apps/api/src/server.js';

const env = loadEnv();
const app = await buildServer(env, {
  app: Fastify({ logger: { level: env.LOG_LEVEL } }),
  queue: createInlineWorkerQueue(),
});

if (process.env['VERCEL'] !== '1') {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
}

export default app;
