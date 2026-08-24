import { safeLogValue } from '../_safe-log.js';
import { territoryRewardsSuspended } from '../_territory-lifecycle.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { seededVillageAgenda, verifyAgendaCompletion } from '../_village-agenda.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { MERIT_DAILY_AGENDA, meritNum } from './_village-merit.js';

/*
 * /api/village/claim-daily-agenda  — POST only
 *
 * Server-authoritative VILLAGE-TREASURY half of the daily-agenda reward. The old
 * flow credited the shared village treasury (+15 honorSeals / +1500 ryo / +2
 * boneCharms) via the save blob, which the village-state validator could only
 * cap, not verify — a crafted client could credit arbitrary amounts or claim
 * repeatedly (#17 credit-without-debit on the shared pool).
 *
 * This endpoint credits the FIXED treasury amounts under the village-state lock,
 * at most once per player per UTC day. The claim receipt is committed in the
 * same village-state write as the credit, so an interrupted request can retry
 * without burning the reward or applying it twice.
 *
 * It ALSO credits the player's own fixed PERSONAL reward (audit #7 / Stage 3
 * Phase 2): +750 ryo, +1 boneCharm, +8 honorSeals (Vanguard only). That credit
 * runs under lock:save:<name> (the same lock the autosave takes) with its OWN
 * in-save day receipt committed with the reward — exactly-once, failClosed →
 * 503/retry — so the player save can no longer be raced and a crafted client
 * can no longer claim the personal reward repeatedly or inflate it. The client
 * still adds the returned `granted` delta to its OWN balance (preserving
 * concurrent ryo gains) and re-asserts via autosave; the two converge. The
 * sanitizer stays permissive for these currencies (they have other legit
 * sources — missions/raids/hunts — until later Stage-3 phases move those too).
 * Task COMPLETION is re-verified server-side: the current agenda pool only
 * contains "control" (sectors held, from world:territory:*, written solely by
 * server endpoints). Client-incremented daily counters are excluded from the
 * rewardable pool until server-side ledgers exist for them.
 *
 * Body: { playerName, village }. Caller MUST be the player (or admin) and a
 * member of `village`. Rate-limited 30/min per actor.
 */

const VILLAGE_STATE_PREFIX = 'game:village-state:';
const AGENDA_TREASURY = { honorSeals: 15, ryo: 1500, boneCharms: 2 } as const;
// Vanguard village tithe (owner ruling 2026-08-17). Village upgrades are shared
// infrastructure funded from this pool, and the Vanguard's whole purpose is to
// be the best at PvP FOR THEIR VILLAGE — but the base agenda credit is
// profession-agnostic, so a Vanguard capping 150 Honor Seals a day funded their
// village exactly as much as someone who never fights. This is the seam that
// makes the role's contribution real: a Vanguard's daily claim pays the
// treasury 50 seals instead of 15.
//
// It lives HERE rather than at the PvP grant on purpose. This path already
// takes the village-state lock, already writes the treasury, and is already
// receipt-guarded one-claim-per-player-per-UTC-day — so the tithe inherits all
// of that. Splitting the seal grant inside api/pvp/claim-rewards.ts would have
// added a brand-new cross-key currency write to the most safety-critical path
// in the game for the same effect.
const AGENDA_TREASURY_VANGUARD_SEALS = 50;
// Personal reward (audit #7 / Stage 3 Phase 2). VERBATIM port of the client
// (App.tsx claimVillageAgenda): flat ryo + boneCharm for everyone; honorSeals
// only for the Vanguard profession (vanguardOnlyHonorSeals). The client's
// fateShards line is nonVanguardShardSubstitute(8) = floor(8/25) = 0, so there
// is no fateShard grant here — omitting it is a zero-balance change.
const AGENDA_PERSONAL = { ryo: 750, boneCharms: 1, honorSeals: 8 } as const;
const AUDIT_LOG_PREFIX = 'audit:village-agenda-claim:';

function villageSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function utcDate(): string {
    return new Date().toISOString().slice(0, 10);
}

