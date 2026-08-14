import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { createRepositories, isDatabaseConfigured, type Repositories } from '@tm/db';
import { loadEnv, type Env } from './env.js';
import { registerIntakeRoutes } from './routes/intake.js';
import { registerDateResolutionRoutes } from './routes/date-resolution.js';
import { registerObjectionRoutes } from './routes/objections.js';
import { registerResultRoutes } from './routes/results.js';
import { registerRoomRoutes } from './routes/rooms.js';
import { registerSession } from './routes/session.js';
import { createNoopQueue, createQueue, type QueuePort } from './queue.js';

export interface ServerDeps {
  repos?: Repositories;
  queue?: QueuePort;
}

export async function buildServer(
  env: Env = loadEnv(),
  deps: ServerDeps = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  const repos = deps.repos ?? createRepositories(env.DATABASE_URL);
  // 폴백을 조용히 하지 않는다. 인메모리로 돌고 있다는 사실이 로그에 남아야 한다.
  if (repos.kind === 'memory') {
    app.log.warn('DATABASE_URL이 없어 인메모리 저장소로 실행합니다. 재시작하면 데이터가 사라집니다.');
  }

  const queue =
    deps.queue ??
    (env.ENABLE_QUEUE
      ? createQueue(env.REDIS_URL)
      : createNoopQueue((jobId) =>
          app.log.warn({ jobId }, 'ENABLE_QUEUE=false — 재실행 잡을 등록하지 않았습니다'),
        ));

  // 프론트가 credentials: 'include' 로 호출하므로 와일드카드 오리진을 쓸 수 없다.
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });

  app.get('/health', async () => ({
    status: 'ok',
    env: env.NODE_ENV,
    storage: repos.kind,
    database: isDatabaseConfigured(env.DATABASE_URL),
    queue: env.ENABLE_QUEUE,
  }));

  // 세션이 먼저다. onRequest 훅이 모든 라우트보다 앞서 userId를 채운다.
  await registerSession(app);

  await registerIntakeRoutes(app, repos);
  await registerRoomRoutes(app, repos, queue);
  await registerDateResolutionRoutes(app, repos);
  await registerObjectionRoutes(app, env, repos, queue);
  await registerResultRoutes(app, repos);

  app.addHook('onClose', async () => {
    await queue.close();
    await repos.close();
  });

  return app;
}
