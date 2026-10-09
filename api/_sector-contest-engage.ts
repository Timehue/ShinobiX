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

/** The same two players can meet in the open again only after this. A pet
 *  battle resolves in one request, so without it one strong team could farm a
 *  weaker enemy's points over and over. */
export const OPEN_BATTLE_PAIR_COOLDOWN_MS = 10 * 60_000;
/** After an instant pet battle, neither fighter can start or take another for
 *  this long. A Combat fight keeps both fighters busy while it lasts; a pet
 *  battle is over in one request, so without this a whole village could hit one
 *  enemy's pets within seconds. */
export const OPEN_PET_BATTLE_REST_MS = 60_000;
/** How long a challenged player has to take their seat at an open card duel
 *  before it is void. Their client opens it on its own the moment it hears;
 *  a target who never does scores nothing for anyone, as an unanswered Combat
 *  attack scores nothing. */
export const OPEN_CARD_JOIN_WINDOW_MS = 60_000;

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

function pairKey(contestId: string, a: string, b: string): string {
    const [x, y] = [safeName(a), safeName(b)].sort();
    return `sector-open-battle:pair:${contestId}:${x}:${y}`;
}

function restKey(contestId: string, slug: string): string {
    return `sector-open-battle:rest:${contestId}:${safeName(slug)}`;
}

/** Each fighter's own window, by game. A pet battle is over at once, so each
 *  fighter rests (OPEN_PET_BATTLE_REST_MS). A card duel is not a match until the
 *  challenged player sits down, and until then neither duelist counts as in a
 *  battle; this keeps either from being drawn into a second duel then. */
const FIGHTER_WINDOW: Record<OpenBattleKind, { windowMs: number; mine: string; theirs: string }> = {
    pet: {
        windowMs: OPEN_PET_BATTLE_REST_MS,
        mine: 'Your pets are still recovering from their last battle. Try again in a minute.',
        theirs: 'That shinobi\'s pets just fought. Try again in a minute.',
    },
    card: {
        windowMs: OPEN_CARD_JOIN_WINDOW_MS,
        mine: 'You already have a card duel waiting to begin. Try again in a minute.',
        theirs: 'That shinobi has a card duel waiting to begin. Try again in a minute.',
    },
};

async function claimWindow(key: string, windowMs: number, now: number): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
    const placed = await kv.set(key, { at: now }, { nx: true, ex: Math.max(1, Math.ceil(windowMs / 1000)) });
    if (placed) return { ok: true };
    const held = await kv.get<{ at?: number }>(key);
    const at = Math.floor(Number(held?.at) || now);
    return { ok: false, retryAfterMs: Math.max(1_000, at + windowMs - now) };
}

/**
 * Reserve this meeting. Fails closed: a claim that cannot be made refuses the
 * battle rather than letting it skip its cooldown. Besides the pair's cooldown,
 * each fighter takes their own window for the game (FIGHTER_WINDOW). On a
 * refusal any part already claimed is released, so a refused battle costs nothing.
 */
export async function claimOpenSectorBattle(args: {
    contestId: string;
    kind: OpenBattleKind;
    me: string;
    target: string;
    now: number;
}): Promise<{ ok: true; release: () => Promise<void> } | { ok: false; status: 409; error: string; retryAfterMs: number }> {
    const claimed: string[] = [];
    const release = async () => { if (claimed.length) await kv.del(...claimed).catch(() => 0); };
    const fighter = FIGHTER_WINDOW[args.kind];
    const steps: Array<{ key: string; windowMs: number; error: (min: number) => string }> = [
        { key: pairKey(args.contestId, args.me, args.target), windowMs: OPEN_BATTLE_PAIR_COOLDOWN_MS,
            error: (min) => `You two met in battle moments ago. You can fight again in ${min} min.` },
        { key: restKey(args.contestId, args.me), windowMs: fighter.windowMs, error: () => fighter.mine },
        { key: restKey(args.contestId, args.target), windowMs: fighter.windowMs, error: () => fighter.theirs },
    ];
    for (const step of steps) {
        const claim = await claimWindow(step.key, step.windowMs, args.now);
        if (!claim.ok) {
            await release();
            return { ok: false, status: 409, error: step.error(Math.max(1, Math.ceil(claim.retryAfterMs / 60_000))), retryAfterMs: claim.retryAfterMs };
        }
        claimed.push(step.key);
    }
    return { ok: true, release };
}

/** A card duel its challenger called off inside the join window frees both
 *  duelists at once, instead of at the end of their window. Only inside it:
 *  after it, either may already hold a window for another duel. The pair's
 *  cooldown stands either way. */
export async function releaseOpenBattleFighters(contestId: string, names: readonly string[]): Promise<void> {
    const keys = names.filter(Boolean).map((name) => restKey(contestId, name));
    if (keys.length) await kv.del(...keys).catch(() => 0);
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
