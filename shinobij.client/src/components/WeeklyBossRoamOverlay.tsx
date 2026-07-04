import { useEffect, useState } from "react";
import { SECTOR_POINTS } from "../data/sector-points";
import { weeklyBossRoamState } from "../lib/weekly-boss-roam";
import "./weekly-boss-roam.css";

// The subset of the weekly-boss server state the roam marker needs. `aiId` +
// `bossName` place the portrait/label; `weekKey` + `startedAt` (+ `expiresAt`)
// drive the deterministic position via weeklyBossRoamState.
export type RoamingBoss = {
    weekKey: string;
    startedAt: number;
    expiresAt?: number;
    aiId: string;
    bossName?: string;
};

/**
 * World-map overlay for the roaming weekly boss (weeklyBossRoam.v1, Phase 2).
 *
 * Renders — as direct children of the zoom-transformed `.anime-world-map`, so it
 * rides the pan/zoom exactly like the sector dots — a faded trail of recent
 * sectors, a telegraphed next-hop ring, and the current boss marker (portrait +
 * "moves in ~Nm" label). Pure view over `weeklyBossRoamState`; clicking the
 * marker travels the player to the boss's current sector (`onFocusSector`). It
 * self-ticks once a second so the position and countdown stay live without the
 * parent re-rendering.
 */
export function WeeklyBossRoamOverlay({
    boss,
    sharedImages = {},
    onFocusSector,
}: {
    boss: RoamingBoss | null;
    sharedImages?: Record<string, string>;
    onFocusSector?: (sector: number) => void;
}) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    if (!boss?.aiId) return null;
    const roam = weeklyBossRoamState(boss, now);
    if (!roam || !roam.active) return null;

    const cur = SECTOR_POINTS.find((p) => p.id === roam.currentSector);
    if (!cur) return null;
    const next = SECTOR_POINTS.find((p) => p.id === roam.nextSector);
    const trail = roam.trail
        .map((id) => SECTOR_POINTS.find((p) => p.id === id))
        .filter((p): p is (typeof SECTOR_POINTS)[number] => Boolean(p));

    const portrait = sharedImages["ai:" + boss.aiId] || "";
    const name = boss.bossName ?? "Weekly Boss";
    const mins = Math.max(1, Math.ceil(roam.nextHopInMs / 60000));

    return (
        <>
            {trail.map((p, i) => (
                <span
                    key={`wbtrail-${p.id}-${i}`}
                    className="wb-roam-trail"
                    style={{ left: `${p.x}%`, top: `${p.y}%`, opacity: 0.16 + i * 0.12 }}
                    aria-hidden="true"
                />
            ))}
            {next && (
                <span
                    className="wb-roam-next"
                    style={{ left: `${next.x}%`, top: `${next.y}%` }}
                    title={`${name} moves toward Sector ${next.id} next`}
                    aria-hidden="true"
                />
            )}
            <button
                type="button"
                className="wb-roam-marker"
                style={{ left: `${cur.x}%`, top: `${cur.y}%` }}
                onClick={() => onFocusSector?.(roam.currentSector)}
                title={`${name} — rampaging in Sector ${roam.currentSector}. Moves in ~${mins}m. Click to travel there and challenge it!`}
            >
                <span className="wb-roam-portrait">
                    {portrait
                        ? <img src={portrait} alt={name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                        : <span className="wb-roam-emoji">👹</span>}
                </span>
                <span className="wb-roam-label">⚔ {name} · ~{mins}m</span>
            </button>
        </>
    );
}
