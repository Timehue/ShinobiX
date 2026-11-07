import type { TowerActor, TowerSession } from '../towers/_tower-session.js';
import type { WorldBossContribution } from '../../shared/world-boss-event.js';
import type { WorldBossContributionResult } from './_event.js';
import type { PvpGroundEffect, PvpStatus } from '../pvp/session.js';
import { POISON_DEFAULT_PCT } from '../combat-core/formulas.js';

const EMPTY: WorldBossContribution = { actions: 0, damage: 0, healing: 0, shielding: 0, cleanses: 0, objective: 0 };
type OwnedEffect = { worldBossOwnerSlug?: string | null };

/** These annotations belong to the sealed raid, never to a client command. */
export function worldBossEffectOwner(effect: PvpStatus | PvpGroundEffect): string | null {
    return (effect as OwnedEffect).worldBossOwnerSlug ?? null;
}

export function worldBossActorOwner(session: TowerSession, actor: TowerActor): string | null {
    const humans = session.actors.filter(entry => entry.side === 'squad' && !entry.ai && entry.ownerSlug);
    if (actor.side !== 'squad') return null;
    if (actor.ownerSlug && humans.some(entry => entry.ownerSlug === actor.ownerSlug)) return actor.ownerSlug;
    // Retained solo pets have one provable owner. A retained co-op pet does not.
    return actor.character.companion === true && humans.length === 1 ? humans[0]!.ownerSlug : null;
}

/** Mark retained effects unknown before a resolver copies them, so another
 * player's next action cannot accidentally become their source. */
export function prepareWorldBossEffectOrigins(session: TowerSession): Array<PvpStatus | PvpGroundEffect> {
    const initialized: Array<PvpStatus | PvpGroundEffect> = [];
    if (!session.worldBossEvent) return initialized;
    for (const actor of session.actors) for (const effect of actor.statuses) {
        if (!Object.hasOwn(effect, 'worldBossOwnerSlug')) {
            (effect as OwnedEffect).worldBossOwnerSlug = null;
            initialized.push(effect);
        }
    }
    for (const effect of session.groundEffects ?? []) {
        if (!Object.hasOwn(effect, 'worldBossOwnerSlug')) {
            (effect as OwnedEffect).worldBossOwnerSlug = null;
            initialized.push(effect);
        }
    }
    return initialized;
}

export function stampWorldBossEffectOrigins(session: TowerSession, owner: string | null): void {
    if (!session.worldBossEvent) return;
    for (const actor of session.actors) for (const effect of actor.statuses) {
        if (!Object.hasOwn(effect, 'worldBossOwnerSlug')) (effect as OwnedEffect).worldBossOwnerSlug = owner;
    }
    for (const effect of session.groundEffects ?? []) {
        if (!Object.hasOwn(effect, 'worldBossOwnerSlug')) (effect as OwnedEffect).worldBossOwnerSlug = owner;
    }
}

export function stampWorldBossZoneStatuses(session: TowerSession, statuses: PvpStatus[], effect: PvpGroundEffect): void {
    if (!session.worldBossEvent) return;
    for (const status of statuses) if (status.source === `ground:${effect.id}`) {
        (status as OwnedEffect).worldBossOwnerSlug = worldBossEffectOwner(effect);
    }
}

function addContribution(session: TowerSession, owner: string, delta: WorldBossContribution): void {
    const contributions = new Map(Object.entries(session.worldBossContributions ?? {}));
    const prior = contributions.get(owner) ?? EMPTY;
    contributions.set(owner, Object.fromEntries(Object.keys(EMPTY).map(key => [key,
        Math.max(0, Number(prior[key as keyof WorldBossContribution]) || 0) + delta[key as keyof WorldBossContribution],
    ])) as WorldBossContribution);
    session.worldBossContributions = Object.fromEntries(contributions);
}

/** Credit exact, clamped engine damage. Unknown legacy origins still reduce
 * shared HP, but never fabricate an individual leaderboard owner. */
export function recordWorldBossSupplementalDamage(session: TowerSession, owner: string | null, damage: number): void {
    if (!session.worldBossEvent || !(damage > 0)) return;
    const applied = Math.max(0, Math.floor(damage));
    if (owner && session.actors.some(actor => actor.side === 'squad' && !actor.ai && actor.ownerSlug === owner)) {
        addContribution(session, owner, { ...EMPTY, damage: applied });
    } else {
        session.worldBossUnattributedDamage = Math.max(0, Number(session.worldBossUnattributedDamage) || 0) + applied;
    }
}

