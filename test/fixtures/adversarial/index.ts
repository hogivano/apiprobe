import { seedRows, simulateOffsetScan, startFixture } from '../server.ts';

/**
 * The four cases that break naive implementations. If the probes are
 * right on these, the tool is better than OWASP's reference checker.
 */
const ROWS = seedRows(50_000);

/** 1. 200s with an error envelope — catches the OWASP status-only bug. */
export function lyingStatusApi(port = 0) {
  return startFixture((_req, url, res) => {
    const limit = Number(url.searchParams.get('limit') ?? 20);
    // Validated, so the misleading status is the ONLY trap in this fixture.
    if (!Number.isInteger(limit) || limit < 1) {
      return res.json(400, { error: { code: 'bad_limit', message: 'limit must be positive' } });
    }
    if (limit > 1000) return res.json(200, { error: 'too many results' });
    return res.json(200, { data: ROWS.slice(0, limit) });
  }, port);
}

/** 2. Data ends at page 12 — empty is fast and proves nothing. */
export function shortDataApi(port = 0) {
  return startFixture((_req, url, res) => {
    const page = Number(url.searchParams.get('page') ?? 1);
    const rows = page > 12 ? [] : ROWS.slice((page - 1) * 20, page * 20);
    simulateOffsetScan(page > 12 ? 0 : (page - 1) * 20);
    return res.json(200, { data: rows, page });
  }, port);
}

/** 3. Rejects page > 100 — a cap is a PASS, not a failure. */
export function cappedPageApi(port = 0) {
  return startFixture((_req, url, res) => {
    const page = Number(url.searchParams.get('page') ?? 1);
    if (page > 100) return res.json(400, { error: { code: 'page_too_deep', message: 'max page is 100' } });
    simulateOffsetScan((page - 1) * 20);
    return res.json(200, { data: ROWS.slice((page - 1) * 20, page * 20), page });
  }, port);
}

/**
 * 4. Rate-limits mid-run — probes must abort, not misread the rise as slow
 * pagination. `limitAfter` is settable so a test can guarantee the limiter
 * engages while a probe is still sampling.
 */
export function earlyRateLimitApi(port = 0, limitAfter = 30) {
  let seen = 0;
  return startFixture((_req, url, res) => {
    seen += 1;
    if (seen > limitAfter) {
      return res.json(429, { error: { code: 'rate_limited', message: 'slow down' } });
    }
    const page = Number(url.searchParams.get('page') ?? 1);
    return res.json(200, { data: ROWS.slice((page - 1) * 20, page * 20), page });
  }, port);
}
