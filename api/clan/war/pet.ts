import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import { safeLogValue } from '../../_safe-log.js';
import { petStatCeil, type PetCeilStat } from '../../_pet-stat-ceil.js';
import { petCombatBusyReason } from '../../pet/_pet-busy.js';
import { activeCarriedPets } from '../../_entitlements.js';
import type { Pet } from '../../_pet-sim/pet-types.js';
import { awardWarEndClanXp } from './_war-xp.js';
import { awardFinalizedWarPoints } from './_war-points.js';
import {
    applyFinalResult,
    applyLazyClanWarExpiry,
    CLAN_WAR_REMATCH_COOLDOWN_SEC,
    clanWarCooldownKey,
    type ClanWar,
} from './_storage.js';
import {
    clanWarPetSessionKey,
    clanWarPetDeclineMessage,
    normalizeClanWarPetSession,
    resolveClanWarPetDuel,
    isReadyToResolve,
    petsPerSide,
    sideOfPlayer,
    CLAN_WAR_PET_SESSION_TTL_SEC,
    type ClanWarPetMode,
    type ClanWarPetSession,
} from './_pet-duel.js';

/*
 * /api/clan/war/pet — POST only. The SERVER-AUTHORITATIVE clan-war pet battle.
 *
 * Actions (body.action):
 *   submit { warId, challengeId, petId }  — field a pet. Sealed from the caller's
 *          OWN save (never the request body) and clamped to the per-rarity stat
 *          ceiling, so a tampered save can't field an impossible pet.
 *   state  { warId, challengeId }         — read the session; drives the other
 *          side's "waiting" UI and the client's deterministic replay.
 *
 * Once both sides have fielded their pets the duel resolves IMMEDIATELY and
 * server-side — it is a deterministic auto-battle, so there are no turns to play —
 * and the challenge is finalized through the same applyFinalResult / clan-point /
 * clan-XP path a PvP report uses. `report.ts` refuses client-reported pet results.
 *
 * The client replays the identical (pets, seed, pinned params) through the same
 * engine, so the fight it animates cannot disagree with the recorded outcome.
 * Items are pinned OFF: this asynchronous mode has no item-settlement lease, so
 * an equipped consumable remains equipped and is never represented as charged.
 */

const CEIL_STATS: readonly PetCeilStat[] = ['hp', 'attack', 'defense', 'speed'];

// Seal a player's chosen pet from their save (by id, else active, else first), then
// clamp the four battle stats to the per-rarity anti-tamper ceiling. Mirrors
// api/village/sector-pet.ts sealPlayerPet — combat-busy pets cannot be fielded.
async function sealPlayerPet(playerName: string, petId: string): Promise<Pet | null> {
    const save = await kv.get<{ character?: { pets?: unknown[]; activePetId?: string } }>(`save:${playerName.toLowerCase()}`);
    const pets = activeCarriedPets<Record<string, unknown>>(save?.character ?? {});
    if (!pets.length) return null;
    const activeId = String(save?.character?.activePetId ?? '');
    const raw = pets.find((p) => String(p.id) === petId)
        ?? pets.find((p) => String(p.id) === activeId)
        ?? pets[0];
    if (!raw) return null;
    if (petCombatBusyReason((save?.character ?? {}) as Record<string, unknown>, raw)) return null;
    const pet = { ...raw } as unknown as Pet;
    for (const stat of CEIL_STATS) {
        const v = Number(raw[stat]) || 0;
        (pet as unknown as Record<string, number>)[stat] = Math.min(v, petStatCeil(raw.rarity, stat));
    }
    return pet;
}

/** Hide the opposing side's pets until the duel resolves, so neither player can
 *  scout the matchup and re-pick. Once it's done, both sides see everything (the
 *  replay needs it). */
