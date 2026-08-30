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
    ServerArenaMovementEvent,
    ServerArenaSession,
    ServerArenaTransport,
    ServerArenaVfxEvent,
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

/**
 * Flatten the session's combat events into a flat, seq-tagged VFX stream.
 *
 * A plate's `target` is already an actor id in the projected session ("player" /
 * "enemy" / "companion" — see fighterActor/companionActor above), so the screen
 * can anchor a fighter-targeted plate by looking that actor up directly. Plates
 * that anchor to the board instead carry `tiles`.
 */
export function soloPveVfxStream(session: SoloPveSession): ServerArenaVfxEvent[] {
    return (session.events ?? []).flatMap((event) =>
        (event.vfx ?? []).map((plate) => ({
            seq: event.seq,
            key: plate.key,
            target: plate.target,
            anchor: plate.anchor,
            ...(plate.tiles ? { tiles: plate.tiles } : {}),
            ...(plate.persistent ? { persistent: true } : {}),
        })),
    );
}

/**
 * Preserve each authoritative tile relocation in event order. The final Solo
 * session contains only each fighter's latest position, but one AI turn can
 * contain several adjacent Move actions. The Arena screen replays this trail
 * cosmetically while continuing to use the final snapshot for combat authority.
 */
export function soloPveMovementStream(session: SoloPveSession): ServerArenaMovementEvent[] {
    const roles = ["player", "enemy", "companion"] as const;
    return (session.events ?? []).flatMap((event) => roles.flatMap((role) => {
        const before = event.before?.[role];
        const after = event.after?.[role];
        if (!before || !after || before.pos === after.pos) return [];
        return [{ seq: event.seq, actorId: role, from: before.pos, to: after.pos }];
    }));
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
        companionUsed: !!session.companionUsage,
        // The engine authors a VFX plate per combat event. Carry the session's
        // rolling event window through, each plate tagged with its event's seq,
        // so the screen can play exactly the ones it has not shown yet — a single
        // submitted action commonly yields several events (the player's action,
        // then the enemy's whole multi-action turn).
        vfx: soloPveVfxStream(session),
        vfxSeq: session.eventSeq,
        movements: soloPveMovementStream(session),
        movementSeq: session.eventSeq,
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
        case "flee": return action;
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
};
