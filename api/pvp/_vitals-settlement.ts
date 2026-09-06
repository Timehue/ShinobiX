import { createHash } from 'node:crypto';
import { RECEIPT_TTL_SEC } from '../_receipts.js';
import { mergePreservingImages, safeName } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { appendSettlementReceipt, inspectSettlementReceipt } from '../_settlement-receipts.js';
import type { KvLike } from '../_storage.js';
import type { PvpFighter, PvpSession } from './session.js';

/*
 * The physical consequence of a world PvP duel.
 *
 * Sector attacks are continuous engagements: makePvpFighter() hydrates each
 * fighter straight from their SAVE when the session is created with
 * `useCurrentVitals` ("a damaged player who keeps raiding stays damaged"), and
 * session-create refuses a 0-HP attacker outright. Until this module existed
 * only that READ half was wired — nothing ever wrote the vitals back, so both
 * fighters walked away at exactly the HP/chakra/stamina they arrived with.
 * Raiding cost nothing and losing cost nothing, and PvP was the only combat
 * mode in the game with no physical consequence: solo AI fights
 * (missions/_ai-fight-outcome.ts), Hollow Gate and the legacy battle lock all
 * persist surviving HP and hospitalize a knocked-out player.
 *
 * This is the write half. Nothing here decides or pays a reward — it moves the
 * numbers the sealed terminal session already recorded onto the two saves.
 */

/** The stay every other defeat path applies (player/heal.ts, _ai-fight-outcome.ts). */
export const PVP_HOSPITAL_DURATION_MS = 60_000;

function num(value: unknown): number {
    return Math.max(0, Math.floor(Number(value) || 0));
}

/** A session vital, clamped to the SAVE's own ceiling. */
function clampVital(sessionValue: unknown, saveMaximum: unknown): number {
    return Math.max(0, Math.min(Math.max(1, num(saveMaximum)), num(sessionValue)));
}

/**
 * Whether this battle carried real vitals IN, and so must carry them OUT.
 *
 * Mirrors the `useCurrentVitals` decision sealed at session-create: continuous
 * engagements (sector raids, village guard/defense) settle, while spar, ranked
 * and arena reset both fighters to full on entry — persisting their exit vitals
 * would invent damage the fight never actually charged.
 */
export function pvpSessionCarriesVitals(session: PvpSession): boolean {
    if (typeof session.continuousVitals === 'boolean') return session.continuousVitals;
    // Rows sealed before the flag existed. `world` is exactly the population
    // that ran with useCurrentVitals=true, so it settles; every other legacy
    // row stays inert rather than guessing a physical cost onto a spar.
    return session.rewardAuthority === 'world';
}

/**
 * Whether `side` leaves this battle in the Hospital.
 *
 * Owner ruling (2026-09-03): a knockout admits, and so does LOSING — including
 * losing on the AFK / turn-deadline forfeit, which is how most abandoned duels
 * actually end. Fleeing is the single exception: a successful flee already
 * costs 10% of max HP (the 'flee' action in move.ts) and returns you to your
 * spot in the sector, which is what makes running away a real choice rather
 * than a strictly worse loss.
 *
 * The knockout check comes FIRST and is outcome-blind, so a mutual KO (a
 * damage-over-time tick that drops the winner on the same turn) admits both
 * fighters, and a fighter who somehow flees at 0 HP is still admitted.
 */
export function pvpFighterIsHospitalized(session: PvpSession, side: 'p1' | 'p2'): boolean {
    const fighter = side === 'p1' ? session.p1 : session.p2;
    if (num(fighter.hp) <= 0) return true;
    // A draw — or a row with no decided winner — has no loser to admit.
    if (!session.winner || session.winner === 'draw') return false;
    if (session.winner === side) return false;
    return session.fleedBy !== side;
}

/**
 * The character patch this battle owes `side`: the vitals it actually left them
 * with, plus a hospital admission when they earned one.
 *
 * Pure. Every vital is clamped to the SAVE's own maxima, never the session's —
 * a session sealed before a level-up (or before gear changed the pool) must not
 * be able to set a vital above the real ceiling. A surviving fighter keeps at
 * least 1 HP, so deciding who is unconscious stays this function's job rather
 * than a rounding artifact's.
 */
export function applyPvpVitalsToCharacter(
    character: Record<string, unknown>,
    session: PvpSession,
    side: 'p1' | 'p2',
    now: number,
): Record<string, unknown> {
    const fighter: PvpFighter = side === 'p1' ? session.p1 : session.p2;
    // Chakra and stamina are spent either way: the hospital restores all three
    // on discharge, so recording what the fight burned costs an admitted player
    // nothing and keeps the two branches reading the same.
    const spent = {
        chakra: clampVital(fighter.chakra, character.maxChakra),
        stamina: clampVital(fighter.stamina, character.maxStamina),
    };
    if (pvpFighterIsHospitalized(session, side)) {
        return {
            ...character,
            ...spent,
            hp: 0,
            hospitalized: true,
            hospitalizedAt: now,
            hospitalizedUntil: now + PVP_HOSPITAL_DURATION_MS,
        };
    }
    return { ...character, ...spent, hp: Math.max(1, clampVital(fighter.hp, character.maxHp)) };
}

/** Per-fighter proof that this exact battle already moved this save's vitals. */
export function pvpVitalsReceiptKey(battleId: string, slug: string): string {
    return `pvp:vitals:${battleId}:${slug}`;
}

