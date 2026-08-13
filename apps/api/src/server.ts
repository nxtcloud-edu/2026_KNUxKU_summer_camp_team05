import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { loadEnv, type Env } from './env.js';
import { registerIntakeRoutes } from './routes/intake.js';
import { registerObjectionRoutes } from './routes/objections.js';

export async function buildServer(env: Env = loadEnv()): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  // 프론트가 credentials: 'include' 로 호출하므로 와일드카드 오리진을 쓸 수 없다.
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });

  app.get('/health', async () => ({ status: 'ok', env: env.NODE_ENV }));

  await registerIntakeRoutes(app);
  await registerObjectionRoutes(app, env);

  return app;
}
