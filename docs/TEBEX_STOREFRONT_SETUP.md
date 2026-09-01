# Tebex storefront setup

The web rail for Fate Shards and the Shinobi Supporter subscription. Tebex is
the **merchant of record**, so they handle VAT and sales tax worldwide and we
never touch card details.

Google Play Billing is a separate, later rail — see `ANDROID_TWA_SETUP.md`.
Inside the Android app the web checkout is deliberately **not** offered
(`shardRail()` returns `'blocked'`), because Play's billing policy forbids
routing players to an external payment page for digital goods.

## Environment variables (Railway)

| Variable | Purpose | Unset behaviour |
|---|---|---|
| `TEBEX_WEBHOOK_SECRET` | Signs every webhook. The **only** authentication on that endpoint. | Every webhook is rejected — the rail is fully inert. |
| `TEBEX_PUBLIC_TOKEN` | Public webstore token (`spk3-…`), used server-side to create baskets. | `/api/tebex/basket` returns 503; the price list comes back empty. |
| `TEBEX_SUBSCRIPTION_PACKAGE_ID` | Tebex product id of the Shinobi Supporter package. | Recurring webhooks are acknowledged and ignored; the supporter tile cannot be bought. |

Shard tier ids are **code**, not environment: fill `PROVIDER_PACKAGE_IDS.tebex`
in `shared/shard-packages.ts`. A tier with no id refuses to sell rather than
charging for something the webhook could not resolve back to a shard amount.

## Order of operations

Tebex will not let you publish a package with no deliverable until a **validated
webhook endpoint** exists — so the endpoint has to be deployed and validated
*before* the packages can be created. That ordering is not obvious and it blocks
everything else.

1. Deploy, so `POST /api/tebex/webhook` is live (a `GET` should return 405).
2. Set `TEBEX_WEBHOOK_SECRET` in Railway to match the dashboard's Secret Key.
3. Add the endpoint in Tebex and click **Validate**.
4. Create the four shard packages and the subscription.
5. Put the four shard ids in `PROVIDER_PACKAGE_IDS.tebex`, and the subscription
   id in `TEBEX_SUBSCRIPTION_PACKAGE_ID`.
6. Set `TEBEX_PUBLIC_TOKEN`.

## How a purchase is attributed

⛔ **Ours is a universal webstore, which collects no username.** Tebex's
`products[].username.id` — the obvious identity field — is populated only for
*game* stores where the buyer types a Minecraft name at checkout. Here it
arrives empty, so identity rides in the basket's **`custom`** blob, which Tebex
echoes back with every webhook.

`api/tebex/basket.ts` seals the player slug in from `authedPlayer()` at basket
creation. The buyer never types or chooses a name, so a purchase cannot land on
a stranger's account. `api/tebex/_webhook-core.ts` reads it back out.

## Trust order on the webhook

**Signature first, source IP second and advisory.** The HMAC is the real
authentication — recomputed with a secret only Tebex holds, over the exact raw
bytes, which no proxy can disturb.

The IP allowlist used to gate first and return a bare `404`. This origin sits
behind Cloudflare **and** Railway, so attributing a request to its true source
depends on `CF-Connecting-IP` / `X-Forwarded-For` resolving correctly through
two hops; when that slipped, a correctly-signed delivery from someone who had
already paid was discarded with no log line. `webhook-gate-order.test.ts` pins
the current order.

## Subscription events

Five types, and the table matters:

| Event | Effect |
|---|---|
| `recurring-payment.started` / `.renewed` | Entitled |
| `recurring-payment.cancellation.aborted` | Entitled (they changed their mind) |
| `recurring-payment.cancellation.requested` | **Still entitled** — paid through the current period |
| `recurring-payment.ended` | Revoked. The only stop signal. |

Revoking on `cancellation.requested` bills someone for time they never receive.

The flag itself is written by `applyEntitlementToSave` in `api/_subscription.ts`
— the single writer of `character.patreon`, shared with the admin comp path, and
idempotent so re-delivery is free. ⛔ `character.patreon` is a **frozen storage
key**: it is live save data, the name is provider-agnostic, and only the rail
that writes it changed.

## Prices

⛔ **Never display `usd` from `shared/shard-packages.ts`.** Those are planning
reference figures that can drift from the dashboard. The shop asks
`/api/tebex/catalogue` what the storefront actually has configured, and falls
back to a clearly-labelled estimate only when that call cannot answer.

⚠ Those are the store's **base-currency** prices, not per-buyer localized ones.
Do NOT add an `ipAddress` parameter to that call to try to localize them: the
Headless packages endpoint answers **302 for any value of it** — valid IPv4,
IPv6 and private ranges alike — and 200 without it. Because the route fails
soft, this broke prices *invisibly*, leaving only `reason: 'upstream'` in the
response body. The buyer's real localized amount is shown by Tebex at checkout.

The tile artwork carries the shard count but deliberately **no price**, for the
same reason — a baked-in "$5" is a wrong number for most of the world.

## Known gap

`fateShards` is a server ledger where client saves may spend but never grant, so
decreases pass. A tab holding a stale balance can autosave over freshly credited
shards. `refreshPurchasedSave` re-reads the authoritative save when the player
returns to the tab, which mitigates but does not prove this away — **verify with
a real purchase** that a credit survives the next autosave.
