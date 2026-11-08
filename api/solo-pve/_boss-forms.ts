/**
 * Solo-PvE adapter for multi-stage boss transformations
 * (shared/boss-transformations.ts owns the rules).
 *
 * The engine calls in at four points, all inside the same persisted session:
 *   - checkWinner           → guardBossFormLethal: a blow that would defeat the
 *                             boss while a form is pending leaves it at 1 HP.
 *   - after each action and at each turn start
 *                           → syncSoloPveBossForms: enter crossed forms (once),
 *                             heal, swap the kit, re-aim the AI, swap the art,
 *                             and break a charge the player has answered.
 *   - the boss's turn start → soloPveBossTurnStart: detonate or arm a charge.
 *   - the boss's turn end   → soloPveBossTurnEnd: a released limiter burns.
 *
 * The transformation is applied at stable points rather than inside a cast,
 * because a cast holds copies of both fighters and writes them back; a heal
 * applied in the middle of one could be overwritten by the stale copy.
 * Player resources, statuses and cooldowns are never touched.
 */
import {
    applyMovesetDelta,
    bossBurnLabel,
    bossChargeTurn,
    bossFormDamageMult,
    bossFormDamageTakenMult,
    bossFormFavoredJutsu,
    bossLimitBurn,
    checkBossChargeBreak,
    createBossTransformationState,
    enterBossForms,
    holdBossAtLethal,
    validateBossTransformationPlan,
    type BossTransformationPlan,
} from '../../shared/boss-transformations.js';
import type { ServerAiRule } from '../combat-core/ai-authoring.js';
import { activeCombatStatuses } from '../combat-core/statuses.js';
import type { SoloPveJutsu, SoloPveSession } from './_session.js';

export function isBossTransformationPlan(value: unknown): value is BossTransformationPlan {
    return !!value && typeof value === 'object'
        && typeof (value as BossTransformationPlan).id === 'string'
        && Array.isArray((value as BossTransformationPlan).phases);
}

/**
 * Seal a plan and the jutsu its forms learn into a freshly built session.
 * `formJutsu` must already carry the costs the boss's own kit was sealed with.
 */
export function sealSoloPveBossForms(
    session: SoloPveSession,
    plan: BossTransformationPlan,
    formJutsu: readonly SoloPveJutsu[],
    masteryLevel: number,
): void {
    const problems = validateBossTransformationPlan(plan);
    if (problems.length) throw new Error(`Invalid boss transformation plan: ${problems[0]}`);
    const learnable = new Set(plan.phases.flatMap(phase => phase.moveset?.add ?? []));
    const byId = Object.fromEntries(formJutsu.filter(jutsu => learnable.has(jutsu.id)).map(jutsu => [jutsu.id, structuredClone(jutsu)]));
    const missing = [...learnable].filter(id => !byId[id]);
    if (missing.length) throw new Error(`Boss transformation ${plan.id} cannot resolve ${missing.join(', ')}`);
    session.bossForms = createBossTransformationState(plan);
    session.bossFormKit = { jutsu: byId, masteryLevel: Math.max(0, Math.floor(masteryLevel)) };
}

/** Outgoing (side 'enemy') or incoming (side 'player') multiplier for a cast. */
export function soloPveBossFormMultiplier(
    session: SoloPveSession,
    side: 'player' | 'enemy',
    attack?: { type?: unknown; element?: unknown },
): number {
    if (!session.bossForms) return 1;
    return side === 'enemy'
        ? bossFormDamageMult(session.bossForms)
        : bossFormDamageTakenMult(session.bossForms, session.round, attack);
}

/** Inside checkWinner: never let a pending transformation be skipped by a KO. */
export function guardBossFormLethal(session: SoloPveSession): void {
    const state = session.bossForms;
    if (!state || session.status !== 'active' || session.enemy.hp > 0 || session.enemy.unlimitedHealth) return;
    if (session.player.hp <= 0) return; // a double KO stays a draw
    const hp = holdBossAtLethal(state, session.enemy.hp, session.enemy.maxHp);
    if (hp !== undefined) session.enemy = { ...session.enemy, hp };
}

function isStunned(session: SoloPveSession): boolean {
    return activeCombatStatuses(session.enemy.statuses, session.round)
        .some(status => status.name === 'Stun' || status.name === 'Stunned');
}

