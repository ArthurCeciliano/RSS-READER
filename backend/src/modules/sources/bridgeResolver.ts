export type BridgeSourceType = 'instagram' | 'tiktok';

export interface BridgeConfig {
  instances: string[];
  routeTemplate: string;
}

/**
 * Expands the configured bridge instances + route template into concrete
 * candidate feed URLs for a username, in priority order. Kept separate from
 * fetching so failover (module 1: "múltiplas instâncias ... com failover
 * automático") is just "try candidates[0], then [1], ..." in the ingest loop.
 */
export function buildBridgeCandidateUrls(username: string, config: BridgeConfig): string[] {
  const path = config.routeTemplate.replace(':username', username);
  return config.instances.map((instance) => `${instance.replace(/\/$/, '')}${path}`);
}
