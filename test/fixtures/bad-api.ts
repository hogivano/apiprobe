import { seedRows, simulateOffsetScan, startFixture } from './server.ts';

/**
 * The API every probe must FAIL:
 * offset pagination over 50k rows · no limit cap · inconsistent error shapes ·
 * no rate limiting · non-idempotent POST.
 */
const ROWS = seedRows(50_000);

export function badApi(port = 0) {
  let created = 0;

  return startFixture((req, url, res) => {
    if (url.pathname === '/items' && req.method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const limit = Number(url.searchParams.get('limit') ?? 20); // no cap
      if (!Number.isFinite(page) || page < 1) {
        return res.json(400, { error: 'bad page' }); // shape A
      }
      const offset = (page - 1) * limit;
      simulateOffsetScan(offset);
      return res.json(200, { data: ROWS.slice(offset, offset + limit), page, limit });
    }

    if (url.pathname === '/items' && req.method === 'POST') {
      created += 1; // ignores Idempotency-Key
      return res.json(201, { data: { id: `created-${created}` } });
    }

    if (url.pathname.startsWith('/items/')) {
      return res.json(404, { message: 'not found', status: 404 }); // shape B
    }

    if (url.pathname === '/private') {
      return res.html(401, '<!doctype html><html><body>Unauthorized</body></html>'); // shape C
    }

    return res.json(404, { message: 'not found', status: 404 });
  }, port);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  badApi(4001).then(({ url }) => console.log(`bad-api listening on ${url}`));
}
