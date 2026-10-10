import type { TowerActor, TowerSession } from '../towers/_tower-session.js';
import type { WorldBossContribution } from '../../shared/world-boss-event.js';
import type { WorldBossContributionResult } from './_event.js';

const EMPTY: WorldBossContribution = { actions: 0, damage: 0, healing: 0, shielding: 0, cleanses: 0, objective: 0 };
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
export function recordWorldBossContribution(session: TowerSession, actorId: string, before: WorldBossContributionSnapshot): void {
    if (!session.worldBossEvent) return;
    const actor = session.actors.find(entry => entry.id === actorId);
    if (!actor?.ownerSlug || actor.side !== 'squad') return;
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
    const contributions = session.worldBossContributions ?? {};
    const prior = contributions[actor.ownerSlug] ?? EMPTY;
    contributions[actor.ownerSlug] = {
        actions: prior.actions + 1,
        damage: prior.damage + damage,
        healing: prior.healing + healing,
        shielding: prior.shielding + shielding,
        cleanses: prior.cleanses + cleanses,
        objective: prior.objective + objective,
    };
    session.worldBossContributions = contributions;
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
