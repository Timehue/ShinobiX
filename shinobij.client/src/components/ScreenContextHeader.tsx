import type { IconType } from "react-icons";
import {
  GiAnvil,
  GiBattleGear,
  GiBookCover,
  GiCastle,
  GiFireSpellCast,
  GiKnapsack,
  GiNinjaHeroicStance,
  GiPawPrint,
  GiScrollUnfurled,
  GiShop,
  GiTempleGate,
  GiTreasureMap,
} from "react-icons/gi";
import type { Screen } from "../types/core";

type ContextDefinition = {
  eyebrow: string;
  title: string;
  description: string;
  icon: IconType;
};

const fallback: ContextDefinition = {
  eyebrow: "Shinobi record",
  title: "Shinobi Journey",
  description: "Your current path through the living world.",
  icon: GiTempleGate,
};

const screenContext: Partial<Record<Screen, ContextDefinition>> = {
  adminLogin: { eyebrow: "Secure access", title: "Administration", description: "Authorized studio operations access.", icon: GiCastle },
  adminPanel: { eyebrow: "Studio operations", title: "Administration", description: "Manage live content, players, and world systems.", icon: GiCastle },
  professionPicker: { eyebrow: "Career path", title: "Choose a Profession", description: "Select the discipline that shapes your trade skills.", icon: GiAnvil },
  professions: { eyebrow: "Career mastery", title: "Professions", description: "Develop trade skills, recipes, and mastery rewards.", icon: GiAnvil },
  village: { eyebrow: "Home territory", title: "Village", description: "Village services, training, and local paths.", icon: GiTempleGate },
  villageLore: { eyebrow: "Village archive", title: "Village Lore", description: "History, leaders, and the identity of your home.", icon: GiBookCover },
  centralHub: { eyebrow: "Hidden district", title: "Central Hub", description: "Bloodlines, legacies, and advanced systems.", icon: GiCastle },
  worldMap: { eyebrow: "World operation", title: "World Map", description: "Travel sectors, territory, and active encounters.", icon: GiTreasureMap },
  profile: { eyebrow: "Shinobi dossier", title: "Character", description: "Identity, progression, combat record, and legacy.", icon: GiNinjaHeroicStance },
  inventory: { eyebrow: "Field loadout", title: "Inventory & Equipment", description: "Inspect, equip, and manage carried items.", icon: GiKnapsack },
  training: { eyebrow: "Growth discipline", title: "Training Grounds", description: "Choose a stat and commit to a timed training session.", icon: GiAnvil },
  jutsuTraining: { eyebrow: "Technique archive", title: "Jutsu Training", description: "Prepare your loadout and develop learned techniques.", icon: GiFireSpellCast },
  missions: { eyebrow: "Mission command", title: "Mission Hall", description: "Review requirements, risks, progress, and rewards.", icon: GiScrollUnfurled },
  hunting: { eyebrow: "Hunter command", title: "Hunter Board", description: "Track assigned targets and hunt progress.", icon: GiScrollUnfurled },
  logbook: { eyebrow: "Journey record", title: "Logbook", description: "Track objectives, unlocks, and current progression goals.", icon: GiBookCover },
  arena: { eyebrow: "Combat operation", title: "Battle Arena", description: "Tactical combat, resources, and turn control.", icon: GiBattleGear },
  battleArena: { eyebrow: "Combat district", title: "Battle Arena", description: "Choose a battle path and prepare your loadout.", icon: GiBattleGear },
  arenaDistrict: { eyebrow: "Combat district", title: "Arena District", description: "Competitive and tactical battle systems.", icon: GiBattleGear },
  clan: { eyebrow: "Shinobi alliance", title: "Clan Hall", description: "Clan membership, shared progress, and coordinated action.", icon: GiCastle },
  pets: { eyebrow: "Companion command", title: "Pet Yard", description: "Companion roster, growth, and battle readiness.", icon: GiPawPrint },
  petArena: { eyebrow: "Companion combat", title: "Pet Arena", description: "Prepare companions and enter pet battles.", icon: GiPawPrint },
  petLadder: { eyebrow: "Companion rankings", title: "Pet Ladder", description: "Review ranked standings and seasonal progress.", icon: GiPawPrint },
  townHall: { eyebrow: "Village command", title: "Town Hall", description: "Upgrades, village impact, and shared resources.", icon: GiCastle },
  bank: { eyebrow: "Secure holdings", title: "Bank", description: "Manage protected currency and account transfers.", icon: GiShop },
  shop: { eyebrow: "Village commerce", title: "Shop", description: "Review exact costs, owned currency, and item contents.", icon: GiShop },
  grandMarketplace: { eyebrow: "World commerce", title: "Grand Marketplace", description: "Browse available goods and exact purchase costs.", icon: GiShop },
  hospital: { eyebrow: "Recovery ward", title: "Hospital", description: "Restore battle readiness and review treatment options.", icon: GiTempleGate },
  cafeteria: { eyebrow: "Village provisions", title: "Cafeteria", description: "Prepare meals and temporary field advantages.", icon: GiShop },
  storyHall: { eyebrow: "Story campaign", title: "Story Hall", description: "Continue narrative chapters and review available encounters.", icon: GiBookCover },
  storyBoss: { eyebrow: "Story operation", title: "Boss Encounter", description: "Review the threat, prepare, and confront the chapter boss.", icon: GiBattleGear },
  sunscarFestival: { eyebrow: "Limited event", title: "Sunscar Festival", description: "Festival activities, rewards, and event progress.", icon: GiFireSpellCast },
  shinobiTiles: { eyebrow: "Tactical diversion", title: "Shinobi Tiles", description: "Build combinations and pursue board objectives.", icon: GiBattleGear },
  eventPetBattle: { eyebrow: "Event operation", title: "Event Pet Battle", description: "Deploy a companion against the active event challenge.", icon: GiPawPrint },
  eventTiles: { eyebrow: "Event operation", title: "Event Tiles", description: "Complete the limited board challenge and earn rewards.", icon: GiBattleGear },
  dungeon: { eyebrow: "Expedition operation", title: "Dungeon", description: "Advance through encounters, risks, and expedition rewards.", icon: GiCastle },
  bloodlineMaker: { eyebrow: "Spirit lineage", title: "Bloodline Forge", description: "Rare lineage techniques and permanent identity choices.", icon: GiFireSpellCast },
  tavern: { eyebrow: "Village gathering", title: "Tavern", description: "Hear local leads, meet contacts, and choose your next stop.", icon: GiTempleGate },
  hallOfLegends: { eyebrow: "Prestige archive", title: "Hall of Legends", description: "Rankings, records, and accomplished shinobi.", icon: GiCastle },
  shinobiCouncil: { eyebrow: "World governance", title: "Shinobi Council", description: "Review council affairs, leadership, and world decisions.", icon: GiCastle },
  userHub: { eyebrow: "Shinobi network", title: "Users", description: "Find active players and open their public dossiers.", icon: GiNinjaHeroicStance },
  userView: { eyebrow: "Public dossier", title: "Shinobi Profile", description: "Inspect another player's record and available interactions.", icon: GiNinjaHeroicStance },
  pvpBattle: { eyebrow: "Live combat", title: "Shinobi Duel", description: "Track turn state, resources, and tactical actions.", icon: GiBattleGear },
  hollowGateShrine: { eyebrow: "Forbidden frontier", title: "Hollow Gate Shrine", description: "Prepare attunement and enter the Hollow Gate.", icon: GiTempleGate },
  hollowGateTiles: { eyebrow: "Hollow Gate trial", title: "Hollow Gate", description: "Navigate the unstable board and survive its threats.", icon: GiBattleGear },
  endlessTower: { eyebrow: "Endurance operation", title: "Endless Tower", description: "Prepare for escalating floors and persistent rewards.", icon: GiCastle },
  battleTowers: { eyebrow: "Tower operation", title: "Battle Towers", description: "Choose a tower, inspect conditions, and begin the climb.", icon: GiCastle },
  weeklyBoss: { eyebrow: "Weekly operation", title: "Weekly Boss", description: "Review the active threat and coordinate your assault.", icon: GiBattleGear },
  villageWar: { eyebrow: "Territory command", title: "Village War", description: "Review the campaign state, objectives, and contributions.", icon: GiBattleGear },
  villageWarMap: { eyebrow: "Territory operation", title: "Village War Map", description: "Inspect contested sectors and choose a deployment.", icon: GiTreasureMap },
  tilecardsDuel: { eyebrow: "Tactical duel", title: "Tilecards Duel", description: "Control the board and outmaneuver the opposing shinobi.", icon: GiBattleGear },
  sectorCard: { eyebrow: "Sector conflict", title: "Card Clash", description: "Resolve the sector with a tactical card battle.", icon: GiBattleGear },
  sectorPet: { eyebrow: "Sector conflict", title: "Pet Battle", description: "Deploy a companion to contest this sector.", icon: GiPawPrint },
  cardClashFreePlay: { eyebrow: "Practice match", title: "Card Clash", description: "Test decks and tactics without campaign stakes.", icon: GiBattleGear },
  guides: { eyebrow: "Shinobi archive", title: "Guides", description: "Reference systems, rules, and progression advice.", icon: GiBookCover },
  messages: { eyebrow: "Shinobi network", title: "Mail", description: "Read correspondence and manage player messages.", icon: GiScrollUnfurled },
};

export function ScreenContextHeader({ screen, village }: { screen: Screen; village: string }) {
  const context = screenContext[screen] ?? fallback;
  const Icon = context.icon;
  const villageLabel = village.replace(/\s+Village$/i, "");
  return (
    <div className="journey-context" aria-label={`${context.title} screen`}>
      <span className="journey-context-icon" aria-hidden="true"><Icon /></span>
      <span className="journey-context-copy">
        <span className="journey-context-eyebrow">{context.eyebrow}</span>
        <strong>{context.title}</strong>
        <span className="journey-context-description">{context.description}</span>
      </span>
      <span className="journey-context-village" title={village}>{villageLabel}</span>
    </div>
  );
}