function projectForViewer(session: ClanWarPetSession, side: 'from' | 'to' | null): ClanWarPetSession {
    if (session.status === 'done' || !side) return session;
    return { ...session, from: side === 'from' ? session.from : [], to: side === 'to' ? session.to : [] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-war-pet', 60, 60_000, identity.name))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const action = String(body?.action ?? '').toLowerCase();
        const warId = String(body?.warId ?? '').trim();
        const challengeId = String(body?.challengeId ?? '').trim();
        if (!warId || !challengeId) return res.status(400).json({ error: 'Missing warId or challengeId.' });
        const me = identity.admin ? safeName(String(body?.playerName ?? '')) : identity.name;

        const warKey = `clan-war:${warId}`;
        const sessionKey = clanWarPetSessionKey(warId, challengeId);

        if (action === 'state') {
            const [session, war] = await Promise.all([
                kv.get<Partial<ClanWarPetSession>>(sessionKey).then(normalizeClanWarPetSession),
                kv.get<ClanWar>(warKey),
            ]);
            if (!session) return res.status(404).json({ error: 'No pet battle session yet.' });
            const ch = war?.pendingChallenges.find(c => c.id === challengeId)
                ?? war?.completedChallenges?.find(c => c.id === challengeId);
            const side = ch ? sideOfPlayer(me, ch) : null;
            if (!side && !identity.admin) return res.status(403).json({ error: clanWarPetDeclineMessage('not-a-participant') });
            return res.status(200).json({ session: projectForViewer(session, side) });
        }
        if (action !== 'submit') return res.status(400).json({ error: `Unknown action: ${action}` });

        // Everything below mutates: serialize on the SESSION so two submissions can't
        // both see an incomplete roster and both trigger the resolve. The war lock is
        // taken inside, only when we actually finalize (order: session → war).
        const outcome = await withKvLock(sessionKey, async () => {
            const war = await kv.get<ClanWar>(warKey);
            if (!war) return { status: 404 as const, body: { error: 'War not found.' } };
            if (war.endedAt) return { status: 409 as const, body: { error: 'War has already ended.' } };

            const ch = war.pendingChallenges.find(c => c.id === challengeId);
            if (!ch) return { status: 404 as const, body: { error: 'Challenge not found or already completed.' } };
            if (ch.status !== 'accepted') return { status: 409 as const, body: { error: 'Challenge has not been accepted yet.' } };
            if (ch.mode !== 'pet1v1' && ch.mode !== 'pet2v2') {
                return { status: 400 as const, body: { error: clanWarPetDeclineMessage('not-a-pet-mode') } };
            }
            const mode = ch.mode as ClanWarPetMode;

            const side = sideOfPlayer(me, ch);
            if (!side) return { status: 403 as const, body: { error: clanWarPetDeclineMessage('not-a-participant') } };

            const now = Date.now();
            const existing = normalizeClanWarPetSession(await kv.get<Partial<ClanWarPetSession>>(sessionKey));
            const session: ClanWarPetSession = existing ?? {
                warId, challengeId, mode,
                // The seed is minted server-side when the challenge is created, so
                // neither player can shop for a favourable duel.
                seed: Math.floor(Number(ch.petBattleSeed) || 0) || (now ^ 0x9e3779b9) >>> 0,
                from: [], to: [], status: 'awaiting-pets', consumablesCharged: false,
                createdAt: now, updatedAt: now,
            };
            if (session.status === 'done') {
                return { status: 409 as const, body: { error: clanWarPetDeclineMessage('duel-already-resolved'), session: projectForViewer(session, side) } };
            }

            const roster = side === 'from' ? session.from : session.to;
            if (roster.some((f) => f.name.toLowerCase() === me.toLowerCase())) {
                // Idempotent: a retry from the same player just re-reads the session.
                return { status: 200 as const, body: { session: projectForViewer(session, side) } };
            }
            if (roster.length >= petsPerSide(mode)) {
                return { status: 409 as const, body: { error: clanWarPetDeclineMessage('side-already-full') } };
            }

            const pet = await sealPlayerPet(me, String(body?.petId ?? ''));
            if (!pet) return { status: 400 as const, body: { error: clanWarPetDeclineMessage('no-pet') } };
            roster.push({ name: me, pet });
            session.updatedAt = now;

            if (!isReadyToResolve(session)) {
                await kv.set(sessionKey, session, { ex: CLAN_WAR_PET_SESSION_TTL_SEC });
                return { status: 200 as const, body: { session: projectForViewer(session, side) } };
            }

            // Both sides are in → resolve deterministically and finalize the challenge.
            session.winner = resolveClanWarPetDuel(session);
            session.status = 'done';

            const finalized = await withKvLock(warKey, async () => {
                const fresh = await kv.get<ClanWar>(warKey);
                if (!fresh) return null;
                const expiry = applyLazyClanWarExpiry(fresh);
                if (expiry.war.endedAt) return null;   // war closed under us; the duel still stands as a record
                const live = expiry.war.pendingChallenges.find(c => c.id === challengeId);
                if (!live || live.status !== 'accepted') return null;
                const applied = applyFinalResult(expiry.war, live, session.winner!, now);
                if (applied.warJustEnded) {
                    await kv.set(clanWarCooldownKey(applied.war.clans[0], applied.war.clans[1]), now, { ex: CLAN_WAR_REMATCH_COOLDOWN_SEC });
                }
                await kv.set(warKey, applied.war);
                return applied;
            }, { failClosed: true });

            session.appliedToChallenge = !!finalized;
            await kv.set(sessionKey, session, { ex: CLAN_WAR_PET_SESSION_TTL_SEC });
            return {
                status: 200 as const,
                body: { session: projectForViewer(session, side) },
                finalized,
            };
        }, { failClosed: true });

        // Payouts run AFTER the locks, mirroring report.ts. Every award is eventId-keyed
        // so a retry can't double-pay.
        const finalized = (outcome as { finalized?: { war: ClanWar; completed: unknown; warJustEnded: boolean } }).finalized;
        if (outcome.status === 200 && finalized) {
            const actorName = identity.admin ? '' : identity.name;
            const character = await awardFinalizedWarPoints(
                { war: finalized.war, challenge: finalized.completed, warEnded: finalized.warJustEnded, tentative: false },
                actorName,
            );
            await awardWarEndClanXp(finalized.war)
                .catch((e) => console.error('[clan/war/pet] clan-xp award failed', safeLogValue(e)));
            return res.status(200).json({
                ...outcome.body,
                warEnded: finalized.warJustEnded,
                war: finalized.war,
                character,
            });
        }
        return res.status(outcome.status).json(outcome.body);
    } catch (err) {
        console.error('[clan/war/pet]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
