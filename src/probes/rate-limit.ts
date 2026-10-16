import type { Probe, ProbeContext, ProbeResult } from '../types.ts';

export const BURST_REQUESTS = 60;
export const BURST_WINDOW_MS = 20_000;

/**
 * Probe 5 — rate limiting presence.
 *
 * Method: a bounded burst (60 requests over 20s), watching for 429 or
 * RateLimit-* / X-RateLimit-* headers.
 *
 * - Headers present → PASS, report the stated budget WITHOUT exhausting it.
 * - 429 observed    → PASS.
 * - Neither         → "none observed at this rate". Never "no rate limiting":
 *   we proved a negative only within our budget, and claiming more would be
 *   the OWASP mistake again.
 */
export const rateLimit: Probe = {
  name: 'rate-limit',
  description: 'Sends a bounded burst to see whether a rate limit is observable',
  writes: false,

  async run(_ctx: ProbeContext): Promise<ProbeResult> {
    return {
      probe: 'rate-limit',
      verdict: 'INCONCLUSIVE',
      summary: 'Rate limiting not yet probed',
      reason: 'probe not implemented',
      evidence: [],
      requests: 0,
      durationMs: 0,
    };
  },
};
