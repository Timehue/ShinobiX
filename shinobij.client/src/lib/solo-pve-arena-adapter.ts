import {
    fetchSoloPveState,
    submitSoloPveAction,
    type SoloPveActionInput,
    type SoloPveSession,
} from "./solo-pve-api";
import type {
    ServerArenaAction,
    ServerArenaActionResponse,
    ServerArenaActor,
    ServerArenaSession,
    ServerArenaTransport,
} from "./server-arena-runtime";

const SOLO_ARENA_TURN_MS = 75_000;

function fighterActor(id: "player" | "enemy", session: SoloPveSession): ServerArenaActor {
    const fighter = session[id];
    const isPlayer = id === "player";
    return {
        id,
        side: isPlayer ? "squad" : "enemy",
        name: fighter.name,
        ownerSlug: isPlayer ? session.ownerSlug : null,
        ai: !isPlayer,
        hp: fighter.hp,
        maxHp: fighter.maxHp,
        chakra: fighter.chakra,
        maxChakra: fighter.maxChakra,
        stamina: fighter.stamina,
        maxStamina: fighter.maxStamina,
        shield: fighter.shield,
        statuses: fighter.statuses,
        pos: fighter.pos,
        character: fighter.character,
        ...(isPlayer ? {
            itemCharges: session.itemCharges,
            itemsUsed: session.itemsUsed,
            cooldowns: session.cooldowns.player,
        } : { cooldowns: session.cooldowns.enemy }),
    };
}

function companionActor(session: SoloPveSession): ServerArenaActor | null {
    const companion = session.companion;
    if (!companion) return null;
    return {
        id: "companion",
        side: "squad",
        name: companion.name,
        ownerSlug: session.ownerSlug,
        ai: true,
        hp: companion.hp,
        maxHp: companion.maxHp,
        chakra: companion.chakra,
        maxChakra: companion.maxChakra,
        stamina: companion.stamina,
        maxStamina: companion.maxStamina,
        shield: companion.shield,
        statuses: companion.statuses,
        pos: companion.pos,
        character: {
            ...companion.character,
            companion: true,
            visual: companion.petId,
            companionRoundsLeft: companion.roundsLeft,
        },
        cooldowns: companion.cooldowns,
    };
}

export function soloPveSessionForArena(session: SoloPveSession): ServerArenaSession {
    const companion = companionActor(session);
    return {
        sessionId: session.sessionId,
        runtimeVersion: session.version,
        map: { width: 12, height: 10, biome: session.environment.biome, blockedTiles: session.environment.blockedTiles },
        actors: [fighterActor("player", session), ...(companion ? [companion] : []), fighterActor("enemy", session)],
        turnQueue: [session.activeSide],
        activeIndex: 0,
        round: session.round,
        activeAp: session.ap[session.activeSide],
        actionsThisTurn: session.actionsThisTurn,
        status: session.status,
        winner: session.winner === "player" ? "squad" : session.winner,
        log: session.log,
        groundEffects: session.groundEffects.map((effect) => ({ ...effect, owner: effect.owner })),
        weather: {
            positiveElement: session.environment.weatherPositiveElement,
            negativeElement: session.environment.weatherNegativeElement,
        },
        ...(session.pendingCompanion ? {
            pendingCompanion: {
                petId: session.pendingCompanion.petId,
                name: session.pendingCompanion.name,
                hp: session.pendingCompanion.hp,
                damage: session.pendingCompanion.damage,
            },
        } : {}),
    };
}

function soloAction(action: ServerArenaAction): SoloPveActionInput {
    switch (action.type) {
        case "attack": return { type: "basicAttack" };
        case "heal": return { type: "basicHeal" };
        case "move": return action;
        case "jutsu": return { type: "jutsu", jutsuId: action.jutsuId, ...(action.tile !== undefined ? { tile: action.tile } : {}) };
        case "weapon": return { type: "weapon", itemId: action.itemId ?? "" };
        case "item": return { type: "item", itemId: action.itemId ?? "" };
        case "clear": return { type: "clear" };
        case "cleanse": return action;
        case "summon": return action;
        case "wait": return action;
    }
}

async function submitWithStableRetry(params: {
    sessionId: string;
    playerName: string;
    current: ServerArenaSession;
    action: SoloPveActionInput;
}): Promise<ServerArenaActionResponse> {
    const moveToken = crypto.randomUUID();
    const request = () => submitSoloPveAction({
        sessionId: params.sessionId,
        playerName: params.playerName,
        expectedVersion: Number(params.current.runtimeVersion ?? 0),
        moveToken,
        action: params.action,
    });
    let response;
    try {
        response = await request();
    } catch {
        response = await request();
    }
    if (!response.session) throw new Error(response.error ?? response.reason ?? "The combat server returned no session state.");
    return {
        applied: response.applied === true,
        reason: response.reason ?? response.error,
        session: soloPveSessionForArena(response.session),
    };
}

export const soloPveArenaTransport: ServerArenaTransport = {
    turnTimeoutMs: SOLO_ARENA_TURN_MS,
    fetchState: async (sessionId, playerName) => soloPveSessionForArena(await fetchSoloPveState(sessionId, playerName)),
    submitAction: (sessionId, playerName, current, action) => submitWithStableRetry({ sessionId, playerName, current, action: soloAction(action) }),
    forfeit: (sessionId, playerName, current) => submitWithStableRetry({ sessionId, playerName, current, action: { type: "flee" } }),
};
