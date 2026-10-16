# The sandbox

apiprobe makes real requests against real systems, so development never points
it at someone else's API. The sandbox is a set of local fixture servers with
known-correct and known-broken behaviour. Every probe is developed and verified
against them.

The sandbox is also the test suite: **every probe must report FAIL against
`bad-api` and PASS against `good-api`.** That is what makes the tool
trustworthy.

## Running it

```bash
npm run fixture:bad    # http://127.0.0.1:4001
npm run fixture:good   # http://127.0.0.1:4002
```

Then point the CLI at one:

```bash
node --experimental-strip-types src/cli.ts http://127.0.0.1:4001/items
node --experimental-strip-types src/cli.ts http://127.0.0.1:4002/items
```

Both servers are dependency-free `node:http` (rather than Express; the
built-in server does the same job and keeps `npm install` empty). They bind to
`127.0.0.1` only, and `startFixture()` with no port picks a free one — which is
what the tests use, so parallel runs don't collide.

## The two baseline fixtures

| | `bad-api.ts` (port 4001) | `good-api.ts` (port 4002) |
|---|---|---|
| Pagination | offset over 50k seeded rows | cursor (`after` / `next_cursor`) |
| Page size | uncapped `limit` | capped at 100 |
| Errors | three different shapes, one HTML | one envelope: `{error:{code,message,status}}` |
| Rate limiting | none | 60/min + `RateLimit-*` headers |
| POST | non-idempotent, ignores the key | honours `Idempotency-Key` |

`bad-api` fakes offset cost with `simulateOffsetScan()`, a busy-wait
proportional to offset depth — the same signature a real `.skip()` produces.

Expected verdicts:

| Probe | bad-api | good-api |
|---|---|---|
| deep-pagination | FAIL | PASS |
| unbounded-limit | FAIL | PASS (cap: 100) |
| error-envelope | FAIL | PASS |
| rate-limit | none observed | PASS (headers) |
| idempotency | FAIL | PASS |

## The adversarial fixtures

`test/fixtures/adversarial/` holds the cases that break naive implementations.
These are the ones that matter — passing them is the entire competitive
position against OWASP's checker.

| Fixture | The trap | Correct verdict |
|---|---|---|
| `lyingStatusApi` | 200 carrying `{"error": "too many results"}` | PASS, noting the misleading status — **not** FAIL from the status alone |
| `shortDataApi` | data ends at page 12; deep pages are empty and fast | walk back to the real end, then time inside it |
| `cappedPageApi` | rejects `page > 100` | PASS — a cap is correct behaviour |
| `earlyRateLimitApi` | 429s at request 30 | INCONCLUSIVE — rising latency was our own doing |

`lyingStatusApi` is the OWASP bug itself: a checker that reads status and byte
count scores that response as a pass.

## Adding a fixture

1. Add the server to `test/fixtures/` (or `adversarial/` if it encodes a trap).
2. Export a factory taking an optional port and returning `startFixture(...)`.
3. Document the trap and the correct verdict in the table above.
4. Add the assertion to the probe's test file.

A fixture without a documented expected verdict isn't a fixture, it's a demo.

## Safety rules the sandbox exists to enforce

Verify these against the fixtures, not against a real API:

- Read-only by default; write probes need `--allow-writes`.
- Write probes off a staging-looking host need `--confirm-production` as well.
- 429 → back off and report inconclusive, never hammer.
- Hard cap of ~250 requests per run so a probe run can't become a load test.
- `Authorization` never appears in output or errors.
