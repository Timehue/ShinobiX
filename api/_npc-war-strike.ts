/**
 * A Cinderhold war strike on a player is a REAL world attack (owner ruling
 * 2026-11-10: "Make them real").
 *
 * The war party (api/_npc-war-party.ts) used to settle a strike on an enemy
 * player instantly from both builds: the player saw nothing and lost nothing.
 * Now a Cinderhold shinobi standing in the contested sector attacks the way a
 * player does, through the same four calls a player's browser makes
 * (lib/sector-attack.ts), each made in-process as the NPC with its server-minted
 * token (api/_npc-duel-driver.ts asNpc):
 *   1. /player/attack: the world attack admission (newcomer protection, Field
 *      Recovery shield, travel, an existing fight, world-boss protection...);
 *   2. /pvp/session: the duel, sealed as an NPC duel with the NPC in seat p1, so
 *      the driver joins and plays it under every PvP rule;
 *   3. /village/sector-war `attack`: binds the fight to the sector war, so its
 *      result scores the war like any other world duel there;
 *   4. /player/challenge: the "you were attacked" notice that routes the
 *      player's client into the battle.
 * The player then fights it, or loses it as a no-show when the join window
 * closes (the PvP rule), and a loss is a normal loss: the hospital, the shield.
 * A Cinderhold shinobi beaten there is wounded off the map (api/_npc-wounds.ts).
 */
import { randomUUID } from 'node:crypto';
import { onlineStore } from './_realtime/online-store.js';
import { NPC_DUEL_HOLD_MS, npcPinned, pinNpc, unpinNpc } from './_npc-attack-hold.js';
import type { NpcShinobi } from '../shared/npc-village-roster.js';

export type NpcWarDuel = { ok: true; battleId: string; registered: boolean } | { ok: false; step: 'attack' | 'session'; reason: string };

/** Whether this NPC stands in the sector, free to attack: not mid-fight, travelling or already targeted. */
export function npcStandsIn(npc: Pick<NpcShinobi, 'id' | 'name'>, sector: number): boolean {
    const row = onlineStore.get(npc.name);
    return !!row && row.sector === sector && !row.inBattle && row.pendingAttacker == null && !npcPinned(npc.id)
        && !(Number(row.travelingUntil) > onlineStore.clockNow());
}

/**
 * `registerSectorWar: false` (a village-war strike, Push 4b): there is no
 * sector war to bind it to; the finished duel scores the five-day campaign
 * through the world-PvP settlement every cross-village duel takes.
 */
export async function openNpcWarDuel(npc: NpcShinobi, target: string, sector: number, opts: { registerSectorWar?: boolean } = {}): Promise<NpcWarDuel> {
    // It stands still while it opens the fight, as a player does at the Attack
    // button; once sealed, the duel's own hold takes over (api/_npc-attack-hold.ts).
    pinNpc(npc.id, 'strike', Date.now() + NPC_DUEL_HOLD_MS);
    try { return await openStrike(npc, target, sector, opts); }
    finally { unpinNpc(npc.id, 'strike'); }
}

async function openStrike(npc: NpcShinobi, target: string, sector: number, opts: { registerSectorWar?: boolean }): Promise<NpcWarDuel> {
    const { asNpc, routeHandler } = await import('./_npc-duel-driver.js');
    const call = async (mod: Promise<unknown>, body: Record<string, unknown>) => asNpc(routeHandler(await mod), npc.id, npc.name, body);

    const admitted = await call(import('./player/attack.js'), { targetName: target, attacker: { name: npc.name } });
    if (admitted.status !== 200) return { ok: false, step: 'attack', reason: String(admitted.body.error ?? admitted.status) };

    const created = await call(import('./pvp/session.js'), {
        p1Character: { name: npc.name }, p2Character: { name: target },
        baseRewards: true, rewardSector: sector, useCurrentVitals: true, requireWorldCoLocation: true,
    });
    const battleId = String(created.body.battleId ?? '');
    if (created.status !== 200 || !battleId) {
        // No fight started: do not leave the player flagged as engaged.
        onlineStore.clearPendingAttacker(target);
        return { ok: false, step: 'session', reason: String(created.body.error ?? created.status) };
    }

    // Bound to the war before either fighter can move (registration needs a
    // pristine board; the NPC only moves once the player has joined).
    const registration = opts.registerSectorWar === false
        ? { status: 0, body: {} as Record<string, unknown> }
        : await call(import('./village/sector-war.js'), { action: 'attack', playerName: npc.name, sector, battleId })
            .catch(() => ({ status: 503, body: {} as Record<string, unknown> }));
    const registered = registration.status === 200 && registration.body.registered === true;
    if (!registered && opts.registerSectorWar !== false) console.warn('[npc-war-strike] the duel is live but not bound to the war', battleId, registration.status, JSON.stringify(registration.body).slice(0, 200));

    // The notice is advisory, as it is for a player: the duel is live either way.
    await call(import('./player/challenge.js'), {
        targetName: target,
        challenge: { id: `npc-strike-${randomUUID()}`, fromName: npc.name, toName: target, createdAt: Date.now(), mode: 'standard', sectorAttack: true, battleId },
    }).catch(() => undefined);
    return { ok: true, battleId, registered };
}

/**
 * The same real world attack with no war behind it (a rival hunt,
 * api/_npc-hunt.ts): no sector-war registration, so it is an ordinary NPC
 * world duel that pays under the NPC daily pay rule.
 */
export function openNpcWorldDuel(npc: NpcShinobi, target: string, sector: number): Promise<NpcWarDuel> {
    return openNpcWarDuel(npc, target, sector, { registerSectorWar: false });
}
