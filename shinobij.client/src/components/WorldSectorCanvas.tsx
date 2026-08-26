import type { ReactNode } from "react";
import type { Biome, WeatherType } from "../types/core";
import { biomeLabel, weatherEffects } from "../data/world";
import { sectorRegionName } from "../data/sectors";
import { sectorName } from "../../../shared/sector-geo";
import type { SectorDirection, SectorExit } from "../../../shared/sector-links";
import { DayNightSky } from "./DayNightSky";
import { RegionSplash, SectorGateMarker } from "./WorldWalkFeel";
import { SceneAmbience } from "./SceneAmbience";
import { SceneAmbience3D } from "./SceneAmbience3D";
import { SceneCritters } from "./SceneCritters";
import { SectorAvatar } from "./SectorAvatar";
import { SectorForeground } from "./SectorForeground";
import { SectorMap } from "./SectorMap";
import { SectorPeersLive, type SectorPeer } from "./SectorPeers";
import { SectorScatter } from "./SectorScatter";
import { SectorScene } from "./SectorScene";
import { SectorScene3D } from "./SectorScene3D";
import { playerNameTile } from "../lib/sector-tile";

const GRID_SIZE = 12;
const TILE_COUNT = GRID_SIZE * GRID_SIZE;

export type WorldSectorCanvasPlayer = {
    name: string;
    level: number;
    sleeping: boolean;
    avatarImage: string;
};

export type WorldSectorCanvasProps = {
    sector: number;
    biome: Biome;
    weather: WeatherType;
    ambienceBiome: Biome;
    playerTile: number;
    playerName: string;
    playerAvatarImage: string;
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
    overlayLayer: ReactNode;
    encounterLayer: ReactNode;
};

/**
 * Presentational projection of the selected sector's walkable stage.
 *
 * WorldMap retains every controller, portal, and authority decision. The two
 * render slots preserve their original stacking order around the foreground.
 */
export function WorldSectorCanvas({
    sector,
    biome,
    weather,
    ambienceBiome,
    playerTile,
    playerName,
    playerAvatarImage,
    isCurrent,
    enterDirection,
    regionSplash,
    onRegionSplashDone,
    mapImage,
    sceneImage,
    sceneDepthImage,
    roadExits,
    showLivePeers,
    players,
    sharedImages,
    sleeperPeers,
    onSelectTile,
    onCrossExit,
    overlayLayer,
    encounterLayer,
}: WorldSectorCanvasProps) {
    const playerCol = (playerTile % GRID_SIZE) + 1;
    const playerRow = Math.floor(playerTile / GRID_SIZE) + 1;
    const mapMode = Boolean(mapImage);
    return (
        <main className="tile-scene sector-stage-panel">
            <div className="scene-title sector-scene-title">
                <div>
                    <strong>{sectorName(sector) ?? `Sector ${sector}`}</strong>
                    <span>Sector {sector} · {sectorRegionName(sector)} | {biomeLabel(biome)} | {weatherEffects[weather].name}</span>
                </div>
                <small>R{playerRow} C{playerCol}{isCurrent ? " | Present" : " | Scouting"}</small>
            </div>

            <div className={`pixel-map walkable-sector-map sector-image-map${enterDirection ? ` sector-enter-${enterDirection}` : ""}`}>
                {regionSplash && (
                    <RegionSplash
                        label={regionSplash.label}
                        tint={regionSplash.tint}
                        stamp={regionSplash.stamp}
                        onDone={onRegionSplashDone}
                    />
                )}
                {mapMode ? (
                    <SectorMap image={mapImage} />
                ) : (
                    <>
                        <SectorScene image={sceneImage} biome={ambienceBiome} focus={playerTile} />
                        <SectorScene3D image={sceneImage} biome={ambienceBiome} focus={playerTile} depth={sceneDepthImage} />
                        <SectorScatter sector={sector} biome={ambienceBiome} />
                        <DayNightSky />
                    </>
                )}
                {!mapMode && <SceneAmbience3D biome={ambienceBiome} />}
                <SceneAmbience biome={ambienceBiome} weather={weather} />
                <SceneCritters biome={ambienceBiome} />

                {Array.from({ length: TILE_COUNT }).map((_, index) => {
                    const isPlayer = index === playerTile;
                    const roadExit = roadExits.find((exit) => exit.tile === index);
                    const tileCol = (index % GRID_SIZE) + 1;
                    const tileRow = Math.floor(index / GRID_SIZE) + 1;
                    const otherHere = showLivePeers ? [] : players.filter((player) => playerNameTile(player.name) === index);

                    return (
                        <button
                            type="button"
                            key={index}
                            title={roadExit
                                ? `${isPlayer && isCurrent ? "Cross" : "Road"} to ${sectorName(roadExit.destinationSector) ?? `Sector ${roadExit.destinationSector}`}`
                                : otherHere.length > 0 ? otherHere.map((player) => `${player.name} (Lv ${player.level})`).join(", ") : undefined}
                            aria-label={roadExit
                                ? `${isPlayer && isCurrent ? "Cross" : "Move to road for"} ${sectorName(roadExit.destinationSector) ?? `Sector ${roadExit.destinationSector}`}`
                                : isPlayer ? `Current tile row ${tileRow} column ${tileCol}` : `Move to tile row ${tileRow} column ${tileCol}`}
                            className={`scene-tile walkable-tile transparent-sector-tile ${isPlayer ? "sector-player-tile" : ""} ${roadExit ? "sector-road-exit" : ""} ${isPlayer && roadExit && isCurrent ? "sector-road-exit-ready" : ""} ${otherHere.length > 0 ? "sector-other-tile" : ""}`}
                            onClick={() => {
                                if (roadExit && isPlayer && isCurrent) onCrossExit(roadExit);
                                else onSelectTile(index);
                            }}
                        >
                            {roadExit && (
                                <SectorGateMarker
                                    destinationSector={roadExit.destinationSector}
                                    direction={roadExit.direction}
                                    ready={isPlayer && isCurrent}
                                />
                            )}
                            {otherHere.length > 0 ? (
                                <div className="other-players-map-stack">
                                    {otherHere.map((player) => (
                                        <div key={player.name} className="other-player-map-dot" title={`${player.name} Lv ${player.level}`}>
                                            {player.avatarImage
                                                ? <img className="tiny-map-avatar other-player-map-avatar" src={player.avatarImage} alt={player.name} onError={(event) => { event.currentTarget.style.display = "none"; }} />
                                                : <span className="other-player-map-emoji">🥷</span>}
                                            <span className="other-player-map-name">{player.name}{player.sleeping ? " 💤" : ""}</span>
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

                <SectorAvatar
                    targetIndex={playerTile}
                    sector={sector}
                    avatarImage={playerAvatarImage}
                    name={playerName}
                    biome={ambienceBiome}
                />

                {overlayLayer}
                {!mapMode && <SectorForeground biome={ambienceBiome} focus={playerTile} />}
                {encounterLayer}
            </div>
        </main>
    );
}
