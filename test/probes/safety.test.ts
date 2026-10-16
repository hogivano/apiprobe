import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runProbes } from '../../src/index.ts';
import { formatJson } from '../../src/report/json.ts';
import { formatReport } from '../../src/report/human.ts';
import { redactHeaders, redactText } from '../../src/util/redact.ts';
import { looksLikeStaging } from '../../src/config.ts';
import { badApi } from '../fixtures/bad-api.ts';

const SECRET = 'sk-live-do-not-print-me-1234567890';

test('a token never reaches human or JSON output', async () => {
  const api = await badApi();
  try {
    const report = await runProbes({
      target: `${api.url}/items`,
      token: SECRET,
      only: ['unbounded-limit'],
    });
    assert.ok(!formatReport(report).includes(SECRET), 'token leaked into the human report');
    assert.ok(!formatJson(report).includes(SECRET), 'token leaked into the JSON report');
  } finally {
    await api.close();
  }
});

test('credential headers are redacted, ordinary ones are not', () => {
  const redacted = redactHeaders({
    authorization: `Bearer ${SECRET}`,
    'x-api-key': SECRET,
    cookie: 'session=abc',
    'content-type': 'application/json',
  });
  assert.equal(redacted['authorization'], '<redacted>');
  assert.equal(redacted['x-api-key'], '<redacted>');
  assert.equal(redacted['cookie'], '<redacted>');
  assert.equal(redacted['content-type'], 'application/json');
});

test('token-shaped text is stripped from free-form output', () => {
  assert.ok(!redactText(`failed with Bearer ${SECRET}`).includes(SECRET));
});

test('the run-wide request cap is never exceeded', async () => {
  const api = await badApi();
  try {
    const report = await runProbes({ target: `${api.url}/items`, maxRequests: 12 });
    assert.ok(report.totalRequests <= 12, `used ${report.totalRequests} of 12`);
  } finally {
    await api.close();
  }
});

test('write probes are skipped unless allowWrites is set', async () => {
  const api = await badApi();
  try {
    const report = await runProbes({ target: `${api.url}/items` });
    assert.ok(
      !report.results.some((result) => result.probe === 'idempotency'),
      'a write probe ran without --allow-writes',
    );
  } finally {
    await api.close();
  }
});

test('write probes need a second confirmation off a staging-looking host', async () => {
  assert.equal(looksLikeStaging(new URL('http://localhost:3000')), true);
  assert.equal(looksLikeStaging(new URL('https://api-staging.example.com')), true);
  assert.equal(looksLikeStaging(new URL('https://api.example.com')), false);

  const report = await runProbes({
    target: 'https://api.example.com/items',
    allowWrites: true,
    only: ['idempotency'],
  });
  const result = report.results[0]!;
  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.match(result.reason ?? '', /staging/);
  assert.equal(report.totalRequests, 0, 'skipped probe must not send requests');
});
