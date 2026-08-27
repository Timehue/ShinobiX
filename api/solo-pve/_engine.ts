import { COMBAT_RESOURCES_V2, v2PoisonOnSpend, v2ResourceRegen } from '../_combat-resources.js';
import {
    pveAiCompetence,
    pveEasyBandAllowsLethal,
    pveEasyBandHoldsBurst,
    pveGuardedEnemyHit,
    weeklyBossDamageMultiplier,
    weeklyBossGuardedHit,
} from '../_pve-difficulty.js';
import { pveMeaningfulBuffCount } from '../_pve-ai-tactics.js';
import { MAX_ACTIONS, MAX_ROUNDS, GRID_H, GRID_W, SPIRAL_RADIUS } from '../combat-core/constants.js';
import {
    COMPANION_FIELD_ROUNDS,
    COMPANION_MAX_DAMAGE_FRAC,
    COMPANION_RANGE,
    companionGearDamageMult,
    companionHealOnSummonPct,
    companionConsumableHealPct,
    companionMoveDamage,
    companionObeys,
    companionOwnerLifestealPct,
    pickCompanionMove,
    type CompanionMove,
} from '../combat-core/companion.js';
import { tickCombatCooldowns } from '../combat-core/cooldowns.js';
import { weatherMultiplier } from '../combat-core/formulas.js';
import { hexDistance, hexNeighbors } from '../combat-core/grid.js';
import { adjustedApCost } from '../combat-core/resources.js';
import { activeCombatStatuses, addCombatStatus, removeActiveCombatStatusesByKind, removeActiveCombatStatusesByName } from '../combat-core/statuses.js';
import { validateServerAiRules, type ServerAiRule } from '../combat-core/ai-authoring.js';
import {
    projectAuthoritativeCombatEvent,
    type AuthoritativeCombatEvent,
    type CombatResolutionFacts,
} from '../combat-core/events.js';
import type { ResolveJutsuMetadata } from '../combat-core/resolveJutsu.js';
import type { CombatFxEvent } from '../combat-core/types.js';
import { MAX_COMBAT_VFX_TILES, semanticJutsuVfx } from '../combat-core/jutsu-vfx.js';
import { filledDiskTiles } from '../combat-core/aoe.js';
import { canonicalTagName, OPPONENT_AFFECTING_TAGS, REQUIRES_DAMAGE_TAGS, STACKABLE_STATUS } from '../pvp/_tags.js';
import {
    canonicalGroundTags,
    createCanonicalGroundEffect,
    resolveJutsuActionPlan,
    type JutsuActionPlan,
} from '../combat-core/resolve-jutsu-action.js';
import {
    applyDoTs,
    applyGroundEffectToFighter,
    applyJutsu,
    tickGroundEffects,
    tickStatuses,
} from '../pvp/move.js';
import { characterOwnsElement } from '../pvp/_elements.js';
import { trimPvpLog, type PvpFighter, type PvpGroundEffect } from '../pvp/session.js';
import {
    hollowGateCombatDirective,
    hollowGateHazardDamage,
    type HollowGateCombatDirective,
} from '../../shared/hollow-gate-combat-director.js';
import type { HollowGateHoundKind } from '../../shared/hollow-gate-contract.js';
import {
    SOLO_PVE_EVENT_HISTORY,
    type SoloPveAction,
    type SoloPveActionResult,
    type SoloPveCombatEvent,
    type SoloPveCompanion,
    type SoloPveEventSnapshot,
    type SoloPveItem,
    type SoloPveJutsu,
    type SoloPveRejectionEvent,
    type SoloPveSession,
    type SoloPveSide,
    type SoloPveVfxEvent,
} from './_session.js';

const MOVE_AP = 30;
const BASIC_ATTACK_AP = 40;
const BASIC_ATTACK_STAMINA = 10;
const BASIC_HEAL_AP = 60;
const BASIC_HEAL_CHAKRA = 10;
const CLEAR_AP = 60;
const CLEANSE_AP = 60;

export type SoloPveEngineOptions = {
    /** Server-owned escape decision. Never derive this from request data. */
    escapeSucceeds?: () => boolean;
};

function cloneSession(session: SoloPveSession): SoloPveSession {
    const clone = structuredClone(session);
    clone.events ??= [];
    clone.eventSeq ??= 0;
    return clone;
}

function fighter(session: SoloPveSession, side: SoloPveSide): PvpFighter {
    return side === 'player' ? session.player : session.enemy;
}

function setFighter(session: SoloPveSession, side: SoloPveSide, value: PvpFighter): void {
    if (side === 'player') session.player = value;
    else session.enemy = value;
}

function otherSide(side: SoloPveSide): SoloPveSide {
    return side === 'player' ? 'enemy' : 'player';
}

function hollowGateDirective(session: SoloPveSession): HollowGateCombatDirective | null {
    if (session.encounter.kind !== 'hollow-gate') return null;
    const metadata = session.encounter.metadata ?? {};
    const kind = String(metadata.combatKind ?? '');
    if (kind !== 'battle' && kind !== 'elite' && kind !== 'ambush' && kind !== 'beast' && kind !== 'boss') return null;
    return hollowGateCombatDirective({
        floor: metadata.floor,
        kind: kind as HollowGateHoundKind,
        turn: session.round,
        enemyHp: session.enemy.hp,
        enemyMaxHp: session.enemy.maxHp,
        playerPos: session.player.pos,
        enemyPos: session.enemy.pos,
        gridWidth: GRID_W,
        gridHeight: GRID_H,
    });
}

/**
 * PvE-only relic power. Solo-PvE is player-vs-AI by definition (the enemy is
 * always encounter-authored, never a second human), so it applies unconditionally
 * here — the mode IS the gate. The equivalent in the towers engine has to check
 * the counterparty, because tower PvP seats a human team on side 'enemy'.
 *
 * Sealed by hydrateCharacterFromSave (clamped 0-100 / 0-75) and read only by the
 * PvE engines; api/pvp/move.ts never sees these fields.
 */
function pvePct(value: PvpFighter, field: 'pveDamagePct' | 'pveDamageTakenPct'): number {
    return Math.max(0, Number(value.character?.[field]) || 0);
}

function soloPveDamageMultiplier(session: SoloPveSession, side: SoloPveSide): number {
    const directive = hollowGateDirective(session);
    const hollowGate = directive
        ? side === 'player' ? directive.outgoingDamageMultiplier : directive.incomingDamageMultiplier
        : 1;
    const weeklyBossGuardActive = Boolean(
        session.weeklyBossGuard && session.weeklyBossGuard.mechanicsEnabled !== false,
    );
    const weeklyBoss = side === 'player' && weeklyBossGuardActive
        ? weeklyBossDamageMultiplier(session.round)
        : 1;
    // The player's relic: boosts what they deal, and blunts what the AI deals to
    // them (the enemy's cast is always aimed at the player in a 1v1 solo fight).
    const player = session.player;
    const relic = side === 'player'
        ? 1 + pvePct(player, 'pveDamagePct') / 100
        : Math.max(0.25, 1 - pvePct(player, 'pveDamageTakenPct') / 100);
    return hollowGate * weeklyBoss * relic;
}

function fighterEventState(value: PvpFighter) {
    return {
        hp: value.hp,
        maxHp: value.maxHp,
        chakra: value.chakra,
        stamina: value.stamina,
        shield: value.shield,
        pos: value.pos,
        statuses: structuredClone(value.statuses),
    };
}

function eventSnapshot(session: SoloPveSession): SoloPveEventSnapshot {
    return {
        player: fighterEventState(session.player),
        enemy: fighterEventState(session.enemy),
        ...(session.companion ? { companion: {
            ...fighterEventState(session.companion),
            roundsLeft: session.companion.roundsLeft,
            cooldowns: { ...session.companion.cooldowns },
        } } : {}),
        ap: { ...session.ap },
        cooldowns: structuredClone(session.cooldowns),
        groundEffects: structuredClone(session.groundEffects),
        itemCharges: { ...session.itemCharges },
        itemsUsed: { ...session.itemsUsed },
    };
}

function projectSoloCombatEvent(params: {
    session: SoloPveSession;
    before: SoloPveEventSnapshot;
    after: SoloPveEventSnapshot;
    sequence: number | null;
    roundBefore: number;
    actor: 'player' | 'enemy' | 'companion';
    target: 'player' | 'enemy' | 'companion' | 'tile' | null;
    actionType: string;
    actionId?: string;
    tile?: number;
    applied: boolean;
    rejectionReason?: string;
    resolution?: CombatResolutionFacts;
}): AuthoritativeCombatEvent {
    return projectAuthoritativeCombatEvent({
        runtime: params.session.runtime,
        mode: params.session.encounter.kind,
        sessionId: params.session.sessionId,
        sequence: params.sequence,
        roundBefore: params.roundBefore,
        roundAfter: params.session.round,
        actor: params.actor,
        target: params.target,
        actionType: params.actionType,
        ...(params.actionId ? { actionId: params.actionId } : {}),
        ...(params.tile === undefined ? {} : { tile: params.tile }),
        applied: params.applied,
        ...(params.rejectionReason ? { rejectionReason: params.rejectionReason } : {}),
        ...(params.resolution ? { resolution: params.resolution } : {}),
        before: params.before,
        after: params.after,
        status: params.session.status,
        winner: params.session.winner,
        outcome: params.session.outcome,
    });
}

function actionIdentity(session: SoloPveSession, side: SoloPveSide, action: SoloPveAction): { actionId?: string; actionName?: string } {
    if (action.type === 'jutsu') {
        const jutsu = jutsuList(fighter(session, side)).find((entry) => entry.id === action.jutsuId);
        return { actionId: action.jutsuId, actionName: jutsu?.name };
    }
    if (action.type === 'weapon' || action.type === 'item') {
        const item = equippedItem(fighter(session, side), action.itemId);
        return { actionId: action.itemId, actionName: item?.name };
    }
    if (action.type === 'summon') return { actionId: session.pendingCompanion?.petId, actionName: session.pendingCompanion?.name };
    return { actionId: action.type, actionName: action.type };
}

function eventTarget(session: SoloPveSession, side: SoloPveSide, action: SoloPveAction): SoloPveSide | 'tile' | null {
    if (action.type === 'move') return 'tile';
    if (action.type === 'jutsu') {
        const jutsu = jutsuList(fighter(session, side)).find((entry) => entry.id === action.jutsuId);
        if (jutsu && (jutsu.target === 'EMPTY_GROUND' || hasMoveTag(jutsu))) return 'tile';
        if (jutsu?.target === 'SELF') return side;
        return otherSide(side);
    }
    if (action.type === 'basicHeal' || action.type === 'cleanse' || action.type === 'item' || action.type === 'summon' || action.type === 'flee' || action.type === 'abandon') return side;
    if (action.type === 'wait') return null;
    return otherSide(side);
}

