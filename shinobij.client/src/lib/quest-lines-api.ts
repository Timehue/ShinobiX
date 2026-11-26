import type { CoastFloor } from "../../../shared/coast-world-rules";
/*
 * Quest lines (api/quests/lines.ts) and the coast's map (api/coast/world.ts).
 *
 * The client holds no copy of the quest catalogue or of the coast. It asks the
 * server what the player's quests are and what the coast looks like, names a
 * quest and an action, and draws the answer. Every outcome is the server's.
 */
import type { Character } from "../types/character";

export type QuestPlace = { sector: number; sectorName: string; name?: string };
export type QuestItemCount = { itemId: string; name: string; count: number; have: number };
export type QuestRecipe = { stageKey: string; place?: QuestPlace; inputs: QuestItemCount[]; output: { itemId: string; name: string; count: number } };
type QuestHold = { name: string; tool: string; toolItemId: string; have: number };
export type QuestFight = { name: string; model: string; /** The foe's painted face, by name (lib/coast-quest-scene castPortrait). */ face: string; sector: number; level: number; hold?: QuestHold; thenHolds?: QuestHold[] };
export type QuestStage = {
    index: number;
    kind: "speak" | "reach" | "enter" | "gather" | "make" | "deliver" | "drop" | "boss" | "choice";
    text: string;
    place?: QuestPlace;
    need?: QuestItemCount;
    deliveryReservation?: { target: number; message: string };
    recipe?: QuestRecipe;
    fight?: QuestFight;
    choice?: { prompt: string; place?: string; options: { key: string; label: string; blurb: string }[] };
    /** An enter step's things to find inside: the station on each floor, and whether it has been found. */
    clues?: { key: string; floor: number; station: string; found: boolean }[];
};
export type QuestLine = {
    id: string; series: string; title: string; world: "home" | "coast"; marks: number; stages: number;
    state: "done" | "ready" | "active" | "open" | "locked";
    reason?: string; needLevel: number; needMarks: number;
    giver: string; giverName: string; offerAt?: QuestPlace;
    stage?: QuestStage; remake?: QuestRecipe; committed?: boolean; gearChance?: number;
    /** Optional journal illustrations for badges and equipment named by the server. */
    rewardArtKeys?: string[];
    /** What is being said right now: the offer, the step's lines, or the closing scene. An empty speaker is narration; `face` names a cast member's painted face. */
    talk?: { speaker: string; text: string; face?: string }[];
    /** The quest's painting, by name (lib/coast-journal-art). Rounds and side tales have none. */
    art?: string;
    /** The painting behind what is being said: the quest's own, or its region's. */
    backdrop?: string;
    /** The story theme a scene of this plays under, named by the server for the region it is said in. */
    score?: string;
    /** One sentence on where the quest stands when it is not under way: locked and why, on offer and where, ready, or finished. */
    note?: string;
};
export type QuestSite = {
    id: string; name: string; questId: string; sector: number; approach: number; target: number;
    activity: "harvesting" | "mining" | "fishing"; level: number; itemId: string;
    kept?: boolean; need: number; have: number; remaining: number; refillAt: number;
};
export type QuestLinesList = {
    ok: true; notebook?: Record<string, { active: boolean; result?: string }>; coastWork?: Record<string, number>; marks: number; lines: QuestLine[]; sites: QuestSite[];
    coast: {
        level: number; boat: boolean; region: number; sealed?: number[]; docks?: { sector: number; name: string }[];
        /** Who stands where for this player: each keeper at their counter, and a boss a quest has reached (api/quests/_coast-presence.ts). */
        /** `room` is where a keeper stands inside their site's ground-floor room, in tiles from its top left. */
        figures?: { sector: number; tile: number; label: string; model: string; site: string; image?: string; boss?: boolean; room?: [number, number] }[];
        /** The people of the coast for this player: where each stands, the painted face to draw them with, and the one line they say. */
        people?: { sector: number; tile: number; label: string; model: string; face: string; say: string }[];
        /** Where a quest can be taken or moved on: a sector, and the site in it when there is one. */
        places?: { sector: number; site?: string }[];
    };
};
export type QuestActionReply = {
    progress?: import('../../../shared/coast-room-duties').RoomDutyProgress;
    coastWork?: Record<string, number>;
    ok: boolean; reason?: string; error?: string;
    character?: Character; _saveVersion?: number;
    [key: string]: unknown;
};

async function post(playerName: string, body: Record<string, unknown>): Promise<QuestActionReply> {
    try {
        const response = await fetch("/api/quests/lines", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, ...body }),
            signal: AbortSignal.timeout(12_000),
        });
        const data = await response.json().catch(() => null) as QuestActionReply | null;
        if (!response.ok || !data) return { ok: false, reason: data?.reason, error: data?.error || "The quest record could not be reached. Try again." };
        return data;
    } catch {
        return { ok: false, error: "The quest record could not be reached. Try again." };
    }
}

