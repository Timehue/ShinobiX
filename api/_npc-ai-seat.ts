/**
 * Cinderhold's AI seat in a REAL PvP session (Push 2, 2026-11-09).
 *
 * The seat never applies a move itself: it only chooses one. The driver
 * (api/_npc-duel-driver.ts) sends that choice through the same /api/pvp/move
 * route a human client uses, so every PvP rule (coin flip, 45 s clock, AP and
 * the five-action cap, cooldowns, item charges, round-25 tiebreak) is enforced
 * by the one engine, and an NPC can never do anything a player could not.
 *
 * Choosing reuses the Solo-PvE beam planner. The PvP session is projected into
 * the planner's view with the NPC as its "enemy"; the planner only reads that
 * copy. Its search tier comes from the NPC's rank (NPC_RANK_AI_TIER).
 */
import type { PvpSession } from './pvp/session.js';
import type { SoloPveAction, SoloPveSession } from './solo-pve/_session.js';
import { chooseStandardPveEnemyAction } from './solo-pve/_engine.js';
import { CATALOG_CHALLENGE_WEAPON_POLICY, enemyTurnPolicy, type EnemyTurnPolicy } from './solo-pve/_ai-turn-policy.js';
import { NPC_RANK_AI_TIER, type NpcShinobi } from '../shared/npc-village-roster.js';
import { safeName } from './_utils.js';
import { ITEM_CATALOG } from './pvp/_item-catalog.js';
import { npcInSeat, type PvpSeat } from './_npc-duel.js';

export { npcInSeat, npcSeatOf, type PvpSeat } from './_npc-duel.js';
export type NpcMoveBody = { action: string; tile?: number; jutsuId?: string; itemId?: string };

/**
 * Search budget by rank: genin and chunin read like trained shinobi, a Kage
 * plans the whole turn. At a war front every guard fights at the top tier
 * (owner ruling 2026-11-10), so each win there is a real fight.
 */
export function npcTurnPolicy(npc: NpcShinobi, opts: { atWar?: boolean } = {}): EnemyTurnPolicy {
    const tier = opts.atWar ? 'apex' : NPC_RANK_AI_TIER[npc.rank];
    if (tier === 'apex') return { ...enemyTurnPolicy(100, true), tier: 'apex', lookahead: 5, firstActionBeam: 8, maxSimulations: 192, considersSurvival: true };
    if (tier === 'master') return enemyTurnPolicy(100, true);
    if (tier === 'advanced') return enemyTurnPolicy(70);
    return enemyTurnPolicy(40);
}

/** A read-only planner view of the PvP board with the NPC as the acting "enemy". */
export function projectForNpc(session: PvpSession, seat: PvpSeat): SoloPveSession {
    const foe: PvpSeat = seat === 'p1' ? 'p2' : 'p1';
    const view = structuredClone({
        runtime: 'solo-pve', schemaVersion: 1,
        sessionId: `npc-seat:${String((session as { battleId?: string }).battleId ?? '')}`,
        ownerSlug: safeName(String(session[foe].name ?? '')),
        encounter: { kind: 'npc-duel', id: String(session[seat].name ?? '') },
        player: session[foe],
        enemy: session[seat],
        round: session.round,
        activeSide: 'enemy',
        ap: { player: session.ap[foe], enemy: session.ap[seat] },
        actionsThisTurn: session.actionsThisTurn,
        cooldowns: { player: { ...session.cooldowns[foe] }, enemy: { ...session.cooldowns[seat] } },
        groundEffects: session.groundEffects ?? [],
        // Only the NPC's own sealed charges: the planner never invents an item.
        itemCharges: { ...(session.itemCharges?.[seat] ?? {}) },
        itemsUsed: { ...(session.itemsUsed?.[seat] ?? {}) },
        environment: {
            biome: session.biome ?? 'central',
            ...(session.weatherPositiveElement ? { weatherPositiveElement: session.weatherPositiveElement } : {}),
            ...(session.weatherNegativeElement ? { weatherNegativeElement: session.weatherNegativeElement } : {}),
            blockedTiles: [],
        },
        status: 'active', winner: null, outcome: null, settlementState: 'pending',
        log: [], events: [], eventSeq: 0, version: 0, recentMoveTokens: [],
        createdAt: 0, lastActionAt: 0, expiresAt: Number.MAX_SAFE_INTEGER,
    }) as unknown as SoloPveSession;
    // Another player, not a teaching opponent: no low-level PvE easing (bursts
    // held to round 3, never clearing buffs or cleansing). Only the copy changes.
    const character = (view.enemy as { character?: Record<string, unknown> }).character;
    if (character && typeof character === 'object') {
        character.pvpPeerAi = true;
        // Its weapon is a real catalog weapon, swung through /pvp/move like a
        // player's, so the planner may weigh weapon strikes too.
        character.pveWeaponPolicy = CATALOG_CHALLENGE_WEAPON_POLICY;
        // Its pouch as the planner reads it: the PvP fighter snapshot carries no
        // inventory (only the sealed charges), and the planner spends one
        // inventory entry per use, so list one entry per charge left. Every
        // equipped item must resolve from the catalog for the planner to see it.
        const charges = session.itemCharges?.[seat] ?? {};
        character.inventory = Object.entries(charges).flatMap(([id, n]) => Array.from({ length: Math.max(0, Math.floor(Number(n) || 0)) }, () => id));
        const items = Array.isArray(character.pvpItems) ? [...character.pvpItems as Array<{ id?: string }>] : [];
        const equipped = Object.values((character.equipment ?? {}) as Record<string, unknown>).filter((id): id is string => typeof id === 'string' && !!id);
        for (const id of new Set([...equipped, ...Object.keys(charges)])) {
            if (!items.some((item) => item?.id === id) && ITEM_CATALOG[id]) items.push(structuredClone(ITEM_CATALOG[id]!));
        }
        character.pvpItems = items;
    }
    return view;
}