function tagNames(jutsu: SoloPveJutsu): string[] {
    return (jutsu.tags ?? []).map((tag) => canonicalTagName(String(tag.name ?? '')));
}

function hasMoveTag(jutsu: SoloPveJutsu): boolean {
    return tagNames(jutsu).includes('Move');
}

function normalizedMethod(jutsu: SoloPveJutsu): string {
    return jutsu.method === 'AOE_LINE' ? 'INSTANT_EFFECT' : (jutsu.method ?? 'SINGLE');
}

function jutsuVfx(session: SoloPveSession, side: SoloPveSide, action: SoloPveAction, ko = false): SoloPveVfxEvent[] {
    if (action.type === 'move') return [{ key: 'move', target: 'tile', anchor: 'tile', tiles: [action.tile] }];
    if (action.type === 'basicAttack') return [{ key: 'impact', target: otherSide(side), anchor: 'target' }];
    if (action.type === 'basicHeal') return [{ key: 'heal', target: side, anchor: 'caster' }];
    if (action.type === 'clear' || action.type === 'cleanse') return [{ key: 'cleanse', target: action.type === 'cleanse' ? side : otherSide(side), anchor: 'target' }];
    if (action.type === 'weapon') return [{ key: 'weapon', target: otherSide(side), anchor: 'target' }];
    if (action.type === 'item') return [{ key: 'item', target: side, anchor: 'caster' }];
    if (action.type === 'summon') return [{ key: 'summon', target: side, anchor: 'caster' }];
    if (action.type !== 'jutsu') return [];
    const jutsu = jutsuList(fighter(session, side)).find((entry) => entry.id === action.jutsuId);
    if (!jutsu) return [];
    const names = tagNames(jutsu);
    const pureMove = names.includes('Move') && names.every((name) => name === 'Move');
    if (pureMove) return [];
    const method = normalizedMethod(jutsu);
    const area = method === 'AOE_CIRCLE' || method === 'AOE_SPIRAL';
    const persistent = method === 'INSTANT_EFFECT' || method === 'AOE_SPIRAL';
    const semantic = semanticJutsuVfx(jutsu, {
        ...(persistent || method === 'AOE_SPIRAL' ? { ground: true } : {}),
        ...(area ? { area: true } : {}),
        ...(ko ? { ko: true } : {}),
    });
    const tiles = action.tile === undefined
        ? undefined
        : method === 'AOE_SPIRAL'
            ? filledDiskTiles(action.tile, SPIRAL_RADIUS, GRID_W, GRID_H)
            : method === 'AOE_CIRCLE' || method === 'INSTANT_EFFECT'
                ? [action.tile, ...hexNeighbors(action.tile)]
                : [action.tile];
    return [{
        key: semantic.key,
        target: semantic.anchor === 'area' ? 'area'
            : semantic.anchor === 'tile' ? 'tile'
                : semantic.anchor === 'caster' ? side : otherSide(side),
        anchor: semantic.anchor,
        ...(tiles ? { tiles: tiles.slice(0, MAX_COMBAT_VFX_TILES) } : {}),
        ...(persistent ? { persistent: true } : {}),
    }];
}

function activeStatuses(value: PvpFighter, round: number) {
    return activeCombatStatuses(value.statuses, round);
}

function barrierTiles(session: SoloPveSession): number[] {
    return [session.player, session.enemy].flatMap((value) => activeStatuses(value, session.round)
        .filter((status) => status.name === 'Barrier' && typeof status.amount === 'number')
        .map((status) => status.amount!));
}

function tileBlocked(session: SoloPveSession, tile: number): boolean {
    return session.environment.blockedTiles.includes(tile)
        || barrierTiles(session).includes(tile)
        || session.companion?.pos === tile;
}

function validOpenTile(session: SoloPveSession, side: SoloPveSide, tile: number, range: number, allowCurrent = false): boolean {
    const self = fighter(session, side);
    const opponent = fighter(session, otherSide(side));
    return Number.isInteger(tile)
        && tile >= 0
        && tile < GRID_W * GRID_H
        && hexDistance(self.pos, tile) <= range
        && (allowCurrent || tile !== self.pos)
        && tile !== opponent.pos
        && !tileBlocked(session, tile);
}

function jutsuActionPlan(
    session: SoloPveSession,
    side: SoloPveSide,
    jutsu: SoloPveJutsu,
    tile?: number,
) {
    const self = fighter(session, side);
    const opponent = fighter(session, otherSide(side));
    return resolveJutsuActionPlan({
        jutsu,
        casterPos: self.pos,
        opponentPos: opponent.pos,
        casterChakra: self.chakra,
        casterStamina: self.stamina,
        casterStatuses: self.statuses,
        round: session.round,
        availableAp: session.ap[side],
        actionsThisTurn: session.actionsThisTurn,
        cooldownRemaining: session.cooldowns[side][jutsu.id] ?? 0,
        ...(tile === undefined ? {} : { tile }),
        board: {
            width: GRID_W,
            height: GRID_H,
            unavailableTiles: new Set([
                ...session.environment.blockedTiles,
                ...barrierTiles(session),
                opponent.pos,
                ...(session.companion ? [session.companion.pos] : []),
            ]),
        },
    });
}

function statusPct(value: PvpFighter, name: string, round: number): number | undefined {
    const statuses = activeStatuses(value, round).filter((status) => status.name === name);
    if (!statuses.length) return undefined;
    return statuses.reduce((sum, status) => sum + Number(status.percent ?? 0), 0);
}

function actionCost(session: SoloPveSession, side: SoloPveSide, base: number): number {
    const value = fighter(session, side);
    return adjustedApCost(base, {
        lagPct: statusPct(value, 'Lag', session.round),
        overclockPct: statusPct(value, 'Overclock', session.round),
    });
}

function canAct(session: SoloPveSession, side: SoloPveSide, baseCost: number): boolean {
    return session.activeSide === side
        && session.status === 'active'
        && session.actionsThisTurn < MAX_ACTIONS
        && session.ap[side] >= actionCost(session, side, baseCost);
}

function spendAction(session: SoloPveSession, side: SoloPveSide, baseCost: number): void {
    session.ap[side] = Math.max(0, session.ap[side] - actionCost(session, side, baseCost));
    session.actionsThisTurn += 1;
}

/**
 * Whether the human fighter has any non-wait action the authoritative runtime
 * would accept right now. This intentionally mirrors resolveDirectAction's AP,
 * action-count, cooldown, resource, range, charge, and target-space gates.
 *
 * The retired local Arena advanced the turn after an action spent the last
 * usable AP. Solo PvE originally omitted that transition, leaving every mission
 * fight parked on a dead turn until the player clicked Wait or the timer fired.
 * Keeping the decision here makes missions, story fights, hunts, Hollow Gate,
 * and every other Solo PvE host behave identically without trusting a client.
 */
function playerHasLegalAction(session: SoloPveSession): boolean {
    if (session.status !== 'active' || session.activeSide !== 'player') return false;
    const self = session.player;
    const opponent = session.enemy;

    // Summoning is deliberately free in this runtime, so preserve the chance to
    // use it even when AP is exhausted (provided an adjacent landing tile exists).
    if (session.pendingCompanion && hexNeighbors(self.pos).some((tile) => tile !== opponent.pos && !tileBlocked(session, tile))) {
        return true;
    }
    if (session.actionsThisTurn >= MAX_ACTIONS) return false;

    if (canAct(session, 'player', MOVE_AP)
        && hexNeighbors(self.pos).some((tile) => tile !== opponent.pos && !tileBlocked(session, tile))) return true;
    if (canAct(session, 'player', BASIC_ATTACK_AP)
        && hexDistance(self.pos, opponent.pos) <= 1
        && self.stamina >= BASIC_ATTACK_STAMINA) return true;
    if (canAct(session, 'player', BASIC_HEAL_AP)
        && (session.cooldowns.player.basicHeal ?? 0) <= 0
        && self.chakra >= BASIC_HEAL_CHAKRA) return true;
    if (canAct(session, 'player', CLEAR_AP) && (session.cooldowns.player.clear ?? 0) <= 0) return true;
    if (canAct(session, 'player', CLEANSE_AP) && (session.cooldowns.player.cleanse ?? 0) <= 0) return true;

    for (const jutsu of jutsuList(self)) {
        const names = tagNames(jutsu);
        const moveTag = names.includes('Move');
        const groundTarget = jutsu.target === 'EMPTY_GROUND';
        if (moveTag || groundTarget) {
            let hasOpenTarget = false;
            for (let tile = 0; tile < GRID_W * GRID_H; tile += 1) {
                if (jutsuActionPlan(session, 'player', jutsu, tile).accepted) { hasOpenTarget = true; break; }
            }
            if (!hasOpenTarget) continue;
        } else {
            if (!jutsuActionPlan(session, 'player', jutsu).accepted) continue;
        }
        return true;
    }

    const items = Array.isArray(self.character.pvpItems) ? self.character.pvpItems as SoloPveItem[] : [];
    const equipment = self.character.equipment && typeof self.character.equipment === 'object'
        ? self.character.equipment as Record<string, unknown>
        : {};
    const equippedIds = new Set(Object.values(equipment).map(String));
    for (const item of items) {
        if (!item.id || !equippedIds.has(item.id)) continue;
        const slot = normalizeSlot(item.slot);
        if (!['hand', 'thrown', 'item', 'item1', 'item2', 'item3', 'potion'].includes(slot)) continue;
        const cost = Math.max(1, Number(item.apCost ?? (slot === 'hand' || slot === 'thrown' ? 40 : 35)));
        const cooldownKey = item.id ?? item.name ?? (slot === 'hand' || slot === 'thrown' ? 'weapon' : 'item');
        if (!canAct(session, 'player', cost) || (session.cooldowns.player[cooldownKey] ?? 0) > 0) continue;
        if ((slot === 'thrown' || !['hand', 'thrown'].includes(slot)) && (session.itemCharges[item.id] ?? Infinity) <= 0) continue;
        if ((slot === 'hand' || slot === 'thrown')
            && hexDistance(self.pos, opponent.pos) > Math.max(1, Number(item.weaponRange ?? (slot === 'thrown' ? 3 : 1)))) continue;
        return true;
    }

    return false;
}

function appendFx(session: SoloPveSession, side: SoloPveSide, events: CombatFxEvent[]): void {
    if (!events.length) return;
    const opponent = otherSide(side);
    session.fx = events.map((event) => ({
        target: event.who === 'self' ? side : opponent,
        amount: event.amount,
        kind: event.kind,
    }));
    session.fxSeq = (session.fxSeq ?? 0) + 1;
}

