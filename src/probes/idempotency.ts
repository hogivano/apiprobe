import type { Probe, ProbeContext, ProbeResult } from '../types.ts';

/**
 * Probe 4 — retry idempotency. WRITE PROBE: off unless --allow-writes, and
 * never against a non-staging host without --confirm-production.
 *
 * Claim: a retried POST should not create two resources.
 *
 * Method: POST an identical payload twice, with the same idempotency key if the
 * API documents one, then check whether one or two resources exist.
 *
 * - Needs a way to observe the result: an id in the response, or a reachable
 *   list endpoint. If neither → INCONCLUSIVE, don't guess.
 * - Print exactly what it created so the user can clean up.
 */
export const idempotency: Probe = {
  name: 'idempotency',
  description: 'POSTs the same payload twice to see whether a retry duplicates a resource',
  writes: true,

  async run(_ctx: ProbeContext): Promise<ProbeResult> {
    return {
      probe: 'idempotency',
      verdict: 'INCONCLUSIVE',
      summary: 'Retry idempotency not yet probed',
      reason: 'probe not implemented',
      evidence: [],
      requests: 0,
      durationMs: 0,
    };
  },
};
