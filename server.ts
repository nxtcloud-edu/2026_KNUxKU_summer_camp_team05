import Fastify from 'fastify';
import { loadEnv } from './apps/api/src/env.js';
import { createInlineWorkerQueue } from './apps/api/src/queue.js';
import { buildServer } from './apps/api/src/server.js';

const env = loadEnv();
export const appPromise = buildServer(env, {
  app: Fastify({ logger: { level: env.LOG_LEVEL } }),
  queue: createInlineWorkerQueue(),
});

export default appPromise;
