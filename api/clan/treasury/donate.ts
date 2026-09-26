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
import { CLAN_DONATION_SAGA } from '../../_save-debit-kinds.js';
import { villageStoresEnabled } from '../../_release-flags.js';
import { routeStoresDonation, type StoresRouted } from '../../_treasury-stores-donate.js';

/*
 * /api/clan/treasury/donate  — POST only
 *
 * Atomic clan-treasury donation. The old flow was two separate client writes:
 *   1) client credits clanData.treasury and POSTs the whole clan-<slug> blob
 *   2) client debits its own save in a separate /api/save POST
 *
 * Because the clan-save validator (api/_clan-save-validate.ts) trusted the
 * incoming treasury and could not verify the donor actually debited (or that
 * a donated item was ever owned), a crafted client could credit the treasury
 * — or mint never-owned items into treasury.items — without debiting anything.
 *
 * This endpoint is the intended path: it debits the donor's save AND credits
 * the clan treasury under dual locks, so the two halves can't be separated.
 * The legitimate client now routes the treasury credit through here; clan XP /
 * clanEventContrib stay client-side and are written on top of the treasury
 * value this returns (a zero-delta write the validator leaves alone).
 *
 * Body (currency):  { playerName, clan, currency, amount, requestId? }
 * Body (item):      { playerName, clan, itemId, count?, requestId? }   // count defaults to 1
 *
 * Caller MUST be the donor (or admin) and a member of `clan`. Rate-limited at
 * 30/min per actor. Locks held: clan save row (outer) + donor save row (inner).
 *
 * Retry-safe (issue #179, api/_save-debit-saga.ts). `requestId` (optional,
 * 16–80 chars) is the donation's identity: the donor debit and its receipt
 * land in one save write, the treasury credit and its receipt in one clan-row
 * write, so the same id never debits twice. A retry after a lost response
 * returns the original result. A donation whose credit did not land (a failed
 * clan-row write, or a process stop between the writes) answers 503 and is
 * FINISHED by the retry, or by /api/admin/economy-reconcile — never unwound,
 * because its debit also moved items and the monthly contribution.
 */