/**
 * The IN-SAVE receipt identity for one fighter of one battle. Lives in the
 * character's `serverSettlementReceipts` (the convention every other
 * server-authoritative settlement uses), so the consequence and the proof that
 * it was applied land in the SAME save write. The fingerprint seals the exact
 * vitals and result the terminal session carried, so a same-battle request
 * that somehow disagrees is refused rather than re-applied.
 */
export function pvpVitalsReceiptIdentity(session: PvpSession, side: 'p1' | 'p2'): { requestId: string; fingerprint: string } {
    const fighter = side === 'p1' ? session.p1 : session.p2;
    const slug = safeName(fighter.name);
    const sha = (value: string) => createHash('sha256').update(value).digest('hex');
    return {
        requestId: `pvpvitals_${sha(`${session.battleId}:${slug}`).slice(0, 32)}`,
        fingerprint: sha(JSON.stringify({
            battleId: session.battleId,
            side,
            slug,
            winner: session.winner ?? null,
            fleedBy: session.fleedBy ?? null,
            hp: num(fighter.hp),
            chakra: num(fighter.chakra),
            stamina: num(fighter.stamina),
        })),
    };
}

type VitalsStore = Pick<KvLike, 'get' | 'set' | 'compareSet' | 'del'>;

export type PvpVitalsDeps = {
    /** Must be fail-closed: a lock that silently no-ops would drop the write. */
    lock: <T>(saveKey: string, action: () => Promise<T>) => Promise<T>;
    now?: number;
};

async function settleFighterVitals(
    store: VitalsStore,
    session: PvpSession,
    side: 'p1' | 'p2',
    deps: PvpVitalsDeps,
    now: number,
): Promise<void> {
    const fighter = side === 'p1' ? session.p1 : session.p2;
    const slug = safeName(fighter.name);
    if (!slug) return;
    const saveKey = `save:${slug}`;
    const receiptKey = pvpVitalsReceiptKey(session.battleId, slug);
    await deps.lock(saveKey, async () => {
        const fresh = await store.get<Record<string, unknown>>(saveKey);
        const freshChar = fresh?.character as Record<string, unknown> | undefined;
        // No save row is an NPC guard or a deleted account — there is no body to
        // mark. Not an error, and not something a retry could improve.
        if (!freshChar) return;

        // The receipt is what stops a LATER replay from re-hospitalizing a
        // player who has since healed. The terminal session is frozen, so
        // re-writing its vitals is idempotent in VALUE and catastrophic in
        // EFFECT: PvP reward completion legitimately replays for up to 48h
        // (PVP_REWARD_RECOVERY_TTL_SECONDS), which is long enough to span a
        // hospital discharge and another fight.
        //
        // The proof used to be a KV key CLAIMED BEFORE the save write and
        // released on a thrown write. A process death between the claim and the
        // write (the one failure a try/catch cannot see) left the claim standing
        // and the fight's consequence never applied — and every replay then read
        // the claim as "already settled". The proof is now written IN the save,
        // in the same write as the consequence, so the two can only ever land
        // together. The KV marker is kept purely for compatibility with rows
        // settled by the previous generation, and is written AFTER the save.
        const legacyMarker = await store.get(receiptKey);
        if (legacyMarker) return;
        const identity = pvpVitalsReceiptIdentity(session, side);
        const inspected = inspectSettlementReceipt(freshChar, identity.requestId, identity.fingerprint);
        if (inspected.status === 'replay') return;
        if (inspected.status === 'conflict' || inspected.status === 'invalid') {
            // The same battle cannot legitimately present different vitals: the
            // session is terminal and frozen. Leave the save alone and say so.
            console.error('[pvp/vitals] receipt conflict', { battleId: session.battleId, slug, status: inspected.status });
            return;
        }
        const settled = appendSettlementReceipt(
            applyPvpVitalsToCharacter(freshChar, session, side, now),
            inspected.receipts,
            {
                requestId: identity.requestId,
                fingerprint: identity.fingerprint,
                value: { kind: 'pvp-vitals', battleId: session.battleId, side },
                settledAt: now,
            },
        );
        const updated = { ...fresh, character: settled };
        await store.set(saveKey, mergePreservingImages(bumpSaveVersion<Record<string, unknown>>(updated), fresh));
        // Compatibility marker for readers of the previous generation. The save
        // above is already durable, so a failure here changes nothing: the next
        // replay finds the in-save receipt and stops there.
        await store.set(receiptKey, { battleId: session.battleId, side, name: fighter.name, settledAt: now }, { ex: RECEIPT_TTL_SEC })
            .catch(() => undefined);
    });
}

/**
 * Move both fighters' vitals from the terminal session onto their saves.
 *
 * Locks are taken ONE AT A TIME and never held together: two players can be
 * raiding each other concurrently, and holding save:A while waiting on save:B
 * is the classic inverted-order deadlock. For the same reason nothing here may
 * take BOUNTY_KEY, which is acquired BEFORE a save lock on the bounty path
 * (api/pvp/bounty.ts) — inverting that order would deadlock the two.
 *
 * Reached only from replayCommittedPvpTerminalEffects, whose every call site
 * invokes it after releasing the pvp session lock.
 */
export async function settlePvpTerminalVitals(
    store: VitalsStore,
    session: PvpSession,
    deps: PvpVitalsDeps,
): Promise<void> {
    if (session.status !== 'done') return;
    if (!pvpSessionCarriesVitals(session)) return;
    const now = deps.now ?? Date.now();
    await settleFighterVitals(store, session, 'p1', deps, now);
    await settleFighterVitals(store, session, 'p2', deps, now);
}
