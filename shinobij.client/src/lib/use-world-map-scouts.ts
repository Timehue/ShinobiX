// Existing WorldMap behavior moved verbatim: clear on clan departure and filter
// presence against wall time when its roster changes.
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
import { useEffect, useMemo, useState } from "react";
import type { PlayerRecord } from "../types/character";
import { villageOutskirtsSectorNumber } from "../data/sectors";
import { cwListWars } from "./clan-war-api";
import { fetchClanData } from "./clan-api";
import { scoutIntelTier } from "./clan-upgrades";

export function useWorldMapScouts(clanName: string | undefined, playerRoster: PlayerRecord[]) {
    // ── Scout Network (clan upgrade) ──────────────────────────────────────
    // During the viewer clan's active clan war, surface enemy-clan members who
    // are out in the world (hidden while they sit safe at their own village).
    // The Scout Network building level gates how much detail each dot shows.
    const [scoutInfo, setScoutInfo] = useState<{ tier: 0 | 1 | 2 | 3; enemyClans: string[] }>({ tier: 0, enemyClans: [] });
    useEffect(() => {
        let cancelled = false;
        const clan = clanName;
        if (!clan) { setScoutInfo({ tier: 0, enemyClans: [] }); return; }
        void (async () => {
            const [clanRec, wars] = await Promise.all([
                fetchClanData(clan) as Promise<{ upgrades?: Record<string, number> } | null>,
                cwListWars(),
            ]);
            if (cancelled) return;
            const tier = scoutIntelTier(clanRec?.upgrades?.scoutNetwork ?? 0);
            const mine = clan.toLowerCase();
            const enemyClans = wars
                .filter((w) => !w.endedAt && w.clans.some((c) => c.toLowerCase() === mine))
                .map((w) => w.clans.find((c) => c.toLowerCase() !== mine) ?? "")
                .filter(Boolean);
            setScoutInfo({ tier, enemyClans });
        })();
        return () => { cancelled = true; };
    }, [clanName]);
    const scoutedSectors = useMemo(() => {
        const map = new Map<number, PlayerRecord[]>();
        if (scoutInfo.tier < 1 || scoutInfo.enemyClans.length === 0) return map;
        const enemySet = new Set(scoutInfo.enemyClans.map((c) => c.toLowerCase()));
        const now = Date.now();
        for (const p of playerRoster) {
            const pClan = (p.clan ?? "").toLowerCase();
            if (!pClan || !enemySet.has(pClan)) continue;
            const sector = p.currentSector;
            if (typeof sector !== "number" || sector <= 0) continue;
            // Hide enemies sitting safe at their own village (home outskirts sector).
            if (sector === villageOutskirtsSectorNumber(p.village)) continue;
            // Only show recently-seen players (drop stale presence).
            if (p.lastSeenAt && now - p.lastSeenAt > 90_000) continue;
            const arr = map.get(sector) ?? [];
            arr.push(p);
            map.set(sector, arr);
        }
        return map;
    }, [playerRoster, scoutInfo]);
    return { scoutInfo, scoutedSectors };
}

export function scoutDotTitle(players: PlayerRecord[], tier: 1 | 2 | 3): string {
    if (tier >= 3) return "Enemy clan: " + players.map((p) => `${p.name} (Lv ${p.level})`).join(", ");
    if (tier === 2) return `Enemy clan here · ${players.length} · level${players.length > 1 ? "s" : ""} ${players.map((p) => p.level).join(", ")}`;
    return `Enemy clan spotted · ${players.length} member${players.length > 1 ? "s" : ""}`;
}
