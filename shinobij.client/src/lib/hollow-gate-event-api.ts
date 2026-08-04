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

export type HollowGateEventReward = {
    currencies?: Partial<Record<"ryo" | "auraDust" | "auraStones" | "boneCharms" | "fateShards" | "honorSeals" | "hollowShards", number>>;
    items?: Partial<Record<"dungeon-legendary-fragment" | "veil-of-the-hollow" | "elemental-shard", number>>;
};

export type HollowGateEventResult = {
    ok: boolean;
    action?: HollowGateEventAction;
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
    action: HollowGateEventAction;
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
            : { ...data, ok: false, error: data.error || `Hollow Gate event failed (${response.status}).` };
    } catch {
        return { ok: false, error: "The Hollow Gate event service is unreachable." };
    }
}

export async function sealHollowGateFloor(playerName: string, token: string, run: HollowGateShrineRun): Promise<{ ok: boolean; error?: string }> {
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
                tiles: run.tiles.map((tile) => ({ kind: tile.kind, terrain: tile.terrain })),
            }),
        });
        const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
        return response.ok && data.ok ? { ok: true } : { ok: false, error: data.error || `Floor seal failed (${response.status}).` };
    } catch {
        return { ok: false, error: "The Hollow Gate floor seal is unreachable." };
    }
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
