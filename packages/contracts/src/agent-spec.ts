import { z } from 'zod';

/**
 * MOA에서 LLM을 사용하는 논리적 Agent 역할.
 * 실제 모델 이름과 Codex 인증 정보는 AgentSpec이 아니라 Runtime Gateway가 결정한다.
 */
export const agentRoles = [
  'PARTICIPANT_PROXY',
  'DEBATE_SUPERVISOR',
  'CATEGORY_WATCHER',
  'CANDIDATE_SEARCH',
  'LOGIC_AUDITOR',
  'RESULT_FINALIZER',
] as const;

export type AgentRole = (typeof agentRoles)[number];

/** 모델 이름이 아니라 비용·속도·추론 깊이에 관한 의도다. */
export const modelProfiles = ['FAST', 'BALANCED', 'DEEP_REASONING'] as const;
export type ModelProfile = (typeof modelProfiles)[number];

export const privacyScopes = ['PARTICIPANT', 'CATEGORY', 'TRIP'] as const;
export type PrivacyScope = (typeof privacyScopes)[number];

export const threadModes = ['PERSISTENT', 'EPHEMERAL'] as const;
export type ThreadMode = (typeof threadModes)[number];

export const threadKeyDimensions = [
  'tripId',
  'planVersion',
  'role',
  'participantId',
  'debateIssueId',
  'category',
] as const;
export type ThreadKeyDimension = (typeof threadKeyDimensions)[number];

/** Gateway가 재시도할 수 있는 일시적 오류만 허용한다. */
export const retryableAgentErrorCodes = [
  'RATE_LIMITED',
  'TIMED_OUT',
  'RUNTIME_UNAVAILABLE',
] as const;
export type RetryableAgentErrorCode = (typeof retryableAgentErrorCodes)[number];

const idSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);

const versionSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^v\d+(?:\.\d+){0,2}$/);

const uniqueStringArray = z
  .array(z.string().min(1).max(100))
  .max(32)
  .refine((values) => new Set(values).size === values.length, {
    message: '중복된 항목을 허용하지 않습니다.',
  });

/**
 * 배포 시 등록되는 정적 Agent 정의.
 * runId, tripId, participantId, 실제 model/threadId 같은 실행 값은 포함하지 않는다.
 */
