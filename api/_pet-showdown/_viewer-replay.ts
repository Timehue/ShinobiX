import type { ShowdownEvent, ShowdownReplayScript, ShowdownStateView } from '../../shared/pet-showdown-contract.js';

/** Present the same sealed fight from the other seat; never simulate or score it again. */
export function replayFromOpposingSide(script: ShowdownReplayScript, opposingName: string): ShowdownReplayScript {
    const side = (value: 'player' | 'enemy') => value === 'player' ? 'enemy' as const : 'player' as const;
    const state = (view: ShowdownStateView): ShowdownStateView => ({
        ...view,
        player: view.enemy,
        enemy: view.player,
        enemyTeamName: opposingName,
        outcome: view.outcome === null ? null : view.outcome === 'win' ? 'loss' : 'win',
    });
    const event = (entry: ShowdownEvent): ShowdownEvent => {
        switch (entry.t) {
            case 'action': case 'skip': case 'confused': return { ...entry, actorSide: side(entry.actorSide) };
            case 'consumable': case 'switch': return { ...entry, side: side(entry.side) };
            case 'dot': return { ...entry, targetSide: side(entry.targetSide) };
            case 'end': return { ...entry, outcome: entry.outcome === 'win' ? 'loss' : 'win' };
            case 'roundStart': case 'roundEnd': return entry;
            default: { const exhaustive: never = entry; return exhaustive; }
        }
    };
    return { initialState: state(script.initialState), finalState: state(script.finalState), events: script.events.map(event) };
}
