import { establishBaseline, BaselineFailedError } from '../baseline.ts';
import { FailureMode } from '../failure-modes.ts';
import { applyRule, PARAM_NAMES, rulesFor } from '../faultload.ts';
import { countRecords, isErrorEnvelope } from '../util/body.ts';
import { RateLimitedError } from '../types.ts';
import type { Evidence, Probe, ProbeContext, ProbeResult, TimedResponse } from '../types.ts';

/**
 * Probe 2 — unbounded result sets.
 *
 * Claim: a list endpoint with no upper bound on page size can be made to
 * return its whole table.
 *
 * Records are counted in the parsed body. Byte size is never a proxy — that
 * is precisely the OWASP bug this tool exists to not repeat.
 */

/** The size we ask for. Large enough that no sane API intends to serve it. */
const ABUSIVE = 100_000;
/** A count at or above this is "effectively the whole table", not a page. */
const UNBOUNDED_RECORDS = 1_000;
/** Used to discover which alias the endpoint actually honours. */
const PROBE_SIZE = 3;

export const unboundedLimit: Probe = {
  name: 'unbounded-limit',
  description: 'Asks for 100,000 records to see whether the endpoint caps page size',
  writes: false,

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const started = performance.now();
    const before = ctx.http.used();
    const path = ctx.target.pathname + ctx.target.search;
    const done = (result: Omit<ProbeResult, 'probe' | 'requests' | 'durationMs'>): ProbeResult => ({
      probe: 'unbounded-limit',
      requests: ctx.http.used() - before,
      durationMs: performance.now() - started,
      ...result,
    });

    let baseline;
    try {
      baseline = await establishBaseline(ctx.http, path, 3);
    } catch (error) {
      if (error instanceof RateLimitedError) return done(rateLimited(error));
      if (error instanceof BaselineFailedError) {
        return done({
          verdict: 'INCONCLUSIVE',
          summary: 'Result-set bound not measured',
          reason: error.message,
          evidence: [],
        });
      }
      throw error;
    }

    if (baseline.defaultRecords === undefined) {
      return done({
        verdict: 'INCONCLUSIVE',
        summary: 'Result-set bound not measured',
        reason: 'could not find a record collection in the response body to count',
        evidence: [evidence('body keys', Object.keys(baseline.reference.json ?? {}).join(', ') || 'none')],
      });
    }

    try {
      // The endpoint may already return everything without being asked.
      if (baseline.defaultRecords >= UNBOUNDED_RECORDS) {
        return done({
          verdict: 'FAIL',
          summary: 'Endpoint returns an unbounded result set by default',
          failureMode: FailureMode.SILENT,
          evidence: [
            evidence('records', baseline.defaultRecords.toLocaleString()),
            evidence('bytes', baseline.reference.bytes.toLocaleString()),
            evidence('duration', `${Math.round(baseline.medianMs)}ms`),
          ],
          explanation:
            'A plain request returns the whole collection. No page size needed to\n' +
            'be supplied, so a client cannot avoid it. Add a default page size and\n' +
            'a maximum.',
        });
      }

      // --- Which page-size alias does this endpoint honour? ------------------
      const param = await findSizeParam(ctx, path, baseline.defaultRecords);
      if (!param) {
        return done({
          verdict: 'PASS',
          summary: `Page size is fixed at ${baseline.defaultRecords} and not client-controlled`,
          evidence: [
            evidence('default records', String(baseline.defaultRecords)),
            evidence('tried', PARAM_NAMES['page-size'].join(', ')),
          ],
          explanation:
            'No conventional page-size parameter changed the number of records\n' +
            'returned, so a client cannot widen the page. Note this is a claim\n' +
            'about the parameter names apiprobe knows; an unconventional name\n' +
            'would not be found.',
        });
      }

      // --- Apply the page-size fault rules from the catalogue. ---------------
      const rules = rulesFor('page-size').filter((rule) =>
        ['size.huge', 'size.zero', 'size.negative'].includes(rule.id),
      );

      const rows: Evidence[] = [evidence('page-size parameter', param)];
      const seen = new Map<string, TimedResponse>();
      let worst: { records: number; response: TimedResponse; rule: string } | undefined;

      for (const rule of rules) {
        const response = await ctx.http.get(applyRule(new URL(path, ctx.target), param, rule));
        seen.set(rule.id, response);
        const outcome = describe(response);
        rows.push(evidence(`${param}=${sentValue(rule.id)}`, outcome.label, outcome.note));

        if (outcome.records !== undefined && outcome.records >= UNBOUNDED_RECORDS) {
          if (!worst || outcome.records > worst.records) {
            worst = { records: outcome.records, response, rule: rule.id };
          }
        }
      }

      if (worst) {
        return done({
          verdict: 'FAIL',
          summary: `No upper bound on \`${param}\``,
          failureMode: FailureMode.SILENT,
          evidence: [
            ...rows,
            evidence('records returned', worst.records.toLocaleString()),
            evidence('bytes', worst.response.bytes.toLocaleString()),
            evidence('duration', `${Math.round(worst.response.durationMs)}ms`),
          ],
          explanation:
            `The endpoint honoured \`${param}\` without capping it, returning\n` +
            `${worst.records.toLocaleString()} records in one response. Any client — or anyone with the\n` +
            `URL — can pull the whole table in a single request.\n\n` +
            `Cap it server-side: take min(requested, MAX) rather than trusting the\n` +
            `parameter, and reject values outside the range.`,
        });
      }

      // Nothing was unbounded. Report the cap we already observed — no extra
      // request; the budget is not ours to spend twice.
      const capped = seen.get('size.huge')!;
      const cap = countRecords(capped.json);
      const misleading = capped.status < 300 && capped.json !== undefined && isErrorEnvelope(capped.json);

      return done({
        verdict: 'PASS',
        summary: misleading
          ? `Page size is bounded, but the refusal is dressed as success`
          : `Page size is capped${cap !== undefined ? ` at ${cap}` : ''}`,
        evidence: rows,
        explanation: misleading
          ? `Asking for ${ABUSIVE.toLocaleString()} was refused, which is correct — but the refusal came\n` +
            `back as HTTP ${capped.status} carrying an error body. Clients checking the status\n` +
            `will read that as success. Return a 4xx.`
          : `Asking for ${ABUSIVE.toLocaleString()} did not widen the page, so the bound is enforced\n` +
            `server-side rather than trusted from the client.`,
      });
    } catch (error) {
      if (error instanceof RateLimitedError) return done(rateLimited(error));
      throw error;
    }
  },
};

