import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAULT_RULES, applyRule, familyOf, rulesFor } from '../../src/faultload.ts';

test('infers the family of conventional pagination parameters', () => {
  assert.equal(familyOf('limit'), 'page-size');
  assert.equal(familyOf('per_page'), 'page-size');
  assert.equal(familyOf('PAGE'), 'page-index');
  assert.equal(familyOf('offset'), 'offset');
  assert.equal(familyOf('after'), 'cursor');
});

test('leaves parameters it cannot type alone', () => {
  // No spec means no way to know what these are — so no mutation is applied.
  assert.equal(familyOf('status'), undefined);
  assert.equal(familyOf('created_at'), undefined);
  assert.equal(familyOf('q'), undefined);
});

test('every rule changes exactly one parameter', () => {
  const url = new URL('https://api.test/items?limit=20&page=3&q=widget');
  for (const rule of rulesFor('page-size')) {
    const mutated = new URL(applyRule(url, 'limit', rule), 'https://api.test');
    assert.equal(mutated.searchParams.get('page'), '3', `${rule.id} altered page`);
    assert.equal(mutated.searchParams.get('q'), 'widget', `${rule.id} altered q`);
  }
});

test('cursor.truncated corrupts the baseline value rather than inventing one', () => {
  const rule = FAULT_RULES.find((r) => r.id === 'cursor.truncated')!;
  const url = new URL('https://api.test/items?cursor=abcdef');
  assert.equal(applyRule(url, 'cursor', rule), '/items?cursor=abcd');
});

test('cursor.absent removes the parameter', () => {
  const rule = FAULT_RULES.find((r) => r.id === 'cursor.absent')!;
  const url = new URL('https://api.test/items?cursor=abcdef&limit=20');
  assert.equal(applyRule(url, 'cursor', rule), '/items?limit=20');
});

test('every rule states its expectation and a violation mode', () => {
  for (const rule of FAULT_RULES) {
    assert.ok(rule.expectation.length > 10, `${rule.id} has no stated expectation`);
    assert.ok(rule.onViolation, `${rule.id} has no violation mode`);
  }
});
