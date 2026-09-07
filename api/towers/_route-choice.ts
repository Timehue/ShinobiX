import type { TowerSession } from './_tower-session.js';

export type TowerRouteChoiceId = 'rest-shrine' | 'focused-assault' | 'elite-shortcut';

export type TowerRouteChoice = {
    id: TowerRouteChoiceId;
    label: string;
    summary: string;
    scoreMultiplier: number;
};

export const TOWER_ROUTE_CHOICES: Record<TowerRouteChoiceId, TowerRouteChoice> = {
    'rest-shrine': {
        id: 'rest-shrine',
        label: 'Rest Shrine',
        summary: 'The squad enters with a 12% max-HP barrier.',
        scoreMultiplier: 1,
    },
    'focused-assault': {
        id: 'focused-assault',
        label: 'Focused Assault',
        summary: 'The squad deals 10% more damage for the opening three rounds.',
        scoreMultiplier: 1,
    },
    'elite-shortcut': {
        id: 'elite-shortcut',
        label: 'Elite Shortcut',
        summary: 'Enemies gain 18% HP and 10% damage; a clear earns 25% more score.',
        scoreMultiplier: 1.25,
    },
};

export function parseTowerRouteChoice(value: unknown): TowerRouteChoiceId {
    const id = String(value ?? 'rest-shrine') as TowerRouteChoiceId;
    return Object.prototype.hasOwnProperty.call(TOWER_ROUTE_CHOICES, id) ? id : 'rest-shrine';
}

/** Apply one run-sealed Story route before round one. This mutates only the
 * newly-created server session; the client can never alter it after entry. */
export function applyTowerRouteChoice(session: TowerSession, requested: unknown): TowerRouteChoice {
    const choice = TOWER_ROUTE_CHOICES[parseTowerRouteChoice(requested)];
    session.routeChoice = { ...choice };

    const squad = session.actors.filter(actor => actor.side === 'squad');
    if (choice.id === 'rest-shrine') {
        for (const actor of squad) {
            const barrier = Math.max(1, Math.floor(actor.maxHp * 0.12));
            actor.shield += barrier;
        }
    } else if (choice.id === 'focused-assault') {
        for (const actor of squad) {
            actor.statuses.push({
                name: 'Increase Damage Given',
                source: choice.label,
                rounds: 3,
                activeRound: 1,
                percent: 10,
                kind: 'positive',
            });
        }
    } else {
        for (const actor of session.actors.filter(candidate => candidate.side === 'enemy')) {
            actor.maxHp = Math.max(1, Math.ceil(actor.maxHp * 1.18));
            actor.hp = actor.maxHp;
            actor.character = {
                ...actor.character,
                towerDmgScale: Math.max(0, Number(actor.character.towerDmgScale ?? 1)) * 1.1,
            };
        }
    }

    session.log.push(`Route chosen: ${choice.label}. ${choice.summary}`);
    return choice;
}

export function towerRouteScoreMultiplier(session: Pick<TowerSession, 'routeChoice'>): number {
    if (!session.routeChoice) return 1;
    return TOWER_ROUTE_CHOICES[parseTowerRouteChoice(session.routeChoice.id)].scoreMultiplier;
}