/** Enter crossed forms and break an answered charge. Idempotent. */
export function syncSoloPveBossForms(session: SoloPveSession): void {
    const state = session.bossForms;
    if (!state || session.status !== 'active') return;
    const broken = checkBossChargeBreak(state, session.enemy, session.round, isStunned(session));
    if (broken) {
        session.log.push(`${session.enemy.name}'s ${broken.name} is broken! ${session.enemy.name} staggers and takes extra damage until the end of the next round.`);
    }
    const effects = enterBossForms(state, session.enemy, session.round);
    if (!effects) return;
    const character = { ...session.enemy.character };
    if (effects.landing.portrait) character.avatarImage = effects.landing.portrait;
    const kit = Array.isArray(character.jutsu) ? character.jutsu as SoloPveJutsu[] : [];
    const learnedEntries = session.bossFormKit?.jutsu ?? {};
    const ids = applyMovesetDelta(kit.map(jutsu => jutsu.id), effects.learned, effects.forgotten);
    const byId = new Map(kit.map(jutsu => [jutsu.id, jutsu]));
    const nextKit = ids.map(id => byId.get(id) ?? learnedEntries[id]).filter((jutsu): jutsu is SoloPveJutsu => !!jutsu);
    character.jutsu = nextKit;
    const mastery = Array.isArray(character.jutsuMastery) ? character.jutsuMastery as Array<{ jutsuId: string; level: number }> : [];
    const masteryLevel = session.bossFormKit?.masteryLevel ?? mastery[0]?.level ?? 0;
    character.jutsuMastery = nextKit.map(jutsu => mastery.find(entry => entry.jutsuId === jutsu.id) ?? { jutsuId: jutsu.id, level: masteryLevel });
    // Change attack priorities: the form opens with its favoured signatures
    // whenever they are ready, ahead of any rule the base form carried. Rules
    // that named a technique the form dropped are removed so the program stays valid.
    const kept = (Array.isArray(character.aiRules) ? character.aiRules as ServerAiRule[] : [])
        .filter(rule => !rule.jutsuId || ids.includes(rule.jutsuId));
    const favored = bossFormFavoredJutsu(state).filter(id => ids.includes(id)).map((id): ServerAiRule => ({
        condition: 'cooldown_ready', value: 0, action: 'use_specific_jutsu', jutsuId: id, target: 'opponent',
    }));
    character.aiRules = [...favored, ...kept.filter(rule => !favored.some(f => f.jutsuId === rule.jutsuId && rule.action === 'use_specific_jutsu'))];
    // Newly learned techniques start ready; techniques the form dropped forget their timers.
    const cooldowns = { ...session.cooldowns.enemy };
    for (const id of [...effects.learned, ...effects.forgotten]) delete cooldowns[id];
    session.cooldowns = { ...session.cooldowns, enemy: cooldowns };
    session.enemy = { ...session.enemy, hp: effects.hp, character };
    session.log.push(...effects.log);
}

/** At the start of the boss's turn: release a charge from last turn, or begin one. */
export function soloPveBossTurnStart(session: SoloPveSession): void {
    const state = session.bossForms;
    if (!state || session.status !== 'active') return;
    const turn = bossChargeTurn(state, session.enemy, session.round);
    if (!turn) return;
    if (turn.kind === 'armed') {
        session.log.push(`${session.enemy.name} begins gathering ${turn.charge.name}! Deal ${turn.charge.breakAt} damage or stun them before their next turn to break it.`);
        return;
    }
    const player = session.player;
    const damage = Math.max(1, Math.floor((player.maxHp * turn.damagePct) / 100));
    const absorbed = Math.min(Math.max(0, player.shield), damage);
    const taken = damage - absorbed;
    session.player = { ...player, shield: player.shield - absorbed, hp: Math.max(0, player.hp - taken) };
    session.log.push(`${session.enemy.name} releases ${turn.charge.name}! ${player.name} takes ${taken} damage${absorbed ? ` (${absorbed} absorbed by shield)` : ''}.`);
}

/** At the end of the boss's turn: a released limiter burns its own health. */
export function soloPveBossTurnEnd(session: SoloPveSession): void {
    const state = session.bossForms;
    if (!state || session.status !== 'active') return;
    const burn = bossLimitBurn(state, session.enemy);
    if (burn <= 0) return;
    session.enemy = { ...session.enemy, hp: session.enemy.hp - burn };
    session.log.push(`${bossBurnLabel(state)} costs ${session.enemy.name} ${burn} HP (${session.enemy.hp}/${session.enemy.maxHp}).`);
}