export function applyAgendaPersonalReward(char: Record<string, unknown>, date: string) {
    if (char.claimedVillageAgendaDate === date) {
        return {
            character: char,
            alreadyClaimed: true,
            granted: { ryo: 0, boneCharms: 0, honorSeals: 0 },
        };
    }
    const granted = {
        ryo: AGENDA_PERSONAL.ryo,
        boneCharms: AGENDA_PERSONAL.boneCharms,
        honorSeals: char.profession === 'vanguard' ? AGENDA_PERSONAL.honorSeals : 0,
    };
    return {
        character: {
            ...char,
            ryo: num(char.ryo) + granted.ryo,
            boneCharms: num(char.boneCharms) + granted.boneCharms,
            honorSeals: num(char.honorSeals) + granted.honorSeals,
            claimedVillageAgendaDate: date,
            villageMerit: meritNum(char.villageMerit) + MERIT_DAILY_AGENDA,
        },
        alreadyClaimed: false,
        granted,
    };
}

export function applyAgendaTreasuryReward(state: Record<string, unknown>, claimId: string, isVanguard = false) {
    const claimDate = claimId.slice(0, 10);
    const receipts = Array.isArray(state.agendaClaimReceipts)
        ? (state.agendaClaimReceipts as unknown[]).filter((value): value is string =>
            typeof value === 'string' && value.startsWith(`${claimDate}:`))
        : [];
    const treasury = (state.treasury ?? {}) as Record<string, unknown>;
    if (receipts.includes(claimId)) return { state, treasury, alreadyClaimed: true };
    const nextTreasury = {
        ...treasury,
        honorSeals: num(treasury.honorSeals) + (isVanguard ? AGENDA_TREASURY_VANGUARD_SEALS : AGENDA_TREASURY.honorSeals),
        ryo: num(treasury.ryo) + AGENDA_TREASURY.ryo,
        boneCharms: num(treasury.boneCharms) + AGENDA_TREASURY.boneCharms,
    };
    return {
        state: { ...state, treasury: nextTreasury, agendaClaimReceipts: [...receipts, claimId] },
        treasury: nextTreasury,
        alreadyClaimed: false,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        if (!playerName || !village) return res.status(400).json({ error: 'Missing playerName or village.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only claim for yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-agenda-claim', 30, 60_000, identity.name))) return;

        const slug = villageSlug(village);
        if (!slug) return res.status(400).json({ error: 'Invalid village name.' });
        const villageStateKey = `${VILLAGE_STATE_PREFIX}${slug}`;

        // Membership: the caller's character must belong to this village (admin exempt).
        if (!identity.admin) {
            const donorRec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const donorChar = (donorRec?.character ?? null) as Record<string, unknown> | null;
            if (!donorChar) return res.status(404).json({ error: 'Your save was not found.' });
            if (String(donorChar.village ?? '').trim() !== village) {
                return res.status(403).json({ error: 'You are not a member of this village.' });
            }
        }

        const date = utcDate();

        // ── Server-side task-completion check (verifiable subset) ──────────────
        // Re-derive today's seeded agenda and verify it BEFORE crediting or
        // placing any NX marker. The current pool only contains "control"
        // (sectors held): world:territory:* is written by server endpoints, so
        // the count cannot be faked. Rejecting here (no marker placed) lets the
        // player re-claim once they genuinely meet it. Admins skip - they may
        // test without holding territory.
        if (!identity.admin) {
            const seededKinds = seededVillageAgenda(village, date).map((task) => task.kind);
            let heldSectors = 0;
            if (seededKinds.includes('control')) {
                const territoryKeys = await kv.keys('world:territory:*');
                const territories = territoryKeys.length
                    ? ((await kv.mget<Record<string, unknown>[]>(...territoryKeys)).filter(Boolean) as Record<string, unknown>[])
                    : [];
                const rewardNow = Date.now();
                heldSectors = territories.filter((t) => String(t.ownerVillage ?? '').trim() === village
                    && !territoryRewardsSuspended(t, rewardNow)).length;
            }
            const gate = verifyAgendaCompletion(seededKinds, heldSectors);
            if (!gate.ok) return res.status(403).json({ error: gate.error });
        }

        // ── PERSONAL reward (audit #7 / Stage 3 Phase 2) ───────────────────────
        // Credit the player's OWN fixed agenda reward under lock:save:<name> (the
        // same lock the autosave takes) with its in-save day receipt. The reward
        // and receipt share one write, and a contention abort leaves both absent
        // for a clean retry. Done BEFORE the treasury credit so a personal 503
        // cannot leave a partial personal payout. The client adds the returned
        // `granted` delta to its OWN balance (not the absolute — so concurrent ryo
        // gains elsewhere survive) and re-asserts via autosave; the two converge.
        let personal: { alreadyClaimed: boolean; granted: { ryo: number; boneCharms: number; honorSeals: number }; isVanguard: boolean; balances: { ryo: number; boneCharms: number; honorSeals: number }; saveVersion: number };
        try {
            const out = await withKvLock(`save:${playerName}`, async () => {
                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { error: 'no-save' as const };
                const applied = applyAgendaPersonalReward(char, date);
                const nextChar = applied.character;
                const next = bumpSaveVersion({ ...rec, character: nextChar });
                if (!applied.alreadyClaimed) await kv.set(`save:${playerName}`, mergePreservingImages(next, rec));
                return {
                    alreadyClaimed: applied.alreadyClaimed,
                    granted: applied.granted,
                    // `profession` is server-owned (locked to stored by the save
                    // sanitizer), so the tithe cannot be claimed by a forged save.
                    isVanguard: char.profession === 'vanguard',
                    balances: { ryo: num(nextChar.ryo), boneCharms: num(nextChar.boneCharms), honorSeals: num(nextChar.honorSeals) },
                    saveVersion: applied.alreadyClaimed
                        ? Number(rec._saveVersion ?? 0)
                        : Number((next as Record<string, unknown>)._saveVersion ?? 0),
                };
            }, { failClosed: true });
            if ('error' in out) return res.status(404).json({ error: 'Your save was not found.' });
            personal = out;
        } catch (e) {
            console.error('[village/claim-daily-agenda] personal credit failed', e);
            return res.status(503).json({ error: 'Could not credit your daily reward — please retry.' });
        }

        // One treasury credit per player per UTC day. The bounded claim-ID list
        // lives in the village state and is written atomically with the treasury
        // increase. If the personal write completed before an interruption, a
        // retry skips it and safely finishes this half.
        const claimId = `${date}:${playerName.toLowerCase()}`;
        const isVanguardClaimer = personal.isVanguard;
        const treasuryOutcome = await withKvLock(villageStateKey, async () => {
            const state = (await kv.get<Record<string, unknown>>(villageStateKey)) ?? {};
            const applied = applyAgendaTreasuryReward(state, claimId, isVanguardClaimer);
            if (!applied.alreadyClaimed) await kv.set(villageStateKey, applied.state);
            return { alreadyClaimed: applied.alreadyClaimed, treasury: applied.treasury };
        }, { failClosed: true });
        const treasury = treasuryOutcome.treasury;

        await kv.set(`${AUDIT_LOG_PREFIX}${slug}:${Date.now()}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            village,
            player: playerName,
            granted: treasuryOutcome.alreadyClaimed ? { honorSeals: 0, ryo: 0, boneCharms: 0 } : AGENDA_TREASURY,
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);

        return res.status(200).json({
            ok: true,
            alreadyClaimed: treasuryOutcome.alreadyClaimed && personal.alreadyClaimed,
            treasuryAlreadyClaimed: treasuryOutcome.alreadyClaimed,
            personalAlreadyClaimed: personal.alreadyClaimed,
            treasury,
            granted: treasuryOutcome.alreadyClaimed ? { honorSeals: 0, ryo: 0, boneCharms: 0 } : AGENDA_TREASURY,
            personal,
            _saveVersion: personal.saveVersion,
        });
    } catch (err) {
        console.error('[village/claim-daily-agenda]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
