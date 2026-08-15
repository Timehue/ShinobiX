import type { ShrineDef } from "../../../shared/shrines";
import type { Biome } from "../types/core";
import type { TrailSignView } from "../lib/sector-traces";
import type { Wanderer } from "../lib/wanderers";
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
    biome: Biome;
    playerTile: number;
    wanderers: readonly Wanderer[];
    rift: WorldSectorRiftMarker | null;
    vault: WorldSectorVaultMarker | null;
    traceSigns: TrailSignView[];
    shrine: WorldSectorShrineMarker | null;
    boss: WorldSectorBossMarker | null;
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
    biome,
    playerTile,
    wanderers,
    rift,
    vault,
    traceSigns,
    shrine,
    boss,
    onEngageWanderer,
    onOpenTrace,
    onOpenShrine,
}: WorldSectorOverlayLayerProps) {
    return (
        <>
            {wanderers.map((wanderer) => (
                <SectorWanderer
                    key={wanderer.id}
                    wanderer={wanderer}
                    playerIndex={playerTile}
                    biome={biome}
                    onEngage={onEngageWanderer}
                />
            ))}

            {rift && (
                <button
                    key="sector-rift-structure"
                    className="atlas-landmark atlas-hollowRift sector-rift-structure"
                    style={{
                        left: "50%",
                        top: "32%",
                        backgroundImage: `url(/landmarks/${rift.landmark}.webp)`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                    }}
                    onClick={rift.onOpen}
                    title={rift.title}
                >
                    <strong>🌀</strong>
                    <span>Rift</span>
                </button>
            )}

            {vault && (
                <button
                    key="sector-anbu-vault-structure"
                    className="atlas-landmark sector-rift-structure"
                    style={{
                        left: "72%",
                        top: "38%",
                        backgroundImage: "url(/landmarks/anbu-vault.webp)",
                        backgroundSize: "contain",
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "center bottom",
                    }}
                    onClick={vault.onOpen}
                    title={`${vault.village} war vault — infiltrate?`}
                >
                    <strong>🏯</strong>
                    <span>War Vault</span>
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
