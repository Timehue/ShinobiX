/*
 * Pure village-state helpers — daily agenda generation, Kage challenge window
 * + normalization, treasury defaults/cleaning, and ANBU appointee
 * normalization. Extracted verbatim from App.tsx. The cache-coupled
 * load/save/normalizeVillageState stay in App.tsx (they read/reassign
 * sharedVillageStateCache).
 */
import { currentDateKey } from "./utils";
import { cleanTreasuryItems } from "./items";
import type { KageChallenge, VillageAgendaTask, VillageDailyAgenda, VillageTreasury } from "../App";

export function normalizeAnbuAppointees(appointees?: string[]) {
    const seen = new Set<string>();
    return Array.from({ length: 3 }, (_, index) => {
        const name = String(appointees?.[index] ?? "").trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) return "";
        seen.add(key);
        return name;
    });
}

const villageAgendaTaskPool: Omit<VillageAgendaTask, "id">[] = [
    { kind: "missions", label: "Complete village missions", target: 3 },
    { kind: "explore", label: "Explore map tiles", target: 20 },
    { kind: "ai", label: "Defeat AI enemies", target: 3 },
    { kind: "pet", label: "Win pet battles", target: 1 },
    { kind: "control", label: "Hold controlled sectors", target: 1 },
];
function seededAgendaIndex(seed: string, index: number, size: number) {
    let hash = 0;
    for (const char of `${seed}:${index}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash % size;
}
export function makeVillageDailyAgenda(village: string, date = currentDateKey()): VillageDailyAgenda {
    const pool = [...villageAgendaTaskPool];
    const tasks: VillageAgendaTask[] = [];
    for (let i = 0; i < 3 && pool.length; i += 1) {
        const choice = pool.splice(seededAgendaIndex(`${village}:${date}`, i, pool.length), 1)[0];
        tasks.push({ ...choice, id: `${date}-${choice.kind}` });
    }
    return { date, tasks };
}
export function normalizeVillageDailyAgenda(village: string, agenda?: VillageDailyAgenda) {
    return agenda?.date === currentDateKey() && agenda.tasks?.length === 3 ? agenda : makeVillageDailyAgenda(village);
}
export const KAGE_CHALLENGE_SUPPORT_REQUIRED = 1;
export const KAGE_CHALLENGE_CONTRIBUTION_REQUIRED = 10;
export const KAGE_READY_WINDOW_MS = 60 * 60 * 1000;
export function isKageChallengeWindow(now = new Date()) {
    const hour = now.getUTCHours();
    return hour >= 23 || hour < 3;
}
export function kageWindowLabel() {
    return "23:00-03:00 server time";
}
export function normalizeKageChallenges(village: string, challenges?: KageChallenge[]) {
    return (challenges ?? [])
        .filter(challenge => challenge && challenge.id && challenge.challenger && challenge.seatedKage)
        .map(challenge => ({
            ...challenge,
            village: challenge.village || village,
            status: challenge.status ?? "open",
            support: Array.from(new Set((challenge.support ?? []).filter(Boolean))),
            opposition: Array.from(new Set((challenge.opposition ?? []).filter(Boolean))),
            contributionRequired: Math.max(1, Math.floor(Number(challenge.contributionRequired ?? KAGE_CHALLENGE_CONTRIBUTION_REQUIRED))),
        }))
        .slice(0, 12);
}
export function defaultVillageTreasury(): VillageTreasury { return { ryo: 0, honorSeals: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0, items: [] }; }
export function cleanVillageTreasury(t?: Partial<VillageTreasury>): VillageTreasury { return { ryo: Math.max(0, Math.floor(Number(t?.ryo ?? 0))), honorSeals: Math.max(0, Math.floor(Number(t?.honorSeals ?? 0))), fateShards: Math.max(0, Math.floor(Number(t?.fateShards ?? 0))), boneCharms: Math.max(0, Math.floor(Number(t?.boneCharms ?? 0))), auraStones: Math.max(0, Math.floor(Number(t?.auraStones ?? 0))), mythicSeals: Math.max(0, Math.floor(Number(t?.mythicSeals ?? 0))), items: cleanTreasuryItems(t?.items) }; }
