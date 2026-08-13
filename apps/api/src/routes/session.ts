import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionView } from '@tm/contracts';

/**
 * 간이 세션 — 사용자를 식별하는 최소 장치.
 *
 * 카카오 OAuth는 범위 밖이다(team-assignments 4.2). 그렇다고 `x-user-id` 헤더에
 * 계속 의존하면 브라우저는 사용자를 기억하지 못하고, 초대 링크로 들어온 참여자가
 * 새로고침 한 번에 남이 된다. 그래서 **신원이 아니라 연속성**만 제공한다.
 *
 * 이것이 인증이 아니라는 점이 중요하다. 쿠키 값은 서명되지 않았고 위조할 수 있다.
 * 그러므로 **인증이 붙기 전까지 API를 외부에 노출하지 않는다** (development-and-deployment 7.6).
 *
 * 우선순위: `x-user-id` 헤더 > 쿠키 > 신규 발급
 * 헤더가 우선인 이유는 기존 스모크 스크립트와 워커 검증 경로를 깨지 않기 위해서다.
 */

const COOKIE_NAME = 'moa_uid';
/** 방 하나의 수명(설문 → 결과 확인)을 덮을 만큼. 30일 */
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

declare module 'fastify' {
  interface FastifyRequest {
    /** 이 요청의 사용자. onRequest 훅이 항상 채운다 */
    userId: string;
  }
}

const newUserId = (): string => `u_${randomBytes(9).toString('base64url')}`;

/** 헤더 문자열에서 쿠키 하나를 꺼낸다. 의존성을 늘리지 않으려고 직접 파싱한다 */
function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = decodeURIComponent(part.slice(index + 1).trim());
    return value.length === 0 ? null : value;
  }
  return null;
}

/**
 * 이 요청의 사용자. 라우트는 헤더를 직접 읽지 않고 항상 이 함수를 쓴다 —
 * 읽는 곳이 여러 군데면 어떤 곳은 쿠키를 무시하게 된다.
 */
export const currentUserId = (request: FastifyRequest): string => request.userId;

export async function registerSession(app: FastifyInstance): Promise<void> {
  // 기본값이 있어야 Fastify가 요청 객체 shape를 미리 잡는다.
  app.decorateRequest('userId', '');

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const fromHeader = request.headers['x-user-id'];
    const header = typeof fromHeader === 'string' && fromHeader.length > 0 ? fromHeader : null;
    const cookie = readCookie(request.headers.cookie, COOKIE_NAME);

    if (header !== null) {
      // 스크립트·테스트 경로. 쿠키를 덮어쓰지 않는다.
      request.userId = header;
      return;
    }
    if (cookie !== null) {
      request.userId = cookie;
      return;
    }

    const issued = newUserId();
    request.userId = issued;
    // SameSite=Lax로 충분하다. localhost:5173 → localhost:3001은 포트만 다르므로
    // 교차 사이트가 아니다(사이트는 등록 가능 도메인 기준). Secure는 배포에서 붙인다.
    reply.header(
      'Set-Cookie',
      `${COOKIE_NAME}=${encodeURIComponent(issued)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}`,
    );
  });

  /** 현재 사용자 확인. 프론트가 앱 진입 시 한 번 호출해 식별자를 확보한다 */
  app.get(
    '/api/session',
    async (request): Promise<SessionView> => ({
      userId: currentUserId(request),
      // 이것은 인증이 아니다. 프론트가 이 값을 권한 판단에 쓰면 안 된다.
      authenticated: false,
    }),
  );
}