/** On-spend Poison combines the winning direct stacks or strongest zone into
 * one hit. Divide that exact hit proportionally; the last stack takes rounding. */
export function recordWorldBossPoisonDamage(session: TowerSession, statuses: readonly PvpStatus[], damage: number): void {
    recordWorldBossStatusDamage(session, statuses, damage, POISON_DEFAULT_PCT);
}

/** Split one resolver hit between its actual status sources, including a capped
 * sum of Reflect stacks. Never use the defender as a substitute for the caster. */
export function recordWorldBossStatusDamage(session: TowerSession, statuses: readonly PvpStatus[], damage: number, defaultPct = 0): void {
    const weighted = statuses.map(status => ({ status, weight: Math.max(0, status.percent ?? defaultPct) })).filter(entry => entry.weight > 0);
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    if (!total) return recordWorldBossSupplementalDamage(session, null, damage);
    let remaining = Math.max(0, Math.floor(damage));
    for (const [index, entry] of weighted.entries()) {
        const share = index === weighted.length - 1 ? remaining : Math.min(remaining, Math.floor(damage * entry.weight / total));
        recordWorldBossSupplementalDamage(session, worldBossEffectOwner(entry.status), share);
        remaining -= share;
    }
}
type ActorSnapshot = Pick<TowerActor, 'id' | 'side' | 'hp' | 'shield'> & { negativeStatuses: number };
export type WorldBossContributionSnapshot = { actors: ActorSnapshot[]; objective: string };

function negativeStatuses(actor: TowerActor): number {
    return actor.statuses.filter(status => status.kind === 'negative').length;
}

export function snapshotWorldBossContribution(session: TowerSession): WorldBossContributionSnapshot {
    return {
        actors: session.actors.map(actor => ({
            id: actor.id,
            side: actor.side,
            hp: actor.hp,
            shield: actor.shield,
            negativeStatuses: negativeStatuses(actor),
        })),
        objective: JSON.stringify(session.objectiveState ?? {}),
    };
}

function positiveDelta(before: number, after: number): number {
    return Math.max(0, Math.round(before - after));
}

/** Credit is attached to the verified Tower actor that submitted the action. */
export function recordWorldBossContribution(session: TowerSession, actorId: string, before: WorldBossContributionSnapshot, countAction = true): void {
    if (!session.worldBossEvent) return;
    const actor = session.actors.find(entry => entry.id === actorId);
    if (!actor || actor.side !== 'squad') return;
    const owner = worldBossActorOwner(session, actor);
    const previous = new Map(before.actors.map(entry => [entry.id, entry]));
    const bossId = session.phaseState.bossId;
    let damage = 0;
    let healing = 0;
    let shielding = 0;
    let cleanses = 0;
    for (const current of session.actors) {
        const prior = previous.get(current.id);
        if (!prior) continue;
        if (current.id === bossId) damage += positiveDelta(prior.hp, current.hp);
        if (current.side === 'squad' || current.side === 'npc') {
            healing += positiveDelta(current.hp, prior.hp);
            shielding += positiveDelta(current.shield, prior.shield);
            cleanses += Math.max(0, prior.negativeStatuses - negativeStatuses(current));
        }
    }
    const objective = before.objective === JSON.stringify(session.objectiveState ?? {}) ? 0 : 1;
    if (owner) addContribution(session, owner, { actions: countAction ? 1 : 0, damage, healing, shielding, cleanses, objective });
    else recordWorldBossSupplementalDamage(session, null, damage);
}

export function scoreWorldBossContribution(raw: Partial<WorldBossContribution> | null | undefined): WorldBossContributionResult {
    const contribution: WorldBossContribution = {
        actions: Math.max(0, Math.floor(Number(raw?.actions) || 0)),
        damage: Math.max(0, Math.round(Number(raw?.damage) || 0)),
        healing: Math.max(0, Math.round(Number(raw?.healing) || 0)),
        shielding: Math.max(0, Math.round(Number(raw?.shielding) || 0)),
        cleanses: Math.max(0, Math.floor(Number(raw?.cleanses) || 0)),
        objective: Math.max(0, Math.floor(Number(raw?.objective) || 0)),
    };
    const score = Math.round(
        Math.min(12_000, contribution.damage) * 0.02
        + Math.min(5_000, contribution.healing) * 0.04
        + Math.min(5_000, contribution.shielding) * 0.03
        + Math.min(4, contribution.cleanses) * 40
        + Math.min(3, contribution.objective) * 75,
    );
    return { ...contribution, score, active: contribution.actions > 0 && score >= 60 };
}
