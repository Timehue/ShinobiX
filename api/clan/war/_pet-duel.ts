/*
 * Clan War — the PET win-conditions (pet1v1 / pet2v2), resolved SERVER-SIDE.
 *
 * WHY: pet modes were the last client-reported clan-war outcome. `report.ts`
 * cross-checks PvP modes against the authoritative PvpSession, but pet challenges
 * carry no battleId, so they fell through to two-phase reporting alone — and the
 * 15-minute auto-confirm fires BEFORE the same-player guard, so whoever stamped
 * the tentative could finalize their own claim unilaterally. Pet wins are worth
 * 20/40 clan-war HP and pay clan points + clan XP, so that was a live
 * currency-touching client trust.
 *
 * The fix needs no new combat code. A clan-war pet battle is already a fully
 * DETERMINISTIC auto-resolve from (pets, seed) — the client passes no player
 * commands for a real-player fight (PetArena only runs a commanded duel against a
 * built-in AI) — and `api/_pet-sim/pet-duel-cinematic.ts` is a GENERATED,
 * parity-guarded mirror of the very engine the client renders. So the server runs
 * the same function over pets sealed from each owner's save and owns the result;
 * the client replays the same inputs and watches a byte-identical fight.
 *
 * Mirrors api/village/sector-pet.ts, which does this for the Sector War.
 */

import { runPetDuelCinematic, runPetPartyDuelCinematic } from '../../_pet-sim/pet-duel-cinematic.js';
import type { Pet } from '../../_pet-sim/pet-types.js';

/**
 * Duel parameters PINNED for every clan-war pet battle.
 *
 * These are the values for an asynchronous garrison fight: no PvE mastery
 * multipliers (`isGenericPetOpponent` is false against a player), no items, and
 * no terrain. Consumables must stay inert here because neither owner is present
 * to authorize or atomically settle a charge. KEEP IN SYNC with the client mirror in
 * shinobij.client/src/lib/clan-war-pet-api.ts — the replay must feed the engine
 * exactly these numbers or it will diverge from the recorded result.
 *
 * `accuracy` is pinned DELIBERATELY. The client reads it from
 * `petAccuracyEnabled()` → localStorage, so today two players with different
 * toggles compute DIFFERENT winners for the same clan-war fight. `true` is the
 * client's unset default, so pinning it here keeps the fight players already
 * experience while making it reproducible on the server.
 */
export const CLAN_WAR_PET_DUEL = Object.freeze({
    damageMult: 1,
    hpMult: 1,
    reviveOnce: false,
    applyItems: false,
    accuracy: true,
    terrain: null as string | null,
});

export type ClanWarPetMode = 'pet1v1' | 'pet2v2';
/** Which side of the challenge a fighter is on. `from` = the challenging clan. */
export type ClanWarPetSide = 'from' | 'to';
export type ClanWarPetOutcome = 'from-wins' | 'to-wins' | 'draw';

export interface ClanWarPetFighter {
    name: string;
    pet: Pet;
}

export interface ClanWarPetSession {
    warId: string;
    challengeId: string;
    mode: ClanWarPetMode;
    /** Server-minted at challenge creation — the shared, unforgeable duel seed. */
    seed: number;
    /** Fighters sealed from each owner's save, in submission order. */
    from: ClanWarPetFighter[];
    to: ClanWarPetFighter[];
    status: 'awaiting-pets' | 'done';
    /** Async garrison fights never consume an equipped item. Always false. */
    consumablesCharged: false;
    winner?: ClanWarPetOutcome;
    /** Set once the outcome has been applied to the war record (idempotence). */
    appliedToChallenge?: boolean;
    createdAt: number;
    updatedAt: number;
}

/** How many pets each side fields in a mode. */
export function petsPerSide(mode: ClanWarPetMode): number {
    return mode === 'pet2v2' ? 2 : 1;
}

/** True once both sides have fielded their full complement and the duel can run. */
export function isReadyToResolve(session: Pick<ClanWarPetSession, 'mode' | 'from' | 'to'>): boolean {
    const need = petsPerSide(session.mode);
    return session.from.length >= need && session.to.length >= need;
}

/**
 * Run the duel. `from` is the engine's "player" side and `to` the "enemy" side, so
 * the winner maps straight onto the challenge result. Pure and deterministic given
 * (pets, seed) — the client replay calls the identical function with the identical
 * inputs.
 */
