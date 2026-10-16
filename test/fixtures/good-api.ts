import { seedRows, startFixture } from './server.ts';

/**
 * The API every probe must PASS:
 * cursor pagination · limit capped at 100 · one error envelope · rate limited ·
 * idempotency keys honoured.
 */
const ROWS = seedRows(50_000);
const MAX_LIMIT = 100;
const RATE_LIMIT = 60;

const fail = (status: number, code: string, message: string) => ({
  error: { code, message, status },
});

export function goodApi(port = 0) {
  // Per-instance: two fixtures in one test run must not share a rate-limit
  // window or an idempotency store.
  let requestsThisWindow = 0;
  let windowStartedAt = Date.now();
  const idempotencyKeys = new Map<string, string>();

  return startFixture((req, url, res) => {
    if (Date.now() - windowStartedAt > 60_000) {
      requestsThisWindow = 0;
      windowStartedAt = Date.now();
    }
    requestsThisWindow += 1;
    const remaining = Math.max(0, RATE_LIMIT - requestsThisWindow);
    const rateHeaders = {
      'ratelimit-limit': String(RATE_LIMIT),
      'ratelimit-remaining': String(remaining),
      'ratelimit-reset': String(Math.ceil((windowStartedAt + 60_000 - Date.now()) / 1000)),
    };
    if (requestsThisWindow > RATE_LIMIT) {
      return res.json(429, fail(429, 'rate_limited', 'too many requests'), rateHeaders);
    }

    if (url.pathname === '/items' && req.method === 'GET') {
      const requested = url.searchParams.has('limit')
        ? Number(url.searchParams.get('limit'))
        : 20;
      if (!Number.isInteger(requested) || requested < 1) {
        return res.json(400, fail(400, 'bad_limit', 'limit must be a positive integer'), rateHeaders);
      }
      const limit = Math.min(requested, MAX_LIMIT);
      const after = Number(url.searchParams.get('after') ?? 0);
      if (!Number.isFinite(after) || after < 0) {
        return res.json(400, fail(400, 'bad_cursor', 'invalid cursor'), rateHeaders);
      }
      const data = ROWS.filter((row) => row.id > after).slice(0, limit); // O(limit) in a real store
      const next = data.length === limit ? String(data.at(-1)!.id) : null;
      return res.json(200, { data, next_cursor: next, limit }, rateHeaders);
    }

    if (url.pathname === '/items' && req.method === 'POST') {
      const key = req.headers['idempotency-key'];
      if (typeof key === 'string' && idempotencyKeys.has(key)) {
        return res.json(200, { data: { id: idempotencyKeys.get(key) } }, rateHeaders);
      }
      const id = `item-${idempotencyKeys.size + 1}`;
      if (typeof key === 'string') idempotencyKeys.set(key, id);
      return res.json(201, { data: { id } }, rateHeaders);
    }

    return res.json(404, fail(404, 'not_found', 'resource not found'), rateHeaders);
  }, port);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  goodApi(4002).then(({ url }) => console.log(`good-api listening on ${url}`));
}
