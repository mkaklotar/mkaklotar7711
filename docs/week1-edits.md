# Week 1: n8n માં હાથે કરવાના ફેરફાર (30 થી 40 મિનિટ)

MCP થી આ ફેરફાર કરવા સલામત નથી (નીચે કારણ). દરેક લાઈન = એક વર્કફ્લો ખોલો, node શોધો, કરો, Save.

## A. Telegram માંથી હટાવવા (node disable કરો, delete નહીં)

| વર્કફ્લો | node | કરવું |
|---|---|---|
| Shopify Safety Net — Ratguard Hourly Gap Fill | `Send Summary` | Deactivate node (દર કલાકે "Run Complete" બંધ). `Alert:` વાળા 4 node રહેવા દો |
| Ratguard - Purchase Bill Core (sub-workflow) | `Confirm Captured`, `Duplicate Skipped`, `Skipped Not An Invoice` | Deactivate. `Extraction Failed Alert`, `Drive Error Alert`, `Directus Error Alert` રહેવા દો |
| Ratguard - Return Slip (Customer Page) | `Alert Returns Channel` | Deactivate |
| Ratguard - Returns In Scan (Webhook) | `Alert Returns Counter`, `Alert Book Out` | Deactivate |
| Ratguard - RTO Received Scan (Webhook) | `Alert Ratguard: RTO Scan` | Deactivate. `Alert Ratguard: RTO Scan Rejected` રહેવા દો |
| Ratguard - RTO Unmatched Resolver (Webhook) | `Alert Ratguard: Unmatched Resolved` | Deactivate |
| Ratguard - GSTIN Add or Correct | `Telegram - GSTIN Applied` | Deactivate. `Telegram - Blocked` રહેવા દો |
| Ratguard — Dispatch Bind (Shopify) | `Telegram Confirm` | Deactivate. `Telegram Failed` રહેવા દો |
| Ratguard — Social Media Cross-Post | `Post Video to Telegram`, `Post Photo to Telegram` | chat id બદલીને બીજા (marketing) ગ્રુપમાં મોકલો, અથવા deactivate |
| Ratguard WABA - Create Order | `Telegram: Notify Team` | ફક્ત failure પર ચાલે તેમ IF ઉમેરો, અથવા deactivate |

## B. Throttle (દરેકમાં એક IF node ઉમેરવો)

Directus કલેક્શન `alert_throttle` પહેલેથી છે (id, last_sent_at, note). WhatsApp Inbound Bridge માં "Directus: Claim Alert Slot" node આ જ રીતે કરે છે. તે node કૉપી કરો:
PATCH `https://noco.ratguards.com/items/alert_throttle/<key>` with filter `last_sent_at < now - 15 min`, body `{ "last_sent_at": now }`. જવાબમાં data ખાલી હોય તો મેસેજ ન મોકલો.

| વર્કફ્લો | ક્યાં | key |
|---|---|---|
| Ratguard WABA - Health Monitor | `Build Alert` → `Telegram: Health Alert` વચ્ચે | `health_agent` |
| Ratguard WABA - Health Monitor | `Disk Alert Due?` → `Telegram: Disk Alert` વચ્ચે | `health_disk` |
| Ratguard WABA - Health Monitor | `Bitrix Token Expired?` → `Telegram: Bitrix Token Alert` વચ્ચે | `health_bitrix_token` |
| Ratguard WABA - Health Monitor | `Build Model Alert` → `Telegram: Model Alert` વચ્ચે | `health_model` |
| Ratguard - Purchase Bill Backfill (Drive intake) | `Move Failed Alert`, `Download Failed Alert`, `Drive Listing Error Alert` પહેલાં | `bill_backfill` |
| Ratguard - Return Reference Sweep | `Build Summary` → `Post Summary` વચ્ચે | `return_refs` (અથવા `Post Summary` ફક્ત failed > 0 હોય ત્યારે) |
| Ratguard - NDR WhatsApp Inbound Router | `Alert Ratguard: Reply Needs A Human` પહેલાં | `ndr_human` (window 10 min) |

Health Monitor માટે alert_throttle માં 4 નવી row બનાવો: id = ઉપરના key, last_sent_at = ખાલી.
Throttle window: 15 મિનિટ (900000 ms). Health Monitor માટે 6 કલાક (21600000 ms) વધુ સારું.

## C. Hardcoded bot token હટાવવો

5 વર્કફ્લોમાં `8929163328:AAHd...` સીધો લખેલો છે. દરેકમાં Telegram URL ને
`={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/sendMessage' }}` કરો.
ચેક: `$env.TELEGRAM_BOT_TOKEN` એ જ bot (8929163328) છે? Safety Net આ env token થી એ જ ચેનલમાં લખે છે, એટલે હા હોવું જોઈએ. ખાતરી માટે n8n Settings → Environment જુઓ.

| વર્કફ્લો | node |
|---|---|
| Ratguard - COD Manual Invoice (Form) | `COD Config` (TG_URL બને છે ત્યાં) |
| Ratguard - GSTIN Add or Correct | `Telegram - GSTIN Applied`, `Telegram - Blocked` |
| Ratguard - Prepaid Invoice Poll v3 | 7 `Telegram -` node, અથવા config node જ્યાં URL બને છે |
| Ratguard - Weekly Invoice Sweeper | `Telegram - Weekly Sweep Report`, `Telegram - Sweep FAILED` |
| Ratguard — Social Media Cross-Post | `Post Failure Alert`, `Telegram - FB Token Error` |
પછી BotFather માં token revoke કરી નવો બનાવો અને env માં મૂકો (જૂનો token 5 વર્કફ્લોના JSON માં ફરતો હતો).

## D. ACTION ગ્રુપ

નવું Telegram ગ્રુપ બનાવો, ops bot ને admin બનાવો, "whoami" કે Ingestion Group Chat ID utility થી chat id લો. પછી ફક્ત આ node ની chat_id બદલો:
Error Handler `Telegram: Execution Failed` (CRITICAL branch), COD PIN Match `Post Do Not Ship Alert`, Double Ship Guard `Alert Ratguard: Double Ship`, Pack Verify `Alert Ratguard: Pack Mismatch`, Scan Fulfil `Alert Ratguard: Scan Rejected`, Handover `Alert Ratguard: Handover Rejected`, Site Form Canary `Telegram: Canary Alert`, Maruti 1PM Cutoff `Post Cutoff Summary To Ratguard Channel`, NDR Escalation Sweep `Alert Ratguard: Escalations`.

## MCP થી કેમ નહીં

n8n MCP નું `update_workflow` આખો વર્કફ્લો SDK code થી ફરી લખે છે. `get_workflow_details` credentials બતાવતું નથી, અને ફરી લખતી વખતે credential type પ્રમાણે auto-assign થાય છે (probe માં `telegramApi` → "Ratguard Official Bot (env)" આપોઆપ લાગ્યું, નામ અવગણ્યું). જ્યાં એક type ના બે credential હોય (httpHeaderAuth: Directus/ShipPrime, telegramApi: ops bot/Maruti bot/invoice bot, oAuth2Api: Zoho) ત્યાં ખોટું લાગી શકે અને `neverError: true` હોવાથી ચૂપચાપ તૂટે. એટલે production વર્કફ્લો પર આ રસ્તો નહીં.

સલામત રસ્તો: n8n Settings → n8n API → key બનાવો, અને Claude Code environment ની network policy માં `automation.ratguards.com` allow કરો. પછી દરેક ફેરફાર REST PATCH થી node-level થાય અને પહેલાં/પછી diff બતાવી શકાય.