function rateLimited(error: RateLimitedError) {
  return {
    verdict: 'INCONCLUSIVE' as const,
    summary: 'Result-set bound not measured',
    reason: `${error.message}. Backed off rather than continuing`,
    evidence: [],
  };
}

/**
 * Find the page-size parameter by asking for a small, unmistakable count. An
 * endpoint that returns exactly what we asked for is honouring the parameter;
 * one that ignores it returns its default.
 */
async function findSizeParam(
  ctx: ProbeContext,
  path: string,
  defaultRecords: number,
): Promise<string | undefined> {
  if (defaultRecords === PROBE_SIZE) return undefined; // can't distinguish; don't guess
  for (const candidate of PARAM_NAMES['page-size']) {
    const url = new URL(path, ctx.target);
    url.searchParams.set(candidate, String(PROBE_SIZE));
    const response = await ctx.http.get(`${url.pathname}${url.search}`);
    if (response.status >= 300) continue;
    if (countRecords(response.json) === PROBE_SIZE) return candidate;
  }
  return undefined;
}

function describe(response: TimedResponse): { label: string; note?: string; records?: number } {
  if (response.status >= 400) {
    return { label: `HTTP ${response.status}`, note: 'rejected — correct' };
  }
  if (response.json !== undefined && isErrorEnvelope(response.json)) {
    return { label: `HTTP ${response.status}`, note: 'error body under a success status' };
  }
  const records = countRecords(response.json);
  if (records === undefined) {
    return { label: `HTTP ${response.status}`, note: 'records not countable' };
  }
  return { label: `${records.toLocaleString()} records`, records };
}

function sentValue(ruleId: string): string {
  return ruleId === 'size.huge' ? String(ABUSIVE) : ruleId === 'size.zero' ? '0' : '-1';
}

function evidence(label: string, value: string, note?: string): Evidence {
  return note === undefined ? { label, value } : { label, value, note };
}
