# Ratguard ઓપ્સ સરળીકરણ પ્લાન (11 Sep 2026)

આધાર: n8n ના 132 એક્ટિવ વર્કફ્લો (116 વાંચ્યા, 16 MCP માં બંધ), Directus ડેટા, 22.5 કલાકનો execution લોગ.
આ ડોક્યુમેન્ટ ફક્ત પ્લાન છે. હજી કોઈ પ્રોડક્શન વર્કફ્લો બદલ્યો નથી.

## 1. અત્યારે શું ચાલે છે

| વસ્તુ | આંકડો |
|---|---|
| Telegram મોકલતા વર્કફ્લો | 48 (ops ચેનલ -1003949001906) + 8 (refund ગ્રુપ -1003926000367) + 5 (Maruti ગ્રુપ) |
| ops ચેનલમાં રોજના મેસેજ (અંદાજ) | 80 થી 150 |
| તેમાં ખરેખર action માંગતા | આશરે 35 થી 40% |
| ખુલ્લા exceptions (Directus) | 283 (ROUTE_STALLED 114, NDR_UNTOUCHED 72, CONFIRM_STALLED 37) |
| NDR_OPEN માં પડેલા ઓર્ડર | 561 |
| lifecycle_state ખાલી હોય તેવા ઓર્ડર | 485 |
| ઓપરેટર માટે અલગ સરફેસ (પેજ, ફોર્મ, બોટ, શીટ, પાઈપલાઈન) | 30 |

## 2. મૂળ કારણ ત્રણ છે

1. **Telegram ને લોગ તરીકે વાપરવામાં આવે છે.** "Safety Net Run Complete" દર કલાકે (24/દિવસ), દરેક purchase bill capture, દરેક return slip submit, દરેક RTO scan, Facebook post નું re-post. આ બધું action નથી, છતાં એ જ ચેનલમાં જાય છે જ્યાં "DO NOT SHIP" અને Error Handler આવે છે.
2. **Repeat alerts પર throttle નથી.** Health Monitor દર 15 મિનિટે (96/દિવસ) જ્યાં સુધી condition રહે. Purchase Bill Backfill દર 5 મિનિટે. Return Reference Sweep દર 10 મિનિટે backlog સુધી. alert_throttle કલેક્શન ફક્ત એક જ key (agent_down) માટે વપરાય છે.
3. **એક જ કામ માટે બે-ત્રણ રસ્તા.** Maruti parcel fulfil થવાના 3 રસ્તા, RTO book-in ના 2 દરવાજા, COD xlsx ingest ના 2 રસ્તા, એક જ parcel ના 3 scan (station, Dispatch Bind form, parcel-scan listener), refund_requests ના status બે જગ્યાએથી લખાય (Telegram command અને Returns Counter). ઓપરેટરે યાદ રાખવું પડે કે કયું ક્યાં.

## 3. નોટિફિકેશન: ત્રણ સ્તર

**સ્તર A - તરત action (Telegram, નવું ગ્રુપ "Ratguard ACTION"):** ફક્ત આ:
- Error Handler ના CRITICAL (maruti/cutoff/awb/cod/ndr/invoice/refund)
- DO NOT SHIP, Double Ship, Pack Mismatch, Scan/Handover Rejected
- Refund approval card, Warranty card, Offer Disputed, Cancel/Refund Needs Attention
- WhatsApp "Reply Needs A Human" અને Handoff (પણ 10 મિનિટમાં એક digest, per message નહીં)
- Maruti 1PM cutoff લિસ્ટ, Prepaid fallback notice
- Site Form Canary તૂટે ત્યારે, Health Monitor (state-change પર જ, નીચે જુઓ)

**સ્તર B - દિવસમાં બે digest (09:15 અને 19:00):** રિપોર્ટ 7 અલગ મેસેજ ને બદલે એક. Scorecard, Dispatch Summary, Pack Accuracy, Waterfall, Save Rate, Funnel, Unlinkable AWB, Tracking Mismatch, purchase bills captured count, returns/RTO scans count.

**સ્તર C - Telegram બિલકુલ નહીં, ફક્ત dashboard/Directus:** Safety Net heartbeat, દરેક bill "Confirm Captured", Return Slip submit, Returns Counter book-in/out, RTO scan success, Unmatched Resolved, GSTIN Applied, Dispatch Bind confirm, Social Media cross-post, Return Reference Sweep summary, WABA Create Order success.

**Throttle નિયમ (alert_throttle ને બધે વાપરવું):** એક જ alert class 15 મિનિટમાં એક જ વાર, અને "તૂટ્યું / ઠીક થયું" બે જ મેસેજ, વચ્ચે ચૂપ. Health Monitor, Purchase Bill Backfill, Return Reference Sweep, WABA handoff ને આ લાગુ.

અસર: ops ચેનલમાં રોજ 80-150 ને બદલે 10-25 મેસેજ, અને દરેક મેસેજ પર કંઈક કરવાનું હોય.

## 4. ઓપરેટર માટે: 30 સરફેસ ને બદલે 3

