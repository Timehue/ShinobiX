/*
 * Weekly world-boss scheduling — deterministically derives the current week's
 * boss, its spawn window, and live status from a seeded hash of the ISO week
 * key, so every client agrees on the same schedule without server coordination.
 *
 * Pure functions depending only on the Character type. The optional admin
 * override is typed structurally ({ id, name, icon }) so this module stays leaf
 * and does not depend on the App-scoped CreatorAi type.
 *
 * Extracted from App.tsx (Region A).
 */

import type { Character } from "../types/character";

export type WeeklyBossStatus = "dormant" | "active" | "defeated" | "escaped";
export type WeeklyBossSchedule = {
    weekKey: string;
    bossId: string;
    bossName: string;
    bossIcon: string;
    startsAt: number;
    endsAt: number;
    status: WeeklyBossStatus;
};

const weeklyBossPool = [
    { id: "ashen-dragon", name: "Ashen Dragon", icon: "DR" },
    { id: "moonshadow-oni", name: "Moonshadow Oni", icon: "ON" },
    { id: "frostfang-warlord", name: "Frostfang Warlord", icon: "FW" },
    { id: "stormveil-beast", name: "Stormveil Beast", icon: "SB" },
    { id: "deathsgate-revenant", name: "Deathsgate Revenant", icon: "DG" },
];

function seededHash(input: string) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function weekKeyForDate(date = new Date()) {
    const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const day = date.getUTCDay() || 7;
    const thursday = new Date(utc + (4 - day) * 24 * 60 * 60 * 1000);
    const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
    const week = Math.ceil((((thursday.getTime() - yearStart) / 86400000) + 1) / 7);
    return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function weeklyBossSchedule(character?: Character, now = Date.now(), overrideAi?: { id: string; name: string; icon: string } | null): WeeklyBossSchedule {
    const current = new Date(now);
    const weekKey = weekKeyForDate(current);
    const seed = seededHash(weekKey);
    const poolBoss = weeklyBossPool[seed % weeklyBossPool.length];
    const boss = overrideAi
        ? { id: overrideAi.id, name: overrideAi.name, icon: overrideAi.icon }
        : poolBoss;
    const dayOffset = (seed >>> 4) % 7;
    const hour = (seed >>> 9) % 24;
    const start = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
    const startDay = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - (startDay - 1) + dayOffset);
    start.setUTCHours(hour, 0, 0, 0);
    const startsAt = start.getTime();
    const endsAt = startsAt + 24 * 60 * 60 * 1000;
    const killed = Boolean(character?.weeklyBossKills?.[weekKey]);
    const status: WeeklyBossStatus = killed ? "defeated" : now < startsAt ? "dormant" : now <= endsAt ? "active" : "escaped";
    return { weekKey, bossId: boss.id, bossName: boss.name, bossIcon: boss.icon, startsAt, endsAt, status };
}