function checkWinner(session: SoloPveSession): void {
    if (session.status === 'done') return;
    if (session.player.hp <= 0 && session.enemy.hp <= 0) {
        session.status = 'done';
        session.winner = 'draw';
        session.outcome = 'draw';
        session.log.push('Both fighters fall. The encounter ends in a draw.');
    } else if (session.enemy.hp <= 0) {
        session.status = 'done';
        session.winner = 'player';
        session.outcome = 'win';
        session.log.push(`${session.player.name} wins.`);
    } else if (session.player.hp <= 0) {
        session.status = 'done';
        session.winner = 'enemy';
        session.outcome = 'loss';
        session.log.push(`${session.enemy.name} wins.`);
    }
}

function applyGroundEffects(session: SoloPveSession, side: SoloPveSide): void {
    const owner = side === 'player' ? 'p2' : 'p1';
    let value = fighter(session, side);
    for (const effect of session.groundEffects) {
        if (effect.owner !== owner || !effect.tiles.includes(value.pos)) continue;
        const applied = applyGroundEffectToFighter(value, effect, session.round);
        value = applied.fighter;
        session.log.push(...applied.lines);
    }
    setFighter(session, side, value);
}

function startTurn(session: SoloPveSession, side: SoloPveSide): void {
    let value = fighter(session, side);
    applyGroundEffects(session, side);
    value = fighter(session, side);
    const dots = applyDoTs(value, session.round);
    value = dots.fighter;
    session.log.push(...dots.lines);
    appendFx(session, side, dots.fx);
    if (COMBAT_RESOURCES_V2) {
        const level = Math.max(1, Number(value.character.level) || 1);
        const regen = v2ResourceRegen(level);
        value = {
            ...value,
            chakra: Math.min(value.maxChakra, value.chakra + regen),
            stamina: Math.min(value.maxStamina, value.stamina + regen),
        };
    }
    const stunned = activeStatuses(value, session.round).some((status) => status.name === 'Stun' || status.name === 'Stunned');
    if (stunned) {
        const consumed = removeActiveCombatStatusesByName(value.statuses, ['Stun', 'Stunned'], session.round);
        value = { ...value, statuses: consumed.statuses };
    }
    setFighter(session, side, value);
    session.activeSide = side;
    session.ap[side] = stunned ? 60 : 100;
    session.actionsThisTurn = 0;
    if (side === 'enemy' && session.difficultyGuard) {
        session.difficultyGuard.playerHpTurnStart = session.player.hp;
        session.difficultyGuard.dealtThisTurn = 0;
    }
    if (side === 'enemy' && session.weeklyBossGuard) {
        session.weeklyBossGuard.playerHpTurnStart = session.player.hp;
        session.weeklyBossGuard.dealtThisTurn = 0;
    }
    checkWinner(session);
}

function companionRoll(session: SoloPveSession): number {
    let hash = 2166136261;
    const input = `${session.sessionId}:${session.round}:${session.eventSeq}:${session.companion?.petId ?? ''}`;
    for (let index = 0; index < input.length; index++) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 0x1_0000_0000;
}

function addCompanionStatus(value: PvpFighter, status: PvpFighter['statuses'][number]): void {
    value.statuses = addCombatStatus(value.statuses, status, { isStackable: (name) => STACKABLE_STATUS.has(name) });
}

function appendCompanionEvent(
    session: SoloPveSession,
    before: SoloPveEventSnapshot,
    logStart: number,
    action: 'companionMove' | 'companionWait',
    actionName: string,
    target: 'companion' | 'enemy' | 'tile' | null,
    tile?: number,
    resolution?: CombatResolutionFacts,
): void {
    const after = eventSnapshot(session);
    const sequence = session.eventSeq + 1;
    const event: SoloPveCombatEvent = {
        kind: 'action',
        seq: sequence,
        round: session.round,
        actor: 'companion',
        target,
        action,
        actionId: actionName,
        actionName,
        ...(tile === undefined ? {} : { tile }),
        before,
        after,
        log: session.log.slice(logStart),
        vfx: [{
            key: target === 'companion' ? 'buff' : target === 'tile' ? 'move' : 'impact',
            target: target ?? 'companion',
            anchor: target === 'tile' ? 'tile' : target === 'companion' ? 'caster' : 'target',
            ...(tile === undefined ? {} : { tiles: [tile] }),
        }],
        status: session.status,
        winner: session.winner,
        outcome: session.outcome,
        combat: projectSoloCombatEvent({
            session, before, after, sequence, roundBefore: session.round,
            actor: 'companion', target, actionType: action, actionId: actionName,
            ...(tile === undefined ? {} : { tile }), applied: true,
            ...(resolution ? { resolution } : {}),
        }),
    };
    session.eventSeq = event.seq;
    session.events = [...session.events, event].slice(-SOLO_PVE_EVENT_HISTORY);
}

function companionDealDamage(session: SoloPveSession, companion: SoloPveCompanion, move: CompanionMove | null): CombatResolutionFacts & { dealt: number } {
    const inc = activeStatuses(companion, session.round)
        .filter((status) => status.name === 'Increase Damage Given')
        .reduce((sum, status) => sum + Number(status.percent ?? 0), 0);
    const enemyHpPct = session.enemy.hp / Math.max(1, session.enemy.maxHp) * 100;
    const ownerHpPct = session.player.hp / Math.max(1, session.player.maxHp) * 100;
    const raw = companionMoveDamage(companion.baseDamage, move)
        * (1 + Math.min(60, inc) / 100)
        * companionGearDamageMult(companion.pveGearId, enemyHpPct, ownerHpPct);
    if (raw <= 0) return { dealt: 0, rawDamage: 0, resolvedDamage: 0 };
    const cap = Math.max(1, Math.floor(session.enemy.maxHp * COMPANION_MAX_DAMAGE_FRAC));
    const uncapped = Math.max(0, Math.floor(raw * soloPveDamageMultiplier(session, 'player')));
    const dealt = Math.min(uncapped, cap);
    session.enemy.hp = Math.max(0, session.enemy.hp - dealt);
    const lifestealPct = companionOwnerLifestealPct(companion.pveGearId);
    if (dealt > 0 && lifestealPct > 0 && session.player.hp > 0) {
        const heal = Math.max(1, Math.floor(dealt * lifestealPct / 100));
        session.player.hp = Math.min(session.player.maxHp, session.player.hp + heal);
        session.log.push(`${session.player.name} draws ${heal} HP from ${companion.name}'s strike.`);
    }
    return { dealt, rawDamage: uncapped, resolvedDamage: dealt };
}

function companionCast(session: SoloPveSession, companion: SoloPveCompanion, move: CompanionMove | null): CombatResolutionFacts | undefined {
    if (move) companion.cooldowns[move.name] = Math.max(1, move.cooldown);
    const rounds = move?.rounds ?? 2;
    const kind = move?.kind ?? 'damage';
    const label = move ? ` uses ${move.name}` : ' strikes';
    if (kind === 'heal') {
        const heal = Math.max(1, Math.floor(companion.maxHp * 0.25 + Number(move?.power ?? 0) * 0.5));
        companion.hp = Math.min(companion.maxHp, companion.hp + heal);
        session.log.push(`${companion.name}${label} and recovers ${heal} HP.`);
        return { healing: heal };
    }
    if (kind === 'shield' || kind === 'barrier') {
        const amount = Math.max(1, Math.floor(companion.maxHp * 0.2));
        companion.shield += amount;
        session.log.push(`${companion.name}${label} and raises a ${amount} HP shield.`);
        return { shielding: amount };
    }
    if (kind === 'buff' || kind === 'haste' || kind === 'absorb' || kind === 'taunt') {
        const status = kind === 'absorb' ? 'Absorb' : kind === 'taunt' ? 'Decrease Damage Taken' : 'Increase Damage Given';
        addCompanionStatus(companion, { name: status, rounds, percent: kind === 'absorb' ? 30 : 25, kind: 'positive' });
        session.log.push(`${companion.name}${label} and steels itself.`);
        return undefined;
    }
    const resolution = companionDealDamage(session, companion, move);
    const dealt = resolution.dealt;
    session.log.push(`${companion.name}${label} -> ${session.enemy.name} for ${dealt}.`);
    switch (kind) {
        case 'stun': case 'freeze': case 'movelock':
            addCompanionStatus(session.enemy, { name: 'Stun', rounds: 1, kind: 'negative' }); break;
        case 'wound':
            addCompanionStatus(session.enemy, { name: 'Wound', rounds, amount: Math.max(1, Math.floor(dealt * 0.4)), kind: 'negative' }); break;
        case 'dot': case 'burn':
            addCompanionStatus(session.enemy, { name: 'Poison', rounds, percent: 8, kind: 'negative' });
            if (kind === 'burn') addCompanionStatus(session.enemy, { name: 'Decrease Damage Given', rounds, percent: 15, kind: 'negative' });
            break;
        case 'crush': case 'confuse': case 'debuff': case 'slow':
            addCompanionStatus(session.enemy, { name: 'Decrease Damage Given', rounds, percent: kind === 'confuse' ? 40 : 25, kind: 'negative' }); break;
        case 'mark':
            addCompanionStatus(session.enemy, { name: 'Increase Damage Taken', rounds, percent: 20, kind: 'negative' }); break;
        case 'lifesteal':
            if (dealt > 0) companion.hp = Math.min(companion.maxHp, companion.hp + Math.max(1, Math.floor(dealt * 0.5)));
            break;
        case 'push': {
            const choices = hexNeighbors(session.enemy.pos)
                .filter((tile) => tile !== companion.pos && tile !== session.player.pos && !tileBlocked(session, tile))
                .sort((a, b) => hexDistance(b, companion.pos) - hexDistance(a, companion.pos) || a - b);
            if (choices[0] !== undefined) session.enemy.pos = choices[0];
            break;
        }
        case 'pull': {
            const choices = hexNeighbors(session.enemy.pos)
                .filter((tile) => tile !== companion.pos && tile !== session.player.pos && !tileBlocked(session, tile))
                .sort((a, b) => hexDistance(a, companion.pos) - hexDistance(b, companion.pos) || a - b);
            if (choices[0] !== undefined && hexDistance(choices[0], companion.pos) < hexDistance(session.enemy.pos, companion.pos)) session.enemy.pos = choices[0];
            break;
        }
        default: break;
    }
    checkWinner(session);
    return resolution;
}

