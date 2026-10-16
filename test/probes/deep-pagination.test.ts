import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runProbes } from '../../src/index.ts';
import { badApi } from '../fixtures/bad-api.ts';
import { goodApi } from '../fixtures/good-api.ts';
import { cappedPageApi, earlyRateLimitApi, shortDataApi } from '../fixtures/adversarial/index.ts';

/**
 * Every probe must report FAIL against the bad fixture and PASS against the
 * good one, and be right on the adversarial cases. That is the whole test
 * suite, and it is the thing that makes the tool trustworthy.
 */

async function probe(url: string) {
  const report = await runProbes({ target: `${url}/items`, only: ['deep-pagination'] });
  return report.results[0]!;
}

test('FAILs against bad-api: offset pagination degrades with depth', async () => {
  const api = await badApi();
  try {
    const result = await probe(api.url);
    assert.equal(result.verdict, 'FAIL', `got ${result.verdict}: ${result.reason ?? ''}`);
    assert.match(result.summary, /degrades/);
    // The evidence must carry the numbers that produced the verdict.
    assert.ok(result.evidence.length >= 3, 'expected timings at three depths');
    assert.match(result.explanation ?? '', /offset pagination/i);
  } finally {
    await api.close();
  }
});

test('PASSes against good-api: cursor pagination has no depth to degrade', async () => {
  const api = await goodApi();
  try {
    const result = await probe(api.url);
    assert.equal(result.verdict, 'PASS', `got ${result.verdict}: ${result.reason ?? ''}`);
  } finally {
    await api.close();
  }
});

test('a capped page number is a PASS, not a failure', async () => {
  const api = await cappedPageApi();
  try {
    const result = await probe(api.url);
    assert.equal(result.verdict, 'PASS', `got ${result.verdict}: ${result.reason ?? ''}`);
    assert.match(result.summary, /capped/i);
  } finally {
    await api.close();
  }
});

test('data ending at page 12 does not read as fast-and-therefore-good', async () => {
  const api = await shortDataApi();
  try {
    const result = await probe(api.url);
    // Deep pages are empty, so the probe walks back to real data before timing.
    // Little data means little to degrade: PASS is correct, FAIL would be a lie.
    assert.equal(result.verdict, 'PASS', `got ${result.verdict}: ${result.reason ?? ''}`);
  } finally {
    await api.close();
  }
});

test('a 429 mid-run is INCONCLUSIVE, never a degradation claim', async () => {
  // Limits early enough that the limiter engages while the probe is sampling.
  const api = await earlyRateLimitApi(0, 8);
  try {
    const result = await probe(api.url);
    assert.equal(result.verdict, 'INCONCLUSIVE', `got ${result.verdict}`);
    assert.match(result.reason ?? '', /429/);
    assert.match(result.reason ?? '', /our own doing|not evidence/i);
  } finally {
    await api.close();
  }
});

test('respects the run-wide request budget', async () => {
  const api = await badApi();
  try {
    const report = await runProbes({
      target: `${api.url}/items`,
      only: ['deep-pagination'],
      maxRequests: 8,
    });
    assert.ok(report.totalRequests <= 8, `used ${report.totalRequests} of 8`);
    assert.equal(report.results[0]!.verdict, 'INCONCLUSIVE');
  } finally {
    await api.close();
  }
});
