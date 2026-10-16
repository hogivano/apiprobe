import { looksLikeStaging, resolveConfig } from './config.ts';
import { createClient } from './http/client.ts';
import { ALL_PROBES } from './probes/index.ts';
import { BudgetExhaustedError, RateLimitedError } from './types.ts';
import type { Probe, ProbeConfig, ProbeResult, RunReport } from './types.ts';

export type { Probe, ProbeConfig, ProbeResult, RunReport, Verdict } from './types.ts';
export { ALL_PROBES } from './probes/index.ts';
export { FailureMode, FAILURE_MODE_DESCRIPTION, worstOf } from './failure-modes.ts';
export { classify, classifyTransportError } from './classify.ts';
export { establishBaseline, BaselineFailedError } from './baseline.ts';
export { FAULT_RULES, PARAM_NAMES, familyOf, rulesFor, applyRule } from './faultload.ts';
export type { FaultRule, ParamFamily } from './faultload.ts';
export type { Baseline } from './baseline.ts';
export { formatReport } from './report/human.ts';
export { formatJson } from './report/json.ts';
export { exitCodeFor, EXIT } from './exit-codes.ts';

/** Programmatic entry point. Returns structured results; never throws on a
 * probe failure — a failed probe is a result, not an exception. */
export async function runProbes(config: ProbeConfig): Promise<RunReport> {
  const resolved = resolveConfig(config);
  const target = new URL(resolved.target);
  const http = createClient(target, resolved);
  const startedAt = new Date();
  const started = performance.now();

  const results: ProbeResult[] = [];
  for (const probe of selectProbes(resolved.only)) {
    if (probe.writes && !resolved.allowWrites) continue;
    if (probe.writes && !looksLikeStaging(target) && !resolved.confirmProduction) {
      results.push(skipped(probe, 'target does not look like staging; pass confirmProduction'));
      continue;
    }
    results.push(await runOne(probe, { target, config: resolved, http }));
  }

  return {
    target: target.toString(),
    startedAt: startedAt.toISOString(),
    durationMs: performance.now() - started,
    totalRequests: http.used(),
    results,
  };
}

async function runOne(probe: Probe, ctx: Parameters<Probe['run']>[0]): Promise<ProbeResult> {
  const started = performance.now();
  try {
    return await probe.run(ctx);
  } catch (error) {
    // A probe that cannot decide reports INCONCLUSIVE with the reason — it
    // never guesses and never takes the whole run down with it.
    return {
      probe: probe.name,
      verdict: 'INCONCLUSIVE',
      summary: `${probe.name} could not complete`,
      reason: reasonFor(error),
      evidence: [],
      requests: 0,
      durationMs: performance.now() - started,
    };
  }
}

function reasonFor(error: unknown): string {
  if (error instanceof RateLimitedError) return `${error.message} — backed off rather than hammering`;
  if (error instanceof BudgetExhaustedError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function selectProbes(only?: string[]): Probe[] {
  if (!only || only.length === 0) return ALL_PROBES;
  return ALL_PROBES.filter((probe) => only.includes(probe.name));
}

function skipped(probe: Probe, reason: string): ProbeResult {
  return {
    probe: probe.name,
    verdict: 'INCONCLUSIVE',
    summary: `${probe.name} skipped`,
    reason,
    evidence: [],
    requests: 0,
    durationMs: 0,
  };
}
