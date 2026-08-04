import { COMBAT_RESOURCES_V2, v2PoisonOnSpend, v2ResourceRegen } from '../_combat-resources.js';
import { pveEasyBandHoldsBurst, pveGuardedEnemyHit } from '../_pve-difficulty.js';
import { MAX_ACTIONS, MAX_ROUNDS, GRID_H, GRID_W } from '../combat-core/constants.js';
import { tickCombatCooldowns } from '../combat-core/cooldowns.js';
import { weatherMultiplier } from '../combat-core/formulas.js';
import { hexDistance, hexNeighbors } from '../combat-core/grid.js';
import { adjustedApCost } from '../combat-core/resources.js';
import { activeCombatStatuses } from '../combat-core/statuses.js';
import type { CombatFxEvent } from '../combat-core/types.js';
import {
    applyDoTs,
    applyGroundEffectToFighter,
    applyJutsu,
    tickGroundEffects,
    tickStatuses,
} from '../pvp/move.js';
import { characterOwnsElement } from '../pvp/_elements.js';
import type { PvpFighter, PvpGroundEffect } from '../pvp/session.js';
import {
    type SoloPveAction,
    type SoloPveActionResult,
    type SoloPveItem,
    type SoloPveJutsu,
    type SoloPveSession,
    type SoloPveSide,
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
    return structuredClone(session);
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

function activeStatuses(value: PvpFighter, round: number) {
    return activeCombatStatuses(value.statuses, round);
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
        value = { ...value, statuses: value.statuses.filter((status) => status.name !== 'Stun' && status.name !== 'Stunned') };
    }
    setFighter(session, side, value);
    session.activeSide = side;
    session.ap[side] = stunned ? 60 : 100;
    session.actionsThisTurn = 0;
    if (side === 'enemy' && session.difficultyGuard) {
        session.difficultyGuard.playerHpTurnStart = session.player.hp;
        session.difficultyGuard.dealtThisTurn = 0;
    }
    checkWinner(session);
}

