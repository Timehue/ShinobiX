import type { PendingTravelSave } from "./player-accounts";
import type { TileCard } from "../data/tile-cards";
import { type Biome } from "../types/core";
import { type Pet } from "../types/pet";
import { type Jutsu, type GameItem, type SavedBloodline, type ActiveTraining, type ActiveJutsuTraining } from "../types/combat";
import type { CreatorEvent } from "../types/vn";
import { type HollowGateEventConfig, type Character } from "../types/character";
import { type CreatorAi } from "../types/creator-ai";
import { type CreatorMission, type CreatorRaid } from "../types/missions";

export type PlayerSaveFields = {
    currentBiome: Biome;
    activeTraining: ActiveTraining | null;
    activeJutsuTraining: ActiveJutsuTraining | null;
    acceptedMissionIds: string[];
    missionProgress: Record<string, number>;
    triggeredEvents: string[];
    currentSector: number;
    pendingTravel: PendingTravelSave | null;
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
    creatorAis: CreatorAi[];
    creatorEvents: CreatorEvent[];
    creatorMissions: CreatorMission[];
    creatorRaids: CreatorRaid[];
    creatorCards: TileCard[];
    creatorItems: GameItem[];
    petEncounterVn: CreatorEvent;
    ancientChestVn: CreatorEvent;
    editablePets: Pet[];
    hollowGateEventConfig: HollowGateEventConfig | null;
};

export type PlayerSavePayload = PlayerSaveFields & { character: Character };
export type PlayerSaveOverrides = Partial<Pick<PlayerSaveFields, 'savedBloodlines'>>;
export type PlayerSaveSnapshot = Partial<PlayerSaveFields> & { character: Character };
