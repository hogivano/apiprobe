# Architecture

```
src/
  cli.ts            argv → runProbes → formatted output → exit code
  index.ts          runProbes(config): the programmatic API
  types.ts          Probe / ProbeResult / Verdict — the contract
  config.ts         defaults, config resolution, staging-host detection
  exit-codes.ts     0 all pass · 1 any fail · 2 inconclusive only
  failure-modes.ts  CRASH severity scale (bBOXRT / Koopman)
  classify.ts       response → failure mode, automatically
  baseline.ts       the workload phase: valid requests before any claim
  faultload.ts      12 spec-free mutation rules over inferable params
  http/client.ts    the only place fetch is called
  probes/           one file per probe, registered in probes/index.ts
  report/           human.ts (verdict → evidence → meaning), json.ts
  util/             stats.ts (median/spread), body.ts (record + envelope
                    detection), redact.ts (never log tokens)
test/
  fixtures/         the sandbox — see docs/sandbox.md
  probes/           one test file per probe
docs/
```

## Load-bearing decisions

**`http/client.ts` is the only caller of `fetch`.** That is what makes the
safety rules enforceable in one place: the request cap, the per-request
timeout, header redaction, and turning a 429 into a `RateLimitedError` that
aborts the probe instead of hammering the target. A probe that calls `fetch`
directly bypasses all of it — don't.

**`util/body.ts` never looks at byte size.** OWASP's checker decides verdicts
from HTTP status and response length, which is why a 200 carrying
`{"error": "too many results"}` scores as a pass there. `countRecords()`
returns `undefined` rather than `0` when it can't find a collection, so the
caller reports INCONCLUSIVE instead of inventing a number.

**A probe never throws.** `runOne()` in `index.ts` converts any error into an
INCONCLUSIVE result carrying the reason. Inconclusive is a first-class result:
a tool that is right every time gets kept, one that cries wolf once gets
uninstalled.

**Write probes are gated twice**, in `runProbes`: `allowWrites` must be set,
and if the host doesn't look like staging, `confirmProduction` too.

**Classification follows bBOXRT** (IEEE Access 2021) — the CRASH scale, the
workload-before-faultload phase order, and one-mutation-at-a-time. What that
paper does that apiprobe deliberately doesn't (OpenAPI, a 57-rule fault model,
manual outcome analysis) is set out with reasons in
[methodology.md](methodology.md).

## Adding a probe

1. New file in `src/probes/`, exporting a `Probe`.
2. Register it in `src/probes/index.ts` (order there is report order).
3. Set `writes: true` if it creates data — that's what gates it.
4. Add fixtures and expected verdicts (`docs/sandbox.md`), then the tests.

Set `failureMode` on a FAIL, via `classify()` — don't hand-pick one.

Every verdict must state the evidence that produced it. If the probe can't
distinguish its cases confidently, return INCONCLUSIVE with `reason`.
