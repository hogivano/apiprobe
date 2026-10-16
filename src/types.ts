/**
 * The contract every probe shares.
 *
 * The one rule: only report what is actually true. A probe that
 * cannot make its distinction confidently returns INCONCLUSIVE with a reason.
 */

import type { FailureMode } from './failure-modes.ts';

export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

/** A single measurement a probe wants to show as evidence. */
export interface Evidence {
  label: string;
  value: string;
  /** Optional detail shown indented under the value. */
  note?: string;
}

export interface ProbeResult {
  probe: string;
  verdict: Verdict;
  /** One line, verdict-first. e.g. "Deep pagination degrades". */
  summary: string;
  /** The numbers that produced the verdict. */
  evidence: Evidence[];
  /** What it means, and what to do. Absent when there is nothing to say. */
  explanation?: string;
  /** Required when verdict is INCONCLUSIVE: why we could not decide. */
  reason?: string;
  /**
   * CRASH-scale severity of the problem, on a FAIL. Follows the classification
   * bBOXRT applies to REST robustness findings — see src/failure-modes.ts.
   */
  failureMode?: FailureMode;
  /** Requests this probe actually made, counted against the budget. */
  requests: number;
  durationMs: number;
}

export interface ProbeContext {
  target: URL;
  config: ResolvedConfig;
  /** Shared, budget-enforcing HTTP client. Probes must not call fetch directly. */
  http: HttpClient;
}

export interface Probe {
  name: string;
  /** One-line description used by `--list`. */
  description: string;
  /** True when this probe creates data; gated behind --allow-writes. */
  writes: boolean;
  run(ctx: ProbeContext): Promise<ProbeResult>;
}

export interface ProbeConfig {
  /** Base URL of the list endpoint to probe. */
  target: string;
  /** Bearer token. Never logged; redacted from all output. */
  token?: string;
  headers?: Record<string, string>;
  /** Hard cap on total requests across the whole run. */
  maxRequests?: number;
  /** Enable write probes. Off by default. */
  allowWrites?: boolean;
  /** Second confirmation required when the host does not look like staging. */
  confirmProduction?: boolean;
  /** Run only these probes, by name. */
  only?: string[];
  timeoutMs?: number;
}

export interface ResolvedConfig extends Required<Omit<ProbeConfig, 'token' | 'headers' | 'only'>> {
  token?: string;
  headers: Record<string, string>;
  only?: string[];
}

export interface RunReport {
  target: string;
  startedAt: string;
  durationMs: number;
  totalRequests: number;
  results: ProbeResult[];
}

/** Shape of the shared client; implemented in src/http/client.ts. */
export interface HttpClient {
  get(path: string, init?: RequestInit): Promise<TimedResponse>;
  post(path: string, body: unknown, init?: RequestInit): Promise<TimedResponse>;
  /** Requests remaining in the run budget. */
  remaining(): number;
  used(): number;
}

export interface TimedResponse {
  status: number;
  headers: Headers;
  /** Raw text, always captured — verdicts are decided from the body. */
  text: string;
  /** Parsed JSON, or undefined when the body was not JSON. */
  json?: unknown;
  bytes: number;
  durationMs: number;
}

/** Thrown when a probe hits the run-wide request cap. */
export class BudgetExhaustedError extends Error {}
/** Thrown when the target rate-limits us mid-run; probes abort, not hammer. */
export class RateLimitedError extends Error {}
