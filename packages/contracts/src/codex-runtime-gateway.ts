import { z } from 'zod';
import { agentCategorySchema } from './agent-runtime.js';

export const codexGatewayAgentRoleSchema = z.enum([
  'USER_PROXY',
  'CANDIDATE_EVIDENCE',
  'CATEGORY_ARBITER',
  'TRIP_ORCHESTRATOR',
  'PLAN_FINALIZER',
]);

export const codexGatewayModelProfileSchema = z.enum([
  'FAST',
  'BALANCED',
  'DEEP_REASONING',
]);

export const codexGatewayReasoningEffortSchema = z.enum(['low', 'medium', 'high']);

export const codexGatewayAgentRefSchema = z
  .object({
    role: codexGatewayAgentRoleSchema,
    instanceId: z.string().min(1),
    participantId: z.string().min(1).optional(),
    category: agentCategorySchema.optional(),
    promptVersion: z.string().min(1),
    inputContractVersion: z.string().min(1),
    outputContractVersion: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.role === 'USER_PROXY' && value.participantId === undefined) {
      context.addIssue({ code: 'custom', message: 'USER_PROXY에는 participantId가 필요합니다.' });
    }
    if (value.role !== 'USER_PROXY' && value.participantId !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'USER_PROXY 외 역할에는 participantId를 전달할 수 없습니다.',
      });
    }
    const categoryScoped = new Set([
      'USER_PROXY',
      'CANDIDATE_EVIDENCE',
      'CATEGORY_ARBITER',
    ]).has(value.role);
    if (categoryScoped && value.category === undefined) {
      context.addIssue({
        code: 'custom',
        message: `${value.role}에는 category가 필요합니다.`,
      });
    }
    if (!categoryScoped && value.category !== undefined) {
      context.addIssue({
        code: 'custom',
        message: '전역 Agent 역할에는 category를 전달할 수 없습니다.',
      });
    }
  });

export const codexGatewayThreadRefSchema = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('NEW') }).strict(),
    z.object({ mode: z.literal('CONTINUE'), threadId: z.string().min(1) }).strict(),
  ]);

export const codexGatewayAgentRunRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    tripId: z.string().min(1),
    planVersion: z.number().int().nonnegative(),
    agent: codexGatewayAgentRefSchema,
    thread: codexGatewayThreadRefSchema,
    modelProfile: codexGatewayModelProfileSchema,
    reasoningEffort: codexGatewayReasoningEffortSchema,
    input: z
      .object({
        instruction: z.string().min(1).max(20_000),
        context: z.record(z.unknown()),
        evidenceIds: z.array(z.string()),
      })
      .strict(),
    outputSchema: z.record(z.unknown()),
    limits: z
      .object({
        timeoutMs: z.number().int().min(1_000).max(300_000),
        maxOutputTokens: z.number().int().min(128).max(32_768),
      })
      .strict(),
  })
  .strict();

export const codexGatewayAuthContextSchema = z
  .object({
    loginMethod: z.enum(['CHATGPT', 'CODEX_ACCESS_TOKEN', 'EXTERNAL_PROVIDER', 'UNKNOWN']),
    workspaceIdHash: z.string().nullable().optional(),
    authFingerprint: z.string().min(1),
  })
  .strict();

export const codexGatewayAgentRunResultSchema = z
  .object({
    runId: z.string().min(1),
    status: z.enum([
      'SUCCEEDED',
      'AUTH_REQUIRED',
      'MODEL_NOT_AVAILABLE',
      'RATE_LIMITED',
      'TIMED_OUT',
      'INVALID_OUTPUT',
      'FAILED',
    ]),
    authContext: codexGatewayAuthContextSchema,
    modelContext: z
      .object({
        model: z.string().min(1),
        reasoningEffort: codexGatewayReasoningEffortSchema,
        catalogFetchedAt: z.string().min(1),
      })
      .strict()
      .nullable()
      .optional(),
    threadId: z.string().nullable().optional(),
    output: z.record(z.unknown()).nullable().optional(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        cachedInputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      })
      .strict()
      .nullable()
      .optional(),
    repairUsed: z.boolean(),
    error: z
      .object({
        code: z.string().min(1),
        retryable: z.boolean(),
        safeMessage: z.string(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export const codexGatewayModelListSchema = z
  .object({
    fetchedAt: z.string(),
    models: z.array(
      z
        .object({
          model: z.string().min(1),
          isDefault: z.boolean(),
          supportedEfforts: z.array(z.string()),
          allowedProfiles: z.array(codexGatewayModelProfileSchema),
        })
        .strict(),
    ),
  })
  .strict();

export const codexGatewayReadySchema = z
  .object({
    ready: z.boolean(),
    authMode: z.string(),
    modelCount: z.number().int().nonnegative(),
    allowedModelCount: z.number().int().nonnegative(),
    allowlistConfigured: z.boolean(),
  })
  .strict();

export type CodexGatewayAgentRole = z.infer<typeof codexGatewayAgentRoleSchema>;
export type CodexGatewayModelProfile = z.infer<typeof codexGatewayModelProfileSchema>;
export type CodexGatewayAgentRunRequest = z.infer<typeof codexGatewayAgentRunRequestSchema>;
export type CodexGatewayAgentRunResult = z.infer<typeof codexGatewayAgentRunResultSchema>;
export type CodexGatewayModelList = z.infer<typeof codexGatewayModelListSchema>;
export type CodexGatewayReady = z.infer<typeof codexGatewayReadySchema>;
