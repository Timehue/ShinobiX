import type { ReactNode } from "react";
import type { Biome, WeatherType } from "../types/core";
import { sectorName } from "../../../shared/sector-geo";
import type { SectorDirection, SectorExit } from "../../../shared/sector-links";
import { DayNightSky } from "./DayNightSky";
import { RegionSplash } from "./WorldWalkFeel";
import { SceneAmbience } from "./SceneAmbience";
import { SceneCritters } from "./SceneCritters";
import { SectorAvatar } from "./SectorAvatar";
import { SectorMap } from "./SectorMap";
import { SectorPeersLive, type SectorPeer } from "./SectorPeers";
import { SectorScene } from "./SectorScene";
import { playerNameTile } from "../lib/sector-tile";
import { GameArtIcon } from "./GameArtIcon";
import { isWalkableTile, nearestWalkableTile, sectorWalkMask } from "../../../shared/sector-walk-mask";
import { safeSectorTile } from "../lib/sector-obstacles";
import { ContinuousWorldSector } from "./ContinuousWorldSector";

const GRID_SIZE = 12;
const TILE_COUNT = GRID_SIZE * GRID_SIZE;

export type WorldSectorCanvasPlayer = {
    name: string;
    level: number;
    sleeping: boolean;
    avatarImage: string;
};

export type WorldSectorCanvasProps = {
    gatheringCharacter?: import('../types/character').Character;
    onGatheringCommit?: import('../types/character').VersionedCharacterCommit;
    worldBossCrystalsActive?: boolean;
    worldBossEventId?: string;
    minedWorldBossCrystalNodeIds?: readonly string[];
    sector: number;
    obstacles?: boolean;
    biome: Biome;
    weather: WeatherType;
    ambienceBiome: Biome;
    playerTile: number;
    playerName: string;
    playerAvatarImage: string;
    /** A fullscreen interior covers this scene; release its renderers while keeping the host slots mounted. */
    suspended?: boolean;
    isCurrent: boolean;
    enterDirection: SectorDirection | null;
    regionSplash: { label: string; tint: string; stamp: number } | null;
    onRegionSplashDone: () => void;
    mapImage?: string;
    sceneImage: string;
    sceneDepthImage?: string;
    roadExits: readonly SectorExit[];
    showLivePeers: boolean;
    players: readonly WorldSectorCanvasPlayer[];
    sharedImages: Record<string, string>;
    sleeperPeers: SectorPeer[];
    onSelectTile: (tile: number) => void;
    onCrossExit: (exit: SectorExit) => void;
    onWalkArrive?: (tile: number, sector: number | null) => void;
    onWorldAuthority?: (sector: number, tile: number) => void;
    worldMovementBlocked?: () => boolean;
    hudLayer: ReactNode;
    overlayLayer: ReactNode;
    mapHudLayer?: ReactNode;
    encounterLayer: ReactNode;
};

/**
 * Presentational projection of the selected sector's walkable stage.
 *
 * WorldMap retains every controller, portal, and authority decision. The two
 * render slots preserve their original stacking order around the foreground.
 */
