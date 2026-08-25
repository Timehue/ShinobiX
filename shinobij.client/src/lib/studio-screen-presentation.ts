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
  facility?: FacilityPresentation;
};

const archive = {
  family: "archive",
  artwork: archiveArmory,
} as const;

const civic = {
  family: "civic",
  artwork: civicDistrict,
} as const;

const clan = {
  family: "clan",
  artwork: FACILITY_PRESENTATION["clan-hall"].hero,
} as const;

const combat = {
  family: "combat",
  artwork: combatCitadel,
} as const;

const companion = {
  family: "companion",
  artwork: companionSanctuary,
} as const;

const frontier = {
  family: "frontier",
  artwork: frontierOutpost,
} as const;

const town = {
  family: "town",
  artwork: FACILITY_PRESENTATION["town-hall"].hero,
} as const;

function atFacility(base: StudioScreenPresentation, facilityId: FacilityId): StudioScreenPresentation {
  const facility = FACILITY_PRESENTATION[facilityId];
  return { ...base, artwork: facility.hero, facility };
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
  battleLog: archive,
  training: atFacility(combat, "stat-training"),
  jutsuTraining: atFacility(combat, "jutsu-training"),
  missions: atFacility(archive, "mission-hall"),
  arena: atFacility(combat, "battle-arena"),
  battleArena: atFacility(combat, "battle-arena"),
  arenaDistrict: atFacility(combat, "battle-arena"),
  bloodlineMaker: archive,
  clan: atFacility(clan, "clan-hall"),
  worldMap: atFacility(frontier, "world-map"),
  worldCrisis: frontier,
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
  petShowdown: atFacility(companion, "pet-yard"),
  // The paid Coliseum bout shares the Showdown presentation — same arena.
  petColiseum: atFacility(companion, "pet-yard"),
  petLadder: atFacility(companion, "pet-yard"),
  home: atFacility(companion, "home"),
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
  sectorGarrison: combat,
  clanWarPet: companion,
  clanWar2v2: combat,
  cardClashFreePlay: atFacility(combat, "card-hall"),
  guides: archive,
  messages: civic,
};
