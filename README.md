# apiprobe

> 1.2 million downloads a month of pagination that breaks at depth.
> `npx apiprobe <your-api>` tells you whether yours is one of them.

Point it at a running API. It reports which scalability and robustness
properties the API actually has. Black-box: no OpenAPI spec, no source access,
no framework assumptions.

```bash
npx apiprobe https://api.example.com/items
```

```
✗ Deep pagination degrades
    page 1     2.1ms  (median of 5, spread ±0.4ms)
    page 125   64ms
    page 1250  626ms

    Latency grows with depth — the signature of offset pagination
    (.skip() or OFFSET). At 0.5ms per page of depth, page=5000
    would take about 2.5s.

    Cursor pagination keeps this flat: page by a key from the last row
    you returned instead of counting rows from the start.
```

**Status:** probes 1 and 2 are implemented and tested. Probes 3–5 are
scaffolded and report `INCONCLUSIVE`. See [docs/probes.md](docs/probes.md).

---

## Usage

```
apiprobe <url> [options]
```

`<url>` is the **list endpoint** you want checked — the one that paginates,
e.g. `https://api.example.com/items`. Any query string you include is
preserved, so you can probe a filtered view:

```bash
apiprobe "https://api.example.com/items?status=active"
```

### Options

| Option | Argument | Default | What it does |
|---|---|---|---|
| `--token` | `<token>` | — | Bearer token, sent as `Authorization: Bearer <token>`. Redacted from every line of output, including errors and `--json`. |
| `--header` | `<key:value>` | — | Extra request header. Repeatable. Use for non-bearer auth (`--header "X-API-Key: abc"`) or tenancy headers. Value may contain colons. |
| `--only` | `<name,...>` | all probes | Run only the named probes, comma-separated. Unknown names are rejected with the list of valid ones. |
| `--max-requests` | `<n>` | `250` | Hard cap on total requests for the whole run, across all probes. When it's reached, the running probe reports `INCONCLUSIVE` rather than continuing. |
| `--timeout` | `<ms>` | `10000` | Per-request timeout in milliseconds. A timed-out request aborts its probe. |
| `--allow-writes` | — | off | Enable write probes. **They create real data.** Without this, write probes are skipped entirely. |
| `--confirm-production` | — | off | Additionally required for write probes when the hostname doesn't look like staging. See [Safety](#safety). |
| `--json` | — | off | Emit the machine-readable report instead of the human one. Same data. |
| `--list` | — | — | Print `name<TAB>description` for each probe and exit `0`. |
| `-h`, `--help` | — | — | Full help, including the probe list. |
| `-v`, `--version` | — | — | Print the version and exit `0`. |

Options that take an argument fail with a usage error if it is missing.
`--max-requests` and `--timeout` must be positive numbers. An unrecognised
flag is an error, not something silently ignored.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | every probe passed |
| `1` | at least one probe failed — or the arguments were invalid |
| `2` | nothing failed, but at least one probe was inconclusive |

Inconclusive is a real result, not an error: it means apiprobe could not
establish the fact confidently, and it always prints why. Gate CI on `1` and
decide for yourself whether `2` should block.

```bash
apiprobe "$API_URL" --token "$API_TOKEN" --json || exit 1
```

### Examples

```bash
# the common case
apiprobe https://api.example.com/items

# authenticated, machine-readable, for CI
apiprobe https://api.example.com/items --token "$API_TOKEN" --json

# a non-bearer scheme, with two headers
apiprobe https://api.example.com/items \
  --header "X-API-Key: $KEY" --header "X-Tenant: acme"

# just the flagship probe, with a tighter budget
apiprobe https://api.example.com/items --only deep-pagination --max-requests 80

# write probes against a local server
apiprobe http://localhost:3000/items --allow-writes
```

## Programmatic API

```ts
import { runProbes, exitCodeFor } from 'apiprobe';

const report = await runProbes({
  target: 'https://api.example.com/items',
  token: process.env.API_TOKEN,
  maxRequests: 120,
  only: ['deep-pagination'],
});

for (const result of report.results) {
  console.log(result.probe, result.verdict, result.failureMode ?? '');
}

process.exit(exitCodeFor(report));
```

`ProbeConfig` mirrors the flags: `target`, `token`, `headers`, `only`,
`maxRequests`, `timeoutMs`, `allowWrites`, `confirmProduction`. A probe never
throws — a failure to complete becomes an `INCONCLUSIVE` result with a `reason`.

## Probes

| Name | Reads/Writes | What it checks |
|---|---|---|
| `deep-pagination` | read | Times the endpoint at increasing page depth to detect offset pagination |
| `unbounded-limit` | read | Asks for 100,000 records to see whether page size is capped |
| `error-envelope` | read | Triggers 400/401/404 and compares the JSON shape of each |
| `rate-limit` | read | Sends a bounded burst to see whether a rate limit is observable |
| `idempotency` | **write** | POSTs the same payload twice to see whether a retry duplicates a resource |

## The one rule

Only report what is actually true. Inspect the body, never just the status code
and byte count. A probe that cannot make its distinction confidently reports
`INCONCLUSIVE` with the reason.

## Method

Findings are graded on the CRASH severity scale, following bBOXRT
([IEEE Access, 2021](https://ieeexplore.ieee.org/document/9344640)) — the most
rigorous published black-box robustness tester for REST services. apiprobe
differs from it in three deliberate ways: no OpenAPI spec required; a fault
catalogue narrowed to the parameters it can name without one (`limit`, `page`,
`offset`, `cursor`); and **no manual analysis step** — bBOXRT's outcome
analysis needs a test engineer, which is what stops it being a CI gate. See
[docs/methodology.md](docs/methodology.md).

## Safety

apiprobe sends real requests to a real system.

- **Read-only by default.** Write probes require `--allow-writes`, and
  `--confirm-production` as well when the hostname doesn't contain a staging
  hint (`localhost`, `127.0.0.1`, `staging`, `stg`, `dev`, `test`, `sandbox`).
- **Respects 429** — backs off and reports inconclusive rather than hammering.
  Latency that rises because a limiter engaged is never reported as
  degradation.
- **Hard cap of 250 requests** per run, so it can't become a load test by
  accident. Lower it with `--max-requests`.
- **Never logs your token.** `Authorization` and other credential headers are
  redacted from all output.

## Docs

- [docs/sandbox.md](docs/sandbox.md) — the local fixture APIs to develop against
- [docs/architecture.md](docs/architecture.md) — layout and load-bearing decisions
- [docs/methodology.md](docs/methodology.md) — what apiprobe takes from the research, and what it doesn't
- [docs/probes.md](docs/probes.md) — the five probes and their status

## Development

```bash
npm install
npm run build
npm test            # probes must FAIL against bad-api and PASS against good-api
npm run fixture:bad     # a deliberately broken API on :4001
npm run fixture:good    # a correct one on :4002
```

## License

MIT