function runSoloPveCompanionPhase(session: SoloPveSession): void {
    const companion = session.companion;
    if (!companion || companion.hp <= 0 || session.status !== 'active') return;
    const effectsBefore = eventSnapshot(session);
    const effectsLogStart = session.log.length;
    for (const effect of session.groundEffects) {
        if (effect.owner !== 'p2' || !effect.tiles.includes(companion.pos)) continue;
        const applied = applyGroundEffectToFighter(companion, effect, session.round);
        session.companion = Object.assign(companion, applied.fighter);
        session.log.push(...applied.lines);
    }
    const dots = applyDoTs(companion, session.round);
    session.companion = Object.assign(companion, dots.fighter);
    session.log.push(...dots.lines);
    if (session.log.length > effectsLogStart || companion.hp <= 0) {
        if (companion.hp <= 0) session.log.push(`${companion.name} is knocked out. The fight continues.`);
        appendCompanionEvent(session, effectsBefore, effectsLogStart, 'companionWait', 'Ongoing Effects', 'companion');
        if (companion.hp <= 0) {
            session.companion = undefined;
            return;
        }
    }
    if (!companionObeys(companion.happiness, companion.loyal, companionRoll(session))) {
        const before = eventSnapshot(session);
        const logStart = session.log.length;
        session.log.push(`${companion.name} ignores your command and holds its position.`);
        appendCompanionEvent(session, before, logStart, 'companionWait', 'Disobey', null);
    } else {
        let ap = 100;
        let actions = 0;
        while (ap >= MOVE_AP && actions < MAX_ACTIONS && session.status === 'active' && companion.hp > 0) {
            const move = pickCompanionMove(companion.moves, companion.cooldowns, companion.hp / Math.max(1, companion.maxHp));
            const selfCast = !!move && companionMoveDamage(1, move) === 0;
            if (!selfCast && hexDistance(companion.pos, session.enemy.pos) > COMPANION_RANGE) {
                const candidates = hexNeighbors(companion.pos)
                    .filter((tile) => tile !== session.player.pos && tile !== session.enemy.pos && !tileBlocked(session, tile))
                    .sort((a, b) => hexDistance(a, session.enemy.pos) - hexDistance(b, session.enemy.pos) || a - b);
                const tile = candidates.find((candidate) => hexDistance(candidate, session.enemy.pos) < hexDistance(companion.pos, session.enemy.pos));
                if (tile === undefined) break;
                const before = eventSnapshot(session);
                const logStart = session.log.length;
                companion.pos = tile;
                session.log.push(`${companion.name} closes in on ${session.enemy.name}.`);
                ap -= MOVE_AP;
                actions += 1;
                appendCompanionEvent(session, before, logStart, 'companionMove', 'Move', 'tile', tile);
                continue;
            }
            if (ap < BASIC_ATTACK_AP) break;
            const before = eventSnapshot(session);
            const logStart = session.log.length;
            const resolution = companionCast(session, companion, move);
            ap -= BASIC_ATTACK_AP;
            actions += 1;
            appendCompanionEvent(
                session,
                before,
                logStart,
                'companionMove',
                move?.name ?? 'Basic Strike',
                move && companionMoveDamage(1, move) === 0 ? 'companion' : 'enemy',
                undefined,
                resolution,
            );
        }
    }
    const phaseEndBefore = eventSnapshot(session);
    const phaseEndLogStart = session.log.length;
    companion.statuses = tickStatuses(companion, session.round).statuses;
    companion.cooldowns = tickCombatCooldowns(companion.cooldowns);
    companion.roundsLeft -= 1;
    if (companion.roundsLeft <= 0 || companion.hp <= 0) {
        session.log.push(`${companion.name} returns to its scroll.`);
        session.companion = undefined;
    }
    appendCompanionEvent(session, phaseEndBefore, phaseEndLogStart, 'companionWait', 'Phase End', 'companion');
}

export function endSoloPveTurn(session: SoloPveSession): void {
    if (session.status !== 'active') return;
    const current = session.activeSide;
    if (current === 'enemy') {
        const directive = hollowGateDirective(session);
        const hazard = directive ? hollowGateHazardDamage(directive, session.player.pos, session.player.maxHp) : 0;
        if (hazard > 0) {
            session.player = { ...session.player, hp: Math.max(0, session.player.hp - hazard) };
            session.log.push(`${directive!.signature} tears through the marked seal for ${hazard} damage.`);
            checkWinner(session);
            if (session.status !== 'active') return;
        }
    }
    setFighter(session, current, tickStatuses(fighter(session, current), session.round));
    session.cooldowns[current] = tickCombatCooldowns(session.cooldowns[current]);
    if (current === 'enemy') {
        session.groundEffects = tickGroundEffects(session.groundEffects);
        if (session.weeklyBossGuard && session.round >= session.weeklyBossGuard.roundBudget) {
            session.status = 'done';
            session.winner = 'player';
            session.outcome = 'win';
            session.log.push(`${session.player.name} outlasts the Weekly Boss assault.`);
            return;
        }
        session.round += 1;
        session.log.push(`--- Round ${session.round} ---`);
        if (session.round > MAX_ROUNDS) {
            session.status = 'done';
            session.winner = 'enemy';
            session.outcome = 'loss';
            session.log.push('Round limit reached. The encounter is lost.');
            return;
        }
    }
    startTurn(session, otherSide(current));
}

function weatherMult(session: SoloPveSession, jutsu: SoloPveJutsu): number {
    return weatherMultiplier(
        jutsu.weatherElement ?? jutsu.element,
        session.environment.weatherPositiveElement ?? '',
        session.environment.weatherNegativeElement ?? '',
    );
}

function guardedDamageCap(session: SoloPveSession, side: SoloPveSide): number | undefined {
    if (side !== 'enemy') return undefined;
    if (session.weeklyBossGuard && session.weeklyBossGuard.mechanicsEnabled !== false) {
        return weeklyBossGuardedHit(
            Number.MAX_SAFE_INTEGER,
            session.player.maxHp,
            session.weeklyBossGuard.dealtThisTurn,
        );
    }
    if (!session.difficultyGuard) return undefined;
    return pveGuardedEnemyHit(Number.MAX_SAFE_INTEGER, {
        enemyLevel: session.difficultyGuard.enemyLevel,
        playerMaxHp: session.player.maxHp,
        playerHpTurnStart: session.difficultyGuard.playerHpTurnStart,
        dealtThisTurn: session.difficultyGuard.dealtThisTurn,
    });
}

function applyCast(session: SoloPveSession, side: SoloPveSide, jutsu: SoloPveJutsu, damageCap?: number): ResolveJutsuMetadata {
    const self = fighter(session, side);
    const opponent = fighter(session, otherSide(side));
    const guardCap = guardedDamageCap(session, side);
    const effectiveDamageCap = damageCap === undefined
        ? guardCap
        : guardCap === undefined ? damageCap : Math.min(damageCap, guardCap);
    const result = applyJutsu(
        self,
        opponent,
        jutsu as Parameters<typeof applyJutsu>[2],
        weatherMult(session, jutsu) * soloPveDamageMultiplier(session, side),
        session.environment.biome,
        session.round,
        effectiveDamageCap,
    );
    setFighter(session, side, result.self);
    setFighter(session, otherSide(side), result.opponent);
    session.log.push(...result.lines);
    appendFx(session, side, result.fx);
    if (side === 'enemy' && session.difficultyGuard) {
        session.difficultyGuard.dealtThisTurn += Math.max(0, Math.floor(result.metadata.damage ?? 0));
    }
    if (side === 'enemy' && session.weeklyBossGuard) {
        session.weeklyBossGuard.dealtThisTurn += Math.max(0, Math.floor(result.metadata.damage ?? 0));
    }
    checkWinner(session);
    return result.metadata;
}

function spendPoison(session: SoloPveSession, side: SoloPveSide, chakra: number, stamina: number): void {
    if (!COMBAT_RESOURCES_V2) return;
    const value = fighter(session, side);
    const pct = activeStatuses(value, session.round)
        .filter((status) => status.name === 'Poison')
        .reduce((sum, status) => sum + Number(status.percent ?? 6), 0);
    const damage = pct > 0 ? v2PoisonOnSpend(chakra + stamina, pct) : 0;
    if (damage <= 0) return;
    setFighter(session, side, { ...value, hp: Math.max(0, value.hp - damage) });
    session.log.push(`${value.name} takes ${damage} Poison damage from exertion.`);
    checkWinner(session);
}

function jutsuList(value: PvpFighter): SoloPveJutsu[] {
    return Array.isArray(value.character.jutsu) ? value.character.jutsu as SoloPveJutsu[] : [];
}

function equippedItem(value: PvpFighter, itemId: string): SoloPveItem | null {
    const items = Array.isArray(value.character.pvpItems) ? value.character.pvpItems as SoloPveItem[] : [];
    const equipment = value.character.equipment && typeof value.character.equipment === 'object'
        ? value.character.equipment as Record<string, unknown>
        : {};
    const equipped = new Set(Object.values(equipment).map(String));
    return items.find((item) => item.id === itemId && equipped.has(itemId)) ?? null;
}

function normalizeSlot(slot: string | undefined): string {
    if (slot === 'weapon') return 'hand';
    if (slot === 'armor') return 'body';
    if (slot === 'accessory') return 'aura';
    return slot ?? '';
}

function spendItemCharge(session: SoloPveSession, itemId: string): boolean {
    if (session.itemCharges[itemId] === undefined) return true;
    if (session.itemCharges[itemId] <= 0) return false;
    session.itemCharges[itemId] -= 1;
    session.itemsUsed[itemId] = (session.itemsUsed[itemId] ?? 0) + 1;
    return true;
}

function groundTags(jutsu: SoloPveJutsu): PvpGroundEffect['tags'] {
    return canonicalGroundTags(jutsu.tags);
}

function addGroundEffect(session: SoloPveSession, side: SoloPveSide, jutsu: SoloPveJutsu, plan: JutsuActionPlan): void {
    const effect: PvpGroundEffect = createCanonicalGroundEffect({
        id: `${session.sessionId}:${session.eventSeq + 1}:${side}:${jutsu.id}`,
        owner: side === 'player' ? 'p1' : 'p2',
        name: jutsu.name,
        plan,
    });
    session.groundEffects.push(effect);
    session.log.push(`${jutsu.name} creates a ground effect across ${effect.tiles.length} hexes for 2 rounds.`);
    const opponentSide = otherSide(side);
    const applied = applyGroundEffectToFighter(fighter(session, opponentSide), effect, session.round);
    setFighter(session, opponentSide, applied.fighter);
    session.log.push(...applied.lines);
}

function payJutsuResources(session: SoloPveSession, side: SoloPveSide, chakra: number, stamina: number): void {
    const updated = fighter(session, side);
    setFighter(session, side, {
        ...updated,
        chakra: Math.max(0, updated.chakra - chakra),
        stamina: Math.max(0, updated.stamina - stamina),
    });
    spendPoison(session, side, chakra, stamina);
}

type DirectActionResult = { applied: boolean; reason?: string; resolution?: CombatResolutionFacts };

function resolutionFacts(metadata: ResolveJutsuMetadata): CombatResolutionFacts {
    return {
        rawDamage: metadata.rawDamage,
        resolvedDamage: metadata.damage,
        healing: metadata.healing,
        shielding: metadata.shieldGain,
    };
}

