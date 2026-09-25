import { playerSlug } from "./utils";
import type { FieldMissionObjective } from "../data/missions";

const KEY = "fieldMissionNavigation.v1";

export type FieldMissionNavigationIntent = {
    owner: string;
    missionId: string;
    targetSector: number;
    objective: FieldMissionObjective;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
    try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

export function writeFieldMissionNavigationIntent(
    playerName: string,
    intent: Omit<FieldMissionNavigationIntent, "owner">,
    storage: StorageLike | null = defaultStorage(),
): void {
    const owner = playerSlug(playerName);
    if (!owner || !/^[A-Za-z0-9_-]{1,96}$/.test(intent.missionId)
        || !Number.isSafeInteger(intent.targetSector) || intent.targetSector < 1
        || !["explore", "raid", "claim"].includes(intent.objective)) return;
    try { storage?.setItem(KEY, JSON.stringify({ ...intent, owner })); } catch { /* map can still be opened manually */ }
}

/** Consume once on World Map entry; acceptance and objective are rechecked there. */
export function takeFieldMissionNavigationIntent(
    playerName: string,
    storage: StorageLike | null = defaultStorage(),
): FieldMissionNavigationIntent | null {
    let parsed: unknown;
    try {
        const raw = storage?.getItem(KEY);
        parsed = raw ? JSON.parse(raw) : null;
    } catch { parsed = null; }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
        && (parsed as Partial<FieldMissionNavigationIntent>).owner !== playerSlug(playerName)) return null;
    try { storage?.removeItem(KEY); } catch { /* stale navigation is safer than replaying it */ }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as Partial<FieldMissionNavigationIntent>;
    if (value.owner !== playerSlug(playerName)
        || typeof value.missionId !== "string" || !/^[A-Za-z0-9_-]{1,96}$/.test(value.missionId)
        || !Number.isSafeInteger(value.targetSector) || Number(value.targetSector) < 1
        || !["explore", "raid", "claim"].includes(String(value.objective))) return null;
    return value as FieldMissionNavigationIntent;
}
