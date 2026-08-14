import {
  CodexGatewayAgentRuntime,
  createCodexGatewayClient,
  type AgentRuntime,
  type CodexGatewayClient,
} from '@tm/agents';

function agentTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env['MOA_CODEX_AGENT_TIMEOUT_MS'];
  if (raw === undefined) return 60_000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1_000 || value > 300_000) {
    throw new Error('MOA_CODEX_AGENT_TIMEOUT_MS must be an integer between 1000 and 300000.');
  }
  return value;
}

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
    timeoutMs: agentTimeoutMs(env),
  });
}