function applyJutsuAction(session: SoloPveSession, side: SoloPveSide, action: Extract<SoloPveAction, { type: 'jutsu' }>): DirectActionResult {
    const self = fighter(session, side);
    const opponent = fighter(session, otherSide(side));
    const jutsu = jutsuList(self).find((entry) => entry.id === action.jutsuId);
    if (!jutsu) return { applied: false, reason: 'no-jutsu' };
    const tile = action.tile === undefined ? undefined : Math.floor(action.tile);
    const plan = jutsuActionPlan(session, side, jutsu, tile);
    if (!plan.accepted) return { applied: false, reason: plan.rejection };

    const flavor = String(jutsu.battleDescription ?? '').trim()
        .replace(/%user/g, self.name)
        .replace(/%target/g, opponent.name);
    session.log.push(`${self.name} uses ${jutsu.name}:${flavor ? ` ${flavor}` : ''}`);
    let resolution: CombatResolutionFacts | undefined;

    // PvP pays a tile-target cast before movement/impact resolution. Preserve
    // that ordering so Poison-on-spend and any self heal/shield on the same cast
    // observe the same fighter state in both runtimes.
    if (plan.move || plan.groundTarget) payJutsuResources(session, side, plan.chakraCost, plan.staminaCost);

    if (plan.move) {
        setFighter(session, side, { ...fighter(session, side), pos: plan.targetTile! });
        session.log.push(`${self.name} dashes to hex ${tile}.`);
        if (plan.createsGroundEffect) {
            addGroundEffect(session, side, jutsu, plan);
        } else if (plan.method === 'AOE_CIRCLE') {
            if (plan.hitsOpponent) {
                session.log.push(`Ring impact catches ${opponent.name}!`);
                resolution = resolutionFacts(applyCast(session, side, { ...jutsu, tags: (jutsu.tags ?? []).filter((tag) => canonicalTagName(tag.name) !== 'Move') }));
            } else {
                session.log.push(`${opponent.name} is outside the impact area.`);
            }
        } else {
            const secondaryTags = (jutsu.tags ?? []).filter((tag) => {
                const tagName = canonicalTagName(tag.name);
                return tagName !== 'Move'
                    && tagName !== 'Pierce'
                    && !REQUIRES_DAMAGE_TAGS.has(tagName);
            });
            if (secondaryTags.length > 0) {
                // SINGLE movement owns relocation, but authored secondary tags
                // still resolve. Keep direct damage at zero so a remote target
                // cannot be hit by a dash with no impact footprint. This mirrors
                // the authoritative PvP movement branch.
                resolution = resolutionFacts(applyCast(session, side, {
                    ...jutsu,
                    effectPower: 0,
                    tags: secondaryTags,
                }, 0));
            }
        }
    } else if (plan.groundTarget) {
        if (plan.createsGroundEffect) {
            addGroundEffect(session, side, jutsu, plan);
        } else {
            if (plan.method === 'AOE_CIRCLE' && plan.hitsOpponent) {
                session.log.push(`Area burst catches ${opponent.name}!`);
                resolution = resolutionFacts(applyCast(session, side, jutsu));
            } else {
                session.log.push(`${opponent.name} is outside the impact area.`);
            }
        }
    } else {
        resolution = resolutionFacts(applyCast(session, side, jutsu));
        payJutsuResources(session, side, plan.chakraCost, plan.staminaCost);
    }

    if (plan.cooldown > 0) session.cooldowns[side][jutsu.id] = plan.cooldown;
    session.ap[side] = Math.max(0, session.ap[side] - plan.effectiveApCost);
    session.actionsThisTurn += 1;
    checkWinner(session);
    return { applied: true, ...(resolution ? { resolution } : {}) };
}

