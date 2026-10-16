import { deepPagination } from './deep-pagination.ts';
import { errorEnvelope } from './error-envelope.ts';
import { idempotency } from './idempotency.ts';
import { rateLimit } from './rate-limit.ts';
import { unboundedLimit } from './unbounded-limit.ts';
import type { Probe } from '../types.ts';

/** Registry, in the order results are reported. */
export const ALL_PROBES: Probe[] = [
  deepPagination,
  unboundedLimit,
  errorEnvelope,
  rateLimit,
  idempotency,
];

export { deepPagination, unboundedLimit, errorEnvelope, rateLimit, idempotency };