export function WorldSectorCanvas(props: WorldSectorCanvasProps) { const {
    sector,
    obstacles = true,
    biome,
    weather,
    ambienceBiome,
    playerTile,
    playerName,
    playerAvatarImage,
    suspended = false,
    isCurrent,
    enterDirection,
    regionSplash,
    onRegionSplashDone,
    mapImage,
    sceneImage,
    roadExits,
    showLivePeers,
    players,
    sharedImages,
    sleeperPeers,
    onSelectTile,
    onCrossExit,
    onWalkArrive,
    hudLayer,
    overlayLayer,
    encounterLayer,
} = props;
    if (!suspended && isCurrent && roadExits.length && props.onWorldAuthority) return <ContinuousWorldSector {...props} />;
    const mapMode = Boolean(mapImage);
    const fallbackMarkers = players.slice(0, 48);
    return (
        <main className="tile-scene sector-stage-panel">
            {!suspended && hudLayer}

            <div data-ground-floor={sectorWalkMask(sector) ? "true" : undefined} className={`pixel-map walkable-sector-map sector-image-map${enterDirection ? ` sector-enter-${enterDirection}` : ""}`}>
                {!suspended && <>
                {regionSplash && (
                    <RegionSplash
                        label={regionSplash.label}
                        tint={regionSplash.tint}
                        stamp={regionSplash.stamp}
                        onDone={onRegionSplashDone}
                    />
                )}
                {mapMode ? (
                    <>
                        <SectorMap image={mapImage} enterDirection={enterDirection} />
                        {/* The world's time of day, washed over the painted floor
                            and under the tile grid, so road exits and peer markers
                            stay readable after dark. It used to live only in the
                            vista branch below, which no sector reaches since the
                            floors became unconditional (2026-07-29), so the sector
                            view showed noon at every hour. */}
                        <DayNightSky className="on-floor" />
                    </>
                ) : (
                    <>
                        <SectorScene image={sceneImage} biome={ambienceBiome} focus={playerTile} />
                        <DayNightSky />
                    </>
                )}
                <SceneAmbience biome={ambienceBiome} weather={weather} weatherSector={sector} weatherBiome={biome} />
                <SceneCritters biome={ambienceBiome} />

                {Array.from({ length: TILE_COUNT }).map((_, index) => {
                    const isPlayer = index === playerTile;
                    const roadExit = roadExits.find((exit) => exit.tile === index);
                    const tileCol = (index % GRID_SIZE) + 1;
                    const tileRow = Math.floor(index / GRID_SIZE) + 1;
                    const otherHere = showLivePeers ? [] : fallbackMarkers.filter((player) => safeSectorTile(sector, playerNameTile(player.name)) === index);
                    const walkable = isWalkableTile(sector, index, obstacles);

                    return (
                        <button
                            type="button"
                            key={index}
                            title={roadExit
                                ? `${isCurrent ? "Cross" : "Road"} to ${sectorName(roadExit.destinationSector) ?? `Sector ${roadExit.destinationSector}`}`
                                : otherHere.length > 0 ? otherHere.map((player) => `${player.name} (Lv ${player.level})`).join(", ") : undefined}
                            aria-label={roadExit
                                ? `${isCurrent ? "Cross to" : "Road to"} ${sectorName(roadExit.destinationSector) ?? `Sector ${roadExit.destinationSector}`}`
                                : isPlayer ? `Current tile row ${tileRow} column ${tileCol}` : `${walkable ? "Move to tile" : "Move near blocked tile"} row ${tileRow} column ${tileCol}`}
                            className={`scene-tile walkable-tile transparent-sector-tile ${isPlayer ? "sector-player-tile" : ""} ${roadExit ? "sector-road-exit" : ""} ${otherHere.length > 0 ? "sector-other-tile" : ""}`}
                            data-walkable={walkable}
                            disabled={!isCurrent}
                            onClick={() => {
                                if (roadExit && isCurrent) onCrossExit(roadExit);
                                else onSelectTile(nearestWalkableTile(sector, index, obstacles));
                            }}
                        >
                            {otherHere.length > 0 ? (
                                <div className="other-players-map-stack">
                                    {otherHere.map((player) => (
                                        <div key={player.name} className="other-player-map-dot" title={`${player.name} Lv ${player.level}`}>
                                            {player.avatarImage
                                                ? <img className="tiny-map-avatar other-player-map-avatar" src={player.avatarImage} alt={player.name} onError={(event) => { event.currentTarget.style.display = "none"; }} />
                                                : <span className="other-player-map-emoji"><GameArtIcon kind="roleAssassin" size={20} title={`${player.name}, shinobi`} /></span>}
                                            <span className="other-player-map-name">{player.name}{player.sleeping && <> <GameArtIcon kind="biomeShadow" size={12} title="Sleeping" /></>}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : ""}
                        </button>
                    );
                })}

                {showLivePeers && isCurrent && (
                    <SectorPeersLive
                        selectedSector={sector}
                        selfName={playerName}
                        sharedImages={sharedImages}
                        sleepers={sleeperPeers}
                    />
                )}
                {!showLivePeers && players.length > fallbackMarkers.length && <div className="sector-peers-overflow" aria-hidden="true">+{players.length - fallbackMarkers.length} more here</div>}

                {isCurrent && (
                    <SectorAvatar
                        targetIndex={playerTile}
                        sector={sector}
                        avatarImage={playerAvatarImage}
                        name={playerName}
                        biome={ambienceBiome}
                        enterDirection={enterDirection}
                        onArrive={onWalkArrive}
                    />
                )}
                </>}

                {overlayLayer}
                {props.mapHudLayer}
                {encounterLayer}
            </div>
        </main>
    );
}
