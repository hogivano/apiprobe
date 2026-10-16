import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from '../../src/classify.ts';
import { FailureMode } from '../../src/failure-modes.ts';
import { createClient } from '../../src/http/client.ts';
import { resolveConfig } from '../../src/config.ts';
import { lyingStatusApi } from '../fixtures/adversarial/index.ts';
import { goodApi } from '../fixtures/good-api.ts';

const clientFor = (base: string) =>
  createClient(new URL(base), resolveConfig({ target: base }));

test('SILENT: a 200 carrying an error envelope is not a pass', async () => {
  const api = await lyingStatusApi();
  try {
    const http = clientFor(api.url);
    const response = await http.get('/items?limit=100000');
    assert.equal(response.status, 200, 'fixture should answer 200');
    assert.equal(classify(response, { maxRecords: 1000 }), FailureMode.SILENT);
  } finally {
    await api.close();
  }
});

test('no failure mode when a valid request behaves correctly', async () => {
  const api = await goodApi();
  try {
    const http = clientFor(api.url);
    const response = await http.get('/items?limit=10');
    assert.equal(classify(response, { maxRecords: 100 }), undefined);
  } finally {
    await api.close();
  }
});

test('SILENT: an abusive limit honoured rather than capped', async () => {
  const response = {
    status: 200,
    headers: new Headers(),
    text: '',
    json: { data: Array.from({ length: 100_000 }, (_, i) => ({ id: i })) },
    bytes: 0,
    durationMs: 1,
  };
  assert.equal(classify(response, { maxRecords: 1000 }), FailureMode.SILENT);
});

test('ABORT: HTML where JSON was expected', () => {
  const response = {
    status: 401,
    headers: new Headers(),
    text: '<!doctype html><html><body>Unauthorized</body></html>',
    bytes: 52,
    durationMs: 1,
  };
  assert.equal(classify(response), FailureMode.ABORT);
});

test('undefined, not a guess, when records cannot be counted', () => {
  const response = {
    status: 200,
    headers: new Headers(),
    text: '{"weird":true}',
    json: { weird: true },
    bytes: 14,
    durationMs: 1,
  };
  assert.equal(classify(response, { maxRecords: 10 }), undefined);
});
