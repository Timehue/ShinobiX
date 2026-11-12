/**
 * "Unless attacked": the moment a Cinderhold shinobi is attacked, it stops
 * where it stands, as a player does when a fight opens on them.
 *
 * A player target is held by its `pendingAttacker` flag and then by
 * `inBattle`. An NPC gets no attack flag (player/attack.ts: one would let
 * repeated attacks with no duel behind them keep it out of reach), and its
 * `inBattle` only turns on once its seat joins, 3-12 s after the duel is
 * published (api/_npc-duel-driver.ts npcJoinDelayMs). Until then nothing
 * pinned it, so the journey walker (api/_npc-journeys.ts) walked it away from
 * its own fight, often into the next sector.
 *
 * These pins bridge that gap, in memory only (the walker reads them every
 * 500 ms; the server is a single process):
 *   - `attack:<attacker>` from an admitted world attack, NPC_ATTACK_HOLD_MS;
 *   - `duel:<battleId>` from a sealed NPC duel, until the duel is forgotten or
 *     NPC_DUEL_HOLD_MS has passed (by then the seat has joined, and
 *     `inBattle` holds it);
 *   - `strike` while an NPC opens a war strike on a player.
 * Every pin expires on its own, so a lost release costs seconds, not a stuck NPC.
 */

/** How long an admitted attack holds the NPC for its attacker (the session create follows within a second or two). */
export const NPC_ATTACK_HOLD_MS = 10_000;
/** A sealed duel's hold: the publish grace plus the longest join delay, with room to spare. */
export const NPC_DUEL_HOLD_MS = 30_000;

const pins = new Map<string, Map<string, number>>();

function live(id: string, now: number): Map<string, number> | null {
    const held = pins.get(id);
    if (!held) return null;
    for (const [key, until] of held) if (until <= now) held.delete(key);
    if (!held.size) { pins.delete(id); return null; }
    return held;
}

/** Hold `id` under `key` until `until`. A live pin under the same key is never extended. */
export function pinNpc(id: string, key: string, until: number, now = Date.now()): void {
    if (!id || until <= now) return;
    const held = live(id, now) ?? new Map<string, number>();
    if (held.has(key)) return;
    held.set(key, until);
    pins.set(id, held);
}

export function unpinNpc(id: string, key: string): void {
    const held = pins.get(id);
    if (!held) return;
    held.delete(key);
    if (!held.size) pins.delete(id);
}

/** The live pin keys on `id` (empty when it is free to walk). */
export function npcPins(id: string, now = Date.now()): string[] {
    return [...(live(id, now)?.keys() ?? [])];
}

export function npcPinned(id: string, now = Date.now()): boolean {
    return live(id, now) !== null;
}

/**
 * A second attacker while another attack holds the NPC: the refusal a player
 * target gives (presence-gating.ts attackBlock, a pending attacker). Null when
 * the attack may proceed.
 */
export function npcAttackRefusal(id: string, attacker: string, now = Date.now()): string | null {
    const keys = npcPins(id, now);
    return keys.some((key) => key.startsWith('attack:') && key !== `attack:${attacker}`) ? 'Target is already engaged in combat.' : null;
}

export function resetNpcPinsForTest(): void { pins.clear(); }
