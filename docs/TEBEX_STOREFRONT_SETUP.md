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
| `TEBEX_CHECKOUT_API_KEY` | **Privileged.** Tebex account API key, used to cancel a subscription when its account is deleted, one at a time or by a full server reset. | A deleted account's subscription keeps billing; the reference is parked in `tebex:orphaned-subscriptions` for manual cancellation. The server-reset dry run says so before you confirm. |

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
| `recurring-payment.ended` | Revoked, but only on a save whose flag holds that reference. The only stop signal. |

Revoking on `cancellation.requested` bills someone for time they never receive.

The flag itself is written by `applyEntitlementToSave` in `api/_subscription.ts`
— the single writer of `character.patreon`, shared with the admin comp path, and
idempotent so re-delivery is free. ⛔ `character.patreon` is a **frozen storage
key**: it is live save data, the name is provider-agnostic, and only the rail
that writes it changed.

⛔ **`ended` revokes only the subscription it names.** Every event finds its
player by the name sealed into the original basket, not by any save, and a name
outlives its account. After a deletion or a full reset, whoever registers the
name next may have a subscription of their own, or an admin comp. So
`applyEntitlementToSave` writes a revoke only over a flag whose `userId` is the
reference that ended. Otherwise the save is not touched, and the webhook logs
`[tebex] subscription ended — flag left alone` and answers 200 `ignored`:

| Reason | The save's flag |
|---|---|
| `subscription-not-on-save` | Holds another reference, or none. |
| `admin-comp-on-save` | Is a live admin comp, even one made over the reference that ended. The comp expires on its own. |

Before this rule, a late `ended` replaced the new owner's live flag with an
inactive one. That revoked perks they were paying for, until their own next
renewal. It also erased the only record of their reference, so deleting their
account in that window would not have cancelled it.

An `ended` for a name with **no save** answers 200 `no-save` and logs
`[tebex] subscription ended with no save` at info level. It is the normal tail
of a deleted account whose cancellation succeeded: the entitlement went with
the save, so there is nothing to revoke. It used to answer 500, so Tebex kept
retrying, and a retry that landed after someone registered the name reached a
stranger's save.

⛔ **A paid event replaces an admin comp.** A `started`, `renewed` or
`cancellation.aborted` event writes a plain paid flag over an admin comp, with
no `expiresAt` and no `source`, and keeps `since`. A comp made over a paying
subscriber keeps their reference as `userId`. Same-price renewals used to count
as re-deliveries of that flag and changed nothing, so the comp's `expiresAt`
survived them. Once it passed, the player lost their perks while still paying,
and stayed that way until the price changed or an admin stepped in.

Now such a comp lasts only until the subscriber's next renewal. After that the
flag is an ordinary subscription, and the subscription's own `ended` revokes it,
even if the comp had days left. Comp the player again if those days should
stand. `admin-comp-on-save` therefore applies to a comp over a subscriber only
when the subscription ends before its next renewal. A comp with no payment
behind it is untouched and still lapses on its own.

⚠ **One door is still open: renewals.** A `started`, `renewed` or
`cancellation.aborted` event entitles whoever holds the name when it lands.
With no save it answers 500 so Tebex retries, which is right for a
player who has not finished creating a character. A parked reference is
refused (see Account deletion below). A deleted account's reference that is
**not** parked can still renew. That can happen when a renewal was already in
flight when the account was deleted, when an operator deletes a parked entry
before cancelling the subscription, or when the flag was inactive at deletion,
for example after an admin revoke. In those cases the renewal entitles the next
owner of the name. Closing that needs a record of every reference cancelled on
deletion, which is a storage change awaiting a decision.

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

## Account deletion cancels the subscription

A subscription belongs to the account, not the save, and Tebex knows nothing
about a deletion here. Left alone, someone who deletes their account keeps being
charged every month for a game they no longer have and has to discover the
charge themselves.

`detachPlayerReferences` in `api/_delete-player-account.ts` cancels it. That is
the **shared** entry point — the player-facing delete in `api/save/[name].ts`
calls it directly, and the guest sweep reaches it through
`deletePlayerAccount` — so putting the cancellation anywhere else would cover
only one of the two paths. ⚠ The player-facing path does NOT call
`deletePlayerAccount`, which is the easy mistake here.

It runs **before** the save is deleted, because `character.patreon.userId`
holds the only copy of the `tbx-r-…` reference.

`DELETE https://checkout.tebex.io/api/recurring-payments/{reference}`, HTTP
Basic with the API key as the **username and a blank password**. 204 is success;
404 is treated as success too, since already-gone is the state we wanted.

A successful cancellation parks nothing. Tebex reports `ended` after the save is
gone, and the webhook answers 200 `no-save`. If someone has registered the name
by then, their save does not hold the reference, so the `ended` is refused with
`subscription-not-on-save` and their own flag is left alone (see Subscription
events).

⛔ **A failure never blocks the deletion** — the right to delete an account does
not depend on a third party being reachable. But it is never swallowed either:
the reference is written to the `tebex:orphaned-subscriptions` hash so it
outlives the save, and an operator can cancel it in the dashboard and delete the
key once it shows `endedAt` (see below). Admin-comped subscriptions are
skipped; they have no recurring payment behind them.

⛔ **A parked reference no longer entitles anyone on renewal.** Renewals find
their player by the name sealed into the original basket, and once the account
is gone that name belongs to nobody, or to whoever registered it afterwards.
`api/tebex/webhook.ts` checks the hash before it writes the flag. A `started`,
`renewed` or `cancellation.aborted` webhook for a parked reference logs
`[tebex] renewal for PARKED subscription`, stamps `lastRenewalAt` and
`lastRenewalType` on the entry, and answers 200 `parked-subscription`. An
`ended` webhook is ignored the same way and stamps `endedAt`. It answers 200
because a 500 would keep Tebex retrying until someone registered the name. If
the hash cannot be read, it answers 500 and entitles nobody.

A `lastRenewalType` of `recurring-payment.renewed` means the customer was
charged again after their account was gone. Cancel the subscription and
consider a refund. Even after cancelling, keep the entry until it shows
`endedAt`. While it exists, a renewal that was already in flight is ignored
too. Deleting it before cancelling lets the next renewal entitle whoever holds
the name now. The trailing `ended` is harmless with or without the entry,
because any save whose flag does not hold the reference refuses it (see
Subscription events). An entry left in place does no harm.

### A full server reset does the same, for every account at once

`api/admin/server-reset.ts` deletes every ordinary player's save, so it runs
the same cancel-or-park step for each paid subscription on a save it is about to
delete, before it deletes anything (issue #181). Protected accounts keep their
saves, so their subscriptions are left alone.

It cancels rather than carrying the subscription over. The reset deletes the
account itself (the save, `auth:*` and `auth-google:*`), so there is nothing
left to carry it to. Renewals find their player by the name sealed into the
original basket, which means an uncancelled subscription would keep billing
and then hand the perks to whoever registers that name next.

The dry run lists the affected accounts and whether `TEBEX_CHECKOUT_API_KEY` is
set, and the confirmation dialog shows both. The completion message lists what
was cancelled and, as an action item, anything parked. A cancelled supporter
can subscribe again on their new character, or you can comp them with the
admin subscription grant.

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
