import { median, spread } from './util/stats.ts';
import { countRecords, isErrorEnvelope } from './util/body.ts';
import type { HttpClient, TimedResponse } from './types.ts';

/**
 * The workload phase.
 *
 * bBOXRT runs a Workload generator before its Faultload generator: valid
 * requests first, to learn how the service behaves in the absence of faults,
 * keeping the interactions that returned 2XX for later mutation. apiprobe does
 * the same thing, for the same reason and one more: apiprobe requires a noise
 * floor before any timing claim, and page 1 sampled five times gives both.
 *
 * No probe should make a claim without one of these.
 */
export interface Baseline {
  /** A known-good response, the one probes mutate from. */
  reference: TimedResponse;
  /** Median latency of the valid workload, in ms. Cold start discarded. */
  medianMs: number;
  /** Half the observed range — the noise floor a signal must clear. */
  spreadMs: number;
  /** Records the endpoint returns by default, or undefined if not countable. */
  defaultRecords: number | undefined;
  samples: number;
}

export class BaselineFailedError extends Error {}

/**
 * Sample a valid request. Throws BaselineFailedError when the endpoint does not
 * behave normally under a valid workload — there is no point probing an
 * endpoint that is already broken, and any claim built on it would be wrong.
 */
export async function establishBaseline(
  http: HttpClient,
  path: string,
  samples = 5,
): Promise<Baseline> {
  const timings: number[] = [];
  let reference: TimedResponse | undefined;

  // Warm up and discard: cold start is not the signal.
  await http.get(path);

  for (let i = 0; i < samples; i++) {
    const response = await http.get(path);
    if (response.status < 200 || response.status >= 300) {
      throw new BaselineFailedError(
        `valid request returned ${response.status}; endpoint is not healthy enough to probe`,
      );
    }
    if (response.json !== undefined && isErrorEnvelope(response.json)) {
      throw new BaselineFailedError(
        'valid request returned an error envelope under a 2xx status',
      );
    }
    timings.push(response.durationMs);
    reference ??= response;
  }

  return {
    reference: reference!,
    medianMs: median(timings),
    spreadMs: spread(timings),
    defaultRecords: countRecords(reference!.json),
    samples,
  };
}
