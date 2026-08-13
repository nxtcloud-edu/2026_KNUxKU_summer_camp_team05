import { createStaticRegistry, type ProviderAdapter, type ProviderRegistry } from '../provider.js';
import { amadeusFromEnv } from './amadeus.js';
import { odsayFromEnv } from './odsay.js';
import { tourApiFromEnv } from './tourapi.js';

/**
 * 환경변수에 키가 있는 제공자만 모아 레지스트리를 만든다.
 *
 * 키가 없으면 어댑터를 만들지 않고 **어느 제공자가 빠졌는지 보고한다.** 조용히 빠지면
 * "후보가 하나도 없는 이유"를 아무도 모르는 채 라운드가 돈다 (침묵 금지, 11장).
 */

export interface ProviderSetup {
  adapters: ProviderAdapter[];
  /** 키가 없어 제외된 제공자와 필요한 환경변수 */
  missing: { id: string; envVars: string[] }[];
  registry(packProviders?: Record<string, Record<string, readonly string[]>>): ProviderRegistry;
}

const SOURCES: { id: string; envVars: string[]; create: (env: NodeJS.ProcessEnv) => ProviderAdapter | null }[] = [
  { id: 'amadeus', envVars: ['AMADEUS_CLIENT_ID', 'AMADEUS_CLIENT_SECRET'], create: amadeusFromEnv },
  { id: 'odsay', envVars: ['ODSAY_API_KEY'], create: odsayFromEnv },
  { id: 'tourapi', envVars: ['TOUR_API_KEY'], create: tourApiFromEnv },
];

export function providersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  extra: readonly ProviderAdapter[] = [],
): ProviderSetup {
  const adapters: ProviderAdapter[] = [...extra];
  const missing: ProviderSetup['missing'] = [];

  for (const source of SOURCES) {
    const adapter = source.create(env);
    if (adapter === null) missing.push({ id: source.id, envVars: source.envVars });
    else adapters.push(adapter);
  }

  return {
    adapters,
    missing,
    registry(packProviders = {}) {
      return createStaticRegistry(adapters, packProviders);
    },
  };
}
