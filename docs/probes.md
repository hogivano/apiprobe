# Probes

Status against the v0 build order.

| # | Probe | Reads/Writes | Status |
|---|---|---|---|
| 1 | `deep-pagination` ⭐ | read | **implemented, tested** |
| 2 | `unbounded-limit` | read | **implemented, tested** |
| 3 | `error-envelope` | read | scaffolded |
| 4 | `idempotency` | **write**, `--allow-writes` | scaffolded |
| 5 | `rate-limit` | read | scaffolded |

Build order: fixtures → probe 1 → probe 2 → CLI/output/exit codes →
**publish v0.1 (here)** → probes 3 and 5 → probe 4.

## Probe 1 — the guards that make it trustworthy

Each of these is a way the probe could otherwise report something untrue, and
each has a test against a fixture built to trigger it:

| Guard | Behaviour |
|---|---|
| Noise floor | Page 1 sampled 5x; if the depth difference is within 2x the spread, INCONCLUSIVE |
| Cold start | Warm-up request discarded before sampling |
| Median, not mean | One GC pause cannot move the verdict |
| Parameter is ignored | Identical payload for `page=1` and `page=2` → PASS, not a timing claim |
| End of data | Walks back from `page=5000` until a page holds records |
| Small collection | No page past 50 holding records → PASS, with the caveat that this is today's data |
| Page cap | A 4xx on a deep page → PASS; refusing deep scans is correct |
| Rate limiter | A 429 mid-run → INCONCLUSIVE; the rise was our own doing |
| Threshold | FAIL needs both `ratio > 5` **and** `deep > 500ms` |

## Probe 2 — how the verdict is reached

Records are counted in the **parsed body**; byte size is never a proxy. The
probe first finds which page-size alias the endpoint honours (by asking for an
unmistakable small count), then applies the `page-size` rules from
`src/faultload.ts`.

| Observed | Verdict |
|---|---|
| 4xx rejection | PASS |
| 200, count capped | PASS, reporting the cap |
| 200, ~100,000 records | FAIL, `SILENT` |
| 200 with an error envelope | PASS — the bound holds — but the misleading status is called out |
| Whole collection returned with no parameter at all | FAIL, `SILENT` |
| Records not countable | INCONCLUSIVE |

Each probe's claim, method and the subtleties that make it trustworthy are
documented in the doc comment at the top of its own file — that's the spec, and
it stays next to the code that has to honour it.

## The rule all five share

Only report what is actually true. Inspect the body, never just the status code
and byte count. Every probe must be able to distinguish:

- a real success from a 200 carrying an error envelope
- a genuine limit cap from an error page that happens to be small
- "no more data" from "the request failed"
- a slow response from a rate limiter kicking in mid-run

## Severity

A FAIL also carries a CRASH-scale `failureMode` — CATASTROPHIC, RESTART, ABORT,
SILENT or HINDERING — following bBOXRT's classification of REST robustness
findings. `SILENT` is the published name for the OWASP bug: success reported
over an error body. See [methodology.md](methodology.md).

## Verdict vocabulary

- **PASS** — the property holds, and we have the evidence.
- **FAIL** — it doesn't, and we have the evidence.
- **INCONCLUSIVE** — we could not decide. Always carries `reason`. This is a
  first-class result, not a failure to handle.

Phrasing matters: the rate-limit probe reports "none observed at this rate",
never "no rate limiting". We proved a negative only within our own budget, and
claiming more would be the OWASP mistake again.