function resolveDirectAction(session: SoloPveSession, side: SoloPveSide, action: SoloPveAction, opts: SoloPveEngineOptions): DirectActionResult {
    const self = fighter(session, side);
    const opponent = fighter(session, otherSide(side));
    if (session.status !== 'active') return { applied: false, reason: 'session-done' };
    if (session.activeSide !== side) return { applied: false, reason: 'not-your-turn' };

    if (action.type === 'summon') {
        if (side !== 'player') return { applied: false, reason: 'enemy-cannot-summon' };
        const seal = session.pendingCompanion;
        if (!seal) return { applied: false, reason: session.companion ? 'already-summoned' : 'no-companion' };
        const spot = hexNeighbors(self.pos)
            .sort((a, b) => a - b)
            .find((tile) => tile !== opponent.pos && !tileBlocked(session, tile));
        if (spot === undefined) return { applied: false, reason: 'no-space' };
        session.companion = {
            name: seal.name,
            hp: seal.hp,
            maxHp: seal.hp,
            chakra: 999,
            maxChakra: 999,
            stamina: 999,
            maxStamina: 999,
            shield: 0,
            statuses: [],
            character: { companion: true, visual: seal.petId, specialty: 'Taijutsu', level: 1, stats: {} },
            pos: spot,
            petId: seal.petId,
            baseDamage: seal.damage,
            happiness: seal.happiness,
            loyal: seal.loyal,
            moves: structuredClone(seal.moves),
            cooldowns: {},
            roundsLeft: COMPANION_FIELD_ROUNDS,
            pveGearId: seal.pveGearId,
        };
        session.pendingCompanion = undefined;
        session.companionUsage = {
            petId: seal.petId,
            ...(seal.pveGearId ? { pveGearId: seal.pveGearId } : {}),
            ...(seal.consumableId ? { consumableId: seal.consumableId } : {}),
        };
        session.log.push(`${self.name} summons ${seal.name}!`);
        const healPct = companionHealOnSummonPct(seal.pveGearId) + companionConsumableHealPct(seal.consumableId);
        if (healPct > 0) {
            const heal = Math.max(1, Math.floor(self.maxHp * healPct / 100));
            setFighter(session, side, { ...self, hp: Math.min(self.maxHp, self.hp + heal) });
            session.log.push(`${seal.name}'s bond restores ${heal} HP to ${self.name}.`);
        }
        return { applied: true };
    }
    if (action.type === 'wait') {
        session.log.push(`${self.name} ends the turn.`);
        endSoloPveTurn(session);
        return { applied: true };
    }
    if (action.type === 'move') {
        if (!canAct(session, side, MOVE_AP)) return { applied: false, reason: 'cannot-act' };
        const tile = Math.floor(action.tile);
        if (tile < 0 || tile >= GRID_W * GRID_H || !hexNeighbors(self.pos).includes(tile)) return { applied: false, reason: 'invalid-move' };
        if (tile === opponent.pos || tileBlocked(session, tile)) return { applied: false, reason: 'occupied' };
        setFighter(session, side, { ...self, pos: tile });
        spendAction(session, side, MOVE_AP);
        session.log.push(`${self.name} moves.`);
        return { applied: true };
    }
    if (action.type === 'basicAttack') {
        if (!canAct(session, side, BASIC_ATTACK_AP)) return { applied: false, reason: 'cannot-act' };
        if (hexDistance(self.pos, opponent.pos) > 1) return { applied: false, reason: 'out-of-range' };
        if (self.stamina < BASIC_ATTACK_STAMINA) return { applied: false, reason: 'no-stamina' };
        const specialty = typeof self.character.specialty === 'string' ? self.character.specialty : 'Ninjutsu';
        const basic: SoloPveJutsu = { id: 'basic-attack', name: 'Basic Attack', type: specialty, effectPower: 10, ap: BASIC_ATTACK_AP, range: 1, tags: [] };
        session.log.push(`${self.name} uses Basic Attack:`);
        const resolution = resolutionFacts(applyCast(session, side, basic));
        const updated = fighter(session, side);
        setFighter(session, side, { ...updated, stamina: Math.max(0, updated.stamina - BASIC_ATTACK_STAMINA) });
        spendAction(session, side, BASIC_ATTACK_AP);
        return { applied: true, resolution };
    }
    if (action.type === 'basicHeal') {
        if (!canAct(session, side, BASIC_HEAL_AP) || (session.cooldowns[side].basicHeal ?? 0) > 0) return { applied: false, reason: 'cannot-act' };
        if (self.chakra < BASIC_HEAL_CHAKRA) return { applied: false, reason: 'no-chakra' };
        const amount = Math.max(1, Math.floor(self.maxHp * 0.1));
        setFighter(session, side, { ...self, hp: Math.min(self.maxHp, self.hp + amount), chakra: self.chakra - BASIC_HEAL_CHAKRA });
        session.cooldowns[side].basicHeal = 5;
        spendAction(session, side, BASIC_HEAL_AP);
        session.log.push(`${self.name} uses Basic Heal, restoring ${amount} HP.`);
        return { applied: true };
    }
    if (action.type === 'clear') {
        if (!canAct(session, side, CLEAR_AP) || (session.cooldowns[side].clear ?? 0) > 0) return { applied: false, reason: 'cannot-act' };
        const blocked = activeStatuses(opponent, session.round).some((status) => status.name === 'Clear Prevent');
        if (!blocked) {
            const cleared = removeActiveCombatStatusesByKind(opponent.statuses, 'positive', session.round);
            setFighter(session, otherSide(side), { ...opponent, statuses: cleared.statuses });
        }
        session.cooldowns[side].clear = 10;
        spendAction(session, side, CLEAR_AP);
        session.log.push(blocked ? `${opponent.name}'s Clear Prevent blocks the clear.` : `${self.name} clears ${opponent.name}'s positive effects.`);
        return { applied: true };
    }
    if (action.type === 'cleanse') {
        if (!canAct(session, side, CLEANSE_AP) || (session.cooldowns[side].cleanse ?? 0) > 0) return { applied: false, reason: 'cannot-act' };
        const blocked = activeStatuses(self, session.round).some((status) => status.name === 'Cleanse Prevent');
        if (!blocked) {
            const cleansed = removeActiveCombatStatusesByKind(self.statuses, 'negative', session.round);
            setFighter(session, side, { ...self, statuses: cleansed.statuses });
        }
        session.cooldowns[side].cleanse = 10;
        spendAction(session, side, CLEANSE_AP);
        session.log.push(blocked ? `${self.name}'s Cleanse Prevent blocks the cleanse.` : `${self.name} cleanses negative effects.`);
        return { applied: true };
    }
    if (action.type === 'jutsu') {
        return applyJutsuAction(session, side, action);
    }
    if (action.type === 'weapon') {
        const item = equippedItem(self, action.itemId);
        const slot = normalizeSlot(item?.slot);
        if (!item || (slot !== 'hand' && slot !== 'thrown')) return { applied: false, reason: 'no-weapon' };
        const cost = Math.max(1, Number(item.apCost ?? 40));
        const range = Math.max(1, Number(item.weaponRange ?? (slot === 'thrown' ? 3 : 1)));
        const cooldownKey = item.id ?? item.name ?? 'weapon';
        const cooldown = Math.max(0, Math.floor(Number(item.weaponCooldown ?? 5)));
        if (!canAct(session, side, cost)) return { applied: false, reason: 'cannot-act' };
        if ((session.cooldowns[side][cooldownKey] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
        if (hexDistance(self.pos, opponent.pos) > range) return { applied: false, reason: 'out-of-range' };
        if (slot === 'thrown' && !spendItemCharge(session, item.id ?? '')) return { applied: false, reason: 'out-of-item' };
        const tags = item.weaponTags?.length ? item.weaponTags : item.weaponEffect ? [{ name: item.weaponEffect, percent: item.weaponEffectValue }] : [];
        const weapon: SoloPveJutsu = {
            id: `weapon-${item.id ?? 'equipped'}`,
            name: item.name ?? 'Weapon Attack',
            type: 'Bukijutsu',
            effectPower: Number(item.weaponEp ?? 15),
            ap: cost,
            range,
            element: item.weaponElement,
            tags,
            isUtility: false,
            weaponSwing: true,
            suppressBloodline: !characterOwnsElement(self.character, item.weaponElement),
        };
        session.log.push(`${self.name} uses ${weapon.name}:`);
        const resolution = resolutionFacts(applyCast(session, side, weapon));
        if (cooldown > 0) session.cooldowns[side][cooldownKey] = cooldown;
        spendAction(session, side, cost);
        return { applied: true, resolution };
    }
    if (action.type === 'item') {
        const item = equippedItem(self, action.itemId);
        const slot = normalizeSlot(item?.slot);
        if (!item || slot === 'hand' || slot === 'thrown') return { applied: false, reason: 'no-item' };
        const cost = Math.max(1, Number(item.apCost ?? 35));
        const cooldownKey = item.id ?? item.name ?? 'item';
        const cooldown = Math.max(0, Math.floor(Number(item.weaponCooldown ?? 0)));
        if (!canAct(session, side, cost)) return { applied: false, reason: 'cannot-act' };
        if ((session.cooldowns[side][cooldownKey] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
        if (!spendItemCharge(session, item.id ?? '')) return { applied: false, reason: 'out-of-item' };
        const restoreChakra = Math.max(0, Number(item.restoreChakra ?? 0));
        const restoreStamina = Math.max(0, Number(item.restoreStamina ?? 0));
        let resolution: CombatResolutionFacts | undefined;
        if ((restoreChakra > 0 || restoreStamina > 0) && !item.weaponEffect && !item.weaponTags?.length) {
            setFighter(session, side, {
                ...self,
                chakra: Math.min(self.maxChakra, self.chakra + restoreChakra),
                stamina: Math.min(self.maxStamina, self.stamina + restoreStamina),
            });
            session.log.push(`${self.name} uses ${item.name ?? 'an item'}.`);
        } else {
            const tags = item.weaponTags?.length ? item.weaponTags : item.weaponEffect ? [{ name: item.weaponEffect, percent: item.weaponEffectValue }] : [{ name: 'Heal' }];
            const itemJutsu: SoloPveJutsu = { id: `item-${item.id ?? 'equipped'}`, name: item.name ?? 'Item', type: 'Ninjutsu', target: 'SELF', effectPower: Number(item.weaponEp ?? 10), ap: cost, range: 0, tags };
            session.log.push(`${self.name} uses ${itemJutsu.name}:`);
            resolution = resolutionFacts(applyCast(session, side, itemJutsu));
            if (item.weaponEffectTarget === 'both' && item.weaponEffect === 'Decrease Damage Given') {
                const updated = fighter(session, side);
                const percent = Math.max(0, Number(item.weaponEffectValue ?? 0));
                setFighter(session, side, {
                    ...updated,
                    statuses: addCombatStatus(updated.statuses, {
                        name: 'Decrease Damage Given', rounds: 1, percent, kind: 'negative',
                    }, { isStackable: (name) => STACKABLE_STATUS.has(name) }),
                });
                session.log.push(`Smoke: ${updated.name} also deals ${percent}% less damage for 1 round.`);
            }
        }
        if (cooldown > 0) session.cooldowns[side][cooldownKey] = cooldown;
        spendAction(session, side, cost);
        return { applied: true, ...(resolution ? { resolution } : {}) };
    }
    if (action.type === 'flee') {
        if (session.encounter.kind === 'hollow-gate' && session.encounter.metadata?.noRetreat === true) {
            return { applied: false, reason: 'retreat-sealed' };
        }
        if (!canAct(session, side, 100)) return { applied: false, reason: 'cannot-act' };
        const hpCost = Math.max(1, Math.floor(self.maxHp * 0.1));
        setFighter(session, side, { ...self, hp: Math.max(0, self.hp - hpCost) });
        spendAction(session, side, 100);
        if (opts.escapeSucceeds?.() === true) {
            session.status = 'done';
            session.winner = 'enemy';
            session.outcome = 'fled';
            session.log.push(`${self.name} escapes, losing ${hpCost} HP.`);
        } else {
            session.log.push(`${self.name} fails to escape and loses ${hpCost} HP.`);
            checkWinner(session);
            if (session.status === 'active') endSoloPveTurn(session);
        }
        return { applied: true };
    }
    if (action.type === 'abandon') {
        // Abandon is an explicit terminal forfeit, not an escape attempt. It is
        // deliberately independent of AP and the sealed flee roll so closing an
        // unresolved battle can always settle exactly once. The same 10% max-HP
        // physical cost as an escape attempt is retained; loss settlement owns
        // any additional defeat/hospital consequences for the host mode.
        const hpCost = Math.max(1, Math.floor(self.maxHp * 0.1));
        setFighter(session, side, { ...self, hp: Math.max(0, self.hp - hpCost) });
        session.status = 'done';
        session.winner = 'enemy';
        session.outcome = 'loss';
        session.log.push(`${self.name} abandons the encounter, forfeiting the fight and losing ${hpCost} HP.`);
        return { applied: true };
    }
    return { applied: false, reason: 'unknown-action' };
}

function directAction(
    session: SoloPveSession,
    side: SoloPveSide,
    action: SoloPveAction,
    opts: SoloPveEngineOptions,
): { applied: boolean; reason?: string; event?: SoloPveCombatEvent | SoloPveRejectionEvent } {
    const before = eventSnapshot(session);
    const eventRound = session.round;
    const identity = actionIdentity(session, side, action);
    const target = eventTarget(session, side, action);
    const logStart = session.log.length;
    const result = resolveDirectAction(session, side, action, opts);
    if (!result.applied) {
        const after = eventSnapshot(session);
        return {
            ...result,
            event: {
                kind: 'rejected',
                round: eventRound,
                actor: side,
                action: action.type,
                ...identity,
                ...('tile' in action && action.tile !== undefined ? { tile: action.tile } : {}),
                reason: result.reason ?? 'rejected',
                combat: projectSoloCombatEvent({
                    session, before, after, sequence: null, roundBefore: eventRound,
                    actor: side, target, actionType: action.type, actionId: identity.actionId,
                    ...('tile' in action && action.tile !== undefined ? { tile: action.tile } : {}),
                    applied: false, rejectionReason: result.reason ?? 'rejected',
                }),
            },
        };
    }

    const actionLog = session.log.slice(logStart);
    const vfx = jutsuVfx(
        session,
        side,
        action,
        action.type === 'jutsu' && fighter(session, otherSide(side)).hp <= 0,
    );
    if (actionLog.some((line) => line.endsWith('Poison damage from exertion.'))) {
        vfx.push({ key: 'poisonCloud', target: side, anchor: 'caster' });
    }
    const after = eventSnapshot(session);
    const sequence = session.eventSeq + 1;
    const event: SoloPveCombatEvent = {
        kind: 'action',
        seq: sequence,
        round: eventRound,
        actor: side,
        target,
        action: action.type,
        ...identity,
        ...('tile' in action && action.tile !== undefined ? { tile: action.tile } : {}),
        before,
        after,
        log: actionLog,
        vfx,
        status: session.status,
        winner: session.winner,
        outcome: session.outcome,
        combat: projectSoloCombatEvent({
            session, before, after, sequence, roundBefore: eventRound,
            actor: side, target, actionType: action.type, actionId: identity.actionId,
            ...('tile' in action && action.tile !== undefined ? { tile: action.tile } : {}),
            applied: true,
            ...(result.resolution ? { resolution: result.resolution } : {}),
        }),
    };
    session.eventSeq = event.seq;
    session.events = [...session.events, event].slice(-SOLO_PVE_EVENT_HISTORY);
    session.log = trimPvpLog(session.log);
    return { ...result, event };
}

function aiTileForJutsu(session: SoloPveSession, jutsu: SoloPveJutsu): number | undefined {
    if (jutsu.target !== 'EMPTY_GROUND' && !hasMoveTag(jutsu)) return undefined;
    const range = Math.max(1, Number(jutsu.range) || 4);
    const method = normalizedMethod(jutsu);
    const tiles = Array.from({ length: GRID_W * GRID_H }, (_, tile) => tile)
        .filter((tile) => validOpenTile(session, 'enemy', tile, range))
        .sort((a, b) => {
            const aCatches = method === 'AOE_CIRCLE' ? Number(hexNeighbors(a).includes(session.player.pos)) : Number(hexDistance(a, session.player.pos) <= (method === 'AOE_SPIRAL' ? SPIRAL_RADIUS : 1));
            const bCatches = method === 'AOE_CIRCLE' ? Number(hexNeighbors(b).includes(session.player.pos)) : Number(hexDistance(b, session.player.pos) <= (method === 'AOE_SPIRAL' ? SPIRAL_RADIUS : 1));
            return bCatches - aCatches
                || hexDistance(a, session.player.pos) - hexDistance(b, session.player.pos)
                || a - b;
        });
    return tiles[0];
}

type AiJutsuCandidate = { jutsu: SoloPveJutsu; tile?: number; score: number };

function statusCount(value: PvpFighter): number {
    return activeStatuses(value, Number.MAX_SAFE_INTEGER).length;
}

function aiJutsuScore(session: SoloPveSession, jutsu: SoloPveJutsu, tile: number | undefined, smart: boolean): number {
    const self = structuredClone(session.enemy);
    const opponent = structuredClone(session.player);
    const method = normalizedMethod(jutsu);
    const move = hasMoveTag(jutsu);
    let afterSelf = self;
    let afterOpponent = opponent;
    let score = Number(jutsu.effectPower ?? 0);

    if (move && tile !== undefined) {
        afterSelf.pos = tile;
        const catches = method === 'AOE_CIRCLE' && hexNeighbors(tile).includes(opponent.pos);
        if (catches) {
            const preview = applyJutsu(afterSelf, opponent, { ...jutsu, tags: (jutsu.tags ?? []).filter((tag) => canonicalTagName(tag.name) !== 'Move') }, weatherMult(session, jutsu), session.environment.biome, session.round, guardedDamageCap(session, 'enemy'));
            afterSelf = preview.self;
            afterOpponent = preview.opponent;
        }
        score += Math.max(0, hexDistance(self.pos, opponent.pos) - hexDistance(tile, opponent.pos)) * 8;
    } else if (jutsu.target === 'EMPTY_GROUND' && tile !== undefined) {
        const catches = method === 'AOE_CIRCLE'
            ? hexNeighbors(tile).includes(opponent.pos)
            : hexDistance(tile, opponent.pos) <= (method === 'AOE_SPIRAL' ? SPIRAL_RADIUS : 1);
        if (method === 'AOE_CIRCLE' && catches) {
            const preview = applyJutsu(self, opponent, jutsu, weatherMult(session, jutsu), session.environment.biome, session.round, guardedDamageCap(session, 'enemy'));
            afterSelf = preview.self;
            afterOpponent = preview.opponent;
        }
        if (catches) score += 18;
        if (session.groundEffects.some((effect) => effect.owner === 'p2' && effect.name === jutsu.name)) score -= 35;
    } else {
        const preview = applyJutsu(self, opponent, jutsu, weatherMult(session, jutsu), session.environment.biome, session.round, guardedDamageCap(session, 'enemy'));
        afterSelf = preview.self;
        afterOpponent = preview.opponent;
    }

    if (!smart) return score;
    const damage = Math.max(0, (opponent.hp + opponent.shield) - (afterOpponent.hp + afterOpponent.shield));
    const healing = Math.max(0, afterSelf.hp - self.hp);
    const shielding = Math.max(0, afterSelf.shield - self.shield);
    const selfStatusDelta = Math.max(0, statusCount(afterSelf) - statusCount(self));
    const opponentStatusDelta = Math.max(0, statusCount(afterOpponent) - statusCount(opponent));
    score += damage * 100 / Math.max(1, opponent.maxHp);
    score += healing * 80 / Math.max(1, self.maxHp);
    score += shielding * 50 / Math.max(1, self.maxHp);
    score += (selfStatusDelta + opponentStatusDelta) * 12;

    const names = tagNames(jutsu);
    if (names.includes('Heal') && self.hp >= self.maxHp) score -= 100;
    if (names.includes('Shield') && self.shield >= self.maxHp * 0.15) score -= 50;
    for (const name of names) {
        const alreadyActive = activeStatuses(self, session.round).some((status) => status.name === name)
            || activeStatuses(opponent, session.round).some((status) => status.name === name);
        if (alreadyActive && name !== 'Wound' && name !== 'Ignition') score -= 14;
    }
    if (afterOpponent.hp <= 0) {
        const allowed = pveEasyBandAllowsLethal(
            session.difficultyGuard?.enemyLevel ?? (Number(self.character.level) || 1),
            opponent.hp / Math.max(1, opponent.maxHp),
        );
        score += allowed ? 1_000 : -10_000;
    }
    return score;
}

function aiJutsuCandidates(session: SoloPveSession): AiJutsuCandidate[] {
    const enemy = session.enemy;
    const distance = hexDistance(enemy.pos, session.player.pos);
    const level = Math.max(1, Number(enemy.character.level) || 1);
    const competence = pveAiCompetence(level, enemy.character.masterAi === true);
    return jutsuList(enemy)
        .filter((jutsu) => (session.cooldowns.enemy[jutsu.id] ?? 0) <= 0)
        .filter((jutsu) => enemy.chakra >= Math.max(0, Number(jutsu.chakraCost ?? 0)) && enemy.stamina >= Math.max(0, Number(jutsu.staminaCost ?? 0)))
        .filter((jutsu) => {
            if (jutsu.target === 'EMPTY_GROUND' || hasMoveTag(jutsu)) return aiTileForJutsu(session, jutsu) !== undefined;
            if (jutsu.target === 'SELF') return true;
            const affectsOpponent = Number(jutsu.effectPower ?? 0) > 0 || tagNames(jutsu).some((name) => OPPONENT_AFFECTING_TAGS.has(name));
            const range = Math.max(0, Number(jutsu.range ?? 0));
            return !affectsOpponent || range <= 0 || distance <= range;
        })
        .filter((jutsu) => !pveEasyBandHoldsBurst(level, session.round) || Number(jutsu.ap ?? 40) < 60)
        .filter((jutsu) => canAct(session, 'enemy', Math.max(1, Number(jutsu.ap ?? 40))))
        .map((jutsu): AiJutsuCandidate => {
            const tile = aiTileForJutsu(session, jutsu);
            return { jutsu, ...(tile === undefined ? {} : { tile }), score: aiJutsuScore(session, jutsu, tile, competence.usesSmartScorer) };
        })
        .filter((candidate) => candidate.score > -1_000)
        .sort((a, b) => b.score - a.score || a.jutsu.id.localeCompare(b.jutsu.id));
}

function aiJutsu(session: SoloPveSession): AiJutsuCandidate | null {
    return aiJutsuCandidates(session)[0] ?? null;
}

function aiTacticalAction(session: SoloPveSession): SoloPveAction | null {
    const level = Math.max(1, Number(session.enemy.character.level) || 1);
    const competence = pveAiCompetence(level, session.enemy.character.masterAi === true);
    if (Number.isFinite(competence.clearBuffThreshold)
        && canAct(session, 'enemy', CLEAR_AP)
        && (session.cooldowns.enemy.clear ?? 0) <= 0
        && pveMeaningfulBuffCount(activeStatuses(session.player, session.round)) >= competence.clearBuffThreshold) {
        return { type: 'clear' };
    }
    if (Number.isFinite(competence.cleanseSelfThreshold)
        && canAct(session, 'enemy', CLEANSE_AP)
        && (session.cooldowns.enemy.cleanse ?? 0) <= 0
        && activeStatuses(session.enemy, session.round).filter((status) => status.kind === 'negative').length >= competence.cleanseSelfThreshold) {
        return { type: 'cleanse' };
    }
    const healThreshold = competence.band === 'easy' ? 0.3 : competence.band === 'medium' ? 0.42 : 0.55;
    if (session.enemy.hp / Math.max(1, session.enemy.maxHp) <= healThreshold
        && canAct(session, 'enemy', BASIC_HEAL_AP)
        && (session.cooldowns.enemy.basicHeal ?? 0) <= 0
        && session.enemy.chakra >= BASIC_HEAL_CHAKRA) {
        return { type: 'basicHeal' };
    }
    return null;
}

function enemyMoveTowardPlayerAction(session: SoloPveSession): SoloPveAction | null {
    if (!canAct(session, 'enemy', MOVE_AP)) return null;
    const candidates = hexNeighbors(session.enemy.pos)
        .filter((tile) => tile !== session.player.pos && !session.environment.blockedTiles.includes(tile))
        .sort((a, b) => hexDistance(a, session.player.pos) - hexDistance(b, session.player.pos));
    const tile = candidates[0];
    if (tile === undefined || hexDistance(tile, session.player.pos) >= hexDistance(session.enemy.pos, session.player.pos)) return null;
    return { type: 'move', tile };
}

function moveEnemyTowardPlayer(session: SoloPveSession): boolean {
    const action = enemyMoveTowardPlayerAction(session);
    return action ? directAction(session, 'enemy', action, {}).applied : false;
}

function authoredAiRuleMatches(session: SoloPveSession, rule: ServerAiRule): boolean {
    const distance = hexDistance(session.enemy.pos, session.player.pos);
    const resourcePct = (side: SoloPveSide): number => {
        const value = fighter(session, side);
        if (rule.resource === 'ap') return session.ap[side];
        if (rule.resource === 'stamina') return value.stamina * 100 / Math.max(1, value.maxStamina);
        return value.chakra * 100 / Math.max(1, value.maxChakra);
    };
    const hasStatus = (side: SoloPveSide): boolean => activeStatuses(fighter(session, side), session.round)
        .some((status) => status.name.toLocaleLowerCase() === String(rule.status ?? '').toLocaleLowerCase());
    const recentPlayerActionMatches = (): boolean => {
        const recent = [...session.events].reverse().find((event) => event.actor === 'player');
        if (!recent || !rule.pattern) return false;
        if (rule.pattern === 'any_jutsu') return recent.action === 'jutsu';
        if (rule.pattern === 'basic_attack') return recent.action === 'basicAttack';
        if (rule.pattern === 'heal') {
            if (recent.action === 'basicHeal') return true;
            if (recent.action !== 'jutsu') return false;
            const used = jutsuList(session.player).find((jutsu) => jutsu.id === recent.actionId);
            return !!used && tagNames(used).includes('Heal');
        }
        if (rule.pattern === 'defend') {
            if (recent.action === 'clear' || recent.action === 'cleanse') return true;
            if (recent.action !== 'jutsu') return false;
            return jutsuList(session.player).some((jutsu) => jutsu.id === recent.actionId && jutsu.target === 'SELF');
        }
        return recent.action === rule.pattern;
    };
    switch (rule.condition) {
        case 'always': return true;
        case 'specific_round': return session.round === rule.value;
        case 'distance_lower_than': return distance < rule.value;
        case 'distance_higher_than': return distance > rule.value;
        case 'hp_lower_than': return session.enemy.hp * 100 / Math.max(1, session.enemy.maxHp) < rule.value;
        case 'player_hp_lower_than': return session.player.hp * 100 / Math.max(1, session.player.maxHp) < rule.value;
        case 'player_has_shield': return session.player.shield > 0;
        case 'player_has_buff': return activeStatuses(session.player, session.round).filter((status) => status.kind === 'positive').length >= rule.value;
        case 'player_low_ap': return session.ap.player < rule.value;
        case 'self_has_debuff': return activeStatuses(session.enemy, session.round).filter((status) => status.kind === 'negative').length >= rule.value;
        case 'self_resource_lower_than': return resourcePct('enemy') < rule.value;
        case 'player_resource_lower_than': return resourcePct('player') < rule.value;
        case 'self_status_present': return hasStatus('enemy');
        case 'self_status_absent': return !hasStatus('enemy');
        case 'player_status_present': return hasStatus('player');
        case 'player_status_absent': return !hasStatus('player');
        case 'cooldown_ready': return (session.cooldowns.enemy[rule.jutsuId ?? ''] ?? 0) <= 0;
        case 'cooldown_active': return (session.cooldowns.enemy[rule.jutsuId ?? ''] ?? 0) > 0;
        case 'player_recent_action': return recentPlayerActionMatches();
        // The shared authoring contract understands these conditions, while
        // Solo PvE has no ally roster, objective, or threat table. A Tower or
        // party adapter evaluates them against its sealed encounter state.
        case 'ally_count_lower_than': case 'objective_state': case 'threat_higher_than': return false;
    }
}

function authoredAiRuleAction(session: SoloPveSession, rule: ServerAiRule): SoloPveAction | null {
    const candidates = aiJutsuCandidates(session);
    if (rule.action === 'use_specific_jutsu') {
        const chosen = candidates.find((candidate) => candidate.jutsu.id === rule.jutsuId);
        return chosen ? { type: 'jutsu', jutsuId: chosen.jutsu.id, ...(chosen.tile === undefined ? {} : { tile: chosen.tile }) } : null;
    }
    if (rule.action === 'use_highest_power_jutsu' || rule.action === 'use_best_legal_jutsu') {
        const chosen = candidates[0];
        return chosen ? { type: 'jutsu', jutsuId: chosen.jutsu.id, ...(chosen.tile === undefined ? {} : { tile: chosen.tile }) } : null;
    }
    if (rule.action === 'move_towards_opponent') return enemyMoveTowardPlayerAction(session);
    if (rule.action === 'use_movement_jutsu') {
        const chosen = candidates.find((candidate) => hasMoveTag(candidate.jutsu));
        return chosen ? { type: 'jutsu', jutsuId: chosen.jutsu.id, ...(chosen.tile === undefined ? {} : { tile: chosen.tile }) } : null;
    }
    if (rule.action === 'use_basic_attack') {
        return hexDistance(session.enemy.pos, session.player.pos) <= 1
            && canAct(session, 'enemy', BASIC_ATTACK_AP)
            && session.enemy.stamina >= BASIC_ATTACK_STAMINA
            ? { type: 'basicAttack' }
            : null;
    }
    if (rule.action === 'heal') {
        const chosen = candidates.find((candidate) => tagNames(candidate.jutsu).includes('Heal'));
        if (chosen) return { type: 'jutsu', jutsuId: chosen.jutsu.id, ...(chosen.tile === undefined ? {} : { tile: chosen.tile }) };
        return canAct(session, 'enemy', BASIC_HEAL_AP)
            && (session.cooldowns.enemy.basicHeal ?? 0) <= 0
            && session.enemy.chakra >= BASIC_HEAL_CHAKRA
            ? { type: 'basicHeal' }
            : null;
    }
    if (rule.action === 'end_turn') return { type: 'wait' };
    if (rule.action === 'summon_add' || rule.action === 'hold_objective') return null;

    // Reactive counterplay remains competence-gated. Authored rules can decide
    // WHEN a capable AI counters, but cannot make easy-band opponents omniscient.
    const level = Math.max(1, Number(session.enemy.character.level) || 1);
    const competence = pveAiCompetence(level, session.enemy.character.masterAi === true);
    if (competence.band === 'easy') return null;
    if (rule.action === 'clear_player_buffs') {
        return canAct(session, 'enemy', CLEAR_AP)
            && (session.cooldowns.enemy.clear ?? 0) <= 0
            && pveMeaningfulBuffCount(activeStatuses(session.player, session.round)) > 0
            ? { type: 'clear' }
            : null;
    }
    if (rule.action === 'cleanse_self') {
        return canAct(session, 'enemy', CLEANSE_AP)
            && (session.cooldowns.enemy.cleanse ?? 0) <= 0
            && activeStatuses(session.enemy, session.round).some((status) => status.kind === 'negative')
            ? { type: 'cleanse' }
            : null;
    }
    if (rule.action === 'defend') {
        const chosen = candidates.find((candidate) => candidate.jutsu.target === 'SELF');
        return chosen ? { type: 'jutsu', jutsuId: chosen.jutsu.id, ...(chosen.tile === undefined ? {} : { tile: chosen.tile }) } : null;
    }
    if (rule.action === 'buff') {
        const chosen = candidates.find((candidate) => candidate.jutsu.target === 'SELF'
            && !tagNames(candidate.jutsu).includes('Heal')
            && !hasMoveTag(candidate.jutsu));
        return chosen ? { type: 'jutsu', jutsuId: chosen.jutsu.id, ...(chosen.tile === undefined ? {} : { tile: chosen.tile }) } : null;
    }
    return null;
}

function authoredAiAction(session: SoloPveSession): SoloPveAction | null {
    const loadoutIds = jutsuList(session.enemy).map((jutsu) => jutsu.id);
    const program = validateServerAiRules(session.enemy.character.aiRules, loadoutIds);
    if (!program.ok || program.rules.length === 0) return null;
    for (const rule of program.rules) {
        if (!authoredAiRuleMatches(session, rule)) continue;
        const action = authoredAiRuleAction(session, rule);
        // Matching is not enough: cooldown, range, resources, competence, and
        // board legality may make the action impossible. Continue deterministically
        // to the next authored rule, then the generic policy.
        if (action) return action;
    }
    return null;
}

function enemyTargetsCompanion(session: SoloPveSession): boolean {
    const companion = session.companion;
    if (!companion || companion.hp <= 0) return false;
    let weight = 0.32;
    if (hexDistance(session.enemy.pos, companion.pos) < hexDistance(session.enemy.pos, session.player.pos)) weight += 0.15;
    const lowCompanion = companion.hp / Math.max(1, companion.maxHp) < 0.4;
    if (lowCompanion) weight += 0.2;
    if (Number(session.enemy.character.level ?? 1) <= 20) weight -= 0.1;
    if (lowCompanion && session.eventSeq % 2 === 1) return true;
    return companionRoll(session) < Math.max(0, Math.min(0.7, weight));
}

function enemyActsOnCompanion(session: SoloPveSession): boolean {
    const companion = session.companion;
    if (!companion || !canAct(session, 'enemy', hexDistance(session.enemy.pos, companion.pos) > 1 ? MOVE_AP : BASIC_ATTACK_AP)) return false;
    if (hexDistance(session.enemy.pos, companion.pos) > 1) {
        const candidates = hexNeighbors(session.enemy.pos)
            .filter((tile) => tile !== session.player.pos && tile !== companion.pos && !tileBlocked(session, tile))
            .sort((a, b) => hexDistance(a, companion.pos) - hexDistance(b, companion.pos) || a - b);
        const tile = candidates.find((candidate) => hexDistance(candidate, companion.pos) < hexDistance(session.enemy.pos, companion.pos));
        return tile === undefined ? false : directAction(session, 'enemy', { type: 'move', tile }, {}).applied;
    }

    const before = eventSnapshot(session);
    const logStart = session.log.length;
    const level = Number(session.enemy.character.level ?? 1);
    const fraction = level >= 80 ? 0.3 : level >= 40 ? 0.26 : 0.22;
    let damage = Math.max(1, Math.floor(companion.maxHp * fraction));
    const ddt = activeStatuses(companion, session.round)
        .filter((status) => status.name === 'Decrease Damage Taken')
        .reduce((sum, status) => sum + Number(status.percent ?? 0), 0);
    damage = Math.floor(damage * (1 - Math.min(60, ddt) / 100));
    const absorb = activeStatuses(companion, session.round)
        .filter((status) => status.name === 'Absorb')
        .reduce((sum, status) => sum + Number(status.percent ?? 0), 0);
    damage = Math.max(0, damage - Math.floor(damage * Math.min(60, absorb) / 100));
    const resolvedDamage = damage;
    const blocked = Math.min(companion.shield, damage);
    companion.shield -= blocked;
    damage -= blocked;
    companion.hp = Math.max(0, companion.hp - damage);
    spendAction(session, 'enemy', BASIC_ATTACK_AP);
    session.log.push(`${session.enemy.name} attacks ${companion.name} for ${damage} damage${blocked ? ` (${blocked} blocked)` : ''}.`);
    if (companion.hp <= 0) {
        session.log.push(`${companion.name} is knocked out. The fight continues.`);
        session.companion = undefined;
    }
    const after = eventSnapshot(session);
    const sequence = session.eventSeq + 1;
    const event: SoloPveCombatEvent = {
        kind: 'action',
        seq: sequence,
        round: session.round,
        actor: 'enemy',
        target: 'companion',
        action: 'basicAttack',
        actionId: 'basic-attack',
        actionName: 'Basic Attack',
        before,
        after,
        log: session.log.slice(logStart),
        vfx: [{ key: 'impact', target: 'companion', anchor: 'target' }],
        status: session.status,
        winner: session.winner,
        outcome: session.outcome,
        combat: projectSoloCombatEvent({
            session, before, after, sequence, roundBefore: session.round,
            actor: 'enemy', target: 'companion', actionType: 'basicAttack', actionId: 'basic-attack', applied: true,
            resolution: { rawDamage: resolvedDamage, resolvedDamage },
        }),
    };
    session.eventSeq = event.seq;
    session.events = [...session.events, event].slice(-SOLO_PVE_EVENT_HISTORY);
    return true;
}

export function runSoloPveAiUntilPlayer(session: SoloPveSession): void {
    let guard = 0;
    while (session.status === 'active' && session.activeSide === 'enemy' && guard++ < MAX_ACTIONS + 2) {
        if (enemyTargetsCompanion(session) && enemyActsOnCompanion(session)) {
            if (session.status === 'active' && session.activeSide === 'enemy' && (session.actionsThisTurn >= MAX_ACTIONS || session.ap.enemy < 30)) endSoloPveTurn(session);
            continue;
        }
        const tactic = aiTacticalAction(session);
        const authored = tactic ? null : authoredAiAction(session);
        const jutsu = tactic || authored ? null : aiJutsu(session);
        if (tactic) {
            directAction(session, 'enemy', tactic, {});
        } else if (authored) {
            directAction(session, 'enemy', authored, {});
        } else if (jutsu) {
            directAction(session, 'enemy', { type: 'jutsu', jutsuId: jutsu.jutsu.id, ...(jutsu.tile === undefined ? {} : { tile: jutsu.tile }) }, {});
        } else if (hexDistance(session.enemy.pos, session.player.pos) <= 1 && canAct(session, 'enemy', BASIC_ATTACK_AP) && session.enemy.stamina >= BASIC_ATTACK_STAMINA) {
            directAction(session, 'enemy', { type: 'basicAttack' }, {});
        } else if (!moveEnemyTowardPlayer(session)) {
            endSoloPveTurn(session);
        }
        if (session.status === 'active' && session.activeSide === 'enemy' && (session.actionsThisTurn >= MAX_ACTIONS || session.ap.enemy < 30)) {
            endSoloPveTurn(session);
        }
    }
    if (session.status === 'active' && session.activeSide === 'enemy') endSoloPveTurn(session);
}

export function applySoloPveAction(
    source: SoloPveSession,
    action: SoloPveAction,
    opts: SoloPveEngineOptions = {},
): SoloPveActionResult {
    const session = cloneSession(source);
    const result = directAction(session, 'player', action, opts);
    if (result.applied && session.status === 'active' && session.activeSide === 'player' && !playerHasLegalAction(session)) {
        endSoloPveTurn(session);
    }
    if (result.applied && session.status === 'active' && session.activeSide === 'enemy') {
        runSoloPveCompanionPhase(session);
    }
    if (result.applied && session.status === 'active' && session.activeSide === 'enemy') {
        runSoloPveAiUntilPlayer(session);
    }
    return { ...result, session };
}
