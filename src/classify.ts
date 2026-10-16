import { FailureMode } from './failure-modes.ts';
import { countRecords, isErrorEnvelope, looksLikeHtml } from './util/body.ts';
import type { TimedResponse } from './types.ts';

/**
 * Automated response classification.
 *
 * bBOXRT's stated limitation is that it "does not fully automate the analysis
 * of the test cases outcome, so manual intervention is still required". That
 * manual step is the gap apiprobe fills: this module decides the failure mode
 * from the response itself, and returns undefined rather than guessing when it
 * cannot — which the caller must surface as INCONCLUSIVE.
 *
 * It inspects the parsed body. Status and byte count alone are never enough.
 */

export interface Expectation {
  /** True when the request we sent was deliberately invalid. */
  invalidInput?: boolean;
  /** An upper bound the response was expected to respect, e.g. a page-size cap. */
  maxRecords?: number;
}

export function classify(
  response: TimedResponse,
  expectation: Expectation = {},
): FailureMode | undefined {
  // ABORT: an unhandled error escaped. HTML where JSON was due is the loudest
  // version of this — a 500 that got past the error middleware.
  if (response.status >= 500) return FailureMode.ABORT;
  if (looksLikeHtml(response.text)) return FailureMode.ABORT;

  const succeeded = response.status >= 200 && response.status < 300;

  // SILENT: claims success, carries an error. The OWASP bug, by name.
  if (succeeded && response.json !== undefined && isErrorEnvelope(response.json)) {
    return FailureMode.SILENT;
  }

  // SILENT: an abusive request honoured rather than refused.
  if (succeeded && expectation.maxRecords !== undefined) {
    const records = countRecords(response.json);
    if (records === undefined) return undefined; // cannot tell — do not guess
    if (records > expectation.maxRecords) return FailureMode.SILENT;
  }

  // SILENT: invalid input accepted without complaint.
  if (succeeded && expectation.invalidInput) return FailureMode.SILENT;

  // HINDERING: an error was signalled, but a misleading one — a validation
  // problem answered with 404, or an error body with no machine-readable code.
  if (!succeeded && expectation.invalidInput && response.status === 404) {
    return FailureMode.HINDERING;
  }
  if (!succeeded && response.json !== undefined && !isErrorEnvelope(response.json)) {
    return FailureMode.HINDERING;
  }

  return undefined; // behaved correctly, or we could not tell
}

/** A request that never came back. Distinguishes a hang from a hard stop. */
export function classifyTransportError(error: unknown, hadEarlierSuccess: boolean): FailureMode {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|aborted/i.test(message)) return FailureMode.RESTART;
  return hadEarlierSuccess ? FailureMode.CATASTROPHIC : FailureMode.RESTART;
}
