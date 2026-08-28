// Props and row shapes for WorldSectorCommandPanel.
//
// Split out of the component verbatim so the panel stays under the line
// ratchet in screens/WorldMap.projection.test.ts. That budget exists to keep
// commands and authority in WorldMap — type declarations are neither, so they
// live here and the panel re-exports them, leaving every existing import site
// (WorldMap.tsx, SectorIntelCard.tsx, the projection test) untouched.
import type { SectorTracesView } from "../lib/sector-traces";
import type { SectorPoolPlateView } from "../lib/sector-pool";
import type { SectorContractStatus } from "../lib/sector-contract";
import type { SectorIntelPlateView } from "../lib/village-intel";
import type { PlayerRecord } from "../types/character";
import type { Biome, WeatherType } from "../types/core";

export type WorldSectorCommandWar = Readonly<{
    playerVillage: string;
    enemyVillage?: string;
    warGroundHp: number;
    warGroundHpMax: number;
    enemyVillageHp: number;
    enemyVillageHpMax: number;
    ended: boolean;
}>;

export type WorldSectorCommandTerritory = Readonly<{
    isLive: boolean;
    isOwned: boolean;
    ownerLabel: string;
    rebuildMinsLeft: number;
    controlScore: number;
    hp: number;
    breached: boolean;
    breachMinsLeft: number;
    rewardsSuspended: boolean;
    guards: readonly string[];
    enemyControlled: boolean;
    war?: WorldSectorCommandWar;
}>;

export type WorldSectorCommandPlayerStatus = "Sleeping" | "Traveling" | "Fighting" | "Ready";

export type WorldSectorCommandPlayer = Readonly<{
    target: PlayerRecord;
    name: string;
    level: number;
    avatarSrc: string;
    status: WorldSectorCommandPlayerStatus;
    sleeping: boolean;
    actionDisabled: boolean;
}>;

export type WorldSectorCommandHunt = Readonly<{
    targetName: string;
    progress: number;
    requiredTracks: number;
    ready: boolean;
}>;

export type WorldSectorCommandPanelProps = Readonly<{
    sector: number;
    /** False while scouting; command controls become read-only. */
    present: boolean;
    biome: Biome;
    weather: WeatherType;
    territory: WorldSectorCommandTerritory | null;
    /** Shared daily gathering pool for this sector (explores / chests), viewer-sized. */
    gathering: SectorPoolPlateView | null;
    /** The day's posted contract and this player's standing on it (null = none today). */
    contract: SectorContractStatus | null;
    /** A claim is in flight — the card's button disables itself. */
    contractBusy: boolean;
    /** Village Intel on this sector as seen by the viewer's village (null = logged out / no intel block). */
    intel?: SectorIntelPlateView | null;
    villageWarAdmissionOpen: boolean;
    traces: SectorTracesView | null;
    hasLivePlayers: boolean;
    players: readonly WorldSectorCommandPlayer[];
    hunt: WorldSectorCommandHunt | null;
    onRaidEnemyVillage: () => void;
    onRaidControlledSector: () => void;
    onOpenSigns: () => void;
    onOpenShrine: () => void;
    onStrikeSleeper: (target: PlayerRecord) => void;
    onAttackPlayer: (target: PlayerRecord) => void;
    onClaimContract: () => void;
    onExplore: () => void;
    /** Depleted-pool replacement for Explore — points at the nearest richer sector. */
    onFindRicherGround: () => void;
    onHunt: () => void;
    onRecover: () => void;
    onLeave: () => void;
}>;
