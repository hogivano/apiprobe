/**
 * Failure-mode classification, following the CRASH scale as applied to REST
 * services by bBOXRT (Laranjeiro, Agnelo & Bernardino, "A Black Box Tool for
 * Robustness Testing of REST Services", IEEE Access 9, 2021).
 *
 * CRASH originates in Koopman's Ballista work on robustness testing; bBOXRT
 * adapts it to grade REST robustness problems by severity. apiprobe adopts the
 * scale — and the discipline of naming a severity rather than a bare pass/fail
 * — because it gives a precise, citable name to the exact defect this tool
 * exists to catch: SILENT.
 *
 * See docs/methodology.md for what apiprobe takes from that paper and what it
 * deliberately does not.
 */

export const FailureMode = {
  /** Service or host stops serving entirely; later requests can't connect. */
  CATASTROPHIC: 'CATASTROPHIC',
  /** Service hangs and needs a restart; requests time out and keep timing out. */
  RESTART: 'RESTART',
  /** Unhandled exception escapes: a 5xx, a stack trace, or HTML where JSON was due. */
  ABORT: 'ABORT',
  /**
   * No error indication when one was due — the response claims success while
   * carrying an error, or an abusive request is honoured. A 200 carrying
   * {"error": "too many results"} is SILENT, and it is precisely the case
   * OWASP's checker scores as a pass.
   */
  SILENT: 'SILENT',
  /** An error is signalled, but the wrong one — a misleading status or shape. */
  HINDERING: 'HINDERING',
} as const;

export type FailureMode = (typeof FailureMode)[keyof typeof FailureMode];

/** Most severe first — the order findings are ranked in a report. */
export const SEVERITY_ORDER: FailureMode[] = [
  FailureMode.CATASTROPHIC,
  FailureMode.RESTART,
  FailureMode.ABORT,
  FailureMode.SILENT,
  FailureMode.HINDERING,
];

export const FAILURE_MODE_DESCRIPTION: Record<FailureMode, string> = {
  CATASTROPHIC: 'the service stopped serving entirely',
  RESTART: 'the service stopped responding and did not recover',
  ABORT: 'an unhandled error escaped the service',
  SILENT: 'the response reported success while carrying an error or honouring an abusive request',
  HINDERING: 'an error was signalled, but a misleading one',
};

export function isMoreSevere(a: FailureMode, b: FailureMode): boolean {
  return SEVERITY_ORDER.indexOf(a) < SEVERITY_ORDER.indexOf(b);
}

/** The worst mode observed, or undefined when nothing was classified. */
export function worstOf(modes: readonly FailureMode[]): FailureMode | undefined {
  return SEVERITY_ORDER.find((mode) => modes.includes(mode));
}