export async function loadQuestLines(playerName: string): Promise<QuestLinesList | null> {
    const data = await post(playerName, { action: "list" });
    return data.ok && Array.isArray(data.lines) ? data as unknown as QuestLinesList : null;
}

/** `recall` reads a finished quest's whole story back (`talk`, `backdrop`) and changes nothing. */
export type QuestAction = "accept" | "advance" | "make" | "examine" | "choose" | "claim" | "abandon" | "recall";
export function roomDutyRequest(player: string, questId: string, command: import('../../../shared/coast-room-duties').RoomDutyCommand,
    data: { tick?: number; revision?: number; station?: string; answer?: string | number; legacy?: Record<string, number> } = {}) {
    return post(player, { action: 'room-duty', questId, command, ...data });
}

export function doCoastWork(player: string, questId: string, step: number, choice: string) {
    return post(player, { action: "work", questId, step, choice });
}

export function questLineAction(playerName: string, action: QuestAction, questId: string, extra: { optionKey?: string; stageKey?: string; clueKey?: string } = {}) {
    return post(playerName, { action, questId, ...extra });
}

/** A sentence for a refused quest action. The server words every refusal it knows (api/quests/_refusals.ts). */
export function questRefusal(reply: QuestActionReply): string {
    return reply.error || "That could not be done right now.";
}

// ── The coast's map ─────────────────────────────────────────────────────────

export type CoastExit = { id: string; direction: "north" | "south" | "east" | "west"; tile: number; destinationSector: number; destinationTile: number };
export type CoastSite = {
    id: string; name: string; role: string; verb: string; description: string;
    approach: number; returnTile?: number; floors?: CoastFloor[]; footprint: number[]; sprite?: string; scene?: string;
    duty?: string;
    workshop?: import("../../../shared/coast-room-duties").RoomDuty;
    gather?: "harvesting" | "mining" | "fishing";
    /** True at the slip, where the boat home is boarded. */
    boat?: boolean;
};

export type CoastTravelReply = { ok: boolean; travelMs?: number; arrivalTile?: number; error?: string };
/** Ask the server to move the player: by the boat, across the atlas, or along a trail. */
export async function coastTravel(body: { destinationSector: number; mode?: "edge"; originSector?: number; originTile?: number; exitId?: string }): Promise<CoastTravelReply> {
    try {
        const response = await fetch("/api/player/travel", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000),
        });
        const data = await response.json().catch(() => null) as { arrivalAt?: number; travelMs?: number; arrivalTile?: number; error?: string } | null;
        if (!response.ok || !data?.arrivalAt) return { ok: false, error: data?.error || "The way is shut for now. Try again." };
        return { ok: true, travelMs: data.travelMs, arrivalTile: data.arrivalTile };
    } catch {
        return { ok: false, error: "The travel server could not be reached. Try again." };
    }
}

export type GatherReply = {
    ok: boolean; error?: string; character?: Character; _saveVersion?: number;
    receipt?: { outcome: "success" | "failed" | "cancelled" | "expired"; itemId?: string; count?: number; toolBroke?: boolean };
};
/** One step of a gathering attempt at a quest site (api/world/resource.ts). */
export async function questSiteGather(body: { action: "start" | "resolve"; requestId: string; nodeId?: string; mode?: "relaxed" }): Promise<GatherReply> {
    try {
        const response = await fetch("/api/world/resource", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000),
        });
        const data = await response.json().catch(() => null) as GatherReply | null;
        if (!response.ok || !data) return { ok: false, error: data?.error || "The site could not be worked just now. Try again." };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: "The site could not be worked just now. Try again." };
    }
}
export type CoastSector = {
    resources?: (import('../../../shared/resource-nodes').ResourceNode & { siteId: string })[]; name: string; biome: string; contestable: boolean; mask: string[]; floor: string; exits: CoastExit[]; sites: CoastSite[] };
export type CoastWorld = {
    jobs?: readonly import("../../../shared/coast-work").CoastJob[];
    space: import('../../../shared/continuous-world-space').VersionedWorldSpace;
    version: string;
    atlas: { width: number; height: number; image: string };
    regions: string[];
    points: { sector: number; x: number; y: number; region: number }[];
    roads: [number, number][];
    sectors: Record<string, CoastSector>;
};

let coastWorld: Promise<CoastWorld | null> | null = null;
/** The coast's map, fetched once a session. A failed fetch is tried again on the next call. */
export function loadCoastWorld(): Promise<CoastWorld | null> {
    coastWorld ??= fetch("/api/coast/world", { cache: "no-cache", signal: AbortSignal.timeout(15_000) })
        .then(async response => (response.ok ? await response.json() as CoastWorld : null))
        .catch(() => null)
        .then(world => { if (world?.space) return world; coastWorld = null; return null; });
    return coastWorld;
}
