import type { ShrineDef } from "../../../shared/shrines";
import type { Biome } from "../types/core";
import type { TrailSignView } from "../lib/sector-traces";
import type { Wanderer } from "../lib/wanderers";
import { riftPlacement, strongholdPlacement } from "../data/sector-structure-placements";
import { SectorShrineStandee, SectorTraceMarkers } from "./SectorTraces";
import { SectorWanderer } from "./SectorWanderer";
import { SectorWeeklyBossActor } from "./SectorWeeklyBossActor";

export type WorldSectorRiftMarker = Readonly<{
    landmark: string;
    title: string;
    onOpen: () => void;
}>;

export type WorldSectorVaultMarker = Readonly<{
    village: string;
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
    fieldStory?: { title: string; tile: number; onOpen: () => void } | null;
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
    // Per-sector, tuned to each sector's painted ground and validated clear of its
    // gates, arrival tiles, shrine, and each other (sector-structure-placements.test).
    const riftAt = riftPlacement(sector);
    const strongholdAt = strongholdPlacement(sector);

    return (
        <>
            {fieldStory && <button className="atlas-landmark sector-story-field-marker"
                style={{ left: `${((fieldStory.tile % 12) + .5) / 12 * 100}%`, top: `${(Math.floor(fieldStory.tile / 12) + .5) / 12 * 100}%` }}
                onClick={fieldStory.onOpen} title={fieldStory.title} aria-label={`Explore ${fieldStory.title}`}>
                <strong aria-hidden="true">◇</strong><span>{fieldStory.title}</span>
            </button>}
            {wanderers.map((wanderer) => (
                <SectorWanderer
                    key={wanderer.id}
                    wanderer={wanderer}
                    playerIndex={playerTile}
                    biome={biome}
                    onEngage={onEngageWanderer}
                />
            ))}

            {/* Also NOT .atlas-landmark, for the reason spelled out on the stronghold
                below — but the rift cannot be a cutout standee like it. None of the six
                rift landmarks has an alpha channel, and forgotten-shrine is a full-bleed
                landscape with no object in it to cut out at all, so it is rendered as a
                round rimmed aperture instead: a window onto somewhere else, which is
                what a rift is and which suits every one of the six pictures. The board
                already names things this way — the wanderer medallions are rimmed
                circles with a name pill under them. */}
            {rift && (
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

            {/* Deliberately NOT .atlas-landmark — same reasoning as SectorShrineStandee.
                That class paints the world atlas' label-card chrome (dark plate, cream
                border, gold sigil), which read as a UI card pasted onto the terrain and
                sat a panel behind art that is already a painted 2.5D building. Here the
                art IS the marker, standing on the ground, with a map nameplate at its
                foot. */}
            {vault && (
                <button
                    type="button"
                    key="sector-anbu-vault-structure"
                    className="sector-vault-standee"
                    style={{ left: `${strongholdAt.left}%`, top: `${strongholdAt.top}%` }}
                    onClick={vault.onOpen}
                    title={`${vault.village} Sector Stronghold — infiltrate?`}
                    aria-label={`Sector Stronghold — infiltrate ${vault.village}'s war cache`}
                >
                    <img src="/landmarks/anbu-vault.webp" alt="" draggable={false} />
                    <span className="sector-vault-standee-name">Sector Stronghold</span>
                </button>
            )}

            {traceSigns.length > 0 && (
                <SectorTraceMarkers signs={traceSigns} onOpen={onOpenTrace} />
            )}

            {shrine && (
                <SectorShrineStandee
                    shrine={shrine.definition}
                    tier={shrine.tier}
                    onOpen={onOpenShrine}
                />
            )}

            {boss && (
                <SectorWeeklyBossActor
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
