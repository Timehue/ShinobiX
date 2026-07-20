import bankHero from "../assets/facilities/bank.webp";
import battleArenaHero from "../assets/facilities/battle-arena.webp";
import cafeteriaHero from "../assets/facilities/cafeteria.webp";
import cardHallHero from "../assets/facilities/card-hall.webp";
import hospitalHero from "../assets/facilities/hospital.webp";
import jutsuTrainingHero from "../assets/facilities/jutsu-training.webp";
import missionHallHero from "../assets/facilities/mission-hall.webp";
import petYardHero from "../assets/facilities/pet-yard.webp";
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
  | "pet-yard"
  | "card-hall";

export type FacilityPresentation = {
  name: string;
  screen: Screen;
  hero: string;
  eyebrow: string;
  accent: string;
  mapX: string;
  mapY: string;
};

// Facility card thumbnails are no longer part of this contract — they are painted
// per village and resolved at render time via lib/facility-thumbs.ts.
function facility(
  name: string, screen: Screen, hero: string,
  eyebrow: string, accent: string, mapX: string, mapY: string,
): FacilityPresentation {
  return { name, screen, hero, eyebrow, accent, mapX, mapY };
}

export const FACILITY_PRESENTATION: Record<FacilityId, FacilityPresentation> = {
  "battle-arena": facility("Battle Arena", "battleArena", battleArenaHero, "Combat district", "#ef7b62", "10%", "31%"),
  "story-hall": facility("Story Hall", "storyHall", storyHallHero, "Living archive", "#d4a8ff", "29%", "33%"),
  "town-hall": facility("Town Hall", "townHall", townHallHero, "Village command", "#e6b85c", "50%", "22%"),
  bank: facility("Bank", "bank", bankHero, "Treasury district", "#d9b35d", "68%", "31%"),
  shop: facility("Shop", "shop", shopHero, "Merchant quarter", "#df9a55", "18%", "79%"),
  "clan-hall": facility("Clan Hall", "clan", clanHallHero, "Clan command", "#8fc6e8", "13%", "57%"),
  hospital: facility("Hospital", "hospital", hospitalHero, "Medical ward", "#75d4a8", "66%", "56%"),
  "mission-hall": facility("Mission Hall", "missions", missionHallHero, "Operations bureau", "#d98769", "68%", "75%"),
  cafeteria: facility("Cafeteria", "cafeteria", cafeteriaHero, "Village commons", "#e59a56", "82%", "45%"),
  tavern: facility("Tavern", "tavern", tavernHero, "Night district", "#c87e68", "82%", "63%"),
  "stat-training": facility("Stat Training", "training", statTrainingHero, "Training grounds", "#dc805d", "83%", "25%"),
  "jutsu-training": facility("Jutsu Training", "jutsuTraining", jutsuTrainingHero, "Chakra academy", "#68cde6", "80%", "81%"),
  "world-map": facility("World Map", "worldMap", worldMapHero, "Cartography tower", "#78bfd2", "45%", "68%"),
  "pet-yard": facility("Pet Yard", "pets", petYardHero, "Companion sanctuary", "#8fca8d", "32%", "55%"),
  "card-hall": facility("Card Hall", "shinobiTiles", cardHallHero, "Strategy district", "#ab91e8", "52%", "55%"),
};

export type FacilityEntry = FacilityPresentation & { id: FacilityId };

// Object.entries loses the key type, so re-assert it — every entry carries its
// FacilityId so the Village map can resolve the per-village themed thumbnail.
export const VILLAGE_FACILITIES: FacilityEntry[] =
  (Object.entries(FACILITY_PRESENTATION) as [FacilityId, FacilityPresentation][])
    .map(([id, presentation]) => ({ id, ...presentation }));
