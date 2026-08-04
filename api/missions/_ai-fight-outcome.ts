import type { TowerActor, TowerSession } from '../towers/_tower-session.js';
import type { PvpFighter } from '../pvp/session.js';
import { isSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';

/*
 * Step 4 — the outcome of a sealed AI fight, read from the SESSION.
 *
 * Before this, `report-ai-fight` paid on the client's say-so: calling the
 * endpoint at all WAS the claim that the player had won. The reward amounts were
 * already sealed (the token carries baseXp/baseRyo), so the exposure was not the
 * size of the payout — it was that a client could claim a win it never earned,
 * and that losing cost nothing because no defeat was ever reported.
 *
 * Both halves close here. The session is server-owned and server-resolved, so it
 * is the authority on BOTH questions: did the player win, and what HP did they
 * walk away with.
 *
 * This matters as much for difficulty as for anti-cheat. The local Arena path
 * hospitalizes on a defeat and writes the surviving HP back to the save, so a
 * hunt or a village raid carries real risk. A server fight that skipped that
 * would make every migrated fight free to lose and free to retry — the whole
 * risk side of the loop, gone.
 */

/** Matches the hospital stay every other defeat path applies (api/player/heal.ts). */
export const AI_FIGHT_HOSPITAL_DURATION_MS = 60_000;

export type AiFightOutcome = 'win' | 'loss' | 'draw' | 'forfeit' | 'unknown';
export type AiFightSession = TowerSession | SoloPveSession;
export type AiFightPlayerCombatant = TowerActor | PvpFighter;

function num(value: unknown): number {
    return Math.max(0, Math.floor(Number(value) || 0));
}

/**
 * The human fighter in a solo AI-fight session. These sessions carry exactly one
 * non-AI squad actor (a summoned companion is `ai: true`), so side + ai is an
 * unambiguous match and does not depend on the owner-slug spelling.
 */
export function aiFightPlayerActor(session: SoloPveSession): PvpFighter;
export function aiFightPlayerActor(session: TowerSession): TowerActor | undefined;
export function aiFightPlayerActor(session: null | undefined): undefined;
export function aiFightPlayerActor(session: AiFightSession | null | undefined): AiFightPlayerCombatant | undefined;
export function aiFightPlayerActor(session: AiFightSession | null | undefined): AiFightPlayerCombatant | undefined {
    if (isSoloPveSession(session)) return session.player;
    return session?.actors?.find((actor) => actor.side === 'squad' && actor.ai === false);
}

/** Consumables spent by the authoritative human fighter. Settlement applies
 * this inside the same save mutation as the outcome and reward receipt. */
export function aiFightPlayerItemsUsed(session: AiFightSession | null | undefined): Record<string, number> {
    if (!session) return {};
    if (isSoloPveSession(session)) return { ...session.itemsUsed };
    return { ...(aiFightPlayerActor(session)?.itemsUsed ?? {}) };
}

/**
 * Whether `playerName` actually fought in this session.
 *
 * Load-bearing for /api/pve/fight-outcome, where the runId is CLIENT-supplied
 * (unlike the AI-fight path, whose runId comes from a sealed token stored under
 * the caller's own name). Without this check a player could hand in a stranger's
 * runId and apply that session's outcome to their own save — and on a WINNING
 * session, "apply the surviving HP" is a free heal.
 */
export function isPveFightMember(session: AiFightSession | null | undefined, playerName: string): boolean {
    if (!session || !playerName) return false;
    if (isSoloPveSession(session)) return session.ownerSlug.toLowerCase() === playerName.toLowerCase();
    return session.actors.some(a => a.side === 'squad' && a.ownerSlug === playerName);
}

/**
 * Resolve what actually happened.
 *
 * A session that is still `active` is a FORFEIT, not a no-op: the fight screen's
 * own exit is worded "you'll forfeit the run", and without this a player losing
 * a fight could simply close it and take no damage at all — a free retry, every
 * time, which is strictly better than winning carefully.
 *
 * A MISSING session resolves to `unknown` and must neither pay nor punish. The
 * store has a TTL, and a settle that arrives after it lapsed is far more likely
 * to be a slow network than a cheat; failing closed on the reward while refusing
 * to hospitalize is the only side that cannot hurt an honest player.
 *
 * No ownership check is needed here: the runId is read from the SEALED TOKEN,
 * which is stored under the caller's own name, so it can never address another
 * player's session. Nothing in the request body reaches this.
 */
export function resolveAiFightOutcome(session: AiFightSession | null | undefined): AiFightOutcome {
    if (!session) return 'unknown';
    if (session.status !== 'done') return 'forfeit';
    if (isSoloPveSession(session)) {
        if (session.winner === 'player') return 'win';
        if (session.winner === 'draw') return 'draw';
        return 'loss';
    }
    if (session.winner === 'squad') return 'win';
    if (session.winner === 'draw') return 'draw';
    return 'loss';
}

/**
 * Whether this settle should pay the sealed reward.
 *
 * Only a WIN pays, and a plain practice bout never does — no ryo, stats,
 * currency, items or kill credit — matching Arena's local practice branch, which
 * returns before it reports. Progression comes from missions, hunts, raids, real
 * PvP and training; a sparring partner is not a faucet.
 *
 * Practice still SETTLES, though: losing one costs the same hospital stay as
 * losing anything else, which is why this is a separate question from "did the
 * fight resolve".
 */
export function aiFightPaysReward(outcome: AiFightOutcome, battleKind: string | undefined): boolean {
    return outcome === 'win' && battleKind !== 'practice';
}

/** The Academy spar's sealed session (api/story/spar-start.ts). */
const ACADEMY_SPAR_ENCOUNTER_KIND = 'academy-spar';

/**
 * Whether this run's own SETTLEMENT already owns the player's HP on a win, so
 * the outcome report must leave it alone.
 *
 * Exactly one mode does: the Academy spar grants a scripted post-spar HP
 * (`maxHp - 25` in applyAcademySparSettlement) rather than the HP the fight
 * left. Both writes land through mutatePlayerSave the moment the fight
 * resolves, so without this the tutorial's ending HP would depend on which
 * mutation got there first.
 *
 * Deliberately narrow, and keyed off the SESSION's towerId rather than anything
 * the caller says — a client cannot opt its fight out of paying for itself.
 * A LOST spar is untouched by this and reports normally, which is what puts a
 * knocked-out beginner in the Hospital.
 */
export function settlementOwnsHpOnWin(session: AiFightSession | null | undefined): boolean {
    if (isSoloPveSession(session)) return session.encounter.kind === ACADEMY_SPAR_ENCOUNTER_KIND;
    return session?.towerId === ACADEMY_SPAR_ENCOUNTER_KIND;
}

/**
 * Write the fight's physical consequence onto the character: the surviving HP on
 * any resolved outcome, and the hospital stay on a defeat or a forfeit. Mirrors
 * what Arena.winBattle / its defeat paths do locally, so a fight costs the same
 * whichever engine resolved it.
 */
export function applyAiFightOutcomeToCharacter(
    character: Record<string, unknown>,
    outcome: AiFightOutcome,
    playerActor: AiFightPlayerCombatant | undefined,
    now: number,
): Record<string, unknown> {
    if (outcome === 'unknown') return character;
    // No actor to read means no evidence of what the fight cost. Guessing would
    // be worse than doing nothing — this is also the local-fallback track, which
    // still applies its own HP client-side.
    if (!playerActor) return character;

    // ⚠ The hospital keys off the player being DOWN, not off `winner !== squad`.
    // A run can end with the player alive and standing: the weekly boss is
    // explicitly won by OUTLASTING the round budget, and a mission or story run
    // that times out is a failure the player walked away from. Hospitalizing on
    // "not a squad win" would send someone at full HP to a hospital bed for
    // surviving, which is the opposite of what the local Arena does — it
    // hospitalizes in its KO paths and nowhere else.
    if (num(playerActor.hp) <= 0) {
        return {
            ...character,
            hp: 0,
            hospitalized: true,
            hospitalizedAt: now,
            hospitalizedUntil: now + AI_FIGHT_HOSPITAL_DURATION_MS,
        };
    }

    // Survived — win, draw, timeout, or walked out mid-fight. Carry the HP back.
    // This is what makes a forfeit cost something without over-punishing it: you
    // leave at the HP you left with, so bailing out of a fight you are losing
    // still means healing before the next one.
    //
    // Clamped to the SAVE's own maxHp so a stale session (sealed before a level
    // changed the pool) can never set HP above the real ceiling.
    const maxHp = Math.max(1, num(character.maxHp));
    return { ...character, hp: Math.max(1, Math.min(maxHp, num(playerActor.hp))) };
}
