import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../../_storage.js';
import { cors, safeName } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import { applyTreasuryDonation, type TreasuryDonation } from '../../_treasury-donate.js';

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
 * Body (currency):  { playerName, clan, currency, amount }
 * Body (item):      { playerName, clan, itemId, count? }   // count defaults to 1
 *
 * Caller MUST be the donor (or admin) and a member of `clan`. Rate-limited at
 * 30/min per actor. Locks held: clan save row (outer) + donor save row (inner).
 */

// Player-donatable clan currencies. warSupply is war-earned, not donated.
const CLAN_CURRENCIES = ['ryo', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals'] as const;

// Per-call sanity ceilings. Unlike the validator's defense-in-depth caps,
// crediting a clan treasury is not itself an attack (funds leave the donor and
// land in the shared clan pool, recoverable by leadership) — the real exploit
// the atomic debit closes is credit-without-debit. These bounds only stop
// absurd / overflow inputs; the binding limit is the donor's own balance.
const CURRENCY_CAPS: Record<string, number> = {
    ryo: 10_000_000,
    fateShards: 100_000,
    boneCharms: 100_000,
    auraStones: 100_000,
    mythicSeals: 100_000,
};
const ITEM_COUNT_CAP = 1_000;

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

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only donate your own resources.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-treasury-donate', 30, 60_000, identity.name))) return;

        const targetSlug = clanSlugBare(clan);
        if (!targetSlug) return res.status(400).json({ error: 'Invalid clan name.' });
        const clanSaveKey = `save:clan-${targetSlug}`;
        const donorSaveKey = `save:${playerName}`;

        // ── Atomic donate ──────────────────────────────────────────────
        // Lock the clan save row (the shared, contended resource) first,
        // then the donor save row. The donor debit is COMMITTED before the
        // treasury credit, so a credit failure can never leave the treasury
        // credited without a matching debit (the only outcome of a mid-way
        // failure is the donor losing the funds, which is recoverable and
        // not a free-mint exploit). No other code path takes these two
        // locks in the opposite order, so the nesting can't deadlock.
        const result = await withKvLock(clanSaveKey, async () => {
            const clanRec = await kv.get<Record<string, unknown>>(clanSaveKey);
            if (!clanRec) return { ok: false as const, status: 404, error: 'Clan not found.' };

            const debit = await withKvLock(donorSaveKey, async () => {
                const donorRec = await kv.get<Record<string, unknown>>(donorSaveKey);
                const donorChar = (donorRec?.character ?? null) as Record<string, unknown> | null;
                if (!donorChar) return { ok: false as const, status: 404, error: 'Donor save not found.' };

                // Membership: donor's character.clan must resolve to this clan.
                if (!identity.admin) {
                    const donorClanSlug = clanSlugBare(String(donorChar.clan ?? ''));
                    if (!donorClanSlug || donorClanSlug !== targetSlug) {
                        return { ok: false as const, status: 403, error: 'You are not a member of this clan.' };
                    }
                }

                const outcome = applyTreasuryDonation(
                    clanRec.treasury as Record<string, unknown> | undefined,
                    donorChar,
                    donation,
                    { allowedCurrencies: CLAN_CURRENCIES, currencyCaps: CURRENCY_CAPS, itemCountCap: ITEM_COUNT_CAP },
                );
                if (!outcome.ok) return outcome;

                // Commit donor debit first.
                await kv.set(donorSaveKey, { ...donorRec, character: outcome.nextDonorChar });
                return { ok: true as const, nextTreasury: outcome.nextTreasury };
            }, { failClosed: true });
            if (!debit.ok) return debit;

            // Credit the clan treasury (donor debit is already committed).
            await kv.set(clanSaveKey, { ...clanRec, treasury: debit.nextTreasury });
            return { ok: true as const, treasury: debit.nextTreasury };
        }, { failClosed: true });

        if (!result.ok) return res.status(result.status).json({ error: result.error });

        // Best-effort audit log (30-day TTL).
        await kv.set(`${AUDIT_LOG_PREFIX}${targetSlug}:${Date.now()}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            clan,
            ...(donation.kind === 'currency'
                ? { currency: donation.currency, amount: Math.floor(donation.amount) }
                : { itemId: donation.itemId, count: Math.floor(donation.count) }),
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);

        return res.status(200).json({ ok: true, treasury: result.treasury });
    } catch (err) {
        console.error('[clan/treasury/donate]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
