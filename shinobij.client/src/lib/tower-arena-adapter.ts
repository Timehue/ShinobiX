import {
    TOWER_TURN_AFK_MS,
    fetchTowerState,
    submitTowerAction,
    type TowerActionInput,
    type TowerActionResponse,
    type TowerSession,
} from "./towers-api";
import type { ServerArenaSession, ServerArenaTransport } from "./server-arena-runtime";

export function towerSessionForArena(session: TowerSession): ServerArenaSession {
    return {
        sessionId: session.runId,
        map: session.map,
        actors: session.actors,
        turnQueue: session.turnQueue,
        activeIndex: session.activeIndex,
        round: session.round,
        activeAp: session.activeAp,
        actionsThisTurn: session.actionsThisTurn,
        status: session.status,
        winner: session.winner,
        log: session.log,
        groundEffects: session.groundEffects,
        weather: session.weather,
        pendingCompanion: session.pendingCompanion,
    };
}

export function createTowerArenaTransport(options: {
    submit?: (runId: string, playerName: string, action: TowerActionInput) => Promise<TowerActionResponse>;
    state?: (runId: string, playerName: string) => Promise<TowerSession>;
} = {}): ServerArenaTransport {
    const submit = options.submit ?? submitTowerAction;
    const state = options.state ?? fetchTowerState;
    return {
        turnTimeoutMs: TOWER_TURN_AFK_MS,
        fetchState: async (sessionId, playerName) => towerSessionForArena(await state(sessionId, playerName)),
        submitAction: async (sessionId, playerName, _current, action) => {
            const result = await submit(sessionId, playerName, action as TowerActionInput);
            return { ...result, session: towerSessionForArena(result.session) };
        },
    };
}

export const towerArenaTransport = createTowerArenaTransport();
