# Ratguard – Check Schedule (Hourly / Daily / Weekly)

Prepared 14 Oct 2026 from: all Ratguard chat sessions (≈60 read), n8n (243 workflows, 213 active),
Directus (73 collections), Make, and the 4 existing scheduled tasks. All times IST.

---

## 0. Fix these BEFORE adding new scheduled checks

| # | Problem | Why it matters for scheduling |
|---|---|---|
| 1 | **n8n keeps only ~6.5 hours of execution history** (~9.5k runs, ~1,600/hour) | Any daily/weekly "did it error?" check is blind. Fix: keep error executions longer (e.g. `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` or a higher prune limit, or log errors to a Directus table from the Error Handler). |
| 2 | ~~Meta daily check prompt is out of date~~ **DONE 14 Oct** – prompt now pulls all live ads automatically, has the 14 Oct change log (#227/#233/#214 paused, #240/#241 added) and updated rules | – |
| 3 | **Ops Telegram already gets 80–150 msgs/day, only 35–40% acted on** | New checks must be **silent when OK** and send one summary, not more pings. |
| 4 | **Long Code nodes crash the n8n task runner** (Lead Dedupe ~2.5 min/15 min, Guardrail ~6 min/hour) | Causes random collateral failures that every check will report as noise. |
| 5 | "Blog auto-publish check" and two reminders are **bound to Claude Desktop (Windows)** | They only run if the PC/app is on. Move to cloud tasks. |

---

## 1. HOURLY (keep it to 2 tasks – more is cost + noise)

| ID | Task | Time | What Claude checks | Alert only if |
|---|---|---|---|---|
| H1 | **Google Ads + Merchant watchdog** (EXISTS) | Suggest change: every **3 h** 09–21 instead of hourly | Merchant disapproved/pending, ad disapprovals, campaign status, spend pace, ROAS (09:00) | Already defined. Google data lags ~3 h, so hourly spend-pace is mostly noise. |
| H2 | **"Watch the watchers" – n8n & order-flow health** (NEW) | Every hour 09:00–21:00 | Error executions in last hour; task-runner timeouts; last success of critical flows: Shopify→Directus Sync, Safety Net, Confirmation Engine, Routing Waterfall, Maruti AWB Writeback, ShipPrime Ingest, Bitrix Token Refresh, WABA Health Monitor, Send Gateway; Shopify orders last 2 h vs Directus orders (sync gap); WABA billing block | Any critical flow has no success in 2× its interval, Shopify≠Directus count, or >5 errors in an hour |

---

## 2. DAILY

| ID | Time | Task | What to check | Owner to act |
|---|---|---|---|---|
| D1 | 08:00 | **Meta ads daily check** (EXISTS – prompt updated 14 Oct) | Yesterday / 7d ROAS vs prior 7d, A+SC vs CBO, new-ad winners/losers, human changes in last 24 h, disapprovals. Rules: target ROAS 4.5, budget ±20% max per 72 h, pause new ad at ≥₹2,500 & ≤1 purchase | Mahesh |
| D2 | 09:30 | **Morning order-pipeline brief** (NEW) | Yesterday orders (Shopify, COD vs prepaid); unconfirmed COD >24 h; confirmed but unbooked >24 h (`ROUTE_STALLED`, `NO_COURIER`); **paid but not shipped**; double-ship alerts; open exceptions board count; prepaid payment failures from yesterday (retry list) | Delivery Desk |
| D3 | 10:45 | **India Post cut-off check** (NEW) | 10:30 sheet built & upload file ready; orders tagged India Post still unbooked; barcode pool (re-order if <150) | Rutvik / desk |
| D4 | 13:15 | **Maruti cut-off check** (NEW) | 13:00 manifest done, AWB writeback filled, Maruti pincode list age (alert at 40 days, before the 45-day stale alert), COD orders whose pincode left the list (no automatic path exists) | Desk |
| D5 | 19:30 | **Dispatch close-out** (NEW) | `HANDOVER_MISSED` after 19:00; parcels packed without pack-verify; Daily Waterfall Report numbers; RTO parcels received but not scanned in | Desk |
| D6 | 20:00 | **NDR & RTO daily** (NEW) | New NDR cases today, open NDR count (backlog was 560), cases with no action >24 h, Delhivery "Out for delivery" >24 h (no NDR event from Delhivery), India Post no scan ≥5 days, frozen parcels for claim | Namasvi |
| D7 | 20:30 | **Support inbox + refunds** (NEW) | support@ratguards.com (Zoho) unanswered >24 h; refund requests pending in Refund Automation; warranty claims pending; any "Access Restricted" email failure | Support |
| D8 | 21:00 | **Bitrix lead hygiene (light)** (NEW) | Overdue lead to-dos / handoffs per person (Pooja, Namasvi, Rutvik); leads stuck in WhatsApp AI Handoff (UC_BYC00G); new leads unassigned | Sales |

> Tip: D2–D8 can be **one evening + one morning task** if you want fewer messages (e.g. 09:30 brief = D2+D7+D8, 19:45 close-out = D3–D6 summary).

---

## 3. WEEKLY

| ID | Day / time | Task | What to check |
|---|---|---|---|
| W1 | Mon 10:00 | **Weekly business review** | Revenue, orders, blended ROAS (Meta + Google), ad spend vs ₹30–35k/day ceiling, AOV, prepaid share, payment success (baseline 66%), refunds, profit by channel (Command Center) |
| W2 | Mon 11:00 | **Courier & delivery performance** | Delivery % by courier & COD/prepaid (India Post Sept: 69% overall, COD 62%), RTO %, NDR save rate by attempt (67/33/4%), 17TRACK quota (1,000 vs ~1,850 needed) |
| W3 | Tue 10:00 | **Money reconciliation** | COD remittance received vs delivered COD (Maruti, ShipPrime, India Post cheques); GoKwik / Easebuzz payouts; invoices created for all delivered orders (Weekly Invoice Sweeper result); Zoho bank feed (stuck since 7 Aug); duplicate purchase bills; Meta ad account balance |
| W4 | Wed 10:00 | **CRM / WhatsApp hygiene** | Phone count on "magnet" contacts 80 / 122 / 3486 / 298 / 3920 (nofeck bug proof); IMOL sessions bound to many leads (9036 had 231); duplicate leads; handoff SLA misses; WhatsApp template status; OpenAI / OpenRouter credit balance |
| W5 | Sun 10:00 | **Server & security** | `/var/log/ratguard-maintenance.log` after Sunday 03:37 maintenance; disk % (keep <75%, was 55%); Directus daily backup exists & size OK; n8n Insights not jammed; inactive-but-expected workflows; webhook auth gaps progress; one-off/TEMP workflows still active |
| W6 | Sat 11:00 | **Open-items review** | Walk the pending decisions list (section 5) and close / re-date each one |
| W7 | Mon/Wed/Fri 07:00 | **Blog publish check** (EXISTS on Desktop – move to cloud) | Blog Engine v2 published, quality gate passed, Directus `blog_posts` updated |

---

## 4. MONTHLY / ONE-OFF REMINDERS

| When | Task |
|---|---|
| 5th of month | GST data pack for CA – check late-booked invoices, GSTIN errors, duplicate drafts (Monthly Compliance Digest runs on 7th) |
| Every ~40 days | Ask Maruti for fresh pincode CSV and upload |
| 1st of month | Subscriptions: Zoho Mail (support), 17TRACK, OpenAI, Windsor, Meta WhatsApp payment method |
| ~1 Dec 2026 | Trademark status – applications 7160926 (Cl. 9) & 7160927 (Cl. 35), objected; watch for hearing notice |
| 14 Oct (exists) | Unpublish one-off workflow `ml54DFIkrD3L8nnG` when handoff leads = 0 |
| 15 Oct (exists) | ISM commission follow-up (Mackwins, not Ratguard) |

---

## 5. Pending decisions found in chats (not scheduled – need you once)

**High impact**
1. Pause Meta ad **#227** (₹43k spent, ROAS 2.34) – today's daily check recommends it.
2. nofeck WhatsApp connector still links customers to wrong contacts; IMOL session 9036 bound to 231 leads – approve the cleanup + Already-Customer email bug fix.
3. Webhook security: `waba-inbound`, Bitrix handlers, `shopify-order-sync` (HMAC), maruti form, Carbone, waba-ndr-capture, warranty upload have no auth; Telegram bot token hardcoded in 5 workflows; rotate exposed secrets / n8n API key.
4. Website: ads pointing to homepage, GoKwik attribution / Meta CAPI (Shopify sees 14 of 2,017 orders), fake countdown timer, gtag loaded 6×.
5. Bitrix task #158 – 103 stuck orders, 11 paid but never shipped.

**Medium**
6. Warranty Command Handler still says "2-year" (policy is now 12 months from 1 Sep).
7. Upgrade 17TRACK (~US$39/30 days) – quota is about half of what you need.
8. `WABA_BILLING_REQUEUE_MODE` still dry_run; ratings `RATING_MODE` still not live; confirm Send Gateway is live, not dry_run.
9. 29 customers got blank "₹" refund email – send correction.
10. ~3,075 old Pending orders to cancel manually in ShipPrime dashboard.
11. Finance: Zoho bank feed, duplicate bills ₹7.04L, 12 orders CANCELLED in Directus but fulfilled in Shopify, GoKwik net ₹45,620.85 email.
12. GoKwik: hide Pay Later & wallets, add payment-retry WhatsApp within 1 h (49 customers / ₹2.05L lost in a month).
13. Command Center "Decide (Webhook)" is inactive – Approve/Cancel buttons on the page may fail.
14. Add operators to Telegram ACTION group; remove extra panel logins.
