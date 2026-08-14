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

import { resolveWarDuel, type WarDuelInput } from '../../_pet-showdown/war-duel.js';
import type { ShowdownReplayScript } from '../../../shared/pet-showdown-contract.js';
import type { Pet } from '../../_pet-sim/pet-types.js';

/*
 * The pinned duel parameters (CLAN_WAR_PET_DUEL) retire with the legacy sim.
 * What survives, reconciled with main's items-on change ("the values PetArena
 * already uses for a real-player fight"):
 *   - GEAR APPLIES. These are two real players' pets; sealShowdownPet applies
 *     equipped PvP gear exactly as the live arena does.
 *   - CONSUMABLES STAY INERT. An async garrison fight has no settlement
 *     transaction — neither owner is present to authorize a charge — so a
 *     consumable firing here would be a benefit that never costs the item.
 *     The seal strips only that slot (see war-duel.ts).
 *   - The `accuracy` pin is moot on Showdown: there is no client-toggleable
 *     accuracy, so the per-device divergence it guarded against cannot exist.
 */

export type ClanWarPetMode = 'pet1v1' | 'pet2v2';
/** Which side of the challenge a fighter is on. `from` = the challenging clan. */
export type ClanWarPetSide = 'from' | 'to';
export type ClanWarPetOutcome = 'from-wins' | 'to-wins' | 'draw';

export interface ClanWarPetFighter {
    name: string;
    /** The champion this player sent. */
    pet: Pet;
    /** Their full 2v2+bench roster, sealed at submit (owner ruling: war duels
     *  are 2v2 with two reserves). Absent on sessions written before the team
     *  change — readers fall back to `pet`. */
    team?: Pet[];
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
    winner?: ClanWarPetOutcome;
    /** Which combat engine decided this session. Sessions resolved before the
     *  Showdown cutover carry no stamp; the watch endpoint refuses those, since
     *  a Showdown re-derivation of a legacy-decided fight would show a battle
     *  whose winner can disagree with the recorded one. */
    engine?: 'showdown';
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

/** The one place the session's stored fields become a war-duel input, so the
 *  resolver and the watch script derive from EXACTLY the same values. */
function warInputOf(session: Pick<ClanWarPetSession, 'mode' | 'seed' | 'from' | 'to'>): WarDuelInput {
    return {
        // Deterministic label from the seed — never a clock, never an id the
        // two call sites could disagree on.
        sessionId: `clanwar:${session.seed}`,
        seed: session.seed,
        fromName: session.from[0]?.name || 'Challengers',
        toName: session.to[0]?.name || 'Defenders',
        // A side's roster is every sealed team its players sent, in submission
        // order — so a pet2v2 (two players a side) fields both champions and
        // their reserves, and a pet1v1 fields one player's full team. The
        // engine takes the first two onto the field and benches the rest.
        fromPets: session.from.flatMap((f) => (f.team?.length ? f.team : [f.pet])),
        toPets: session.to.flatMap((f) => (f.team?.length ? f.team : [f.pet])),
        terrain: null,
    };
}

/**
 * Run the duel on the Showdown engine. `from` is the engine's "player" side and
 * `to` the "enemy" side, so the winner maps straight onto the challenge result.
 * Pure and deterministic given (pets, seed).
 *
 * Never returns 'draw': Showdown's round-cap judge always decides (pets left,
 * then HP, then stamina, then speed). The 'draw' member stays in the outcome
 * type only for sessions recorded by the legacy engine.
 */
export function resolveClanWarPetDuel(
    session: Pick<ClanWarPetSession, 'mode' | 'seed' | 'from' | 'to'>,
): ClanWarPetOutcome {
    return resolveWarDuel(warInputOf(session)).outcome === 'from' ? 'from-wins' : 'to-wins';
}

/** Re-derive the watchable script for a resolved session. The caller must have
 *  checked `session.engine === 'showdown'` — deriving a script for a
 *  legacy-decided session would show a fight with a potentially different
 *  winner than the war record. */
export function clanWarPetDuelScript(
    session: Pick<ClanWarPetSession, 'mode' | 'seed' | 'from' | 'to'>,
): ShowdownReplayScript {
    return resolveWarDuel(warInputOf(session)).script;
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
            .map((f) => ({
                name: String(f.name ?? '').trim(),
                pet: f.pet,
                team: Array.isArray(f.team) ? f.team.filter(Boolean) : undefined,
            }))
            .slice(0, petsPerSide(mode));
    return {
        warId,
        challengeId,
        mode,
        seed: Math.floor(Number(raw.seed) || 0),
        from: fighters(raw.from),
        to: fighters(raw.to),
        status: raw.status === 'done' ? 'done' : 'awaiting-pets',
        engine: raw.engine === 'showdown' ? 'showdown' : undefined,
        winner: raw.winner,
        appliedToChallenge: !!raw.appliedToChallenge,
        createdAt: Math.floor(Number(raw.createdAt) || 0),
        updatedAt: Math.floor(Number(raw.updatedAt) || 0),
    };
}
