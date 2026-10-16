import { BudgetExhaustedError, RateLimitedError } from '../types.ts';
import type { HttpClient, ResolvedConfig, TimedResponse } from '../types.ts';

/**
 * The only way a probe talks to the network. Centralising it is what enforces
 * the safety rules: a hard request cap so a run cannot become a load test, and
 * a 429 that aborts the probe instead of hammering the target.
 */
export function createClient(target: URL, config: ResolvedConfig): HttpClient {
  let used = 0;

  const baseHeaders: Record<string, string> = {
    accept: 'application/json',
    'user-agent': 'apiprobe',
    ...config.headers,
  };
  if (config.token) baseHeaders['authorization'] = `Bearer ${config.token}`;

  async function request(method: string, path: string, body?: unknown, init?: RequestInit) {
    if (used >= config.maxRequests) {
      throw new BudgetExhaustedError(`request budget of ${config.maxRequests} exhausted`);
    }
    used += 1;

    const url = new URL(path, target);
    const headers = { ...baseHeaders, ...(init?.headers as Record<string, string> | undefined) };
    if (body !== undefined) headers['content-type'] = 'application/json';

    const startedAt = performance.now();
    const response = await fetch(url, {
      ...init,
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const text = await response.text();
    const durationMs = performance.now() - startedAt;

    if (response.status === 429) {
      throw new RateLimitedError(`target returned 429 after ${used} requests`);
    }

    const result: TimedResponse = {
      status: response.status,
      headers: response.headers,
      text,
      bytes: Buffer.byteLength(text),
      durationMs,
    };
    try {
      result.json = JSON.parse(text) as unknown;
    } catch {
      // Not JSON. Probes decide what that means; body.looksLikeHtml() helps.
    }
    return result;
  }

  return {
    get: (path, init) => request('GET', path, undefined, init),
    post: (path, body, init) => request('POST', path, body, init),
    remaining: () => config.maxRequests - used,
    used: () => used,
  };
}
