import { safeLogValue } from '../../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { LockContendedError } from '../../_lock.js';
import { applyTreasuryDonation, treasuryCreditPlan, type TreasuryDonation } from '../../_treasury-donate.js';
import { parseSettlementRequestId } from '../../_settlement-receipts.js';
import { runSaveDebitSaga, SaveDebitRefusal } from '../../_save-debit-saga.js';
import { VILLAGE_DONATION_SAGA } from '../../_save-debit-kinds.js';
import { meritForDonation, meritNum } from '../_village-merit.js';
import { CRAFT_POINTS } from '../../craft/_forge.js';
import { villageStoresEnabled } from '../../_release-flags.js';
import { routeStoresDonation, type StoresRouted } from '../../_treasury-stores-donate.js';
import {
    deliverEconomyLegacyIntent,
    queueEconomyLegacyIntent,
} from '../../_legacy-economy-outbox.js';

/*
 * /api/village/treasury/donate  — POST only
 *
 * Atomic village-treasury donation — the village twin of
 * api/clan/treasury/donate.ts. The old flow credited state.treasury and
 * POSTed the whole villageState blob in one write while debiting the donor's
 * save in another, so the village-state validator (api/_village-state-validate.ts)
 * trusted a treasury credit it couldn't tie to a real debit (and couldn't
 * verify donated-item ownership). This endpoint debits the donor AND credits
 * the village treasury under dual locks so the halves can't be separated.
 *
 * It deliberately mutates ONLY the treasury on the village-state row and
 * preserves every other field; the incidental rewards (contributionPoints,
 * the donation notice) stay client-side and are written on top of the
 * treasury value this returns.
 *
 * Body (currency):  { playerName, village, currency, amount, requestId? }
 * Body (item):      { playerName, village, itemId, count?, requestId? }   // count defaults to 1
 *
 * Caller MUST be the donor (or admin) and a member of `village`. Rate-limited
 * at 30/min per actor. Locks: village-state row (outer) + donor save row (inner).
 *
 * Retry-safe (issue #179, api/_save-debit-saga.ts): the same contract as
 * api/clan/treasury/donate.ts. The same `requestId` never debits twice, a
 * retry after a lost response returns the original result, and a donation
 * whose credit did not land is FINISHED by its retry or by
 * /api/admin/economy-reconcile, never unwound.
 *
 * Village Stores routing (api/_village-stores.ts): `ration-pack` credits
 * treasury.provisions 1:1; any CRAFT_POINTS material/relic credits
 * treasury.materialPoints at its craft-point value — neither lands as a loose
 * treasury item. Per-donor daily caps 40 rations / 1,500 points (mirrored
 * client-side in shinobij.client/src/lib/village-stores.ts so the Town Hall
 * warns before the 429). Routing does NOT change Village Merit: every item
 * donation, routed or not, earns merit on the same flat 500-per-item basis it
 * always did. Response adds `stores: { provisions, materialPoints }` on a
 * routed donation.
 */

const VILLAGE_STATE_PREFIX = 'game:village-state:';

