import type { Probe, ProbeContext, ProbeResult } from '../types.ts';

/**
 * Probe 3 — error envelope consistency.
 *
 * Claim: clients can't handle errors uniformly if the shape changes per status.
 *
 * Method: deliberately trigger 400 (bad param), 401 (no auth), 403 (wrong auth
 * if two token types are available), 404 (bogus id), and 405 if safely
 * reachable. Compare the JSON shape of each.
 *
 * - Report the shape per status and which keys differ.
 * - HTML where JSON was expected is the loudest finding.
 * - Don't try to force a 500; note one only if it appears incidentally.
 */
export const errorEnvelope: Probe = {
  name: 'error-envelope',
  description: 'Triggers 400/401/404 and compares the JSON shape of each error',
  writes: false,

  async run(_ctx: ProbeContext): Promise<ProbeResult> {
    return {
      probe: 'error-envelope',
      verdict: 'INCONCLUSIVE',
      summary: 'Error shapes not yet compared',
      reason: 'probe not implemented',
      evidence: [],
      requests: 0,
      durationMs: 0,
    };
  },
};
