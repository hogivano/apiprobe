/**
 * A narrow, spec-free fault catalogue.
 *
 * bBOXRT's fault model has 57 mutation rules organised by parameter data type
 * — numbers, strings, booleans, dates, times, arrays — which it can only apply
 * because an OpenAPI specification told it each parameter's type. apiprobe has
 * no spec, so it cannot type an arbitrary parameter and most of those rules are
 * inapplicable rather than merely out of scope.
 *
 * What apiprobe *can* do without a spec is recognise parameters whose semantics
 * are conventional: pagination controls. `limit`, `page`, `offset` and `cursor`
 * mean the same thing across almost every REST API, which makes both the
 * mutation and its expected correct response knowable. This file is that
 * restricted catalogue — twelve rules over four inferable families, each
 * carrying the behaviour a correct service should exhibit.
 *
 * See docs/methodology.md for why the general model is not adopted.
 */

import { FailureMode } from './failure-modes.ts';

export type ParamFamily = 'page-size' | 'page-index' | 'offset' | 'cursor';

/** Conventional names per family, in the order they are matched. */
export const PARAM_NAMES: Record<ParamFamily, readonly string[]> = {
  'page-size': ['limit', 'per_page', 'perPage', 'page_size', 'pageSize', 'entries_per_page', 'size', 'count'],
  'page-index': ['page', 'page_number', 'pageNumber'],
  offset: ['offset', 'skip', 'start'],
  cursor: ['cursor', 'after', 'before', 'next', 'page_token', 'pageToken', 'continuation'],
};

/** Identify a parameter's family by conventional name. Undefined = don't touch it. */
export function familyOf(param: string): ParamFamily | undefined {
  const needle = param.toLowerCase();
  for (const [family, names] of Object.entries(PARAM_NAMES) as [ParamFamily, readonly string[]][]) {
    if (names.some((name) => name.toLowerCase() === needle)) return family;
  }
  return undefined;
}

export interface FaultRule {
  id: string;
  family: ParamFamily;
  /** What the parameter becomes. `null` removes it. Receives the baseline value. */
  mutate: (baselineValue: string | undefined) => string | null;
  /** Plain-language statement of the correct response to this mutation. */
  expectation: string;
  /**
   * The failure mode to report when the service does something else. A rule
   * with no single expected mode is classified by classify() instead.
   */
  onViolation: FailureMode;
}

const junk = () => 'not-a-number';

/**
 * The catalogue. Each rule is a single mutation to a single parameter whose
 * meaning apiprobe can infer, paired with the response a correct service gives.
 */
export const FAULT_RULES: FaultRule[] = [
  // page-size — the family probe 2 is built on.
  {
    id: 'size.huge',
    family: 'page-size',
    mutate: () => '100000',
    expectation: 'reject, or cap the page at a documented maximum',
    onViolation: FailureMode.SILENT,
  },
  {
    id: 'size.zero',
    family: 'page-size',
    mutate: () => '0',
    expectation: 'reject, or return an empty page — never the whole table',
    onViolation: FailureMode.SILENT,
  },
  {
    id: 'size.negative',
    family: 'page-size',
    mutate: () => '-1',
    expectation: 'reject with a 4xx',
    onViolation: FailureMode.SILENT,
  },
  {
    id: 'size.non-numeric',
    family: 'page-size',
    mutate: junk,
    expectation: 'reject with a 400, not a 500',
    onViolation: FailureMode.ABORT,
  },
  {
    id: 'size.overflow',
    family: 'page-size',
    mutate: () => '9999999999999999999',
    expectation: 'reject cleanly rather than overflowing an integer',
    onViolation: FailureMode.ABORT,
  },

  // page-index
  {
    id: 'page.negative',
    family: 'page-index',
    mutate: () => '-1',
    expectation: 'reject with a 4xx, not index backwards from the end',
    onViolation: FailureMode.SILENT,
  },
  {
    id: 'page.non-numeric',
    family: 'page-index',
    mutate: junk,
    expectation: 'reject with a 400, not a 500',
    onViolation: FailureMode.ABORT,
  },

  // offset
  {
    id: 'offset.negative',
    family: 'offset',
    mutate: () => '-1',
    expectation: 'reject with a 4xx',
    onViolation: FailureMode.SILENT,
  },
  {
    id: 'offset.non-numeric',
    family: 'offset',
    mutate: junk,
    expectation: 'reject with a 400, not a 500',
    onViolation: FailureMode.ABORT,
  },

  // cursor — opaque by contract, so these are safe to send blind.
  {
    id: 'cursor.malformed',
    family: 'cursor',
    mutate: () => 'not-a-valid-cursor',
    expectation: 'reject with a 400 — never silently restart from page 1',
    onViolation: FailureMode.SILENT,
  },
  {
    id: 'cursor.truncated',
    family: 'cursor',
    mutate: (value) => (value && value.length > 2 ? value.slice(0, -2) : 'ab'),
    expectation: 'reject a corrupted cursor rather than decode it partially',
    onViolation: FailureMode.ABORT,
  },
  {
    id: 'cursor.absent',
    family: 'cursor',
    mutate: () => null,
    expectation: 'return the first page, consistently with an unpaged request',
    onViolation: FailureMode.HINDERING,
  },
];

export function rulesFor(family: ParamFamily): FaultRule[] {
  return FAULT_RULES.filter((rule) => rule.family === family);
}

/** Apply one rule to a URL, returning the mutated path+query. One change only. */
export function applyRule(url: URL, param: string, rule: FaultRule): string {
  const mutated = new URL(url);
  const next = rule.mutate(mutated.searchParams.get(param) ?? undefined);
  if (next === null) mutated.searchParams.delete(param);
  else mutated.searchParams.set(param, next);
  return `${mutated.pathname}${mutated.search}`;
}