export function resolveClanWarPetDuel(
    session: Pick<ClanWarPetSession, 'mode' | 'seed' | 'from' | 'to'>,
): ClanWarPetOutcome {
    const p = CLAN_WAR_PET_DUEL;
    const result = session.mode === 'pet2v2'
        ? runPetPartyDuelCinematic(
            session.from[0].pet, session.from[1]?.pet ?? null,
            session.to[0].pet, session.to[1]?.pet ?? null,
            session.seed, p.damageMult, p.hpMult, p.reviveOnce, p.applyItems, p.accuracy,
        )
        : runPetDuelCinematic(
            session.from[0].pet, session.to[0].pet,
            session.seed, p.damageMult, p.hpMult, p.reviveOnce, p.applyItems, p.accuracy, p.terrain,
        );
    // A null winner is the engine's timeout/both-alive case → a genuine draw.
    return result.winner === 'player' ? 'from-wins' : result.winner === 'enemy' ? 'to-wins' : 'draw';
}

/** Storage key for a challenge's pet session. */
export function clanWarPetSessionKey(warId: string, challengeId: string): string {
    return `clan-war-pet:${warId}:${challengeId}`;
}

/** 2h TTL — long enough for both sides to show up, short enough to self-clean. */
export const CLAN_WAR_PET_SESSION_TTL_SEC = 2 * 60 * 60;

export type ClanWarPetDecline =
    | 'not-a-pet-mode'
    | 'not-a-participant'
    | 'side-already-full'
    | 'already-submitted'
    | 'duel-already-resolved'
    | 'no-pet';

export function clanWarPetDeclineMessage(reason: ClanWarPetDecline): string {
    switch (reason) {
        case 'not-a-pet-mode': return 'That challenge is not a pet battle.';
        case 'not-a-participant': return 'Only a named participant can send a pet into this battle.';
        case 'side-already-full': return 'Your side has already fielded its pets.';
        case 'already-submitted': return 'You have already sent a pet into this battle.';
        case 'duel-already-resolved': return 'This pet battle has already been decided.';
        case 'no-pet': return 'You have no pet available to send into battle.';
        default: return 'That pet battle could not be joined.';
    }
}

/** Which side of the challenge a player is on, or null when they are not a
 *  participant. Names are compared case-insensitively. */
export function sideOfPlayer(
    playerName: string,
    ch: { fromPlayer?: string; fromPlayer2?: string; acceptedPlayer?: string; acceptedPlayer2?: string },
): ClanWarPetSide | null {
    const n = String(playerName ?? '').trim().toLowerCase();
    if (!n) return null;
    const eq = (v?: string) => String(v ?? '').trim().toLowerCase() === n;
    if (eq(ch.fromPlayer) || eq(ch.fromPlayer2)) return 'from';
    if (eq(ch.acceptedPlayer) || eq(ch.acceptedPlayer2)) return 'to';
    return null;
}

/** Normalize a stored session, dropping anything structurally invalid. */
export function normalizeClanWarPetSession(raw: Partial<ClanWarPetSession> | null | undefined): ClanWarPetSession | null {
    if (!raw) return null;
    const warId = String(raw.warId ?? '').trim();
    const challengeId = String(raw.challengeId ?? '').trim();
    const mode: ClanWarPetMode = raw.mode === 'pet2v2' ? 'pet2v2' : 'pet1v1';
    if (!warId || !challengeId) return null;
    const fighters = (v: unknown): ClanWarPetFighter[] =>
        (Array.isArray(v) ? v : [])
            .filter((f): f is ClanWarPetFighter => !!f && typeof f === 'object' && !!(f as ClanWarPetFighter).pet)
            .map((f) => ({ name: String(f.name ?? '').trim(), pet: f.pet }))
            .slice(0, petsPerSide(mode));
    return {
        warId,
        challengeId,
        mode,
        seed: Math.floor(Number(raw.seed) || 0),
        from: fighters(raw.from),
        to: fighters(raw.to),
        status: raw.status === 'done' ? 'done' : 'awaiting-pets',
        // Never trust stored/caller metadata to claim an item charge. This mode
        // has no item settlement transaction, so the only truthful value is false.
        consumablesCharged: false,
        winner: raw.winner,
        appliedToChallenge: !!raw.appliedToChallenge,
        createdAt: Math.floor(Number(raw.createdAt) || 0),
        updatedAt: Math.floor(Number(raw.updatedAt) || 0),
    };
}
