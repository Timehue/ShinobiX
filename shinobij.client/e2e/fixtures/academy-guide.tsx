import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { MissionArenaFight } from "../../src/screens/MissionArenaFight";
import type { Character } from "../../src/types/character";
import type { ServerArenaAction, ServerArenaSession, ServerArenaTransport } from "../../src/lib/server-arena-runtime";

// The real screen with a deterministic transport: no accounts, rewards, or live mutations.
const params = new URLSearchParams(location.search);
const jutsu = [
    { id: "qa-strike", name: "Academy Flame", type: "Ninjutsu", ap: 60, range: 4, effectPower: 30, cooldown: 7, chakraCost: 53, staminaCost: 0, target: "ENEMY", method: "SINGLE", tags: [{ name: "Damage", percent: 0 }] },
    { id: "qa-guard", name: "Academy Guard", type: "Taijutsu", ap: 40, range: 0, effectPower: 0, cooldown: 7, chakraCost: 0, staminaCost: 27, target: "SELF", method: "SINGLE", tags: [{ name: "Decrease Damage Taken", percent: 30 }], isUtility: true },
    { id: "qa-flicker", name: "Flicker", type: "Taijutsu", ap: 20, range: 5, effectPower: 1, cooldown: 2, chakraCost: 0, staminaCost: 13, target: "EMPTY_GROUND", method: "SINGLE", tags: [{ name: "Move", percent: 0 }] },
];
if (params.has("ground")) Object.assign(jutsu[2]!, { name: "Practice Zone", method: "AOE_CIRCLE", tags: [{ name: "Poison", percent: 10 }] });
const character = { name: "Apprentice", level: 2, specialty: "Ninjutsu", village: "Moonshadow Village", bloodline: "", pets: [], jutsuMastery: [{ jutsuId: "qa-strike", level: 50, xp: 0 }] } as unknown as Character;
let session: ServerArenaSession = {
    sessionId: "academy-guide-qa", runtimeVersion: 1, map: { width: 12, height: 10, blockedTiles: [], biome: "central" },
    actors: [
        { id: "player", side: "squad", name: character.name, ownerSlug: "apprentice", ai: false, hp: 600, maxHp: 600, chakra: 1090, maxChakra: 1090, stamina: 1090, maxStamina: 1090, shield: 0, statuses: [], pos: 52, character: { ...character, jutsu, jutsuMastery: jutsu.map(j => ({ jutsuId: j.id, level: 8, xp: 0 })) } },
        { id: "enemy", side: "enemy", name: "Academy Training Dummy", ownerSlug: null, ai: true, hp: 300, maxHp: 300, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000, shield: 0, statuses: [], pos: params.has("far") ? 119 : 54, character: {} },
    ], turnQueue: ["player", "enemy"], activeIndex: 0, round: 1, activeAp: 100, actionsThisTurn: 0, status: "active", winner: null, log: [],
};
if (params.has("spent")) session.activeAp = 10;
if (params.has("actions")) session.actionsThisTurn = 5;
if (params.has("enemy")) session.activeIndex = 1;
if (params.has("blocked")) session.map.blockedTiles = Array.from({ length: 120 }, (_, i) => i).filter(i => i !== 52 && i !== 54);
const qa = window as unknown as { submitted: ServerArenaAction[]; rejectNext: boolean; settlements: number };
qa.submitted = [];
qa.rejectNext = false;
qa.settlements = 0;
const transport: ServerArenaTransport = {
    turnTimeoutMs: 75000,
    fetchState: async () => session,
    submitAction: async (_id, _name, _current, action) => {
        qa.submitted.push(action);
        if (qa.rejectNext) { qa.rejectNext = false; return { applied: false, reason: "out-of-range", session }; }
        const cast = action.type === "jutsu" ? jutsu.find(j => j.id === action.jutsuId) : undefined;
        const won = params.has("win") && cast?.id === "qa-strike";
        const waiting = action.type === "wait";
        session = { ...session, runtimeVersion: session.runtimeVersion! + 1,
            activeAp: waiting ? 100 : session.activeAp - (cast?.ap ?? (action.type === "move" ? 30 : action.type === "attack" ? 40 : 0)),
            actionsThisTurn: waiting ? 0 : session.actionsThisTurn + 1, round: session.round + (waiting ? 1 : 0),
            status: won ? "done" : "active", winner: won ? "squad" : null,
            actors: session.actors.map(actor => actor.id === "player" ? {
                ...actor, chakra: actor.chakra - (cast?.chakraCost ?? 0), stamina: actor.stamina - (cast?.staminaCost ?? 0),
                pos: "tile" in action ? action.tile ?? actor.pos : actor.pos,
                cooldowns: cast ? { ...actor.cooldowns, [cast.id]: cast.cooldown } : actor.cooldowns,
            } : won ? { ...actor, hp: 0 } : actor),
            log: [...session.log, `${character.name} used ${cast?.name ?? action.type}.`] };
        return { applied: true, session };
    },
};
createRoot(document.getElementById("root")!).render(<MissionArenaFight character={character} runId={session.sessionId}
    initialSession={session} coach={params.has("ordinary") ? undefined : "academySpar"} transport={transport}
    settleFn={async () => { qa.settlements++; return {}; }} onExit={() => {}} />);
