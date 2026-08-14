import type { z } from 'zod';
import {
  codexGatewayAgentRunRequestSchema,
  codexGatewayAgentRunResultSchema,
  codexGatewayModelListSchema,
  codexGatewayReadySchema,
  type CodexGatewayAgentRunRequest,
  type CodexGatewayAgentRunResult,
  type CodexGatewayModelList,
  type CodexGatewayReady,
} from '@tm/contracts';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);

export class CodexGatewayHttpError extends Error {
  constructor(readonly status: number) {
    super(`Codex Gateway HTTP ${status}`);
    this.name = 'CodexGatewayHttpError';
  }
}

export class CodexGatewayResponseError extends Error {
  constructor() {
    super('Codex Gateway 응답이 계약과 일치하지 않습니다.');
    this.name = 'CodexGatewayResponseError';
  }
}

export interface CodexGatewayClient {
  ready(): Promise<CodexGatewayReady>;
  listModels(): Promise<CodexGatewayModelList>;
  run(request: CodexGatewayAgentRunRequest): Promise<CodexGatewayAgentRunResult>;
}

export interface CodexGatewayClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

function localhostBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('MVP Codex Gateway는 loopback HTTP 주소만 사용할 수 있습니다.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function createCodexGatewayClient(options: CodexGatewayClientOptions): CodexGatewayClient {
  const baseUrl = localhostBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, init);
    if (!response.ok) throw new CodexGatewayHttpError(response.status);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new CodexGatewayResponseError();
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new CodexGatewayResponseError();
    return parsed.data;
  }

  return {
    ready: () => request('/readyz', codexGatewayReadySchema),
    listModels: () => request('/internal/v1/models', codexGatewayModelListSchema),
    run(runRequest) {
      const payload = codexGatewayAgentRunRequestSchema.parse(runRequest);
      return request('/internal/v1/agent-runs', codexGatewayAgentRunResultSchema, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
  };
}