1. **Station (packing/dispatch):** હાલનું scan station page જ, પણ Dispatch Bind form અને parcel-scan listener એમાં જ મર્જ (એક scan થી ત્રણેય લખાય). Dispatch Board ની "TO PACK" લિસ્ટ એ જ પેજ પર. Auth એક જ token (અત્યારે બે scheme + બે hardcoded token).
2. **Counter (returns + RTO):** Returns Counter page એક જ દરવાજો. RTO pane station માંથી હટાવીને counter માં. Telegram ના `received / pass / fail / shipped` commands બંધ; એ બધું counter ના બટન. Telegram માં ફક્ત approve/reject/paid રહે (નાણાકીય નિર્ણય).
3. **Worklist (તમારા માટે):** /webhook/ops-work ને "આજે શું કરવાનું" પેજ બનાવવું: exceptions + refund approvals + WhatsApp handoffs + NDR escalations એક જ લિસ્ટમાં, owner/deadline/value પ્રમાણે. Telegram ACTION મેસેજમાં આ પેજની લિંક. Resolve દબાવવાથી ફક્ત row બંધ ન થાય, જરૂરી action (Shopify tag, sheet row) પણ થાય.

જે બદલાશે નહીં (બહારના પક્ષ): Maruti COD Google Sheet અને Maruti Telegram ગ્રુપ (courier એ જ વાપરે છે), India Post portal, Bitrix NDR pipeline (caller ટીમ). આમાં ફેરફાર Maruti સાથે વાત કર્યા વગર શક્ય નથી.

## 5. Backlog સાફ કરવો (નહીં તો નવો dashboard પણ લાલ જ દેખાશે)

- 561 NDR_OPEN માંથી કેટલા ખરેખર ખુલ્લા છે? મોટા ભાગના જૂના delivered/RTO હશે. Shipments status સામે reconcile કરીને bulk close.
- 485 lifecycle null: Lifecycle Backfill (0DBk1QROSxHCM6Qp, અત્યારે inactive) એક વાર ચલાવવો.
- 114 ROUTE_STALLED + 72 NDR_UNTOUCHED: 30 દિવસથી જૂના auto_resolved કરવા, બાકીના worklist માં.

## 6. ક્રમ (ઓછું જોખમ પહેલા)

| અઠવાડિયું | કામ | કયા વર્કફ્લો |
|---|---|---|
| 1 | સ્તર C ના મેસેજ બંધ, ACTION ગ્રુપ બનાવવું, hardcoded bot token હટાવવો | e03JEMgkaYIYVCsi, hFRpqFCjwnfADNXM, S1hVAxmY9Hrr4h9D, c7hNI77ZDweHc5vx, yVUvmVTsKjeFzsI1, Rw0Djwr7Wr6KTYdR, R6dyyfJzjc2ZY1kj, HBE0nkd9NA6JNgrP, tfDWBi9gakQm0uF1, uWN6h1EBqWEjpO2a |
| 1 | throttle: Health Monitor, Bill Backfill, Reference Sweep, WABA handoff | a34lNCqU33aueEfX, uGKf2ljX3TvVuR1b, HqJtehGNH6SS9yMe, kPrWKVz74NwTQq2G, DHb6AFyWXhIZPBTI |
| 2 | 7 daily reports ને 2 digest માં; backlog cleanup; Scorecard કેમ ચાલ્યો નથી તે ચેક | rxkvSDmvXsorPfBp, FPPY0iuE2BMisRnL, m8iBgrihMovD6oMX, nYktt4MZpYHjL2kN, LW3Q4Tod6Nq0W7BO, LzTGK8E6AQAxVo1Y, MVt8ZUOCb4Y2b0Sg, XriBNmrHhqTcRMeN |
| 3 | Worklist = આજનું પેજ (exceptions + refunds + handoffs + NDR) | J6SxYt52keUy3B2M, VsbEWm4K1pXCXhju, KeV90d3QOaIFKd4D |
| 4 | Counter માં RTO + warranty inspection; Telegram commands ઘટાડવા | 7qDOSZ7OgZotsxHZ, c7hNI77ZDweHc5vx, Ip21YfmMA3jjCCqN, qudaFyTlLWlg3evb |
| 5 | Station માં Dispatch Bind + parcel-scan મર્જ; એક auth token | 1B3qagqbrydengtn, 4JroeM6iOu3UETVx, 51omBB8F9Kn9f3Vr, w5gTOIkXU3o6fvi9 |

## 7. જે હજી ખબર નથી

- 16 એક્ટિવ વર્કફ્લો MCP માં "not available" છે (NDR Cases to Bitrix, Pack Pending Sweep, Dispatch SLA Sweep, Payment Proof, WABA senders વગેરે). એ પણ Telegram મોકલતા હોઈ શકે. n8n માં "Available in MCP" ચાલુ કરો તો ઑડિટ પૂરો થાય.
- n8n execution log ફક્ત 22.5 કલાકનો છે, એટલે 7 દિવસના આંકડા x7.5 અંદાજ છે.
- Gold Set Harness (TEST ONLY) એક્ટિવ છે. જરૂરી ન હોય તો બંધ કરવો.
