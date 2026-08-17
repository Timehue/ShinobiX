import bankHero from "../assets/facilities/bank.webp";
import battleArenaHero from "../assets/facilities/battle-arena.webp";
import cafeteriaHero from "../assets/facilities/cafeteria.webp";
import cardHallHero from "../assets/facilities/card-hall.webp";
import hospitalHero from "../assets/facilities/hospital.webp";
import jutsuTrainingHero from "../assets/facilities/jutsu-training.webp";
import missionHallHero from "../assets/facilities/mission-hall.webp";
import petYardHero from "../assets/facilities/pet-yard.webp";
import homeHero from "../assets/facilities/home.webp";
import shopHero from "../assets/facilities/shop.webp";
import statTrainingHero from "../assets/facilities/stat-training.webp";
import storyHallHero from "../assets/facilities/story-hall.webp";
import tavernHero from "../assets/facilities/tavern.webp";
import worldMapHero from "../assets/facilities/world-map.webp";
import clanHallHero from "../assets/clan-exchange/clan-vault-hero.webp";
import townHallHero from "../assets/town-hall/town-hall-command-center.webp";
import type { Screen } from "../types/core";

export type FacilityId =
  | "battle-arena"
  | "story-hall"
  | "town-hall"
  | "bank"
  | "shop"
  | "clan-hall"
  | "hospital"
  | "mission-hall"
  | "cafeteria"
  | "tavern"
  | "stat-training"
  | "jutsu-training"
  | "world-map"
  | "home"
  | "pet-yard"
  | "card-hall";

export type FacilityPresentation = {
  name: string;
  screen: Screen;
  hero: string;
  accent: string;
  mapX: string;
  mapY: string;
  showOnVillageMap: boolean;
};

// Facility card icons are painted per village and resolved at render time via
// lib/facility-thumbs.ts. The village map shows the emblem plus the name only.
function facility(
  name: string, screen: Screen, hero: string,
  accent: string, mapX: string, mapY: string, showOnVillageMap = true,
): FacilityPresentation {
  return { name, screen, hero, accent, mapX, mapY, showOnVillageMap };
}

export const FACILITY_PRESENTATION: Record<FacilityId, FacilityPresentation> = {
  "battle-arena": facility("Battle Arena", "battleArena", battleArenaHero, "#ef7b62", "10%", "31%"),
  "story-hall": facility("Story Hall", "storyHall", storyHallHero, "#d4a8ff", "29%", "33%"),
  "town-hall": facility("Town Hall", "townHall", townHallHero, "#e6b85c", "50%", "22%"),
  bank: facility("Bank", "bank", bankHero, "#d9b35d", "68%", "31%"),
  shop: facility("Shop", "shop", shopHero, "#df9a55", "18%", "79%"),
  "clan-hall": facility("Clan Hall", "clan", clanHallHero, "#8fc6e8", "13%", "57%"),
  hospital: facility("Hospital", "hospital", hospitalHero, "#75d4a8", "66%", "56%"),
  "mission-hall": facility("Mission Hall", "missions", missionHallHero, "#d98769", "68%", "75%"),
  cafeteria: facility("Cafeteria", "cafeteria", cafeteriaHero, "#e59a56", "82%", "45%"),
  tavern: facility("Tavern", "tavern", tavernHero, "#c87e68", "82%", "63%"),
  "stat-training": facility("Stat Training", "training", statTrainingHero, "#dc805d", "83%", "25%"),
  "jutsu-training": facility("Jutsu Training", "jutsuTraining", jutsuTrainingHero, "#68cde6", "80%", "81%"),
  "world-map": facility("World Map", "worldMap", worldMapHero, "#78bfd2", "45%", "68%"),
  home: facility("Pet Home", "home", homeHero, "#8fca8d", "32%", "55%"),
  "pet-yard": facility("Pet Yard", "pets", petYardHero, "#8fca8d", "32%", "55%", false),
  "card-hall": facility("Card Hall", "shinobiTiles", cardHallHero, "#ab91e8", "52%", "55%"),
};

export type FacilityEntry = FacilityPresentation & { id: FacilityId };

// Object.entries loses the key type, so re-assert it — every entry carries its
// FacilityId so the Village map can resolve the per-village themed thumbnail.
export const VILLAGE_FACILITIES: FacilityEntry[] =
  (Object.entries(FACILITY_PRESENTATION) as [FacilityId, FacilityPresentation][])
    .map(([id, presentation]) => ({ id, ...presentation }))
    .filter((entry) => entry.showOnVillageMap);
