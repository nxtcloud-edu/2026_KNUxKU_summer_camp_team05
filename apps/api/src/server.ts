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
import { currentUserId } from './routes/session.js';
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

  // SameSite=None 쿠키를 쓰는 공개 환경에서는 CORS만으로 쓰기 요청을 보호할 수 없다.
  // 브라우저의 unsafe method는 정확히 허용된 프론트 Origin에서만 받는다.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== env.WEB_ORIGIN) {
      return reply.status(403).send({ error: 'origin_not_allowed' });
    }
  });

  app.get('/health', async () => ({
    status: 'ok',
    env: env.NODE_ENV,
    storage: repos.kind,
    database: isDatabaseConfigured(env.DATABASE_URL),
    queue: env.ENABLE_QUEUE,
  }));

  // 세션이 먼저다. onRequest 훅이 모든 라우트보다 앞서 userId를 채운다.
  await registerSession(app, env);

  // roomId는 초대 capability다. 입장 endpoint만 공개하고, 나머지 방 데이터와 동작은
  // 현재 서명 세션이 해당 방의 멤버일 때만 허용한다.
  app.addHook('preHandler', async (request, reply) => {
    const pattern = request.routeOptions.url;
    if (pattern === undefined || !pattern.startsWith('/api/rooms/:roomId')) return;
    if (request.method === 'POST' && pattern === '/api/rooms/:roomId/members') return;
    const { roomId } = request.params as { roomId?: string };
    if (roomId === undefined) return;
    if ((await repos.rooms.get(roomId)) === undefined) {
      return reply.status(404).send({ error: 'room_not_found' });
    }
    if ((await repos.members.get(roomId, currentUserId(request))) === undefined) {
      return reply.status(403).send({ error: 'room_access_denied' });
    }
  });

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
