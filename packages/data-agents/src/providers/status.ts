import { providersFromEnv } from './registry.js';

export const providerStatusIds = [
  'kakao',
  'odsay',
  'tourapi',
  'rakuten_travel',
  'hotpepper',
  'travelpayouts',
] as const;

export type ProviderStatusId = (typeof providerStatusIds)[number];

export interface ProviderStatus {
  providerId: ProviderStatusId;
  requiredEnvVars: readonly string[];
  credentialState: 'MISSING' | 'PRESENT_UNVERIFIED';
  adapterState: 'NOT_CREATED' | 'CREATED_UNVERIFIED';
  authenticationState: 'NOT_CHECKED';
  responseNormalization: 'IMPLEMENTED';
  candidateNormalization: 'HOTEL' | 'HOTEL_ONLY' | 'TRANSPORT' | 'NONE';
  automaticCandidateSupply: 'NOT_CHECKED';
}

const REQUIRED_ENV: Record<ProviderStatusId, readonly string[]> = {
  kakao: ['KAKAO_REST_API_KEY'],
  odsay: ['ODSAY_API_KEY'],
  tourapi: ['TOURAPI_SERVICE_KEY'],
  rakuten_travel: ['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY'],
  hotpepper: ['HOTPEPPER_API_KEY'],
  travelpayouts: ['TRAVELPAYOUTS_TOKEN'],
};

const CANDIDATE_NORMALIZATION: Record<
  ProviderStatusId,
  ProviderStatus['candidateNormalization']
> = {
  kakao: 'NONE',
  odsay: 'TRANSPORT',
  tourapi: 'HOTEL_ONLY',
  rakuten_travel: 'HOTEL',
  hotpepper: 'NONE',
  travelpayouts: 'NONE',
};

function hasCredential(env: NodeJS.ProcessEnv, names: readonly string[]): boolean {
  return names.every((name) => (env[name] ?? '').trim().length > 0);
}

export function providerStatuses(
  env: NodeJS.ProcessEnv = process.env,
): ProviderStatus[] {
  const setup = providersFromEnv(env);
  const created = new Set(setup.adapters.map((adapter) => adapter.id));

  return providerStatusIds.map((providerId) => {
    const requiredEnvVars = REQUIRED_ENV[providerId];
    const credentialPresent = hasCredential(env, requiredEnvVars);
    const adapterCreated = created.has(providerId);
    return {
      providerId,
      requiredEnvVars,
      credentialState: credentialPresent ? 'PRESENT_UNVERIFIED' : 'MISSING',
      adapterState: adapterCreated ? 'CREATED_UNVERIFIED' : 'NOT_CREATED',
      authenticationState: 'NOT_CHECKED',
      responseNormalization: 'IMPLEMENTED',
      candidateNormalization: CANDIDATE_NORMALIZATION[providerId],
      automaticCandidateSupply: 'NOT_CHECKED',
    };
  });
}
