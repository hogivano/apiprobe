import { establishBaseline, BaselineFailedError } from '../baseline.ts';
import { familyOf, PARAM_NAMES } from '../faultload.ts';
import { countRecords } from '../util/body.ts';
import { median } from '../util/stats.ts';
import { RateLimitedError } from '../types.ts';
import type { Evidence, Probe, ProbeContext, ProbeResult, TimedResponse } from '../types.ts';

/**
 * Probe 1 — deep pagination degradation. The flagship.
 *
 * Claim: offset pagination degrades linearly with page depth; cursor
 * pagination doesn't.
 *
 * Everything hard about this probe is in not being fooled: by noise, by the
 * end of the data, by a page cap, or by a rate limiter we tripped ourselves.
 * Each guard below is a way this probe could otherwise report something untrue.
 */

/** A ratio alone is not enough — a 3ms to 9ms rise is real but irrelevant. */
const RATIO_THRESHOLD = 5;
const ABSOLUTE_THRESHOLD_MS = 500;
const SAMPLES = 5;
/**
 * Below this depth there is nothing meaningful to measure: a collection that
 * ends at page 12 cannot exhibit deep-pagination cost, and timing it would only
 * measure noise.
 */
const MIN_DEPTH_FOR_CLAIM = 50;
const SHALLOW_PAGE = 1;
const MID_PAGE = 500;
const DEEP_PAGE = 5000;

export const deepPagination: Probe = {
  name: 'deep-pagination',
  description: 'Times the endpoint at increasing page depth to detect offset pagination',
  writes: false,

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const started = performance.now();
    const before = ctx.http.used();
    const path = ctx.target.pathname + ctx.target.search;
    const done = (result: Omit<ProbeResult, 'probe' | 'requests' | 'durationMs'>): ProbeResult => ({
      probe: 'deep-pagination',
      requests: ctx.http.used() - before,
      durationMs: performance.now() - started,
      ...result,
    });

    // --- Workload phase: a noise floor, before any timing claim. ------------
    let baseline;
    try {
      baseline = await establishBaseline(ctx.http, withPage(path, SHALLOW_PAGE), SAMPLES);
    } catch (error) {
      if (error instanceof RateLimitedError) return done(rateLimited(error));
      if (error instanceof BaselineFailedError) {
        return done({
          verdict: 'INCONCLUSIVE',
          summary: 'Deep pagination not measured',
          reason: error.message,
          evidence: [],
        });
      }
      throw error;
    }

    // Which parameter drives depth here? Without a spec we can only use the
    // conventional names, and we must confirm the endpoint actually honours it.
    const depthParam = findDepthParam(ctx.target);
    if (!depthParam) {
      return done({
        verdict: 'PASS',
        summary: 'No offset pagination parameter to degrade',
        evidence: [evidence('endpoint', ctx.target.pathname)],
        explanation:
          'No page or offset parameter is in use, so there is no page depth to\n' +
          'degrade with. If this endpoint paginates, it does so by cursor, which\n' +
          'is the shape that stays flat.',
      });
    }

    try {
      // --- Is the parameter real? An ignored param is not offset pagination.
      const shallow = baseline.reference;
      const second = await ctx.http.get(setParam(path, depthParam, 2));
      if (identicalPayload(shallow, second)) {
        return done({
          verdict: 'PASS',
          summary: `\`${depthParam}\` is ignored — no depth to degrade`,
          evidence: [
            evidence('page 1 records', String(countRecords(shallow.json) ?? 'unknown')),
            evidence(`${depthParam}=2 records`, String(countRecords(second.json) ?? 'unknown')),
          ],
          explanation:
            `The endpoint returned an identical payload for ${depthParam}=1 and\n` +
            `${depthParam}=2, so it is not paginating by offset on this parameter.`,
        });
      }

      // --- Find a depth that still holds data. Empty pages are fast and prove
      // nothing, and a rejected deep page is correct behaviour, not a failure.
      const deep = await findDeepestWithData(ctx, path, depthParam, DEEP_PAGE);
      if (deep.capped) {
        return done({
          verdict: 'PASS',
          summary: `Page depth is capped at ${depthParam}=${deep.capAt}`,
          evidence: [
            evidence('rejected', `${depthParam}=${deep.rejectedAt} → HTTP ${deep.status}`),
          ],
          explanation:
            'The endpoint refuses pages beyond a bound rather than scanning to\n' +
            'them. That is the correct behaviour, and it makes deep offset scans\n' +
            'unreachable from outside.',
        });
      }
      if (deep.page === undefined) {
        return done({
          verdict: 'INCONCLUSIVE',
          summary: 'Deep pagination not measured',
          reason: 'could not find any page beyond the first that still returns records',
          evidence: [evidence('records at page 1', String(baseline.defaultRecords ?? 'unknown'))],
        });
      }

      // --- The data may simply run out before any depth worth measuring.
      if (deep.page < MIN_DEPTH_FOR_CLAIM) {
        return done({
          verdict: 'PASS',
          summary: `Collection ends before depth matters (no records past ${depthParam}=${deep.page})`,
          evidence: [
            evidence('deepest page with records', `${depthParam}=${deep.page}`),
            evidence('records there', String(deep.records ?? 'unknown')),
          ],
          explanation:
            `apiprobe found no page beyond ${depthParam}=${deep.page} holding records, so there is\n` +
            `no depth at which an offset scan could become expensive. Timing pages\n` +
            `this shallow would measure noise, not pagination.\n\n` +
            `This is a statement about the collection as it is now. If it grows by\n` +
            `orders of magnitude, run this again.`,
        });
      }

      // --- Time it at depth. Median of several, cold start already discarded.
      const midPage = Math.min(MID_PAGE, Math.max(2, Math.floor(deep.page / 10)));
      const mid = await sample(ctx, path, depthParam, midPage, SAMPLES);
      const deepTimings = await sample(ctx, path, depthParam, deep.page, SAMPLES);

      const shallowMs = baseline.medianMs;
      const deepMs = median(deepTimings);
      const ratio = deepMs / Math.max(shallowMs, 0.001);

      const rows: Evidence[] = [
        evidence(
          `${depthParam} ${SHALLOW_PAGE}`,
          `${ms(shallowMs)}`,
          `median of ${SAMPLES}, spread ±${ms(baseline.spreadMs)}`,
        ),
        evidence(`${depthParam} ${midPage}`, ms(median(mid))),
        evidence(`${depthParam} ${deep.page}`, ms(deepMs)),
      ];

      // --- Guard: is the signal bigger than the noise we measured?
      if (deepMs - shallowMs <= baseline.spreadMs * 2) {
        return done({
          verdict: 'INCONCLUSIVE',
          summary: 'Deep pagination inconclusive — signal is within the noise',
          reason:
            `page 1 varied by ±${ms(baseline.spreadMs)} across ${SAMPLES} samples, which is as ` +
            `large as the ${ms(deepMs - shallowMs)} difference at depth`,
          evidence: rows,
        });
      }

      if (ratio > RATIO_THRESHOLD && deepMs > ABSOLUTE_THRESHOLD_MS) {
        const perPage = (deepMs - shallowMs) / deep.page;
        return done({
          verdict: 'FAIL',
          summary: 'Deep pagination degrades',
          evidence: rows,
          explanation:
            `Latency grows with depth — the signature of offset pagination\n` +
            `(.skip() or OFFSET). At ${ms(perPage)} per page of depth, ${depthParam}=${deep.page * 4}\n` +
            `would take about ${ms(shallowMs + perPage * deep.page * 4)}.\n\n` +
            `Cursor pagination keeps this flat: page by a key from the last row\n` +
            `you returned instead of counting rows from the start.`,
        });
      }

      return done({
        verdict: 'PASS',
        summary: 'Deep pagination stays flat',
        evidence: rows,
        explanation:
          `Depth costs ${ratio.toFixed(1)}x, under the ${RATIO_THRESHOLD}x and ` +
          `${ABSOLUTE_THRESHOLD_MS}ms thresholds.\nThis endpoint does not scan from the ` +
          `start to reach a deep page.`,
      });
    } catch (error) {
      if (error instanceof RateLimitedError) return done(rateLimited(error));
      throw error;
    }
  },
};

