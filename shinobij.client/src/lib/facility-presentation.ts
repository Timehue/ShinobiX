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
import bankThumb from "../assets/facilities/thumbs/bank.webp";
import battleArenaThumb from "../assets/facilities/thumbs/battle-arena.webp";
import cafeteriaThumb from "../assets/facilities/thumbs/cafeteria.webp";
import cardHallThumb from "../assets/facilities/thumbs/card-hall.webp";
import clanHallThumb from "../assets/facilities/thumbs/clan-hall.webp";
import hospitalThumb from "../assets/facilities/thumbs/hospital.webp";
import jutsuTrainingThumb from "../assets/facilities/thumbs/jutsu-training.webp";
import missionHallThumb from "../assets/facilities/thumbs/mission-hall.webp";
import petYardThumb from "../assets/facilities/thumbs/pet-yard.webp";
import shopThumb from "../assets/facilities/thumbs/shop.webp";
import statTrainingThumb from "../assets/facilities/thumbs/stat-training.webp";
import storyHallThumb from "../assets/facilities/thumbs/story-hall.webp";
import tavernThumb from "../assets/facilities/thumbs/tavern.webp";
import townHallThumb from "../assets/facilities/thumbs/town-hall.webp";
import worldMapThumb from "../assets/facilities/thumbs/world-map.webp";
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
  thumbnail: string;
  eyebrow: string;
  accent: string;
  mapX: string;
  mapY: string;
};

function facility(
  name: string, screen: Screen, hero: string, thumbnail: string,
  eyebrow: string, accent: string, mapX: string, mapY: string,
): FacilityPresentation {
  return { name, screen, hero, thumbnail, eyebrow, accent, mapX, mapY };
}

export const FACILITY_PRESENTATION: Record<FacilityId, FacilityPresentation> = {
  "battle-arena": facility("Battle Arena", "battleArena", battleArenaHero, battleArenaThumb, "Combat district", "#ef7b62", "10%", "31%"),
  "story-hall": facility("Story Hall", "storyHall", storyHallHero, storyHallThumb, "Living archive", "#d4a8ff", "29%", "33%"),
  "town-hall": facility("Town Hall", "townHall", townHallHero, townHallThumb, "Village command", "#e6b85c", "50%", "22%"),
  bank: facility("Bank", "bank", bankHero, bankThumb, "Treasury district", "#d9b35d", "68%", "31%"),
  shop: facility("Shop", "shop", shopHero, shopThumb, "Merchant quarter", "#df9a55", "18%", "79%"),
  "clan-hall": facility("Clan Hall", "clan", clanHallHero, clanHallThumb, "Clan command", "#8fc6e8", "13%", "57%"),
  hospital: facility("Hospital", "hospital", hospitalHero, hospitalThumb, "Medical ward", "#75d4a8", "66%", "56%"),
  "mission-hall": facility("Mission Hall", "missions", missionHallHero, missionHallThumb, "Operations bureau", "#d98769", "68%", "75%"),
  cafeteria: facility("Cafeteria", "cafeteria", cafeteriaHero, cafeteriaThumb, "Village commons", "#e59a56", "82%", "45%"),
  tavern: facility("Tavern", "tavern", tavernHero, tavernThumb, "Night district", "#c87e68", "82%", "63%"),
  "stat-training": facility("Stat Training", "training", statTrainingHero, statTrainingThumb, "Training grounds", "#dc805d", "83%", "25%"),
  "jutsu-training": facility("Jutsu Training", "jutsuTraining", jutsuTrainingHero, jutsuTrainingThumb, "Chakra academy", "#68cde6", "80%", "81%"),
  "world-map": facility("World Map", "worldMap", worldMapHero, worldMapThumb, "Cartography tower", "#78bfd2", "45%", "68%"),
  "pet-yard": facility("Pet Yard", "pets", petYardHero, petYardThumb, "Companion sanctuary", "#8fca8d", "32%", "55%"),
  "card-hall": facility("Card Hall", "shinobiTiles", cardHallHero, cardHallThumb, "Strategy district", "#ab91e8", "52%", "55%"),
};

export const VILLAGE_FACILITIES = Object.values(FACILITY_PRESENTATION);
