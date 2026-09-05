# Double Ship Guard — fix for the blank 15-minute alert

Workflow: **Ratguard - Double Ship Guard (15 min)** — `prptnZuPmpCCM4z2`
n8n: https://automation.ratguards.com/workflow/prptnZuPmpCCM4z2

## What was observed

The Ratguard channel received this, every 15 minutes, from 3 Sep onward:

> DOUBLE SHIP:  order(s) already DELIVERED by Maruti still have a live ShipPrime leg. Rs.  still cancellable before pickup — the rest need the ShipPrime dashboard. Details on the exceptions board.

Confirmed verbatim from the Telegram API response in execution `160832`.

## The orders it was actually about

From the `Detect Double Ships` output of execution `160832` (05 Sep 06:00 UTC):

| Order | Customer | Value | Maruti AWB (DELIVERED) | ShipPrime leg still live |
|-------|----------|-------|------------------------|--------------------------|
| 17914 | Rasshmi Maheshwari | ₹6,699 | `JVEN0000000440` — 31 Aug 09:53 | BlueDart `77938297684` UNDELIVERED |
| 17895 | Vijay Singh | ₹2,999 | `JVEN0000000438` — 01 Sep 05:56 | BlueDart `77938307160` UNDELIVERED |
| 17779 | Sunil Pawar | ₹6,699 | `JVEN0000000383` — 01 Sep 10:46 | BlueDart `77938331774` UNDELIVERED |

All matched on phone, so the identity gate is satisfied. `cancellable = 0` — none
can be stopped via the API. All three BlueDart legs are already UNDELIVERED, so
they will RTO on their own; the exposure is forward + RTO freight on three
parcels plus the risk that the returning stock is not scanned back in, not the
₹16,397 of order value.

## Root causes

### 1. Blank numbers — wrong expression scope

`Alert Ratguard: Double Ship` read `{{ $json.create_count }}`,
`{{ $json.value_at_risk }}` and `{{ $json.cancellable }}`. At that point in the
chain `$json` is the **Directus HTTP response**, not the detector output. Every
IF node in between correctly used `$('Detect Double Ships').first().json...`;
only the Telegram node did not. All three rendered empty.

### 2. Nothing reaching the exceptions board — unique-key deadlock

`Directus: Create Double Ships` was failing on every run:

```
Value "DOUBLE_SHIP:17895" for field "dedupe_key" in collection "exceptions"
has to be unique.   (RECORD_NOT_UNIQUE)
```

`dedupe_key` carries a UNIQUE constraint. Order 17895 was raised on 3 Sep and
auto-resolved at 11:30 the same day. `Directus: Open Double Ships` only queried
`status in [open, acknowledged]`, so the resolved row was invisible, the order
looked new, and the node queued a duplicate INSERT. Directus batch writes are
transactional, so that one rejected row **discarded the whole batch** — 17914
and 17779 never got written either.

Because nothing was ever written, nothing ever became `open`, so the next run
re-detected the same three as new and alerted again. That is the 15-minute loop.
The message pointed at an exceptions board that was empty.

## The changes

### A. `Directus: Open Double Ships` — query parameters

| Parameter | Was | Now |
|-----------|-----|-----|
| `filter` | `{"type":{"_eq":"DOUBLE_SHIP"},"status":{"_in":["open","acknowledged"]}}` | `{"type":{"_eq":"DOUBLE_SHIP"}}` |
| `fields` | `id,dedupe_key,seen_count` | `id,dedupe_key,seen_count,status` |
| `limit`  | `500` | `1000` |

A resolved row still owns its `dedupe_key`, so it must be visible in order to be
reopened instead of re-inserted.

### B. `Detect Double Ships` — replace body with `01-detect-double-ships.js`

- Loads every DOUBLE_SHIP row and branches on `status`: absent → create,
  open/acknowledged → bump, resolved → **reopen** (`status: 'open'`,
  `resolved_at: null`). A recurrence can never collide on the unique key again.
- `toResolve` now only considers rows that are currently open, otherwise it
  would try to re-close all history on every run.
- Adds `newStrict` / `new_count` / `new_value_at_risk` / `new_cancellable`, and
  `alert` is now `newStrict.length > 0` — rows raised *this run*, not rows that
  merely still match. Once a write succeeds the row is open, the next run bumps
  it instead of raising it, and the channel goes quiet.

### C. New Code node `Build Alert` — body in `02-build-alert.js`

Rewire (Telegram node is unchanged in position, only its text changes):

```
Any To Resolve?  ── true ──> Directus: Resolve Double Ships ──> Build Alert
                 ── false ─────────────────────────────────────> Build Alert
Build Alert ──> Alert Worthy? ── true ──> Alert Ratguard: Double Ship
```

It inspects each Directus node's response for an `errors` array (they all run
`neverError`, so failures arrive as normal items) and builds the message text
itself.

### D. `Alert Worthy?` and the Telegram node

| Node | Field | Now |
|------|-------|-----|
| `Alert Worthy?` | condition left value | `{{ $json.should_alert }}` |
| `Alert Ratguard: Double Ship` | text | `{{ $json.text }}` |

The message body now lists the actual order numbers, so even if the board write
fails again the channel still gets something actionable instead of a blank.

## Known ceiling

`Directus: Open Double Ships` fetches up to 1000 rows with no status filter.
Distinct `dedupe_key` values grow one per order ever double-shipped (3 in the
first three days), so this is years of headroom — but it is a ceiling, not a
guarantee. The durable fix is a Directus upsert keyed on `dedupe_key`, or
dropping the global UNIQUE constraint in favour of unique-per-open-instance.
Until then, a breach surfaces as a loud write-failure alert rather than silence.

## Why this was not applied through the n8n MCP

`update_workflow` only accepts a full re-emit of the workflow as SDK code, and
the SDK's sole credential primitive is `newCredential('Name')` — there is no way
to reference an existing credential by ID, and `get_workflow_details` strips
credentials so the result cannot be verified afterwards. A probe workflow
confirmed the behaviour:

```
"autoAssignedCredentials": []
"note": "HTTP Request nodes (Probe) were skipped during credential
         auto-assignment. Their credentials must be configured manually."
```

Re-emitting this workflow would therefore detach the ShipPrime and Directus
header-auth credentials from all seven HTTP nodes plus the Telegram credential.
Combined with `neverError` on every HTTP node, the guard would keep reporting
success while doing nothing at all. Applying the changes in the n8n editor, or
via the n8n REST API with an API key (which round-trips credentials intact), is
the safe route.
