// n8n Code node: "Detect Double Ships"
// Workflow: Ratguard - Double Ship Guard (15 min)  [prptnZuPmpCCM4z2]
//
// Replaces the previous body wholesale. Two defects fixed:
//
//  1. Only open/acknowledged exceptions were loaded, so a row that had been
//     auto-resolved was invisible and got queued for INSERT again. dedupe_key
//     is UNIQUE in Directus, so the insert was rejected — and because Directus
//     batch writes are transactional, one duplicate key discarded the whole
//     batch. Nothing reached the board from 3 Sep onward.
//  2. Every run therefore re-detected the same orders as "new", so the alert
//     fired every 15 minutes forever. Alerting now keys off rows that were
//     genuinely raised this run, not off rows that merely still match.

const collected = $('Collect Booked').first().json;
const mres = $('Directus: Maruti Shipments').first().json || {};
const maruti = mres.data || [];

// EVERY DOUBLE_SHIP row, whatever its status. A resolved row still owns its
// dedupe_key, so a recurrence has to be REOPENED, never re-inserted.
const existing = ($('Directus: Open Double Ships').first().json.data) || [];
const now = new Date().toISOString();

// Index the ShipPrime side by both key formats.
const spBy = {};
for (const b of collected.booked) spBy[b.oid] = b;

const hits = [];
const watches = [];
const rejected = { no_match: 0, identity_mismatch: 0, legitimate_reship: 0 };
const reships = [];

