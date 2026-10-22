import { createMatch, CHRONICLE_FIXED_FALLBACK_DECK, CHRONICLE_RULES_VERSION, type ChronicleMatch } from '../../shared/chronicle-duel.js';
import { advanceAi, type AiMatchSession } from '../card-clash/_ai-engine.js';

export const STOP_DUELISTS = ['Traveler Neri', 'Traveler Sada'] as const;
export type StopGame = { rulesVersion: number; turns: { player: string; turn: number; life: readonly [number, number] }[]; winner?: string; finished: boolean };
const cached = new Map<number, StopGame>();
const flip = <T>(key: T): T => (key === 'p1' ? 'p2' : key === 'p2' ? 'p1' : key) as T;
/** The production Keeper plays p2. Relabel both sides, including responses and
 * field owners, to let it play the other seat under the same Chronicle rules. */
function swap(state: ChronicleMatch): ChronicleMatch {
    const next = structuredClone(state);
    [next.p1, next.p2] = [next.p2, next.p1];
    next.activePlayer = flip(next.activePlayer); next.firstPlayer = flip(next.firstPlayer);
    if (next.winner) next.winner = flip(next.winner);
    if (next.responseWindow) {
        next.responseWindow.responder = flip(next.responseWindow.responder);
        next.responseWindow.pendingAction.actor = flip(next.responseWindow.pendingAction.actor);
        if (next.responseWindow.pendingAction.targetSide) next.responseWindow.pendingAction.targetSide = flip(next.responseWindow.pendingAction.targetSide);
    }
    if (next.activeField) next.activeField.owner = flip(next.activeField.owner);
    for (const side of [next.p1, next.p2]) {
        for (const monster of side.monsterZones) if (monster) monster.owner = flip(monster.owner);
        for (const card of side.magicTrapZones) if (card) card.owner = flip(card.owner);
    }
    if (next.afkStrikes) next.afkStrikes = { p1: next.afkStrikes.p2, p2: next.afkStrikes.p1 };
    return next;
}
/** A bounded, seeded exhibition using the actual legal starter decks, rules
 * and Keeper AI. No account, collection, ranked session or reward is touched. */
export function stopChronicleGame(window: number): StopGame {
    const prior = cached.get(window); if (prior) return prior;
    let seed = (window ^ CHRONICLE_RULES_VERSION * 2654435761) >>> 0;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    let state = createMatch(STOP_DUELISTS[0], CHRONICLE_FIXED_FALLBACK_DECK, STOP_DUELISTS[1], CHRONICLE_FIXED_FALLBACK_DECK, random, 1000);
    const session: AiMatchSession = { matchId: `road-exhibition-${window}`, playerName: STOP_DUELISTS[0], createdAt: 1000,
        rulesVersion: state.rulesVersion, difficulty: 'medium', state, status: 'active' };
    const turns: StopGame['turns'] = [];
    for (let guard = 0; guard < 600 && state.status === 'active' && state.turnNumber <= 80; guard++) {
        const last = turns.at(-1);
        if (!last || last.turn !== state.turnNumber) turns.push({ player: state[state.activePlayer].name, turn: state.turnNumber, life: [state.p1.lifePoints, state.p2.lifePoints] });
        const before = JSON.stringify(state), reversed = (state.responseWindow?.responder ?? state.activePlayer) === 'p1';
        session.state = reversed ? swap(state) : state; session.status = 'active';
        advanceAi(session, 1000);
        state = reversed ? swap(session.state) : session.state;
        if (JSON.stringify(state) === before) break;
        // Completed turns need no old presentation events or private hand history.
        state.log = state.log.slice(-12); state.events = state.events?.slice(-12);
    }
    const game: StopGame = { rulesVersion: CHRONICLE_RULES_VERSION, turns, finished: state.status === 'complete',
        ...(state.winner && state.winner !== 'draw' ? { winner: state[state.winner].name } : {}) };
    cached.set(window, game); while (cached.size > 4) cached.delete(cached.keys().next().value!);
    return game;
}
