import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FailureMode } from '../../src/failure-modes.ts';
import { runProbes } from '../../src/index.ts';
import { badApi } from '../fixtures/bad-api.ts';
import { goodApi } from '../fixtures/good-api.ts';
import { lyingStatusApi } from '../fixtures/adversarial/index.ts';

async function probe(url: string) {
  const report = await runProbes({ target: `${url}/items`, only: ['unbounded-limit'] });
  return report.results[0]!;
}

test('FAILs against bad-api: no cap, returns the whole table', async () => {
  const api = await badApi();
  try {
    const result = await probe(api.url);
    assert.equal(result.verdict, 'FAIL', `got ${result.verdict}: ${result.reason ?? ''}`);
    assert.equal(result.failureMode, FailureMode.SILENT);
    // The count must come from the parsed body, and must be reported.
    const records = result.evidence.find((row) => row.label === 'records returned');
    assert.ok(records, 'expected a record count in the evidence');
    assert.equal(records.value, (50_000).toLocaleString());
  } finally {
    await api.close();
  }
});

test('PASSes against good-api and reports the cap it found', async () => {
  const api = await goodApi();
  try {
    const result = await probe(api.url);
    assert.equal(result.verdict, 'PASS', `got ${result.verdict}: ${result.reason ?? ''}`);
    assert.match(result.summary, /capped at 100/);
  } finally {
    await api.close();
  }
});

test('a 200 carrying an error envelope is not scored as an unbounded result', async () => {
  // The OWASP bug: status and byte count alone would call this a pass with no
  // caveat. The refusal is real, so the bound holds — but the status lies.
  const api = await lyingStatusApi();
  try {
    const result = await probe(api.url);
    assert.equal(result.verdict, 'PASS', `got ${result.verdict}: ${result.reason ?? ''}`);
    assert.match(result.summary, /dressed as success/);
    assert.match(result.explanation ?? '', /read that as success/);
  } finally {
    await api.close();
  }
});

test('counts records from the parsed body, not from byte size', async () => {
  const api = await badApi();
  try {
    const result = await probe(api.url);
    const records = Number(
      result.evidence.find((row) => row.label === 'records returned')?.value.replace(/\D/g, ''),
    );
    const bytes = Number(
      result.evidence.find((row) => row.label === 'bytes')?.value.replace(/\D/g, ''),
    );
    assert.equal(records, 50_000);
    assert.ok(bytes > records, 'byte count should differ from record count');
  } finally {
    await api.close();
  }
});
