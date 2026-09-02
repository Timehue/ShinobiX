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

## The Headless API contract, as it actually behaves

⚠ Verified against the live storefront 2026-09-01. **Tebex's published docs are
wrong in one place and silent in two others**, and each discrepancy cost a
debugging session.

| Step | Call |
|---|---|
| 1. Create basket | `POST /api/accounts/{token}/baskets` |
| 2. Add package | `POST /api/baskets/{ident}/packages` |
| 3. Read basket | `GET /api/accounts/{token}/baskets/{ident}` |

⛔ **Step 2 is NOT account-scoped.** The docs show
`/api/accounts/{token}/{ident}/packages`; that path **404s**. So does
`/api/accounts/{token}/baskets/{ident}/packages`. Only `/api/baskets/{ident}/packages`
works.

⛔ **A freshly created basket has no checkout link.** `links` comes back as an
empty **array** (`[]`), not an object, and only becomes
`{"checkout": "https://pay.tebex.io/…"}` once the basket holds a package. Code
that requires the link at create time fails every purchase. The add-package
response carries the populated link, so no third call is needed.

⛔ **`ip_address` on the basket body requires Basic auth.** Sending it with the
public token returns `422 "Basic auth credentials are required"` and the basket
is never created. Setting a buyer's IP is privileged; the public flow cannot do
it, so Tebex sees our server's address instead. Same family as the `ipAddress`
trap under Prices below — do not reintroduce either.

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

## Guarding the contract

`api/tebex/live-contract.test.ts` makes the real calls — list packages, create a
basket, add a package, read it back — and fails if a shape we depend on moves.

It is **skipped by default, including in CI**, because it needs a token and a
third party being up; a Tebex outage must never redden an ordinary build. Run it
by hand with:

```bash
TEBEX_LIVE_CONTRACT=1 TEBEX_PUBLIC_TOKEN=… npx tsx --test api/tebex/live-contract.test.ts
```

`.github/workflows/tebex-contract.yml` runs it daily as an **alarm, not a gate**.
It needs two repository secrets: `TEBEX_PUBLIC_TOKEN` and
`TEBEX_SUBSCRIPTION_PACKAGE_ID`. Without them the job warns and exits green
rather than failing.

It also catches dashboard-side changes that are invisible from our code and that
mis-charge real customers: a deleted package, a repriced tier, or a package
flipped between one-time and subscription.

## Resolved: the autosave-clobber risk

`fateShards` is a server ledger where client saves may spend but never grant, so
decreases pass, and a tab holding a stale balance could in principle autosave
over freshly credited shards. `refreshPurchasedSave` re-reads the authoritative
save when the player returns to the tab.

✅ Verified 2026-09-02 with a real $5 purchase: credited, then still present
after a minute of play and a reload. The mitigation is sufficient in practice.
