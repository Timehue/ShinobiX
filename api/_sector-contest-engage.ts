/*
 * Open-world battles in a Pet or Card sector war (owner ruling 2026-10-08).
 *
 * A Combat sector war is fought in the open: a member of either village attacks
 * an enemy standing in the contested sector, the fight happens there and then,
 * and it scores for whichever village wins it. A Pet or Card war only had its
 * table: one per war, which an attacker opens and any defender answers. So
 * attacking an enemy in the open took you to a table and a wait for whoever
 * turned up, not to a battle with the player you attacked.
 *
 * These rules make that attack the war's own game, against that player:
 *   - the same gates as a Combat attack (api/player/attack.ts): both online in
 *     the contested sector, the target attackable (level floor, not traveling,
 *     not in a battle, not already engaged), neither knocked out, and the target
 *     not under post-defeat protection;
 *   - the two must be the war's two sides. Either may start it, and the winner's
 *     village scores: seat p1 is always the ATTACKING village's fighter, which is
 *     how every contest battle maps its winner (applyContestBattleByWinner);
 *   - the target hears of it at once, through the same inbox and nudge a Combat
 *     attack uses, and their client opens the battle (App's sector-attack route).
 *
 * The table and the garrison are unchanged: they remain how a war is fought by
 * players who are not standing in the same sector.
 */
import { randomUUID } from 'node:crypto';
import { kv } from './_storage.js';
import { safeName } from './_utils.js';
import { isIncapacitated } from './_elapsed-state.js';
import { onlineStore } from './_realtime/online-store.js';
import { attackBlock, worldInteractionBlock } from './_realtime/presence-gating.js';
import { kickPlayer } from './_realtime/notify.js';
import { isSectorWarActive, type SectorWarSession } from './_sector-war.js';
import { loadSectorWar } from './_sector-war-store.js';
import { enqueueChallenge, projectChallengerCharacter } from './player/challenge.js';
import { releaseChallengeNoticesWhere } from './pvp/_challenge-inbox-release.js';

/*
 * Cooldowns (owner ruling 2026-10-09): the WINNER of an open battle has none,
 * and neither does either side of a draw. They may fight again at once.
 */
/** The LOSER of an open battle cannot be challenged to another in that war for
 *  this long: the same two minutes a player beaten in Combat is protected for
 *  (PVP_RAID_SHIELD_MS, api/pvp/_vitals-settlement.ts). A pet battle is over in
 *  one request and a player battle's points are uncapped, so this is what stops
 *  a strong team farming one weaker player. Starting a battle of their own ends
 *  it, as a Combat raid ends Field Recovery. */
export const OPEN_BATTLE_LOSER_SHIELD_MS = 2 * 60_000;
/** How long a challenged player has to take their seat at an open card duel
 *  before it is void. Their client opens it on its own the moment it hears;
 *  a target who never does scores nothing for anyone, as an unanswered Combat
 *  attack scores nothing. Until they sit down neither duelist counts as in a
 *  battle, so both are held for this window: one duel at a time each. */
export const OPEN_CARD_JOIN_WINDOW_MS = 60_000;
/** A challenger who calls off a card duel before it starts cannot challenge that
 *  same player again for this long. The target's client opens a duel the moment
 *  it hears of one, so without this a challenger could pull someone into a duel
 *  and back out of it over and over. */
export const OPEN_CARD_CALLED_OFF_MS = 2 * 60_000;
/** A pet battle is fought inside one request, and both fighters are held only
 *  while it is: two challengers cannot fight one player at the same moment. The
 *  hold is released the moment the battle is decided; this bounds a crash. */
export const OPEN_PET_BATTLE_HOLD_MS = 30_000;

export type OpenBattleKind = 'pet' | 'card';

export type OpenBattleGate =
    | {
        ok: true;
        contest: SectorWarSession;
        me: string;
        target: string;
        myVillage: string;
        targetVillage: string;
        /** The attacking village's fighter (seat p1). */
        p1: string;
        /** The defending village's fighter (seat p2). */
        p2: string;
        myCharacter: Record<string, unknown>;
    }
    | { ok: false; status: 400 | 403 | 404 | 409; error: string; retryAfterMs?: number };

