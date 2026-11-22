/*
 * The Hold: a quest boss that cannot fall until the player uses the one tool
 * that breaks it (the tool their quest had them make or win).
 *
 * It changes no damage formula, cooldown or AP cost. Damage lands as usual and
 * the boss's HP drops as usual; the only rule is that a blow which would end
 * the fight leaves the boss on 1 HP while the Hold stands. It works the same
 * way as the boss-form guard (guardBossFormLethal), which already keeps a boss
 * alive for a pending transformation.
 *
 * It is not a status. Statuses can be cleared by the player's own jutsu, and a
 * Hold must only ever be broken by its tool.
 */
import type { SoloPveSession } from './_session.js';

export type SoloPveBossHold = {
    /** The quest tool that breaks it. */
    breakerItemId: string;
    /** What the player sees it called, such as "Smoke Hold". */
    name: string;
    broken: boolean;
    /** The last round the "cannot fall" line was logged, so it reads once a round. */
    heldRound?: number;
    /**
     * Holds in sequence (owner ruling 2026-11-19): the Holds that rise, in this
     * order, as each one before them breaks. The fight always has one Hold
     * standing at a time, the one named above, and each answers only to its
     * own tool. The boss can fall once the last has broken.
     */
    next?: BossHoldLink[];
};

export type BossHoldLink = { breakerItemId: string; name: string };

/** Seal a Hold onto a fight as it starts, with any that rise after it. */
export function sealBossHold(session: SoloPveSession, hold: BossHoldLink, next: readonly BossHoldLink[] = []): void {
    session.bossHold = {
        breakerItemId: hold.breakerItemId, name: hold.name, broken: false,
        ...(next.length ? { next: next.map(link => ({ breakerItemId: link.breakerItemId, name: link.name })) } : {}),
    };
}

/** True for the tool of the Hold that stands, or of any Hold still to rise. */
export function isBossHoldBreaker(session: SoloPveSession, itemId: string | undefined): boolean {
    const hold = session.bossHold;
    if (!hold || !itemId) return false;
    return hold.breakerItemId === itemId || !!hold.next?.some(link => link.breakerItemId === itemId);
}

/** True while the fight has a Hold the player has not broken yet. */
export function bossHoldStands(session: SoloPveSession): boolean {
    return !!session.bossHold && !session.bossHold.broken;
}

/**
 * Inside checkWinner: while the Hold stands, a killing blow leaves the boss on
 * 1 HP. A double knockout stays a draw, exactly as the boss-form guard rules.
 */
export function guardBossHoldLethal(session: SoloPveSession): void {
    const hold = session.bossHold;
    if (!hold || hold.broken || session.status !== 'active') return;
    if (session.enemy.hp > 0 || session.enemy.unlimitedHealth) return;
    if (session.player.hp <= 0) return;
    session.enemy = { ...session.enemy, hp: 1 };
    if (hold.heldRound !== session.round) {
        hold.heldRound = session.round;
        session.log.push(`${session.enemy.name} will not fall while the ${hold.name} stands.`);
    }
}

/**
 * The player used an item. If it is the tool this Hold answers to, the Hold
 * breaks now, before the item's own hit is resolved, so that hit can finish
 * the fight. Any other item, and anything the enemy uses, leaves it standing.
 *
 * When another Hold is waiting behind it, that one rises in the same moment,
 * so the hit that broke the first cannot end the fight. A later Hold's tool
 * does nothing to the one that stands: they are broken in order.
 */
export function breakBossHold(session: SoloPveSession, side: 'player' | 'enemy', itemId: string | undefined): boolean {
    const hold = session.bossHold;
    if (side !== 'player' || !hold || hold.broken || !itemId || itemId !== hold.breakerItemId) return false;
    const [rising, ...rest] = hold.next ?? [];
    if (rising) {
        session.bossHold = { breakerItemId: rising.breakerItemId, name: rising.name, broken: false, ...(rest.length ? { next: rest } : {}) };
        session.log.push(`The ${hold.name} breaks. The ${rising.name} rises.`);
        return true;
    }
    hold.broken = true;
    session.log.push(`The ${hold.name} breaks.`);
    return true;
}
