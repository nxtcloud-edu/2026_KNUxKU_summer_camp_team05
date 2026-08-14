import {
  CodexGatewayAgentRuntime,
  createCodexGatewayClient,
  type AgentRuntime,
  type CodexGatewayClient,
} from '@tm/agents';

export function createWorkerCodexGateway(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): CodexGatewayClient {
  return createCodexGatewayClient({
    baseUrl: env['MOA_CODEX_GATEWAY_URL'] ?? 'http://127.0.0.1:4600',
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
}

export function createWorkerAgentRuntime(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): AgentRuntime {
  return new CodexGatewayAgentRuntime({
    client: createWorkerCodexGateway(env, fetchImpl),
  });
}
