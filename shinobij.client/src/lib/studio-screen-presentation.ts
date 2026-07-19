import archiveArmory from "../assets/studio/archive-armory.webp";
import civicDistrict from "../assets/studio/civic-district.webp";
import combatCitadel from "../assets/studio/combat-citadel.webp";
import companionSanctuary from "../assets/studio/companion-sanctuary.webp";
import frontierOutpost from "../assets/studio/frontier-outpost.webp";
import { FACILITY_PRESENTATION, type FacilityId, type FacilityPresentation } from "./facility-presentation";
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
  facility?: FacilityPresentation;
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
  artwork: FACILITY_PRESENTATION["clan-hall"].hero,
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
  artwork: FACILITY_PRESENTATION["town-hall"].hero,
  eyebrow: "Village command",
  description: "Direct village growth, defenses, and shared resources.",
} as const;

function atFacility(base: StudioScreenPresentation, facilityId: FacilityId): StudioScreenPresentation {
  const facility = FACILITY_PRESENTATION[facilityId];
  return { ...base, artwork: facility.hero, eyebrow: facility.eyebrow, facility };
}

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
  training: atFacility(combat, "stat-training"),
  jutsuTraining: atFacility(combat, "jutsu-training"),
  missions: atFacility(archive, "mission-hall"),
  arena: atFacility(combat, "battle-arena"),
  battleArena: atFacility(combat, "battle-arena"),
  arenaDistrict: atFacility(combat, "battle-arena"),
  bloodlineMaker: archive,
  clan: atFacility(clan, "clan-hall"),
  worldMap: atFacility(frontier, "world-map"),
  townHall: atFacility(town, "town-hall"),
  bank: atFacility(civic, "bank"),
  shop: atFacility(civic, "shop"),
  grandMarketplace: atFacility(civic, "shop"),
  hospital: atFacility(civic, "hospital"),
  cafeteria: atFacility(civic, "cafeteria"),
  storyHall: atFacility(archive, "story-hall"),
  storyBoss: combat,
  sunscarFestival: civic,
  centralHub: archive,
  petArena: atFacility(companion, "pet-yard"),
  petLadder: atFacility(companion, "pet-yard"),
  pets: atFacility(companion, "pet-yard"),
  shinobiTiles: atFacility(combat, "card-hall"),
  eventPetBattle: companion,
  eventTiles: combat,
  dungeon: frontier,
  hunting: frontier,
  tavern: atFacility(civic, "tavern"),
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
  cardClashFreePlay: atFacility(combat, "card-hall"),
  guides: archive,
  messages: civic,
};
