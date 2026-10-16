# Methodology and its provenance

apiprobe's classification method follows **bBOXRT**:

> N. Laranjeiro, J. Agnelo and J. Bernardino, "A Black Box Tool for Robustness
> Testing of REST Services," *IEEE Access*, vol. 9, pp. 24738–24754, 2021.
> <https://ieeexplore.ieee.org/document/9344640>

bBOXRT is the most rigorous published black-box robustness tester for REST
services: 52 services, 1,351 operations, a 57-rule fault model, and findings
graded on a severity scale rather than reported as bare pass/fail. Where its
method is right and applicable to a spec-free CLI, apiprobe follows it.

Where it isn't, apiprobe deliberately diverges — and says so here, because a
tool that claims to follow a paper it contradicts is exactly the kind of
inaccuracy this project exists to avoid.

## What apiprobe takes from it

### 1. The CRASH failure-mode scale

`src/failure-modes.ts`. bBOXRT grades robustness problems on the CRASH scale
(from Koopman's Ballista work) instead of reporting a flat failure. apiprobe
adopts it, and maps it to REST as follows:

| Mode | In apiprobe's terms |
|---|---|
| **CATASTROPHIC** | the service stops serving entirely; later requests can't connect |
| **RESTART** | the service hangs and does not recover |
| **ABORT** | an unhandled error escapes — 5xx, stack trace, or HTML where JSON was due |
| **SILENT** | success reported while carrying an error, or an abusive request honoured |
| **HINDERING** | an error is signalled, but a misleading one |

**SILENT is the reason this scale is worth adopting.** It is the precise,
published name for the defect in OWASP's checker that apiprobe is built around:
a 200 carrying `{"error": "too many results"}` scored as a pass. apiprobe now
reports that case as `SILENT` rather than inventing its own vocabulary for it.

In bBOXRT's own evaluation, ABORT dominated (~97% of problems) with 608
findings fitting HINDERING — evidence that the two error-shape probes (3 and 5)
are aimed at real, common defects, not hypothetical ones.

### 2. The workload-then-faultload structure

`src/baseline.ts`. bBOXRT runs a Workload generator before its Faultload
generator: valid requests first, to learn how the service behaves without
faults, keeping the 2XX interactions to mutate later. apiprobe's
`establishBaseline()` is the same phase, and it does double duty — apiprobe
independently requires a noise floor before any timing claim, and sampling a
valid page-1 request five times produces both the reference response and the
spread.

It throws `BaselineFailedError` when a *valid* request misbehaves. Probing an
already-broken endpoint produces claims that aren't true.

### 3. Mutating a known-good request, one parameter at a time

bBOXRT's faultload mutates stored successful requests, one parameter at a time,
so an observed change is attributable. Probes 2 and 3 are exactly that shape:
take the baseline request, change `limit`, change one param to force a 400.
Change one thing per request.

## Where apiprobe diverges

The first is a positioning choice, deliberate and reversible. The second
follows from it as a technical consequence. The third is the gap this tool
exists to fill.

### 1. The OpenAPI requirement — rejected

bBOXRT begins by parsing an OpenAPI specification, as do RESTler, RestTestGen
and RESTest. apiprobe excludes spec parsing, and the reason is the project's
whole positioning: requiring a spec is *why* these tools stay in research and
nobody `npm install`s them. Plenty of real APIs have no accurate spec, and the
ones most likely to have an unbounded list endpoint are the least likely to
have one.

This is a choice rather than a constraint, and it is the choice everything
below follows from. apiprobe infers what it needs from responses, and reports
INCONCLUSIVE when it can't.

### 2. The 57-rule fault model — narrowed, not rejected

bBOXRT's fault model is organised **by parameter data type**: numbers, strings,
booleans, dates, times, arrays. Rules such as "replace with maximum int",
"malformed date" or "empty array" exist only because the OpenAPI specification
told the tool that *this* parameter is an integer and *that* one is a date.

apiprobe has no spec. For an arbitrary query parameter it cannot distinguish an
integer from an enum from a date string, so the majority of those 57 rules are
not merely out of scope — they are **inapplicable**. Firing them blind would
produce mutations that are meaningless for the parameter and findings that
cannot be interpreted, which is the opposite of this tool's one rule.

Two further constraints, both consequences of apiprobe being a CI gate rather
than a test campaign:

- **Budget.** One parameter at a time × 57 rules is 57 requests per parameter;
  a five-parameter endpoint costs 285 requests for the faultload alone. The
  hard cap is ~250 for the entire run, deliberately, so a probe run cannot
  become a load test.
- **Confidence.** High-volume mutation yields many low-confidence findings —
  which is precisely why bBOXRT still needs an engineer to triage its output.

**What survives the constraint.** The objection is to the *general* model, not
to mutation itself. Some parameters have conventional semantics that are
inferable without any specification: pagination controls. `limit`, `page`,
`offset` and `cursor` mean the same thing across nearly every REST API, which
makes both the mutation *and the correct response to it* knowable.

`src/faultload.ts` is that restricted catalogue — **twelve rules over four
inferable families**, each carrying the behaviour a correct service should
exhibit and the CRASH mode to report when it doesn't:

| Family | Matched names | Rules |
|---|---|---|
| `page-size` | `limit`, `per_page`, `page_size`, `size`, `count`, … | huge, zero, negative, non-numeric, overflow |
| `page-index` | `page`, `page_number` | negative, non-numeric |
| `offset` | `offset`, `skip`, `start` | negative, non-numeric |
| `cursor` | `cursor`, `after`, `before`, `page_token`, … | malformed, truncated, absent |

`familyOf()` returns `undefined` for anything it does not recognise, and
unrecognised parameters are never mutated. That is the spec-free discipline:
apiprobe mutates only what it can name, and states the expected correct
response for every mutation it sends.

Two of these carry real weight. `cursor.malformed` catches a service that
silently restarts from page 1 instead of rejecting a corrupt cursor — a SILENT
failure that quietly breaks client iteration. `size.zero` catches `limit=0`
being read as "no limit" and returning the whole table.

Probes 2 and 3 consume this catalogue; they do not hand-pick mutations.

### 3. Manual outcome analysis — rejected, and this is the gap apiprobe fills

The peer-reviewed comparison of these tools notes that bBOXRT "does not fully
automate the analysis of the test cases outcome, so manual intervention is still
required."

That manual step is the opening. `src/classify.ts` decides the failure mode from
the response body automatically, and returns `undefined` — surfaced as
INCONCLUSIVE with a reason — when it cannot decide. A tool needing a test
engineer to interpret its output cannot be a CI gate.

## Provenance of these details

The IEEE full text is paywalled and could not be retrieved here. The
methodology above is drawn from the paper's abstract and from the peer-reviewed
comparison "Empirical Comparison of Black-box Test Case Generation Tools for
RESTful APIs" (arXiv:2108.08196), which describes bBOXRT's phases, fault model
and stated limitation directly. The CRASH mode definitions follow the canonical
Ballista scale; the REST mapping in the table above is apiprobe's own and is not
quoted from the paper.

**Before publishing anything that cites this paper, check the mapping above
against the full text.** One inaccurate citation would undercut the only claim
this tool makes.