/** Rising latency because we tripped a rate limiter is not offset pagination. */
function rateLimited(error: RateLimitedError) {
  return {
    verdict: 'INCONCLUSIVE' as const,
    summary: 'Deep pagination not measured',
    reason:
      `${error.message}. Latency rising after a rate limiter engages is our own ` +
      `doing, not evidence about pagination`,
    evidence: [],
  };
}

/**
 * Walk back from a deep page until one holds records. An empty result set at
 * page 5000 is fast and proves nothing.
 */
async function findDeepestWithData(
  ctx: ProbeContext,
  path: string,
  param: string,
  from: number,
): Promise<{
  page?: number;
  records?: number;
  capped: boolean;
  capAt?: number;
  rejectedAt?: number;
  status?: number;
}> {
  let page = from;
  while (page >= 2) {
    const response = await ctx.http.get(setParam(path, param, page));

    // A refused deep page is a cap, and a cap is correct behaviour.
    if (response.status >= 400 && response.status < 500) {
      return { capped: true, capAt: page, rejectedAt: page, status: response.status };
    }
    const records = countRecords(response.json);
    if (records === undefined) return { capped: false }; // cannot count — do not guess
    if (records > 0) return { page, records, capped: false };
    page = Math.floor(page / 4); // empty: the data ended before here
  }
  return { capped: false };
}

async function sample(
  ctx: ProbeContext,
  path: string,
  param: string,
  page: number,
  count: number,
): Promise<number[]> {
  const timings: number[] = [];
  for (let i = 0; i < count; i++) {
    timings.push((await ctx.http.get(setParam(path, param, page))).durationMs);
  }
  return timings;
}

/** The depth parameter already in the URL, else the conventional default. */
function findDepthParam(target: URL): string | undefined {
  for (const [param] of target.searchParams) {
    const family = familyOf(param);
    if (family === 'page-index' || family === 'offset') return param;
  }
  // Nothing in the URL says how this endpoint paginates. `page` is the
  // overwhelmingly common default; if the endpoint ignores it, the identical
  // payload check above turns that into a PASS rather than a false claim.
  return PARAM_NAMES['page-index'][0];
}

function setParam(path: string, param: string, value: number): string {
  const url = new URL(path, 'http://placeholder');
  url.searchParams.set(param, String(value));
  return `${url.pathname}${url.search}`;
}

const withPage = (path: string, page: number) =>
  setParam(path, PARAM_NAMES['page-index'][0]!, page);

function identicalPayload(a: TimedResponse, b: TimedResponse): boolean {
  return a.status === b.status && a.text === b.text;
}

function evidence(label: string, value: string, note?: string): Evidence {
  return note === undefined ? { label, value } : { label, value, note };
}

function ms(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  // A per-page cost is often a fraction of a millisecond; rounding it to "0ms"
  // would make the projection that follows look like nonsense.
  if (value < 10) return `${value.toFixed(1)}ms`;
  return `${Math.round(value)}ms`;
}