for (const m of maruti) {
  const o = m.order || {};
  const num = o.order_number ? String(o.order_number).replace(/^#/, '') : null;
  const gid = o.platform_order_id ? String(o.platform_order_id) : null;
  const sp = (num && spBy[num]) || (gid && spBy[gid]);
  if (!sp) { rejected.no_match++; continue; }

  // --- GATE 1: identity ------------------------------------------------
  // On the CUSTOM channel the ShipPrime reference is typed by hand, so a
  // matching order number proves nothing. Order 16929 matched by number but
  // was a different customer in a different city. Require the phone or the
  // order value to agree as well.
  const ourPhone = String(o.shipping_phone || '').replace(/\D/g, '').slice(-10) || null;
  const phoneOk = !!(ourPhone && sp.phone && ourPhone === sp.phone);
  const valueOk = !!(o.total_amount && sp.total && Math.abs(Number(o.total_amount) - sp.total) < 1);
  if (!phoneOk && !valueOk) { rejected.identity_mismatch++; continue; }

  // --- GATE 2: is this waste, or a legitimate reship? -------------------
  // A reship booked AFTER the Maruti leg failed is correct behaviour and must
  // never be flagged — cancelling it would deny the customer their order.
  // Only a Maruti leg that SUCCEEDED makes the ShipPrime leg pure waste.
  const ms = String(m.status || '').toLowerCase();
  const marutiDelivered = ms === 'delivered';
  const marutiFailed = ms === 'rto_delivered' || ms === 'rto_initiated' || ms === 'cancelled';

  if (!marutiDelivered) {
    rejected.legitimate_reship++;
    reships.push({ order_number: num, maruti_status: m.status, sp_status: sp.status });

    // WATCH LIST. Once Maruti delivers, the ShipPrime leg has almost always been
    // picked up already and POST /cancel returns 409 — so by the time the strict
    // rule can prove waste, it is too late to act. A leg that is STILL
    // CANCELLABLE while the Maruti leg is STILL LIVE is the only moment anyone
    // can intervene. Digest only, never alerts, and auto-resolves the moment
    // Maruti fails (which makes the reship legitimate) or it gets picked up.
    if (sp.cancellable && !marutiFailed) {
      watches.push({
        order_number: num, value: Number(o.total_amount || 0),
        maruti_awb: m.awb_number, maruti_status: m.status,
        sp_awb: sp.awb, sp_courier: sp.courier, sp_status: sp.status,
        customer: sp.customer, matched_on: phoneOk ? 'phone' : 'value',
        dedupe_key: 'DOUBLE_SHIP_WATCH:' + (num || gid),
      });
    }
    continue;
  }

  hits.push({
    order_number: num, value: Number(o.total_amount || 0),
    maruti_awb: m.awb_number, maruti_status: m.status,
    maruti_delivered_at: m.actual_delivery_date || null,
    sp_awb: sp.awb, sp_courier: sp.courier, sp_status: sp.status,
    customer: sp.customer, matched_on: phoneOk ? 'phone' : 'value',
    // Cancellable only before pickup — after that the API returns 409 and the
    // parcel can only be stopped from the ShipPrime dashboard.
    cancellable: sp.cancellable,
    severity: sp.cancellable ? 'critical' : 'high',
    dedupe_key: 'DOUBLE_SHIP:' + (num || gid),
  });
}

const OPEN = new Set(['open', 'acknowledged']);
const byKey = {};
for (const e of existing) byKey[e.dedupe_key] = e;
const live = new Set([...hits, ...watches].map(h => h.dedupe_key));

const toCreate = [], toWatch = [], toTouch = [];
// Strict hits raised for the first time, or raised again after being closed.
// These are the only rows worth interrupting anyone for.
const newStrict = [];

function watchDetail(w) {
  return 'WATCH — order ' + w.order_number + ' has a ' + (w.sp_courier || 'ShipPrime') +
    ' leg ' + w.sp_awb + ' (' + w.sp_status + ') booked while the Maruti leg ' + w.maruti_awb +
    ' is still ' + w.maruti_status + '. Still cancellable. If Maruti delivers, this becomes waste and will be too late to stop. (matched on ' + w.matched_on + ')';
}

function hitDetail(h) {
  return 'Order ' + h.order_number + ' was DELIVERED by Maruti (' + h.maruti_awb +
    (h.maruti_delivered_at ? ' on ' + h.maruti_delivered_at : '') + ') but a ' +
    (h.sp_courier || 'ShipPrime') + ' leg ' + h.sp_awb + ' is still ' + h.sp_status + '. ' +
    (h.cancellable
      ? 'Still pre-pickup — cancel it now via POST /v1/forward/' + h.sp_awb + '/cancel.'
      : 'Already picked up: the cancel API returns 409, so stop it from the ShipPrime dashboard.') +
    ' (matched on ' + h.matched_on + ')';
}

for (const w of watches) {
  const ex = byKey[w.dedupe_key];
  const detail = watchDetail(w);
  if (!ex) {
    toWatch.push({
      type: 'DOUBLE_SHIP', status: 'open', severity: 'low',
      awb_number: w.maruti_awb, order_number: w.order_number, courier_code: 'SMILE',
      value_at_risk: w.value, detected_at: now, dedupe_key: w.dedupe_key, seen_count: 1,
      detail, context: w,
    });
    continue;
  }
  if (OPEN.has(ex.status)) {
    toTouch.push({ id: ex.id, seen_count: (ex.seen_count || 1) + 1, detail, context: w });
    continue;
  }
  // Closed earlier, double-booked again: reopen the row we already own.
  toTouch.push({
    id: ex.id, status: 'open', severity: 'low', resolved_at: null,
    seen_count: (ex.seen_count || 1) + 1, detected_at: now,
    value_at_risk: w.value, detail, context: w,
    resolution_note: 'Re-raised at ' + now + ' — double-booked again after being closed.',
  });
}

for (const h of hits) {
  const ex = byKey[h.dedupe_key];
  const detail = hitDetail(h);
  if (!ex) {
    toCreate.push({
      type: 'DOUBLE_SHIP', status: 'open', severity: h.severity,
      awb_number: h.maruti_awb, order_number: h.order_number, courier_code: 'SMILE',
      value_at_risk: h.value, detected_at: now, dedupe_key: h.dedupe_key, seen_count: 1,
      detail, context: h,
    });
    newStrict.push(h);
    continue;
  }
  if (OPEN.has(ex.status)) {
    toTouch.push({ id: ex.id, seen_count: (ex.seen_count || 1) + 1, severity: h.severity, detail, context: h });
    continue;
  }
  toTouch.push({
    id: ex.id, status: 'open', severity: h.severity, resolved_at: null,
    seen_count: (ex.seen_count || 1) + 1, detected_at: now,
    value_at_risk: h.value, detail, context: h,
    resolution_note: 'Re-raised at ' + now + ' — double-booked again after being closed.',
  });
  newStrict.push(h);
}

// Only rows that are currently OPEN can be auto-closed. Without this guard the
// node would try to re-resolve every historical row on every single run.
const toResolve = existing
  .filter(e => OPEN.has(e.status) && !live.has(e.dedupe_key))
  .map(e => ({
    id: e.id, status: 'auto_resolved', resolved_at: now,
    resolution_note: 'No longer double-booked at ' + now + ' — closed by the double-ship guard.',
  }));

const value = hits.reduce((a, h) => a + h.value, 0);
const new_value_at_risk = newStrict.reduce((a, h) => a + h.value, 0);

return [{ json: {
  sp_booked: collected.count, maruti_matched: maruti.length,
  double_ships: hits.length,
  cancellable: hits.filter(h => h.cancellable).length,
  value_at_risk: value, hits,
  // Visible proof the gates are doing work, not just passing everything through.
  rejected, reships,
  watches: watches.length, watch_new: toWatch.length, watchList: watches,
  create_count: toCreate.length, watch_count: toWatch.length,
  touch_count: toTouch.length, resolve_count: toResolve.length,
  allCreates: [...toCreate, ...toWatch],
  has_creates: (toCreate.length + toWatch.length) > 0,
  has_touches: toTouch.length > 0, has_resolves: toResolve.length > 0,
  toCreate, toWatch, toTouch, toResolve,
  // Newly raised strict hits only. A hit that is merely still open was already
  // alerted on when it was raised, so it stays silent from here on.
  newStrict, new_count: newStrict.length,
  new_value_at_risk,
  new_cancellable: newStrict.filter(h => h.cancellable).length,
  alert: newStrict.length > 0,
} }];
