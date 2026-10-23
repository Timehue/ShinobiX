import type { Character, HollowGateShrineRun } from "../types/character";
import type { HollowLockedDoorClientResult } from "./hollow-gate-locked-door-api";

export type HollowGateEventAction =
    | "shrine"
    | "chest"
    | "shard-vein"
    | "trap"
    | "hidden-tablet"
    | "hidden-relic"
    | "locked-door"
    | "keeper-heal"
    | "keeper-torch"
    | "keeper-key";
export type HollowGateTravelerAction = "traveler-heal" | "traveler-key" | "traveler-torch";

export type HollowGateEventReward = {
    currencies?: Partial<Record<"ryo" | "auraDust" | "auraStones" | "boneCharms" | "fateShards" | "honorSeals" | "hollowShards", number>>;
    items?: Partial<Record<"dungeon-legendary-fragment" | "veil-of-the-hollow" | "elemental-shard", number>>;
};

export type HollowGateEventResult = {
    ok: boolean;
    action?: HollowGateEventAction | HollowGateTravelerAction;
    alreadyReported?: boolean;
    reward?: HollowGateEventReward;
    lockedResult?: HollowLockedDoorClientResult;
    damage?: number;
    revived?: boolean;
    ended?: boolean;
    character?: Character;
    runState?: { keys: number; torch: number; threat: number; secondWindArmed: boolean };
    _saveVersion?: number;
    error?: string;
};

export async function resolveHollowGateServerEvent(params: {
    playerName: string;
    token: string;
    nodeId: string;
    action: HollowGateEventAction | HollowGateTravelerAction;
}): Promise<HollowGateEventResult> {
    try {
        const response = await fetch("/api/hollow-gate/event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
        });
        const data = await response.json().catch(() => ({})) as HollowGateEventResult;
        return response.ok && data.ok
            ? data
            : { ...data, ok: false, error: data.error || "The Hollow Gate event did not resolve. Try it again." };
    } catch {
        return { ok: false, error: "The Hollow Gate event service is unreachable." };
    }
}

export async function sealHollowGateFloor(playerName: string, token: string, run: HollowGateShrineRun): Promise<{
    ok: boolean;
    wanderers?: HollowGateShrineRun['wanderers'];
    floorFeatures?: HollowGateShrineRun['floorFeatures'];
    detour?: { tileIndex: number; extraSteps: number; condition: "echo-cache" } | null;
    riftSignal?: { tileIndex: number; kind: string; distortionId: string } | null;
    pendingAmbush?: { nodeId: string; kind: "battle" | "ambush" | "boss" | "card" } | null;
    activeCombat?: HollowGateShrineRun["activeCombat"];
    position?: { x: number; y: number };
    error?: string;
}> {
    try {
        const response = await fetch("/api/hollow-gate/floor-seal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                playerName,
                token,
                floor: run.floor,
                width: run.width,
                height: run.height,
                playerX: run.playerX,
                playerY: run.playerY,
                tiles: run.tiles.map((tile) => ({ kind: tile.kind, terrain: tile.terrain, roomId: tile.roomId })),
                wanderersVersion: 1,
                floorFeaturesVersion: 1,
            }),
        });
        const data = await response.json().catch(() => ({})) as { ok?: boolean; wanderers?: HollowGateShrineRun['wanderers']; floorFeatures?: HollowGateShrineRun['floorFeatures']; detour?: { tileIndex: number; extraSteps: number; condition: "echo-cache" } | null; riftSignal?: { tileIndex: number; kind: string; distortionId: string } | null; pendingAmbush?: { nodeId: string; kind: "battle" | "ambush" | "boss" | "card" } | null; activeCombat?: HollowGateShrineRun["activeCombat"]; position?: { x: number; y: number }; error?: string };
        return response.ok && data.ok
            ? { ok: true, position: data.position, detour: data.detour, riftSignal: data.riftSignal, pendingAmbush: data.pendingAmbush, wanderers: data.wanderers, floorFeatures: data.floorFeatures }
            : { ok: false, position: data.position, activeCombat: data.activeCombat, error: data.error || "Your action on this floor could not be confirmed. Reconnect and try again." };
    } catch {
        return { ok: false, error: "The Hollow Gate floor seal is unreachable." };
    }
}

type FloorSealResult = Awaited<ReturnType<typeof sealHollowGateFloor>>;
let freshSeal: { token: string; floor: number; at: number; result: FloorSealResult } | null = null;
/**
 * An entry that just sealed its first floor hands the reply to the shrine
 * screen. That screen seals its floor on mount to read a pending ambush on
 * every route in; straight after an entry, it was a second identical request
 * under the run lock, racing the player's first steps. Only a successful seal
 * is handed over, so a failed one is still retried on mount.
 */
export function rememberEntryHollowGateSeal(token: string, floor: number, result: FloorSealResult) {
    freshSeal = result.ok ? { token, floor, at: Date.now(), result } : null;
}
/** The entry's seal of this floor, taken once and only while it is a few seconds old. */
export function takeFreshHollowGateSeal(token: string, floor: number, maxAgeMs = 10_000): FloorSealResult | null {
    const seal = freshSeal;
    freshSeal = null;
    return seal && seal.token === token && seal.floor === floor && Date.now() - seal.at <= maxAgeMs ? seal.result : null;
}

export function hollowGateSealRunMarkers(result: Awaited<ReturnType<typeof sealHollowGateFloor>>) {
    return {
        ...(result.wanderers ? { wanderers: result.wanderers } : {}),
        ...(result.floorFeatures ? { floorFeatures: result.floorFeatures, floorFeaturesVersion: 1 as const } : {}),
        detourTileIndex: result.detour?.tileIndex,
        detourExtraSteps: result.detour?.extraSteps,
        riftSignalTileIndex: result.riftSignal?.tileIndex,
    };
}

export function hollowGateRewardLines(reward?: HollowGateEventReward): string[] {
    const currencies = reward?.currencies ?? {};
    const items = reward?.items ?? {};
    const labels: Array<[keyof typeof currencies, string]> = [
        ["ryo", "ryo"],
        ["auraDust", "Aura Dust"],
        ["auraStones", "Aura Stones"],
        ["boneCharms", "Bone Charms"],
        ["fateShards", "Fate Shards"],
        ["honorSeals", "Honor Seals"],
        ["hollowShards", "Hollow Shards"],
    ];
    const lines = labels.flatMap(([key, label]) => {
        const amount = Math.max(0, Math.floor(Number(currencies[key]) || 0));
        return amount ? [`+${amount} ${label}`] : [];
    });
    const veil = Math.max(0, Math.floor(Number(items["veil-of-the-hollow"]) || 0));
    const fragments = Math.max(0, Math.floor(Number(items["dungeon-legendary-fragment"]) || 0));
    const elemental = Math.max(0, Math.floor(Number(items["elemental-shard"]) || 0));
    if (veil) lines.push(`+${veil} Veil of the Hollow`);
    if (fragments) lines.push(`+${fragments} Dungeon Legendary Fragment`);
    if (elemental) lines.push(`+${elemental} Elemental Shard`);
    return lines;
}
