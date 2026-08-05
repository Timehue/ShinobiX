import type { ClanBossContribution, ClanBossContributionResult } from '../../shared/clan-boss-operation.js';
import type { TowerActor, TowerSession } from '../towers/_tower-session.js';

const EMPTY: ClanBossContribution = { actions: 0, damage: 0, healing: 0, shielding: 0, cleanses: 0, objective: 0 };

type ActorSnapshot = Pick<TowerActor, 'id' | 'side' | 'hp' | 'shield'> & { negativeStatuses: number };
export type ContributionSnapshot = {
    actors: ActorSnapshot[];
    objective: string;
};

function negativeStatuses(actor: TowerActor): number {
    return actor.statuses.filter((status) => status.kind === 'negative').length;
}

export function snapshotContributionState(session: TowerSession): ContributionSnapshot {
    return {
        actors: session.actors.map((actor) => ({
            id: actor.id,
            side: actor.side,
            hp: actor.hp,
            shield: actor.shield,
            negativeStatuses: negativeStatuses(actor),
        })),
        objective: JSON.stringify(session.objectiveState ?? {}),
    };
}

function nonNegativeDelta(before: number, after: number): number {
    return Math.max(0, Math.round(after - before));
}

export function recordClanBossContribution(session: TowerSession, actorId: string, before: ContributionSnapshot): void {
    if (!session.runId.startsWith('cboss-')) return;
    const actor = session.actors.find((entry) => entry.id === actorId);
    if (!actor?.ownerSlug || actor.side !== 'squad') return;
    const previous = new Map(before.actors.map((entry) => [entry.id, entry]));
    let damage = 0;
    let healing = 0;
    let shielding = 0;
    let cleanses = 0;
    for (const current of session.actors) {
        const prior = previous.get(current.id);
        if (!prior) continue;
        if (current.side === 'enemy') damage += nonNegativeDelta(current.hp, prior.hp);
        if (current.side === 'squad' || current.side === 'npc') {
            healing += nonNegativeDelta(prior.hp, current.hp);
            shielding += nonNegativeDelta(prior.shield, current.shield);
            cleanses += nonNegativeDelta(negativeStatuses(current), prior.negativeStatuses);
        }
    }
    const objective = before.objective === JSON.stringify(session.objectiveState ?? {}) ? 0 : 1;
    const contributions = session.clanBossContributions ?? {};
    const prior = contributions[actor.ownerSlug] ?? EMPTY;
    contributions[actor.ownerSlug] = {
        actions: prior.actions + 1,
        damage: prior.damage + damage,
        healing: prior.healing + healing,
        shielding: prior.shielding + shielding,
        cleanses: prior.cleanses + cleanses,
        objective: prior.objective + objective,
    };
    session.clanBossContributions = contributions;
}

export function scoreClanBossContribution(raw: Partial<ClanBossContribution> | null | undefined, survived: boolean): ClanBossContributionResult {
    const contribution: ClanBossContribution = {
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
        + Math.min(3, contribution.objective) * 75
        + Math.min(20, contribution.actions) * 10
        + (survived ? 50 : 0),
    );
    const active = contribution.actions > 0 && score >= 60;
    const threshold = !active ? 'none' : score >= 500 ? 'elite' : score >= 220 ? 'veteran' : 'field';
    return { ...contribution, score, active, survived, threshold };
}

export function projectClanBossContributions(session: TowerSession): Record<string, ClanBossContributionResult> {
    const output: Record<string, ClanBossContributionResult> = {};
    for (const actor of session.actors.filter((entry) => entry.side === 'squad' && !!entry.ownerSlug)) {
        output[actor.ownerSlug!] = scoreClanBossContribution(session.clanBossContributions?.[actor.ownerSlug!], actor.hp > 0);
    }
    return output;
}
