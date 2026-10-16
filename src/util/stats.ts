/** Median, never mean — one GC pause ruins a mean. */
export function median(values: number[]): number {
  if (values.length === 0) throw new RangeError('median of empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Half the interquartile-ish range: the "±" we print next to a median. */
export function spread(values: number[]): number {
  if (values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted.at(-1)! - sorted[0]!) / 2;
}

/**
 * The noise floor a signal must clear to be believable. A measured difference
 * smaller than this is not evidence of anything.
 */
export function isAboveNoise(signal: number, baselineSpread: number): boolean {
  return signal > baselineSpread * 2;
}