// Player-donatable village currencies (honorSeals included, unlike clans).
const VILLAGE_CURRENCIES = ['ryo', 'honorSeals', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals'] as const;

const CURRENCY_CAPS: Record<string, number> = {
    // Matched to the 200,000 gift cap so both legs share one blast radius.
    // Was 10,000,000: a single call could pool fifty gifts' worth, which made
    // the donate->gift round trip a bulk laundering channel (2026-08-17).
    ryo: 200_000,
    honorSeals: 100_000,
    fateShards: 100_000,
    boneCharms: 100_000,
    auraStones: 100_000,
    mythicSeals: 100_000,
};
const ITEM_COUNT_CAP = 1_000;

const AUDIT_LOG_PREFIX = 'audit:village-treasury-donate:';

function villageSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseDonation(body: Record<string, unknown>): TreasuryDonation | null {
    const currency = typeof body.currency === 'string' ? body.currency : undefined;
    const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : undefined;
    const hasCurrency = !!currency;
    const hasItem = !!itemId;
    if (hasCurrency === hasItem) return null; // need exactly one
    if (hasCurrency) {
        return { kind: 'currency', currency: currency!, amount: Math.floor(Number(body.amount)) };
    }
    const count = body.count === undefined ? 1 : Math.floor(Number(body.count));
    return { kind: 'item', itemId: itemId!, count };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        if (!playerName || !village) {
            return res.status(400).json({ error: 'Missing playerName or village.' });
        }

        const donation = parseDonation(body);
        if (!donation) {
            return res.status(400).json({ error: 'Provide exactly one of (currency + amount) or (itemId).' });
        }
        const requestId = parseSettlementRequestId(body.requestId);
        if (body.requestId !== undefined && body.requestId !== null && !requestId) {
            return res.status(400).json({ error: 'Invalid requestId.' });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only donate your own resources.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-treasury-donate', 30, 60_000, identity.name))) return;

        const slug = villageSlug(village);
        if (!slug) return res.status(400).json({ error: 'Invalid village name.' });
        const villageStateKey = `${VILLAGE_STATE_PREFIX}${slug}`;
        const legacyDeltas = {
            villageDonations: donation.kind === 'currency'
                ? Math.max(0, Math.floor(donation.amount))
                : Math.max(0, Math.floor(donation.count)) * 500,
        };
        const amount = donation.kind === 'currency' ? Math.floor(donation.amount) : Math.floor(donation.count);

        // ── Atomic donate ──────────────────────────────────────────────
        // Village-state row locked first (shared resource), donor save row
        // inner. Donor debit committed before the treasury credit — same
        // debit-first ordering as the clan endpoint, so a credit failure
        // can't mint free treasury.
        const settled = await runSaveDebitSaga({
            definition: VILLAGE_DONATION_SAGA,
            playerName,
            requestId,
            identity: { village: slug, donation },
            sharedKey: villageStateKey,
            resource: donation.kind === 'currency' ? donation.currency : `item:${donation.itemId}`,
            amount,
            meta: { village },
            decide: async ({ character: donorChar, shared, txId }) => {
                const stateRec = shared ?? {};
                // Membership: donor must belong to this village.
                if (!identity.admin && String(donorChar.village ?? '').trim() !== village) {
                    return { ok: false, status: 403, error: 'You are not a member of this village.' };
                }

                let outcome = applyTreasuryDonation(
                    stateRec.treasury as Record<string, unknown> | undefined,
                    donorChar,
                    donation,
                    { allowedCurrencies: VILLAGE_CURRENCIES, currencyCaps: CURRENCY_CAPS, itemCountCap: ITEM_COUNT_CAP },
                );
                if (!outcome.ok) return outcome;
                // Village Stores: re-route rations / craft materials out of the loose
                // item list and into provisions / materialPoints (caps + merit value).
                let routed: StoresRouted | null = null;
                if (donation.kind === 'item' && villageStoresEnabled()) {
                    const r = routeStoresDonation(stateRec.treasury as Record<string, unknown> | undefined, outcome, donation, CRAFT_POINTS, { materialPoints: true });
                    if (!r.ok) return r;
                    if (r.routed) { outcome = { ok: true, nextDonorChar: r.nextDonorChar, nextTreasury: r.nextTreasury }; routed = r.routed; }
                }

                // Queue before the debit mutation is allowed to return. If the
                // outbox cannot persist, the donation has not committed yet;
                // if the process dies later, delivery waits for tx=complete.
                // Keyed by the settlement id, so a retry queues nothing new.
                await queueEconomyLegacyIntent(playerName, txId, legacyDeltas);
                // Personal Village Merit toward a Kage challenge, scaled by the
                // ryo-value donated (items = 500 each, mirroring the villageDonations
                // legacy bump below). Costs real currency, so no free farming.
                //
                // Every ITEM donation uses the same flat per-item basis, routed
                // or not. Briefly switching routed donations to `routed.ryoValue`
                // (craft points × 4) collapsed the merit on a material donation
                // ~42× — a hunt-torn-hide went from 500 to 12 ryo-equivalent —
                // which is a Kage-challenge balance change nobody asked for.
                // A ration pack is an item donation too, and earns exactly what
                // any other item donation earns. `routed.ryoValue` stays on the
                // routing result for the stores' own accounting; it is NOT the
                // merit basis.
                const ryoValue = donation.kind === 'currency' ? Math.floor(donation.amount) : Math.floor(donation.count) * 500;
                const creditedDonorChar = { ...outcome.nextDonorChar, villageMerit: meritNum((outcome.nextDonorChar as Record<string, unknown>).villageMerit) + meritForDonation(ryoValue) };
                // Credit ONLY the treasury; every other village-state field is
                // preserved (VILLAGE_DONATION_SAGA.applyCredit).
                return { ok: true, character: creditedDonorChar, plan: { treasury: treasuryCreditPlan(donation, routed) }, result: {} };
            },
            messages: {
                pending: 'Your donation was taken but not yet added to the village treasury. Donate again to finish it; you will not be charged twice.',
            },
        });
        const treasury = (settled.shared.treasury ?? {}) as Record<string, unknown>;

        if (!settled.replayed) {
            await kv.set(`${AUDIT_LOG_PREFIX}${slug}:${Date.now()}`, {
                ts: Date.now(),
                actor: identity.admin ? 'admin' : identity.name,
                village,
                ...(donation.kind === 'currency'
                    ? { currency: donation.currency, amount: Math.floor(donation.amount) }
                    : { itemId: donation.itemId, count: Math.floor(donation.count) }),
            }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        }

        // Legacy tracking (ENABLE_LEGACY): villageDonations counts ryo-value
        // donated (currency amount; items count a flat 500 each).
        // The donation is already committed at this point. Legacy delivery is
        // backed by the durable economy outbox, so an infrastructure failure
        // here must not make the client retry (and donate a second time).
        // Delivery is receipt-keyed, so a replay that reaches it is harmless.
        await deliverEconomyLegacyIntent(playerName, settled.txId).catch((error) => {
            console.error('[treasury/donate] deferred Legacy delivery failed:', error);
        });
        const stores = settled.plan.treasury.kind === 'store'
            ? { stores: { provisions: Math.max(0, Math.floor(Number(treasury.provisions) || 0)), materialPoints: Math.max(0, Math.floor(Number(treasury.materialPoints) || 0)) } }
            : {};
        return res.status(200).json({
            ok: true,
            treasury,
            character: settled.character,
            _saveVersion: settled._saveVersion,
            ...stores,
            ...(settled.replayed ? { replayed: true } : {}),
        });
    } catch (err) {
        if (err instanceof SaveDebitRefusal) {
            return res.status(err.status).json({ ...err.details, error: err.message });
        }
        // `withKvLock(..., { failClosed: true })` aborts rather than racing a
        // currency write when the village-state (or donor save) row is busy.
        // That is a transient collision — another donor mid-flight — not a
        // fault, so it must not surface as "Internal server error." Mirrors
        // api/player/sleeper-kill.ts.
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'The treasury is busy right now — please retry.', retryable: true });
        }
        console.error('[village/treasury/donate]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