const KIND_LABEL: Record<OpenBattleKind, string> = { pet: 'Pet', card: 'Card' };

async function characterOf(slug: string): Promise<Record<string, unknown> | null> {
    const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${slug}`);
    return save?.character && typeof save.character === 'object' ? save.character : null;
}

/**
 * May `me` fight `target` in the open in this war, as its own game, right now?
 * Every check reads server state: presence for where both stand (as the Combat
 * attack does) and the saves for villages and post-defeat protection.
 */
export async function gateOpenSectorBattle(args: {
    me: string;
    target: unknown;
    sectorWarId: string;
    kind: OpenBattleKind;
    now: number;
}): Promise<OpenBattleGate> {
    const me = safeName(args.me);
    const target = safeName(String(args.target ?? ''));
    if (!me || !target) return { ok: false, status: 400, error: 'Missing target.' };
    if (target === me) return { ok: false, status: 400, error: 'You cannot battle yourself.' };

    const contest = await loadSectorWar(args.sectorWarId);
    if (!contest || !isSectorWarActive(contest, args.now)) {
        return { ok: false, status: 409, error: 'No active sector war for that id.' };
    }
    if (contest.winCondition !== args.kind) {
        return { ok: false, status: 409, error: `That sector is not a ${KIND_LABEL[args.kind]} contest.` };
    }

    const actor = onlineStore.get(me);
    const targetPresence = onlineStore.get(target);
    const located = worldInteractionBlock(actor, targetPresence, args.now);
    if (located) return { ok: false, status: located.status, error: located.error };
    if (actor && actor.sector !== contest.sector) {
        return { ok: false, status: 409, error: `This war is fought in Sector ${contest.sector}. Go there to fight it.` };
    }
    const attackable = attackBlock(targetPresence, args.now);
    if (attackable) return { ok: false, status: attackable.status, error: attackable.error };

    const [myCharacter, targetCharacter] = await Promise.all([characterOf(me), characterOf(target)]);
    if (!myCharacter || !targetCharacter) return { ok: false, status: 404, error: 'That shinobi could not be found.' };
    const myVillage = String(myCharacter.village ?? '').trim();
    const targetVillage = String(targetCharacter.village ?? '').trim();
    const sides = [contest.attackerVillage, contest.defenderVillage];
    if (!sides.includes(myVillage) || !sides.includes(targetVillage) || myVillage === targetVillage) {
        return { ok: false, status: 403, error: 'Only the two sides of this sector war fight its battles.' };
    }
    if (isIncapacitated(myCharacter, args.now)) {
        return { ok: false, status: 409, error: 'Recover from your defeat before you fight again.' };
    }
    if (isIncapacitated(targetCharacter, args.now)) {
        return { ok: false, status: 409, error: 'Target has already been defeated.' };
    }
    const shieldedUntil = Math.floor(Number(targetCharacter.pvpShieldUntil ?? 0)) || 0;
    if (shieldedUntil > args.now) {
        return { ok: false, status: 409, error: 'Target is recovering from a recent defeat.', retryAfterMs: shieldedUntil - args.now };
    }

    const iAttack = myVillage === contest.attackerVillage;
    return {
        ok: true, contest, me, target, myVillage, targetVillage,
        p1: iAttack ? me : target,
        p2: iAttack ? target : me,
        myCharacter,
    };
}

/** Held while a fighter's battle is being set up or decided: one at a time. */
function holdKey(contestId: string, slug: string): string {
    return `sector-open-battle:hold:${contestId}:${safeName(slug)}`;
}

/** A loser's protection (OPEN_BATTLE_LOSER_SHIELD_MS). */
function loserShieldKey(contestId: string, slug: string): string {
    return `sector-open-battle:shield:${contestId}:${safeName(slug)}`;
}

/** One challenger's called-off duel against one target (OPEN_CARD_CALLED_OFF_MS). */
function calledOffKey(contestId: string, from: string, to: string): string {
    return `sector-open-battle:called-off:${contestId}:${safeName(from)}:${safeName(to)}`;
}

/** Each fighter's hold, by game. A pet battle is decided inside its request; a
 *  card duel is not a match until the challenged player sits down, and until
 *  then neither duelist counts as in a battle. Either way the hold keeps both
 *  from being drawn into a second battle meanwhile. It is never a cooldown. */
const FIGHTER_HOLD: Record<OpenBattleKind, { holdMs: number; mine: string; theirs: string }> = {
    pet: {
        holdMs: OPEN_PET_BATTLE_HOLD_MS,
        mine: 'Your last battle is still being decided. Try again in a moment.',
        theirs: 'That shinobi is already in a battle. Try again in a moment.',
    },
    card: {
        holdMs: OPEN_CARD_JOIN_WINDOW_MS,
        mine: 'You already have a card duel waiting to begin. Try again in a minute.',
        theirs: 'That shinobi has a card duel waiting to begin. Try again in a minute.',
    },
};

function inMinutes(ms: number): string {
    return `${Math.max(1, Math.ceil(ms / 60_000))} min`;
}

async function claimHold(key: string, holdMs: number, now: number): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
    const placed = await kv.set(key, { until: now + holdMs }, { nx: true, ex: Math.max(1, Math.ceil(holdMs / 1000)) });
    if (placed) return { ok: true };
    return { ok: false, retryAfterMs: Math.max(1_000, await msLeftOn(key, now)) };
}

/** How long a stamped `{ until }` key still has to run; 0 when it is gone. */
async function msLeftOn(key: string, now: number): Promise<number> {
    const held = await kv.get<{ until?: number }>(key);
    const until = Math.floor(Number(held?.until) || 0);
    return until > now ? until - now : 0;
}

async function stampFor(key: string, ms: number, now: number): Promise<void> {
    await kv.set(key, { until: now + ms }, { ex: Math.max(1, Math.ceil(ms / 1000)) }).catch(() => undefined);
}

/**
 * Reserve this meeting. Refused while the target is under a loser's protection,
 * or while this challenger's called-off duel against them still runs. Then each
 * fighter takes their hold for the game (FIGHTER_HOLD). Fails closed: a hold
 * that cannot be placed refuses the battle, and any part already placed is
 * released, so a refused battle costs nothing. The caller releases the holds
 * once the battle no longer needs them.
 */
export async function claimOpenSectorBattle(args: {
    contestId: string;
    kind: OpenBattleKind;
    me: string;
    target: string;
    now: number;
}): Promise<{ ok: true; release: () => Promise<void> } | { ok: false; status: 409; error: string; retryAfterMs: number }> {
    const refuse = (error: string, retryAfterMs: number) => ({ ok: false as const, status: 409 as const, error, retryAfterMs });
    const shieldLeft = await msLeftOn(loserShieldKey(args.contestId, args.target), args.now);
    if (shieldLeft > 0) {
        return refuse(`That shinobi just lost a battle and is recovering. You can challenge them in ${inMinutes(shieldLeft)}.`, shieldLeft);
    }
    const calledOffLeft = args.kind === 'card' ? await msLeftOn(calledOffKey(args.contestId, args.me, args.target), args.now) : 0;
    if (calledOffLeft > 0) {
        return refuse(`You called off a duel with them moments ago. You can challenge them again in ${inMinutes(calledOffLeft)}.`, calledOffLeft);
    }
    const claimed: string[] = [];
    const release = async () => { if (claimed.length) await kv.del(...claimed).catch(() => 0); };
    const hold = FIGHTER_HOLD[args.kind];
    for (const step of [{ name: args.me, error: hold.mine }, { name: args.target, error: hold.theirs }]) {
        const key = holdKey(args.contestId, step.name);
        const claim = await claimHold(key, hold.holdMs, args.now);
        if (!claim.ok) {
            await release();
            return refuse(step.error, claim.retryAfterMs);
        }
        claimed.push(key);
    }
    return { ok: true, release };
}

/** Free both duelists' holds: a card duel that started (presence now proves
 *  the fight), finished, or was called off. */
export async function releaseOpenBattleFighters(contestId: string, names: readonly string[]): Promise<void> {
    const keys = names.filter(Boolean).map((name) => holdKey(contestId, name));
    if (keys.length) await kv.del(...keys).catch(() => 0);
}

/**
 * A battle was decided: protect its loser (OPEN_BATTLE_LOSER_SHIELD_MS). The
 * winner gets nothing to wait out, and a draw protects nobody. Best-effort, like
 * the Combat shield's own write: the result already stands either way.
 */
export async function protectOpenBattleLoser(contestId: string, loser: string, now: number): Promise<void> {
    const slug = safeName(loser);
    if (slug) await stampFor(loserShieldKey(contestId, slug), OPEN_BATTLE_LOSER_SHIELD_MS, now);
}

/** Starting a battle ends the challenger's own loser protection in this war. */
export async function endOwnOpenBattleProtection(contestId: string, me: string): Promise<void> {
    await kv.del(loserShieldKey(contestId, me)).catch(() => 0);
}

/** A challenger called off a card duel: they cannot challenge that target again
 *  for OPEN_CARD_CALLED_OFF_MS. Anyone else may, and the target may challenge them. */
export async function noteCalledOffOpenDuel(contestId: string, from: string, to: string, now: number): Promise<void> {
    await stampFor(calledOffKey(contestId, from, to), OPEN_CARD_CALLED_OFF_MS, now);
}

/** A fresh id for one open-world battle. */
export function newOpenBattleId(): string {
    return randomUUID().replace(/-/g, '').slice(0, 24);
}

/**
 * Tell the target, the way a Combat attack does: the "is attacking you" banner
 * through presence, and an inbox notice their client routes into the battle.
 * Best-effort, and never fails the battle: for a pet battle the result already
 * stands, and an unanswered card duel simply goes void.
 */
export async function noticeOpenSectorBattle(args: {
    kind: OpenBattleKind;
    from: string;
    fromCharacter: Record<string, unknown>;
    to: string;
    sectorWarId: string;
    engageId: string;
    now: number;
}): Promise<void> {
    try {
        onlineStore.setPendingAttacker(args.to, { name: args.from });
        await enqueueChallenge(args.to, {
            id: `sector-${args.kind}-${args.engageId}`,
            fromName: args.from,
            toName: args.to,
            challenger: projectChallengerCharacter(args.fromCharacter),
            createdAt: args.now,
            sectorAttack: true,
            sectorContest: { kind: args.kind, sectorWarId: args.sectorWarId, engageId: args.engageId },
        });
        kickPlayer(args.to, 'attack');
    } catch (err) {
        console.warn('[sector-war] open battle notice deferred', args.engageId, (err as Error)?.message ?? err);
    }
}

/**
 * Take an open battle's notice back out of its target's inbox, once they have
 * the battle open or it can no longer start. The heartbeat re-delivers the
 * inbox on every beat for the notice's whole 180s lease, and a client that
 * reloads has lost its local dismissal, so a notice left behind walks the
 * target back into a battle they already saw, or one that is over: the trap
 * api/pvp/_challenge-inbox-release.ts closes for Combat attacks. Best-effort:
 * the lease expires on its own.
 */
export async function releaseOpenBattleNotice(target: string, engageId: string): Promise<void> {
    try {
        await releaseChallengeNoticesWhere(target, (entry) => !!entry && typeof entry === 'object'
            && (entry as { sectorContest?: { engageId?: unknown } }).sectorContest?.engageId === engageId);
    } catch (err) {
        console.warn('[sector-war] open battle notice not released', engageId, (err as Error)?.message ?? err);
    }
}