export const agentSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    specId: idSchema,
    role: z.enum(agentRoles),
    displayName: z.string().min(1).max(80),
    description: z.string().min(1).max(500),
    enabled: z.boolean(),

    prompt: z
      .object({
        promptId: idSchema,
        version: versionSchema,
      })
      .strict(),

    contracts: z
      .object({
        inputSchemaId: idSchema,
        inputSchemaVersion: versionSchema,
        outputSchemaId: idSchema,
        outputSchemaVersion: versionSchema,
        /** 자연어 자유 형식이 아니라 등록된 JSON Schema를 강제한다. */
        strictOutput: z.literal(true),
        /** 최초 응답 실패 뒤 같은 thread에서 허용하는 schema repair 횟수. */
        outputRepairAttempts: z.number().int().min(0).max(1),
      })
      .strict(),

    model: z
      .object({
        profile: z.enum(modelProfiles),
        /** model/list에서 실제 지원 여부를 확인하는 동적 문자열이다. */
        preferredReasoningEffort: z.string().min(1).max(30),
        /** 다른 모델·계정으로 조용히 바꾸지 않는다. */
        unavailablePolicy: z.literal('FAIL_CLOSED'),
      })
      .strict(),

    execution: z
      .object({
        sandbox: z.literal('READ_ONLY'),
        approvalPolicy: z.literal('NEVER'),
        sideEffectPolicy: z.literal('PROPOSE_ONLY'),
        /** 빈 배열은 모든 도구 거부를 뜻한다. */
        allowedToolIds: uniqueStringArray,
        maxToolCallsPerRun: z.number().int().min(0).max(20),
        timeoutMs: z.number().int().min(1_000).max(300_000),
        maxOutputTokens: z.number().int().min(64).max(32_768),
        maxThreadTurns: z.number().int().min(1).max(100),
      })
      .strict(),

    privacy: z
      .object({
        scope: z.enum(privacyScopes),
        /** Orchestrator가 원본 DB를 이 projection으로 축소한 뒤 Agent에 전달한다. */
        contextProjectionId: idSchema,
        crossParticipantRawProfileAccess: z.literal(false),
        credentialsAccess: z.literal('NONE'),
        directDatabaseAccess: z.literal('NONE'),
      })
      .strict(),

    thread: z
      .object({
        mode: z.enum(threadModes),
        keyDimensions: z.array(z.enum(threadKeyDimensions)).max(threadKeyDimensions.length),
        staleOnPlanVersionChange: z.literal(true),
        retentionDays: z.number().int().min(0).max(30),
      })
      .strict(),

    retry: z
      .object({
        /** 최초 실행을 포함한 총 시도 횟수다. */
        maxAttempts: z.number().int().min(1).max(3),
        retryableErrorCodes: z.array(z.enum(retryableAgentErrorCodes)).max(3),
        backoff: z
          .object({
            strategy: z.literal('EXPONENTIAL_JITTER'),
            initialDelayMs: z.number().int().min(100).max(30_000),
            maxDelayMs: z.number().int().min(100).max(120_000),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((spec, context) => {
    const uniqueDimensions = new Set(spec.thread.keyDimensions);
    if (uniqueDimensions.size !== spec.thread.keyDimensions.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['thread', 'keyDimensions'],
        message: 'thread key dimension은 중복될 수 없습니다.',
      });
    }

    if (spec.thread.mode === 'EPHEMERAL') {
      if (spec.thread.keyDimensions.length !== 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['thread', 'keyDimensions'],
          message: 'EPHEMERAL thread에는 key dimension을 지정하지 않습니다.',
        });
      }
      if (spec.thread.retentionDays !== 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['thread', 'retentionDays'],
          message: 'EPHEMERAL thread의 retentionDays는 0이어야 합니다.',
        });
      }
    }

    if (spec.thread.mode === 'PERSISTENT') {
      const requiredDimensions: ThreadKeyDimension[] = ['tripId', 'planVersion', 'role'];
      for (const dimension of requiredDimensions) {
        if (!uniqueDimensions.has(dimension)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['thread', 'keyDimensions'],
            message: `PERSISTENT thread에는 ${dimension}가 필요합니다.`,
          });
        }
      }
      if (spec.thread.retentionDays < 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['thread', 'retentionDays'],
          message: 'PERSISTENT thread의 retentionDays는 1 이상이어야 합니다.',
        });
      }
    }

    if (
      spec.role === 'PARTICIPANT_PROXY' &&
      (spec.privacy.scope !== 'PARTICIPANT' ||
        !uniqueDimensions.has('participantId') ||
        !uniqueDimensions.has('debateIssueId') ||
        spec.thread.mode !== 'PERSISTENT')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['privacy', 'scope'],
        message:
          'PARTICIPANT_PROXY는 PARTICIPANT 범위와 participantId·debateIssueId가 포함된 PERSISTENT thread를 사용해야 합니다.',
      });
    }

    if (
      (spec.role === 'CATEGORY_WATCHER' || spec.role === 'CANDIDATE_SEARCH') &&
      spec.privacy.scope !== 'CATEGORY'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['privacy', 'scope'],
        message: `${spec.role}는 CATEGORY 개인정보 범위를 사용해야 합니다.`,
      });
    }

    if (
      spec.role !== 'PARTICIPANT_PROXY' &&
      spec.role !== 'CATEGORY_WATCHER' &&
      spec.role !== 'CANDIDATE_SEARCH' &&
      spec.privacy.scope !== 'TRIP'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['privacy', 'scope'],
        message: `${spec.role}는 TRIP 개인정보 범위를 사용해야 합니다.`,
      });
    }

    if (spec.retry.backoff.maxDelayMs < spec.retry.backoff.initialDelayMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['retry', 'backoff', 'maxDelayMs'],
        message: 'maxDelayMs는 initialDelayMs 이상이어야 합니다.',
      });
    }

    if (spec.retry.maxAttempts === 1 && spec.retry.retryableErrorCodes.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['retry', 'retryableErrorCodes'],
        message: '재시도하지 않는 Agent는 retryableErrorCodes를 비워야 합니다.',
      });
    }
  });

export type AgentSpec = z.infer<typeof agentSpecSchema>;

export function parseAgentSpec(value: unknown): AgentSpec {
  return agentSpecSchema.parse(value);
}