export function endSoloPveTurn(session: SoloPveSession): void {
    if (session.status !== 'active') return;
    const current = session.activeSide;
    setFighter(session, current, tickStatuses(fighter(session, current), session.round));
    session.cooldowns[current] = tickCombatCooldowns(session.cooldowns[current]);
    if (current === 'enemy') {
        session.groundEffects = tickGroundEffects(session.groundEffects);
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
    if (side !== 'enemy' || !session.difficultyGuard) return undefined;
    return pveGuardedEnemyHit(Number.MAX_SAFE_INTEGER, {
        enemyLevel: session.difficultyGuard.enemyLevel,
        playerMaxHp: session.player.maxHp,
        playerHpTurnStart: session.difficultyGuard.playerHpTurnStart,
        dealtThisTurn: session.difficultyGuard.dealtThisTurn,
    });
}

function applyCast(session: SoloPveSession, side: SoloPveSide, jutsu: SoloPveJutsu): void {
    const self = fighter(session, side);
    const opponent = fighter(session, otherSide(side));
    const result = applyJutsu(
        self,
        opponent,
        jutsu as Parameters<typeof applyJutsu>[2],
        weatherMult(session, jutsu),
        session.environment.biome,
        session.round,
        guardedDamageCap(session, side),
    );
    setFighter(session, side, result.self);
    setFighter(session, otherSide(side), result.opponent);
    session.log.push(...result.lines);
    appendFx(session, side, result.fx);
    if (side === 'enemy' && session.difficultyGuard) {
        session.difficultyGuard.dealtThisTurn += Math.max(0, Math.floor(result.metadata.damage ?? 0));
    }
    checkWinner(session);
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

function directAction(session: SoloPveSession, side: SoloPveSide, action: SoloPveAction, opts: SoloPveEngineOptions): { applied: boolean; reason?: string } {
    const self = fighter(session, side);
    const opponent = fighter(session, otherSide(side));
    if (session.status !== 'active') return { applied: false, reason: 'session-done' };
    if (session.activeSide !== side) return { applied: false, reason: 'not-your-turn' };

    if (action.type === 'wait') {
        session.log.push(`${self.name} ends the turn.`);
        endSoloPveTurn(session);
        return { applied: true };
    }
    if (action.type === 'move') {
        if (!canAct(session, side, MOVE_AP)) return { applied: false, reason: 'cannot-act' };
        const tile = Math.floor(action.tile);
        if (tile < 0 || tile >= GRID_W * GRID_H || !hexNeighbors(self.pos).includes(tile)) return { applied: false, reason: 'invalid-move' };
        if (tile === opponent.pos || session.environment.blockedTiles.includes(tile)) return { applied: false, reason: 'occupied' };
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
        applyCast(session, side, basic);
        const updated = fighter(session, side);
        setFighter(session, side, { ...updated, stamina: Math.max(0, updated.stamina - BASIC_ATTACK_STAMINA) });
        spendAction(session, side, BASIC_ATTACK_AP);
        return { applied: true };
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
        if (!blocked) setFighter(session, otherSide(side), { ...opponent, statuses: opponent.statuses.filter((status) => status.kind !== 'positive') });
        session.cooldowns[side].clear = 10;
        spendAction(session, side, CLEAR_AP);
        session.log.push(blocked ? `${opponent.name}'s Clear Prevent blocks the clear.` : `${self.name} clears ${opponent.name}'s positive effects.`);
        return { applied: true };
    }
    if (action.type === 'cleanse') {
        if (!canAct(session, side, CLEANSE_AP) || (session.cooldowns[side].cleanse ?? 0) > 0) return { applied: false, reason: 'cannot-act' };
        const blocked = activeStatuses(self, session.round).some((status) => status.name === 'Cleanse Prevent');
        if (!blocked) setFighter(session, side, { ...self, statuses: self.statuses.filter((status) => status.kind !== 'negative') });
        session.cooldowns[side].cleanse = 10;
        spendAction(session, side, CLEANSE_AP);
        session.log.push(blocked ? `${self.name}'s Cleanse Prevent blocks the cleanse.` : `${self.name} cleanses negative effects.`);
        return { applied: true };
    }
    if (action.type === 'jutsu') {
        const jutsu = jutsuList(self).find((entry) => entry.id === action.jutsuId);
        if (!jutsu) return { applied: false, reason: 'no-jutsu' };
        if (jutsu.target === 'EMPTY_GROUND' || (jutsu.tags ?? []).some((tag) => tag.name === 'Move')) {
            return { applied: false, reason: 'unsupported-targeting' };
        }
        const cost = Math.max(1, Number(jutsu.ap ?? 40));
        if (!canAct(session, side, cost)) return { applied: false, reason: 'cannot-act' };
        if ((session.cooldowns[side][jutsu.id] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
        const chakra = Math.max(0, Number(jutsu.chakraCost ?? 0));
        const stamina = Math.max(0, Number(jutsu.staminaCost ?? 0));
        if (self.chakra < chakra) return { applied: false, reason: 'no-chakra' };
        if (self.stamina < stamina) return { applied: false, reason: 'no-stamina' };
        const selfTarget = jutsu.target === 'SELF';
        if (!selfTarget && hexDistance(self.pos, opponent.pos) > Math.max(1, Number(jutsu.range ?? 1))) return { applied: false, reason: 'out-of-range' };
        const basicElements = new Set(['Earth', 'Wind', 'Water', 'Lightning', 'Fire']);
        if (jutsu.element && basicElements.has(jutsu.element) && activeStatuses(self, session.round).some((status) => status.name === 'Elemental Seal')) {
            return { applied: false, reason: 'elementally-sealed' };
        }
        session.log.push(`${self.name} uses ${jutsu.name}:`);
        applyCast(session, side, jutsu);
        const updated = fighter(session, side);
        setFighter(session, side, { ...updated, chakra: Math.max(0, updated.chakra - chakra), stamina: Math.max(0, updated.stamina - stamina) });
        spendPoison(session, side, chakra, stamina);
        if ((jutsu.cooldown ?? 0) > 0) session.cooldowns[side][jutsu.id] = Math.floor(jutsu.cooldown!);
        spendAction(session, side, cost);
        return { applied: true };
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
            suppressBloodline: !characterOwnsElement(self.character, item.weaponElement),
        };
        session.log.push(`${self.name} uses ${weapon.name}:`);
        applyCast(session, side, weapon);
        if (cooldown > 0) session.cooldowns[side][cooldownKey] = cooldown;
        spendAction(session, side, cost);
        return { applied: true };
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
            applyCast(session, side, itemJutsu);
        }
        if (cooldown > 0) session.cooldowns[side][cooldownKey] = cooldown;
        spendAction(session, side, cost);
        return { applied: true };
    }
    if (action.type === 'flee') {
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
    return { applied: false, reason: 'unknown-action' };
}

function aiJutsu(session: SoloPveSession): SoloPveJutsu | null {
    const enemy = session.enemy;
    const distance = hexDistance(enemy.pos, session.player.pos);
    return jutsuList(enemy)
        .filter((jutsu) => jutsu.target !== 'EMPTY_GROUND' && !(jutsu.tags ?? []).some((tag) => tag.name === 'Move'))
        .filter((jutsu) => (session.cooldowns.enemy[jutsu.id] ?? 0) <= 0)
        .filter((jutsu) => enemy.chakra >= Math.max(0, Number(jutsu.chakraCost ?? 0)) && enemy.stamina >= Math.max(0, Number(jutsu.staminaCost ?? 0)))
        .filter((jutsu) => jutsu.target === 'SELF' || distance <= Math.max(1, Number(jutsu.range ?? 1)))
        .filter((jutsu) => !pveEasyBandHoldsBurst(session.difficultyGuard?.enemyLevel ?? 999, session.round) || Number(jutsu.ap ?? 40) < 60)
        .filter((jutsu) => canAct(session, 'enemy', Math.max(1, Number(jutsu.ap ?? 40))))
        .sort((a, b) => Number(b.effectPower ?? 0) - Number(a.effectPower ?? 0))[0] ?? null;
}

function moveEnemyTowardPlayer(session: SoloPveSession): boolean {
    if (!canAct(session, 'enemy', MOVE_AP)) return false;
    const candidates = hexNeighbors(session.enemy.pos)
        .filter((tile) => tile !== session.player.pos && !session.environment.blockedTiles.includes(tile))
        .sort((a, b) => hexDistance(a, session.player.pos) - hexDistance(b, session.player.pos));
    const tile = candidates[0];
    if (tile === undefined || hexDistance(tile, session.player.pos) >= hexDistance(session.enemy.pos, session.player.pos)) return false;
    return directAction(session, 'enemy', { type: 'move', tile }, {}).applied;
}

export function runSoloPveAiUntilPlayer(session: SoloPveSession): void {
    let guard = 0;
    while (session.status === 'active' && session.activeSide === 'enemy' && guard++ < MAX_ACTIONS + 2) {
        const jutsu = aiJutsu(session);
        if (jutsu) {
            directAction(session, 'enemy', { type: 'jutsu', jutsuId: jutsu.id }, {});
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
    if (result.applied && session.status === 'active' && session.activeSide === 'enemy') {
        runSoloPveAiUntilPlayer(session);
    }
    return { ...result, session };
}
