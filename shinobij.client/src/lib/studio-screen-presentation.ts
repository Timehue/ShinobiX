import archiveArmory from "../assets/studio/archive-armory.webp";
import civicDistrict from "../assets/studio/civic-district.webp";
import combatCitadel from "../assets/studio/combat-citadel.webp";
import companionSanctuary from "../assets/studio/companion-sanctuary.webp";
import frontierOutpost from "../assets/studio/frontier-outpost.webp";
import clanVault from "../assets/clan-exchange/clan-vault-hero.webp";
import townHallCommandCenter from "../assets/town-hall/town-hall-command-center.webp";
import type { Screen } from "../types/core";

export type StudioScreenFamily =
  | "archive"
  | "civic"
  | "clan"
  | "combat"
  | "companion"
  | "frontier"
  | "town";

export type StudioScreenPresentation = {
  family: StudioScreenFamily;
  artwork: string;
  eyebrow: string;
  description: string;
};

const archive = {
  family: "archive",
  artwork: archiveArmory,
  eyebrow: "Shinobi records",
  description: "Review your intelligence, equipment, progress, and standing.",
} as const;

const civic = {
  family: "civic",
  artwork: civicDistrict,
  eyebrow: "Village services",
  description: "Manage resources, recovery, trade, and local connections.",
} as const;

const clan = {
  family: "clan",
  artwork: clanVault,
  eyebrow: "Clan command",
  description: "Coordinate your alliance, shared progress, and rewards.",
} as const;

const combat = {
  family: "combat",
  artwork: combatCitadel,
  eyebrow: "Combat operations",
  description: "Prepare your loadout, training, and next tactical engagement.",
} as const;

const companion = {
  family: "companion",
  artwork: companionSanctuary,
  eyebrow: "Companion command",
  description: "Develop your roster, mastery, and battle readiness.",
} as const;

const frontier = {
  family: "frontier",
  artwork: frontierOutpost,
  eyebrow: "Frontier operations",
  description: "Assess the field, active threats, and expedition objectives.",
} as const;

const town = {
  family: "town",
  artwork: townHallCommandCenter,
  eyebrow: "Village command",
  description: "Direct village growth, defenses, and shared resources.",
} as const;

export const STUDIO_SCREEN_PRESENTATION: Record<Screen, StudioScreenPresentation> = {
  start: archive,
  adminLogin: archive,
  adminPanel: archive,
  professionPicker: companion,
  professions: companion,
  village: civic,
  profile: archive,
  inventory: archive,
  logbook: archive,
  training: combat,
  jutsuTraining: combat,
  missions: archive,
  arena: combat,
  battleArena: combat,
  arenaDistrict: combat,
  bloodlineMaker: archive,
  clan,
  worldMap: frontier,
  townHall: town,
  bank: civic,
  shop: civic,
  grandMarketplace: civic,
  hospital: civic,
  cafeteria: civic,
  storyHall: archive,
  storyBoss: combat,
  sunscarFestival: civic,
  centralHub: archive,
  petArena: companion,
  petLadder: companion,
  pets: companion,
  shinobiTiles: combat,
  eventPetBattle: companion,
  eventTiles: combat,
  dungeon: frontier,
  hunting: frontier,
  tavern: civic,
  hallOfLegends: archive,
  shinobiCouncil: town,
  userHub: archive,
  userView: archive,
  pvpBattle: combat,
  hollowGateShrine: frontier,
  hollowGateTiles: frontier,
  endlessTower: combat,
  battleTowers: combat,
  weeklyBoss: frontier,
  villageWar: frontier,
  villageWarMap: frontier,
  tilecardsDuel: combat,
  sectorCard: combat,
  sectorPet: companion,
  cardClashFreePlay: combat,
  guides: archive,
  messages: civic,
};
