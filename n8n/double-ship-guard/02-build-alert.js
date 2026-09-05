// n8n Code node: "Build Alert"  (NEW NODE)
// Workflow: Ratguard - Double Ship Guard (15 min)  [prptnZuPmpCCM4z2]
//
// Sits between "Any To Resolve?" / "Directus: Resolve Double Ships" and
// "Alert Worthy?".
//
// Why it exists: the Telegram node read {{ $json.create_count }} etc, but by
// that point in the chain $json is the Directus HTTP response, not the
// detector output — so all three numbers rendered as empty strings and the
// channel got "DOUBLE SHIP:  order(s) ... Rs.  still cancellable". Building
// the whole message here, from a node reference rather than $json, removes
// that class of bug: the Telegram node now only prints {{ $json.text }}.

const d = $('Detect Double Ships').first().json;

// The Directus nodes run with neverError, so a rejection arrives as an ordinary
// item carrying an `errors` array rather than failing the execution. Staying
// silent after a failed write is the worst outcome — the board stays empty and
// the message still says "details on the exceptions board". Check explicitly.
function writeError(nodeName) {
  try {
    const j = $(nodeName).first().json;
    if (j && Array.isArray(j.errors) && j.errors.length) {
      return nodeName + ': ' + j.errors.map(e => e.message).join('; ');
    }
  } catch (e) { /* that branch did not run this time */ }
  return null;
}

const writeErr = writeError('Directus: Create Double Ships')
  || writeError('Directus: Bump Double Ships')
  || writeError('Directus: Resolve Double Ships');

const lines = (d.newStrict || []).map(h =>
  '- #' + h.order_number + ' ' + (h.customer || 'unknown') + ' Rs' + Math.round(h.value) +
  ' | Maruti ' + h.maruti_awb + ' delivered | ' + (h.sp_courier || 'ShipPrime') + ' ' +
  h.sp_awb + ' ' + h.sp_status + (h.cancellable ? ' (CANCELLABLE NOW)' : ''));

let text;
if (writeErr) {
  text = 'DOUBLE SHIP GUARD — Directus write FAILED. The exceptions board is NOT up to date.\n'
    + 'Error: ' + writeErr + '\n'
    + (d.new_count
        ? d.new_count + ' order(s) affected, Rs' + Math.round(d.new_value_at_risk) + ' of order value:\n' + lines.join('\n')
        : 'No new double ships this run — the failure was on a bump or a close.');
} else {
  text = 'DOUBLE SHIP: ' + d.new_count + ' order(s) already DELIVERED by Maruti still have a live ShipPrime leg. '
    + 'Rs' + Math.round(d.new_value_at_risk) + ' of order value. '
    + d.new_cancellable + ' still cancellable before pickup — the rest need the ShipPrime dashboard.\n'
    + lines.join('\n')
    + '\nDetails on the exceptions board.';
}

return [{ json: {
  // Alert on genuinely new hits, and on any failed write — a broken guard has
  // to be louder than a quiet one, not quieter.
  should_alert: !!d.alert || !!writeErr,
  write_ok: !writeErr,
  write_error: writeErr,
  new_count: d.new_count,
  new_value_at_risk: d.new_value_at_risk,
  new_cancellable: d.new_cancellable,
  text,
} }];
