import { worldBossDefinition } from "../../../shared/world-boss-event";
import { isWalkableTile } from "../../../shared/sector-walk-mask";
import { sectorObstaclesOn } from "../lib/sector-obstacles";
import { worldBossSectorTile } from "../lib/world-boss-sector-placement";
import "../styles/world-boss-map.css";

export type WorldSectorWorldBossMarker = Readonly<{
    bossId: string;
    name: string;
    /** A team is forming, so the boss holds this sector. */
    paused: boolean;
    onOpen: () => void;
}>;

/**
 * The roaming world boss standing in its current sector. It is the way in to
 * the event's team queue: WorldMap mounts it only while the player stands in
 * the boss's sector and owns the queue dialog it opens. It stands still on a
 * clear tile instead of hunting the player like the Weekly Boss, because
 * joining a raid is the player's choice.
 */
export function SectorWorldBossStandee({ sector, bossId, name, paused, onOpen }: WorldSectorWorldBossMarker & { sector: number }) {
    const boss = worldBossDefinition(bossId);
    const tile = worldBossSectorTile(sector, candidate => isWalkableTile(sector, candidate, sectorObstaclesOn()));
    const col = tile % 12, row = Math.floor(tile / 12);
    // Canvas taps in the continuous world reach a structure by its footprint;
    // the figure stands about three tiles tall.
    const footprint = [tile, tile - 12, tile - 24].filter(t => t >= 0).join(" ");
    const label = `${name}, world boss. ${paused ? "A team is forming. Open the team queue" : "Open the team queue"}`;
    return (
        <button type="button" className={`sector-world-boss${paused ? " is-paused" : ""}`} data-footprint={footprint}
            style={{ left: `${(col + 0.5) / 12 * 100}%`, top: `${(row + 0.92) / 12 * 100}%` }}
            onClick={onOpen} title={label} aria-label={label}>
            <span className={`sector-world-boss-sprite${boss.mapGlow === "white-red" ? " is-white-red-glow" : ""}`}
                style={{ backgroundImage: `url("${boss.mapSprite}")` }} />
            <span className="sector-world-boss-name">{name}<small>{paused ? "Team forming" : "Join the raid"}</small></span>
        </button>
    );
}
