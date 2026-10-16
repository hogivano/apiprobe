import type { ProbeConfig, ResolvedConfig } from './types.ts';

export const DEFAULTS = {
  maxRequests: 250,
  timeoutMs: 10_000,
  allowWrites: false,
  confirmProduction: false,
} as const;

const STAGING_HINTS = ['localhost', '127.0.0.1', 'staging', 'stg', 'dev', 'test', 'sandbox'];

/** A host we are willing to send write probes at without a second flag. */
export function looksLikeStaging(target: URL): boolean {
  const host = target.hostname.toLowerCase();
  return STAGING_HINTS.some((hint) => host === hint || host.includes(hint));
}

export function resolveConfig(config: ProbeConfig): ResolvedConfig {
  const resolved: ResolvedConfig = {
    target: config.target,
    headers: config.headers ?? {},
    maxRequests: config.maxRequests ?? DEFAULTS.maxRequests,
    timeoutMs: config.timeoutMs ?? DEFAULTS.timeoutMs,
    allowWrites: config.allowWrites ?? DEFAULTS.allowWrites,
    confirmProduction: config.confirmProduction ?? DEFAULTS.confirmProduction,
  };
  if (config.token !== undefined) resolved.token = config.token;
  if (config.only !== undefined) resolved.only = config.only;
  return resolved;
}