// Player-donatable clan currencies. warSupply is war-earned, not donated.
const CLAN_CURRENCIES = ['ryo', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals'] as const;

// Per-call sanity ceilings. Unlike the validator's defense-in-depth caps,
// crediting a clan treasury is not itself an attack (funds leave the donor and
// land in the shared clan pool, recoverable by leadership) — the real exploit
// the atomic debit closes is credit-without-debit. These bounds only stop
// absurd / overflow inputs; the binding limit is the donor's own balance.
const CURRENCY_CAPS: Record<string, number> = {
    // Matched to the 200,000 gift cap so both legs share one blast radius.
    // Was 10,000,000: a single call could pool fifty gifts' worth, which made
    // the donate->gift round trip a bulk laundering channel (2026-08-17).
    ryo: 200_000,
    fateShards: 100_000,
    boneCharms: 100_000,
    auraStones: 100_000,
    mythicSeals: 100_000,
};
const ITEM_COUNT_CAP = 1_000;
const TERRITORY_CONTROL_SCROLL_ID = 'territory-control-scroll';

const AUDIT_LOG_PREFIX = 'audit:clan-treasury-donate:';

function clanSlugBare(name: string): string {
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
        const clan = typeof body.clan === 'string' ? body.clan.trim() : '';
        if (!playerName || !clan) {
            return res.status(400).json({ error: 'Missing playerName or clan.' });
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
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-treasury-donate', 30, 60_000, identity.name))) return;

        const targetSlug = clanSlugBare(clan);
        if (!targetSlug) return res.status(400).json({ error: 'Invalid clan name.' });
        const clanSaveKey = `save:clan-${targetSlug}`;
        const amount = donation.kind === 'currency' ? Math.floor(donation.amount) : Math.floor(donation.count);

        // ── Atomic donate ──────────────────────────────────────────────
        // The clan save row (the shared, contended resource) is locked first,
        // then the donor save row; no other code path takes these two locks in
        // the opposite order, so the nesting can't deadlock. The donor debit is
        // COMMITTED before the treasury credit, so a credit failure can never
        // leave the treasury credited without a matching debit.
        const settled = await runSaveDebitSaga({
            definition: CLAN_DONATION_SAGA,
            playerName,
            requestId,
            identity: { clan: targetSlug, donation },
            sharedKey: clanSaveKey,
            resource: donation.kind === 'currency' ? donation.currency : `item:${donation.itemId}`,
            amount,
            meta: { clan },
            decide: ({ character: donorChar, shared: clanRec }) => {
                if (!clanRec) return { ok: false, status: 404, error: 'Clan not found.' };
                // Membership: donor's character.clan must resolve to this clan.
                if (!identity.admin) {
                    const donorClanSlug = clanSlugBare(String(donorChar.clan ?? ''));
                    if (!donorClanSlug || donorClanSlug !== targetSlug) {
                        return { ok: false, status: 403, error: 'You are not a member of this clan.' };
                    }
                }

                let outcome = applyTreasuryDonation(
                    clanRec.treasury as Record<string, unknown> | undefined,
                    donorChar,
                    donation,
                    { allowedCurrencies: CLAN_CURRENCIES, currencyCaps: CURRENCY_CAPS, itemCountCap: ITEM_COUNT_CAP },
                );
                if (!outcome.ok) return outcome;
                // Village Stores clan mirror: ration-pack → clanTreasury.provisions
                // (same 40/day donor cap as the village; materials are NOT mirrored).
                let routed: StoresRouted | null = null;
                if (donation.kind === 'item' && villageStoresEnabled()) {
                    const r = routeStoresDonation(clanRec.treasury as Record<string, unknown> | undefined, outcome, donation, {}, { materialPoints: false });
                    if (!r.ok) return r;
                    if (r.routed) { outcome = { ok: true, nextDonorChar: r.nextDonorChar, nextTreasury: r.nextTreasury }; routed = r.routed; }
                }

                const contribution = donation.kind === 'currency'
                    ? donation.currency === 'ryo' ? Math.max(1, Math.floor(donation.amount / 1000)) : Math.floor(donation.amount)
                    : Math.floor(donation.count);
                const month = new Date().toISOString().slice(0, 7);
                const priorContribution = donorChar.clanContribMonth === month ? Math.max(0, Number(donorChar.clanEventContrib) || 0) : 0;
                const nextDonorChar = { ...outcome.nextDonorChar, clanEventContrib: priorContribution + contribution, clanContribMonth: month };

                const clanXp = donation.kind === 'currency'
                    ? donation.currency === 'ryo' ? Math.floor(donation.amount / 35) : Math.floor(donation.amount) * 200
                    : donation.itemId === TERRITORY_CONTROL_SCROLL_ID ? Math.floor(donation.count) * 20 : 50;
                return {
                    ok: true,
                    character: nextDonorChar,
                    plan: { treasury: treasuryCreditPlan(donation, routed), clanXp },
                    result: {},
                };
            },
            messages: {
                pending: 'Your donation was taken but not yet added to the clan treasury. Donate again to finish it; you will not be charged twice.',
            },
        });
        const clanRow = settled.shared;
        const treasury = (clanRow.treasury ?? {}) as Record<string, unknown>;

        if (!settled.replayed) {
            // Best-effort audit log (30-day TTL).
            await kv.set(`${AUDIT_LOG_PREFIX}${targetSlug}:${Date.now()}`, {
                ts: Date.now(),
                actor: identity.admin ? 'admin' : identity.name,
                clan,
                ...(donation.kind === 'currency'
                    ? { currency: donation.currency, amount: Math.floor(donation.amount) }
                    : { itemId: donation.itemId, count: Math.floor(donation.count) }),
            }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        }

        const stores = settled.plan.treasury.kind === 'store' ? { stores: { provisions: Math.max(0, Math.floor(Number(treasury.provisions) || 0)) } } : {};
        return res.status(200).json({
            ok: true,
            treasury,
            character: settled.character,
            xp: Number(clanRow.xp) || 0,
            level: Number(clanRow.level) || 1,
            _saveVersion: settled._saveVersion,
            ...stores,
            ...(settled.replayed ? { replayed: true } : {}),
        });
    } catch (err) {
        if (err instanceof SaveDebitRefusal) {
            return res.status(err.status).json({ ...err.details, error: err.message });
        }
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'The clan treasury is busy right now — please retry.', retryable: true });
        }
        console.error('[clan/treasury/donate]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
