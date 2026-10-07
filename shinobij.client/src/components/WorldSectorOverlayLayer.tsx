import type { ShrineDef } from "../../../shared/shrines";
import type { Biome } from "../types/core";
import type { TrailSignView } from "../lib/sector-traces";
import type { Wanderer } from "../lib/wanderers";
import { riftPlacement, strongholdPlacement } from "../data/sector-structure-placements";
import { SectorShrineStandee, SectorTraceMarkers } from "./SectorTraces";
import { SectorWanderer } from "./SectorWanderer";
import { SectorWeeklyBossActor } from "./SectorWeeklyBossActor";
import { SectorStoryFieldMarker, type SectorStoryFieldMarkerProps } from "./SectorStoryFieldMarker";
import { SectorGroundLandmarks } from "./SectorGroundLandmarks";
import { sectorFloorLayout } from "../lib/sector-floor-layout";

export type WorldSectorRiftMarker = Readonly<{
    landmark: string;
    title: string;
    onOpen: () => void;
}>;

export type WorldSectorVaultMarker = Readonly<{
    village: string;
    obsidian?: boolean;
    onOpen: () => void;
}>;

export type WorldSectorShrineMarker = Readonly<{
    definition: ShrineDef;
    tier: number;
}>;

export type WorldSectorBossMarker = Readonly<{
    name: string;
    portrait: string;
    onEngage: () => void;
}>;

export type WorldSectorOverlayLayerProps = Readonly<{
    /** Keys the per-sector Rift and Stronghold placements (data/sector-structure-placements). */
    sector: number;
    biome: Biome;
    playerTile: number;
    wanderers: readonly Wanderer[];
    rift: WorldSectorRiftMarker | null;
    vault: WorldSectorVaultMarker | null;
    traceSigns: TrailSignView[];
    shrine: WorldSectorShrineMarker | null;
    boss: WorldSectorBossMarker | null;
    fieldStory?: SectorStoryFieldMarkerProps | null;
    onEngageWanderer: (wanderer: Wanderer) => void;
    onOpenTrace: (signId: string) => void;
    onOpenShrine: () => void;
}>;

/**
 * Presentation-only actors and landmarks mounted directly on the sector grid.
 *
 * The fragment is structural: moving actors measure their immediate parent as
 * the 12x12 pixel map, so this leaf must never introduce a wrapper element.
 * WorldMap retains time, storage, capability, portal, and mutation ownership.
 */
export function WorldSectorOverlayLayer({
    sector,
    biome,
    playerTile,
    wanderers,
    rift,
    vault,
    traceSigns,
    shrine,
    boss,
    fieldStory,
    onEngageWanderer,
    onOpenTrace,
    onOpenShrine,
}: WorldSectorOverlayLayerProps) {
    const riftAt = riftPlacement(sector);
    const strongholdAt = strongholdPlacement(sector);
    const floorLayout = sectorFloorLayout(sector);

    return (
        <>
            {floorLayout && <SectorGroundLandmarks sector={sector} rift={rift} vault={vault} shrine={shrine} onOpenShrine={onOpenShrine} fieldPointId={fieldStory?.pointId} />}
            {fieldStory && <SectorStoryFieldMarker {...fieldStory} sector={sector} />}
            {wanderers.map((wanderer) => (
                <SectorWanderer
                    key={`${sector}:${wanderer.id}:${wanderer.homeTile}`}
                    wanderer={wanderer}
                    sector={sector}
                    playerIndex={playerTile}
                    biome={biome}
                    onEngage={onEngageWanderer}
                />
            ))}

            {/* Legacy floors retain their original portal markers. */}
            {rift && !floorLayout && (
                <button
                    type="button"
                    key="sector-rift-structure"
                    className="sector-rift-standee"
                    style={{ left: `${riftAt.left}%`, top: `${riftAt.top}%` }}
                    onClick={rift.onOpen}
                    title={rift.title}
                    aria-label={rift.title}
                >
                    <span className="sector-rift-standee-art" data-rift-art={rift.landmark}>
                        <img src={`/landmarks/${rift.landmark}.webp`} alt="" draggable={false} />
                    </span>
                    <span className="sector-rift-standee-name">Rift</span>
                </button>
            )}

            {vault && !floorLayout && (
                <button
                    type="button"
                    key="sector-anbu-vault-structure"
                    className={`sector-vault-standee${vault.obsidian ? ' sector-obsidian-stronghold' : ''}`}
                    style={{ left: `${strongholdAt.left}%`, top: `${strongholdAt.top}%` }}
                    onClick={vault.onOpen}
                    title={vault.obsidian ? 'Obsidian Stronghold · 4× rewards on PvP wins' : `${vault.village} Sector Stronghold — infiltrate?`}
                    aria-label={vault.obsidian ? 'Obsidian Stronghold — enter for 4× PvP rewards' : `Sector Stronghold — infiltrate ${vault.village}'s war cache`}
                >
                    <img src="/landmarks/anbu-vault.webp" alt="" draggable={false} />
                    <span className="sector-vault-standee-name">{vault.obsidian ? 'Obsidian Stronghold · 4× PvP' : 'Sector Stronghold'}</span>
                </button>
            )}

            {traceSigns.length > 0 && (
                <SectorTraceMarkers signs={traceSigns} onOpen={onOpenTrace} sector={sector} />
            )}

            {shrine && !floorLayout && (
                <SectorShrineStandee
                    shrine={shrine.definition}
                    tier={shrine.tier}
                    onOpen={onOpenShrine}
                />
            )}

            {boss && (
                <SectorWeeklyBossActor
                    sector={sector}
                    playerIndex={playerTile}
                    biome={biome}
                    portrait={boss.portrait}
                    name={boss.name}
                    onEngage={boss.onEngage}
                />
            )}
        </>
    );
}
