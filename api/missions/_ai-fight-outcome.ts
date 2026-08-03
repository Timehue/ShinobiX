import type { TowerActor, TowerSession } from '../towers/_tower-session.js';

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

function num(value: unknown): number {
    return Math.max(0, Math.floor(Number(value) || 0));
}

/**
 * The human fighter in a solo AI-fight session. These sessions carry exactly one
 * non-AI squad actor (a summoned companion is `ai: true`), so side + ai is an
 * unambiguous match and does not depend on the owner-slug spelling.
 */
export function aiFightPlayerActor(session: TowerSession | null | undefined): TowerActor | undefined {
    return session?.actors?.find((actor) => actor.side === 'squad' && actor.ai === false);
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
export function isPveFightMember(session: TowerSession | null | undefined, playerName: string): boolean {
    if (!session || !playerName) return false;
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
export function resolveAiFightOutcome(session: TowerSession | null | undefined): AiFightOutcome {
    if (!session) return 'unknown';
    if (session.status !== 'done') return 'forfeit';
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

/**
 * Write the fight's physical consequence onto the character: the surviving HP on
 * any resolved outcome, and the hospital stay on a defeat or a forfeit. Mirrors
 * what Arena.winBattle / its defeat paths do locally, so a fight costs the same
 * whichever engine resolved it.
 */
export function applyAiFightOutcomeToCharacter(
    character: Record<string, unknown>,
    outcome: AiFightOutcome,
    playerActor: TowerActor | undefined,
    now: number,
): Record<string, unknown> {
    if (outcome === 'unknown') return character;
    if (outcome === 'loss' || outcome === 'forfeit') {
        return {
            ...character,
            hp: 0,
            hospitalized: true,
            hospitalizedAt: now,
            hospitalizedUntil: now + AI_FIGHT_HOSPITAL_DURATION_MS,
        };
    }
    // Won or drew: carry the surviving HP back. Clamp to the save's own maxHp so
    // a stale session (sealed before a level-up shrank/grew the pool) can never
    // set HP above the real ceiling.
    if (!playerActor) return character;
    const maxHp = Math.max(1, num(character.maxHp));
    const surviving = Math.max(1, Math.min(maxHp, num(playerActor.hp)));
    return { ...character, hp: surviving };
}
