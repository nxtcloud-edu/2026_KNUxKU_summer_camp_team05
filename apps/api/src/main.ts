import { loadEnv } from './env.js';
import { buildServer } from './server.js';

/**
 * 인증이 붙기 전까지 기본 바인딩은 127.0.0.1 이다.
 * 방·설문 엔드포인트는 사용자 데이터를 다루므로 카카오 OAuth와 세션 없이 외부에 노출하지 않는다.
 * 근거: docs/development-and-deployment.md 7.6
 */
const env = loadEnv();

const app = await buildServer(env);

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