/** The PvP move route's body for a planner action; anything a seat may not do ends the turn. */
export function pvpMoveFor(action: SoloPveAction | null): NpcMoveBody {
    if (!action) return { action: 'wait' };
    switch (action.type) {
        case 'move': return { action: 'move', tile: action.tile };
        case 'basicAttack': case 'basicHeal': case 'clear': case 'cleanse': return { action: action.type };
        case 'jutsu': return { action: 'jutsu', jutsuId: action.jutsuId, ...(action.tile === undefined ? {} : { tile: action.tile }) };
        case 'weapon': return { action: 'weapon', itemId: action.itemId };
        case 'item': return { action: 'item', itemId: action.itemId };
        // An NPC never flees, summons or abandons: it ends its turn instead.
        default: return { action: 'wait' };
    }
}

/**
 * Takes moves the engine just refused out of the planner's view, so it plans
 * something else: a refused jutsu or basic action reads as on cooldown, a
 * refused item as spent, a refused step as a blocked tile. Only the copy changes.
 */
export function withoutRefusedMoves(view: SoloPveSession, avoid: readonly NpcMoveBody[]): SoloPveSession {
    if (!avoid.length) return view;
    const v = view as unknown as {
        cooldowns: { enemy: Record<string, number> };
        itemCharges: Record<string, number>;
        environment: { blockedTiles: number[] };
        enemy?: { character?: { inventory?: unknown } };
    };
    for (const move of avoid) {
        if (move.action === 'jutsu' && move.jutsuId) v.cooldowns.enemy[move.jutsuId] = 99;
        else if ((move.action === 'weapon' || move.action === 'item') && move.itemId) {
            v.itemCharges[move.itemId] = 0;
            const character = v.enemy?.character;
            if (character && Array.isArray(character.inventory)) character.inventory = character.inventory.filter((id) => id !== move.itemId);
            // A refused weapon swing reads as on cooldown, so the planner picks something else.
            v.cooldowns.enemy[`weapon:${move.itemId}`] = 99;
            v.cooldowns.enemy[`item:${move.itemId}`] = 99;
        }
        else if (move.action === 'move' && typeof move.tile === 'number') v.environment.blockedTiles.push(move.tile);
        else v.cooldowns.enemy[move.action] = 99;
    }
    return view;
}

/** The NPC's next move this turn, or `wait` when it has nothing better (or no turn). */
export function chooseNpcMove(session: PvpSession, seat: PvpSeat, opts: { atWar?: boolean; avoid?: readonly NpcMoveBody[] } = {}): NpcMoveBody {
    const npc = npcInSeat(session, seat);
    if (!npc || session.status !== 'active' || session.activePlayer !== seat) return { action: 'wait' };
    try {
        const view = withoutRefusedMoves(projectForNpc(session, seat), opts.avoid ?? []);
        const choice = pvpMoveFor(chooseStandardPveEnemyAction(view, npcTurnPolicy(npc, opts)));
        // Still the refused move (nothing else to try): end the turn instead.
        if ((opts.avoid ?? []).some((move) => JSON.stringify(move) === JSON.stringify(choice))) return { action: 'wait' };
        return choice;
    } catch (error) {
        console.warn('[npc-ai-seat] planner failed; ending the turn', String(error));
        return { action: 'wait' };
    }
}
