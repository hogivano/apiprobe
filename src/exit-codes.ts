import type { RunReport } from './types.ts';

/** 0 all pass · 1 any fail · 2 inconclusive only. Makes apiprobe a CI gate. */
export const EXIT = { PASS: 0, FAIL: 1, INCONCLUSIVE: 2 } as const;

export function exitCodeFor(report: RunReport): number {
  if (report.results.some((result) => result.verdict === 'FAIL')) return EXIT.FAIL;
  if (report.results.some((result) => result.verdict === 'INCONCLUSIVE')) return EXIT.INCONCLUSIVE;
  return EXIT.PASS;
}
