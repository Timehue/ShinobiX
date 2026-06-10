/*
 * Shared world/game state — the polled, server-backed shared caches and their
 * full helper web, extracted verbatim from App.tsx:
 *   • sector territory (cache + load/save/damage/supply + scroll items)
 *   • village wars (cache + declare/damage/outcome/raid/daily-mission helpers)
 *   • village state (cache + load/save/normalize + kage unlock)
 *   • war crates (claimPendingWarCrates)
 *   • arena spectator fights / tournament / pending clan pet battle /
 *     weekly-boss AI override (caches + hydrateSharedGameState)
 * The caches are reassigned by the hydrate functions, so cache + every
 * reassigner live here together (an imported binding cannot be reassigned).
 * App polls via hydrateSharedWorldState/hydrateSharedGameState and the
 * persist* writers POST changes back.
 */
import type { Biome, WeatherType } from "../types/core";
import type { Character, PlayerRecord } from "../types/character";
import type { NoticePost } from "../types/clan";
import { CW_DAMAGE } from "../constants/clan";
import { GAME_STATE_API, LEGENDARY_WAR_CRATE_ID, TERRITORY_CONTROL_MAX, TERRITORY_CONTROL_SCROLL_ID, TERRITORY_DAILY_WAR_SUPPLY, TERRITORY_HP_MAX, TERRITORY_SUPPLY_INTERVAL_MS, WAR_CRATE_EXPIRY_MS, WORLD_STATE_API } from "../constants/game";
import type { TreasuryItemStack } from "./items";
import { villages } from "../data/sectors";
import { biomeWeatherTables } from "../data/world";
import { clampNumber, currentDateKey, currentMonthKey } from "./utils";
import { cleanVillageTreasury, defaultVillageTreasury, makeVillageDailyAgenda, normalizeAnbuAppointees, normalizeKageChallenges, normalizeVillageDailyAgenda } from "./village-state";
import { makeNoticePost, normalizeNoticePosts } from "./clan-notices";
import { sharedClanWarCache } from "./clan-war-api";
import { nonVanguardCharmSubstitute, nonVanguardShardSubstitute, vanguardOnlyHonorSeals, villageLeadership } from "../App";

export type VillageWarRecord = {
    id: string;
    villages: [string, string];
    hp?: Record<string, number>;
    warGroundSector: number;
    warGroundHp: number;
    startedAt: number;
    updatedAt: number;
    capturedBy?: string;
    capturedAt?: number;
    winnerVillage?: string;
    endedAt?: number;
    warCrateId?: string;
    contributions?: Record<string, { damage: number; raids: number; pvpKills: number; side: string; name: string }>;
    mvpByVillage?: Record<string, string>;
    loserCrateId?: string;
    pendingUntil?: number;
};

export type TerritoryRecord = {
    sector: number;
    ownerClan?: string;
    ownerVillage?: string;
    hp: number;
    controlScore?: number;
    warSupply: number;
};

export type ArenaTournament = {
    id: string;
    name: string;
    createdBy: string;
    startsAt: number;
    endsAt: number;
    matchDeadline: number;
    participants: string[];
    advancedPlayers: string[];
};
export type ArenaSpectatorFight = { id: string; title: string; mode: string; startedAt: number; fighters: string[]; battleId?: string; biome?: string };
type PendingClanPetBattle = { clanName?: string; points: number; opponentName: string; createdAt: number };
let sharedArenaTournamentCache: ArenaTournament | null = null;
let sharedArenaActiveFightsCache: ArenaSpectatorFight[] = [];
/** Fights registered locally that haven't been confirmed by the server yet.
 *  Kept for up to 60s so CDN cache staleness doesn't wipe them. */
const locallyRegisteredFights = new Map<string, ArenaSpectatorFight>();
let sharedPendingClanPetBattleCache: PendingClanPetBattle | null = null;
let sharedGameStateOwnerName = "";
export function setSharedGameStateOwnerName(v: string) { sharedGameStateOwnerName = v; }
export let sharedWeeklyBossAiIdCache: string = "";
export function setSharedWeeklyBossAiId(v: string) { sharedWeeklyBossAiIdCache = v; }

export function loadArenaTournament(): ArenaTournament | null {
    return sharedArenaTournamentCache;
}

export function saveArenaTournament(tournament: ArenaTournament | null) {
    sharedArenaTournamentCache = tournament;
    persistSharedGameState({ kind: "arenaTournament", tournament });
}

export function loadArenaActiveFights(): ArenaSpectatorFight[] {
    return sharedArenaActiveFightsCache.filter((fight) => Date.now() - fight.startedAt < 2 * 60 * 60 * 1000);
}

export function saveArenaActiveFights(fights: ArenaSpectatorFight[]) {
    sharedArenaActiveFightsCache = fights.slice(0, 20);
    // Track locally-added fights so CDN-stale hydrations don't wipe them
    for (const f of sharedArenaActiveFightsCache) locallyRegisteredFights.set(f.id, f);
    persistSharedGameState({ kind: "arenaActiveFights", fights: sharedArenaActiveFightsCache });
}

export function unregisterLocalFight(fightId: string) {
    locallyRegisteredFights.delete(fightId);
}

export function loadPendingClanPetBattle(): PendingClanPetBattle | null {
    const battle = sharedPendingClanPetBattleCache;
    if (!battle || Date.now() - battle.createdAt > 24 * 60 * 60 * 1000) return null;
    return battle;
}

export function savePendingClanPetBattle(battle: PendingClanPetBattle | null) {
    sharedPendingClanPetBattleCache = battle;
    if (sharedGameStateOwnerName) {
        persistSharedGameState({ kind: "pendingClanPetBattle", ownerName: sharedGameStateOwnerName, battle });
    }
}

let lastSharedGameStateSnapshot = "";
export function hydrateSharedGameState(data: {
    villageStates?: Record<string, unknown> | (Partial<VillageState> & { village?: string })[];
    arenaTournament?: ArenaTournament | null;
    arenaActiveFights?: ArenaSpectatorFight[];
    pendingClanPetBattle?: PendingClanPetBattle | null;
    clanPetBattles?: Record<string, PendingClanPetBattle>;
    weeklyBossAiId?: string | null;
}): boolean {
    const villageStates: Record<string, VillageState> = {};
    const rawVS = data.villageStates;
    if (Array.isArray(rawVS)) {
        // Legacy array format
        rawVS.forEach((state) => {
            const village = String(state?.village ?? "").trim();
            if (!village) return;
            villageStates[sharedVillageStateKey(village)] = normalizeVillageState(village, state);
        });
    } else if (rawVS && typeof rawVS === "object") {
        // Server returns object keyed by village name
        for (const [key, state] of Object.entries(rawVS)) {
            if (!state || typeof state !== "object") continue;
            const village = key.trim();
            if (!village) continue;
            villageStates[sharedVillageStateKey(village)] = normalizeVillageState(village, state as Partial<VillageState>);
        }
    }
    sharedVillageStateCache = villageStates;
    // Leadership portraits no longer ride the 5s frame (see refreshLeadershipImages
    // and api/game-state.ts ?images=1) — don't touch the cache here, or an absent
    // field would wipe the loaded portraits every poll.
    sharedArenaTournamentCache = data.arenaTournament ?? null;
    const serverFights = Array.isArray(data.arenaActiveFights)
        ? data.arenaActiveFights.filter((fight: ArenaSpectatorFight) => Date.now() - fight.startedAt < 2 * 60 * 60 * 1000)
        : [];
    // Merge locally-registered fights that the server hasn't reflected yet (CDN cache lag).
    // Once a fight appears on the server, remove it from local tracking.
    const serverFightIds = new Set(serverFights.map((f: ArenaSpectatorFight) => f.id));
    const now = Date.now();
    for (const [id, f] of locallyRegisteredFights) {
        if (serverFightIds.has(id)) { locallyRegisteredFights.delete(id); continue; }
        // Keep local fights for up to 60s to survive CDN staleness
        if (now - f.startedAt > 60_000) { locallyRegisteredFights.delete(id); continue; }
        serverFights.push(f);
    }
    sharedArenaActiveFightsCache = serverFights.slice(0, 20);
    // Server returns clanPetBattles as object keyed by clan name; also support legacy singular field
    let pendingBattle: PendingClanPetBattle | null = null;
    if (data.pendingClanPetBattle) {
        pendingBattle = data.pendingClanPetBattle;
    } else if (data.clanPetBattles && typeof data.clanPetBattles === "object") {
        const entries = Object.values(data.clanPetBattles) as PendingClanPetBattle[];
        pendingBattle = entries.find(b => b && Date.now() - b.createdAt <= 24 * 60 * 60 * 1000) ?? null;
    }
    sharedPendingClanPetBattleCache = pendingBattle && Date.now() - pendingBattle.createdAt <= 24 * 60 * 60 * 1000
        ? pendingBattle
        : null;
    sharedWeeklyBossAiIdCache = data.weeklyBossAiId ?? "";
    // See hydrateSharedWorldState: report change so the 5s poller skips the
    // wasted full-app re-render when the server payload is unchanged.
    const snapshot = JSON.stringify([
        sharedVillageStateCache,
        sharedArenaTournamentCache, sharedArenaActiveFightsCache,
        sharedPendingClanPetBattleCache, sharedWeeklyBossAiIdCache,
    ]);
    const changed = snapshot !== lastSharedGameStateSnapshot;
    lastSharedGameStateSnapshot = snapshot;
    return changed;
}

// rankedDelta moved to ./lib/progression.

/**
 * A short, cosmetic sprite animation played over a struck tile when a jutsu's
 * element has bundled CC0 FX frames (or a KV `jutsufx:` override). Cycles a
 * frame sequence then unmounts via onDone; a single-image source (e.g. an
 * animated GIF/WebP override) is just held briefly and self-animates. Pixel
 * art, never interactive. Remount per cast by keying on the FX id.
 */

export type VillageTreasury = { ryo: number; honorSeals: number; fateShards: number; boneCharms: number; auraStones: number; mythicSeals: number; items: TreasuryItemStack[]; };
export type VillageTreasuryCurrencyKey = Exclude<keyof VillageTreasury, "items">;
type DetailedVillageWarRecord = { opponent: string; winner: string; finalScore: string; topDefender: string; topAttacker: string; mvpClan: string; rewards: string; date: string; };
export type KageHistoryEntry = { name: string; village: string; seatedAt: number; endedAt?: number };
type VillageAgendaKind = "missions" | "explore" | "ai" | "pet" | "control";
export type VillageAgendaTask = { id: string; kind: VillageAgendaKind; label: string; target: number };
export type VillageDailyAgenda = { date: string; tasks: VillageAgendaTask[] };
export type KageChallengeStatus = "open" | "supported" | "accepted" | "ready" | "resolved" | "expired";
export type KageChallenge = {
    id: string;
    village: string;
    challenger: string;
    seatedKage: string;
    status: KageChallengeStatus;
    createdAt: number;
    support: string[];
    opposition: string[];
    acceptedAt?: number;
    readyWindowEndsAt?: number;
    challengerReadyAt?: number;
    kageReadyAt?: number;
    officialDuelSentAt?: number;
    battleId?: string;
    winner?: string;
    resolvedAt?: number;
    contributionRequired: number;
};
export type VillageState = { treasury: VillageTreasury; contributionPoints: number; notices: string[]; noticePosts: NoticePost[]; warRecords: DetailedVillageWarRecord[]; kageSystemUnlocked: boolean; firstLiberator?: string; seatedKage?: string; anbuAppointees: string[]; kageHistory?: KageHistoryEntry[]; kageChallenges: KageChallenge[]; dailyAgenda: VillageDailyAgenda; hollowGateUnlocked?: boolean; };
function defaultVillageWarRecords(village: string): DetailedVillageWarRecord[] { const leadership = villageLeadership[village]; return (leadership?.pastWars ?? ["No recorded wars yet."]).map((war, index) => ({ opponent: war.replace(/^Won |^Lost |^Draw at /, ""), winner: war.startsWith("Won") ? village : war.startsWith("Lost") ? "Enemy Village" : "Draw", finalScore: index === 0 ? "112 - 88" : index === 1 ? "76 - 91" : "64 - 64", topDefender: leadership?.elders?.[index % 3] ?? "Village Guard", topAttacker: leadership?.kage ?? "Kage Council", mvpClan: index === 0 ? "Fated Reunion" : "Unclaimed", rewards: index === 0 ? "Village XP / guard medals" : "Archive record", date: index === 0 ? "Recent Season" : "Previous Season" })); }
function defaultVillageState(village: string): VillageState { const notices = ["Town Hall upgrades are open for donation funding.", "Village Guard queue is accepting defenders."]; return { treasury: defaultVillageTreasury(), contributionPoints: 0, notices, noticePosts: normalizeNoticePosts(undefined, notices), warRecords: defaultVillageWarRecords(village), kageSystemUnlocked: false, anbuAppointees: ["", "", ""], kageChallenges: [], dailyAgenda: makeVillageDailyAgenda(village), hollowGateUnlocked: false }; }
function sharedVillageStateKey(village: string) { return village.toLowerCase().replace(/[^a-z0-9]/g, ""); }
let sharedVillageStateCache: Record<string, VillageState> = {};
export function normalizeVillageState(village: string, state?: Partial<VillageState>): VillageState { const base = defaultVillageState(village); const notices = state?.notices?.length ? state.notices.slice(0, 8) : base.notices; return { treasury: cleanVillageTreasury(state?.treasury), contributionPoints: Math.max(0, Math.floor(Number(state?.contributionPoints ?? 0))), notices, noticePosts: normalizeNoticePosts(state?.noticePosts, state?.noticePosts?.length ? [] : notices), warRecords: state?.warRecords?.length ? state.warRecords : base.warRecords, kageSystemUnlocked: Boolean(state?.kageSystemUnlocked ?? base.kageSystemUnlocked), firstLiberator: state?.firstLiberator ?? base.firstLiberator, seatedKage: state?.seatedKage ?? base.seatedKage, anbuAppointees: normalizeAnbuAppointees(state?.anbuAppointees), kageHistory: state?.kageHistory ?? [], kageChallenges: normalizeKageChallenges(village, state?.kageChallenges), dailyAgenda: normalizeVillageDailyAgenda(village, state?.dailyAgenda), hollowGateUnlocked: Boolean(state?.hollowGateUnlocked ?? base.hollowGateUnlocked) }; }
export function loadVillageState(village: string): VillageState { return sharedVillageStateCache[sharedVillageStateKey(village)] ?? defaultVillageState(village); }
export function saveVillageState(village: string, state: VillageState) {
    const normalized = normalizeVillageState(village, state);
    sharedVillageStateCache[sharedVillageStateKey(village)] = normalized;
    persistSharedGameState({ kind: "villageState", village, state: normalized });
}
export function isVillageAnbu(character: Character) {
    const state = loadVillageState(character.village);
    return normalizeAnbuAppointees(state.anbuAppointees).some(name => name.toLowerCase() === character.name.toLowerCase());
}

export const VILLAGE_WAR_HP_MAX = 5000;
export const VILLAGE_WAR_GROUND_HP_MAX = 1000;
export const VILLAGE_WAR_DAILY_MISSIONS = 2;
export const VILLAGE_WAR_RAIDS_PER_MISSION = 3;
export const VILLAGE_WAR_MISSION_DAMAGE = 30;
// Capture damage per flip. Capped at the server's per-write HP delta
// (VILLAGE_WAR_HP_MAX_DELTA_PER_REQUEST = 100) so the single applyVillageWarDamage
// call doesn't bounce off the anti-cheat. With the tug-of-war model
// each war typically sees several captures, so 100/flip stacks up while
// staying inside the cap and matching the per-write damage profile of
// the territory-raid path (VillageWarScreen.raidSector does the same).
const VILLAGE_WAR_GROUND_CAPTURE_DAMAGE = 100;

type VillageWarContribution = {
    damage: number;
    raids: number;
    pvpKills: number;
    side: string;       // village name
    name: string;       // display name (for rendering leaderboard)
};
export type VillageWar = {
    id: string;
    villages: [string, string];
    hp: Record<string, number>;
    warGroundSector: number;
    warGroundHp: number;
    startedAt: number;
    updatedAt: number;
    capturedBy?: string;
    capturedAt?: number;
    winnerVillage?: string;
    endedAt?: number;
    warCrateId?: string;
    // Server-managed: keyed by lowercase player name. Drives the live
    // raid leaderboard during war and the MVP-stamp on war end.
    contributions?: Record<string, VillageWarContribution>;
    // village → MVP display name. Stamped server-side at war end.
    mvpByVillage?: Record<string, string>;
    // Set at war end ONLY if there's a winner (draws give nothing).
    // Each losing-village player who contributed ≥50 damage can claim
    // it once via claimedWarCrateIds dedup.
    loserCrateId?: string;
    // Pre-war pending window. While > now, HP can't drop and the war
    // can't be ended. Both villages get a notice + banner during this
    // window so defenders can rally. No cancellation.
    pendingUntil?: number;
};

function villageWarId(villageA: string, villageB: string) {
    return [villageA, villageB].sort((a, b) => a.localeCompare(b)).map(village => village.toLowerCase().replace(/[^a-z0-9]/g, "")).join("-vs-");
}

function normalizeVillageWar(data: Partial<VillageWar> & { villages: [string, string] }): VillageWar {
    const [first, second] = data.villages;
    return {
        id: data.id ?? villageWarId(first, second),
        villages: [first, second],
        hp: {
            [first]: clampNumber(Math.floor(Number(data.hp?.[first] ?? VILLAGE_WAR_HP_MAX)), 0, VILLAGE_WAR_HP_MAX),
            [second]: clampNumber(Math.floor(Number(data.hp?.[second] ?? VILLAGE_WAR_HP_MAX)), 0, VILLAGE_WAR_HP_MAX),
        },
        warGroundSector: clampNumber(Math.floor(Number(data.warGroundSector ?? firstOpenWarGroundSector())), 1, 60),
        warGroundHp: clampNumber(Math.floor(Number(data.warGroundHp ?? VILLAGE_WAR_GROUND_HP_MAX)), 0, VILLAGE_WAR_GROUND_HP_MAX),
        startedAt: data.startedAt ?? Date.now(),
        updatedAt: data.updatedAt ?? Date.now(),
        capturedBy: data.capturedBy,
        capturedAt: data.capturedAt,
        winnerVillage: data.winnerVillage,
        endedAt: data.endedAt,
        warCrateId: data.warCrateId,
        contributions: data.contributions,
        mvpByVillage: data.mvpByVillage,
        loserCrateId: data.loserCrateId,
    };
}

let lastSharedWorldStateSnapshot = "";
export function hydrateSharedWorldState(data: { territories?: Partial<SectorTerritory>[]; wars?: (Partial<VillageWar> & { villages?: [string, string] })[] }): boolean {
    const territories: Record<number, SectorTerritory> = {};
    (data.territories ?? []).forEach(territory => {
        const sector = Math.floor(Number(territory?.sector ?? 0));
        if (sector >= 1 && sector <= 60) {
            territories[sector] = normalizeSectorTerritory(sector, territory);
        }
    });
    sharedSectorTerritoryCache = territories;

    const wars: Record<string, VillageWar> = {};
    (data.wars ?? []).forEach(war => {
        if (!Array.isArray(war?.villages) || war.villages.length !== 2) return;
        const normalized = normalizeVillageWar({ ...war, villages: war.villages });
        wars[normalized.id] = normalized;
    });
    sharedVillageWarCache = wars;
    // Report whether anything actually changed so the poller can skip a wasted
    // full-app re-render when the server payload is identical (common in the
    // village / when idle). The cache still updates every poll, so any re-render
    // from another source (e.g. the heartbeat) reads current data.
    const snapshot = JSON.stringify([sharedSectorTerritoryCache, sharedVillageWarCache]);
    const changed = snapshot !== lastSharedWorldStateSnapshot;
    lastSharedWorldStateSnapshot = snapshot;
    return changed;
}

function firstOpenWarGroundSector() {
    return loadAllSectorTerritories().find(territory => !territory.ownerClan)?.sector ?? 40;
}

export function loadVillageWar(villageA: string, villageB: string): VillageWar | null {
    const cached = sharedVillageWarCache[villageWarId(villageA, villageB)];
    if (cached) return normalizeVillageWar(cached);
    return null;
}

function saveVillageWar(war: VillageWar) {
    const normalized = normalizeVillageWar({ ...war, updatedAt: Date.now() });
    sharedVillageWarCache[normalized.id] = normalized;
    persistSharedWorldState("war", normalized);
    return normalized;
}

export function activeVillageWarsFor(village: string) {
    return villages
        .filter(otherVillage => otherVillage !== village)
        .map(otherVillage => loadVillageWar(village, otherVillage))
        .filter((war): war is VillageWar => Boolean(war && !war.endedAt && war.villages.includes(village)));
}

function activeVillageWarBetween(villageA?: string, villageB?: string) {
    if (!villageA || !villageB || villageA === villageB) return null;
    const war = loadVillageWar(villageA, villageB);
    return war && !war.endedAt ? war : null;
}

// Reserved entry point for scripted Kage-initiated village wars. Not currently
// wired up — war declarations flow through /api/village/war/declare instead.
// Underscored to silence lint without dropping the helper.
function _startVillageWar(attackerVillage: string, enemyVillage: string) {
    const existing = activeVillageWarBetween(attackerVillage, enemyVillage);
    if (existing) return existing;
    const war = normalizeVillageWar({
        id: villageWarId(attackerVillage, enemyVillage),
        villages: [attackerVillage, enemyVillage],
        hp: { [attackerVillage]: VILLAGE_WAR_HP_MAX, [enemyVillage]: VILLAGE_WAR_HP_MAX },
        warGroundSector: firstOpenWarGroundSector(),
        warGroundHp: VILLAGE_WAR_GROUND_HP_MAX,
        startedAt: Date.now(),
    });
    saveVillageWar(war);
    [attackerVillage, enemyVillage].forEach(village => {
        const state = loadVillageState(village);
        saveVillageState(village, {
            ...state,
            notices: [`Village war started: ${attackerVillage} vs ${enemyVillage}. War ground: Sector ${war.warGroundSector}.`, ...state.notices].slice(0, 8),
        });
    });
    return war;
}
void _startVillageWar;

// Minimum clan-member count required for clan-tier leadership titles
// to unlock the +20 war-damage tier. Stops 1-person "clans" from
// farming the bonus — you need at least 7 OTHER members (8 total
// including yourself) to count as a real clan leader for war purposes.
// Village-level seats (Kage, the 3 appointed Elders, ANBU) are NOT
// affected by clan size — they're scoped to the village, not a clan.
const VILLAGE_WAR_CLAN_LEADER_MIN_MEMBERS = 8;

// Detect clan-tier leadership titles. Village Elder seats use titles
// like "First Elder" / "Second Elder" / "Third Elder", which contain
// "elder" but aren't clan leadership — they're explicitly excluded
// here so they keep the +20 tier with no clan-size requirement.
function isClanLeaderTitle(character: Character): boolean {
    const title = `${character.rankTitle ?? ""} ${character.storyTitle ?? ""}`.toLowerCase();
    if (character.clanFounder) return true;
    if (title.includes("clan leader") || title.includes("clan head") || title.includes("clan elder")) return true;
    return false;
}

function isVillageElderTitle(character: Character): boolean {
    const title = `${character.rankTitle ?? ""} ${character.storyTitle ?? ""}`.toLowerCase();
    return title.includes("first elder") || title.includes("second elder") || title.includes("third elder") || title.includes("village elder");
}

// Count active clanmates including the player themselves. Uses the
// in-memory player roster as the source of truth. The roster may or
// may not include the player (depends on call site), so we always add
// 1 for self when the player is in the named clan and dedupe by name.
function countClanMembers(clanName: string | undefined, characterName: string, roster: PlayerRecord[]): number {
    if (!clanName) return 0;
    const names = new Set<string>();
    names.add(characterName.toLowerCase());
    for (const p of roster) {
        if ((p.character?.clan ?? "") === clanName) names.add(p.name.toLowerCase());
    }
    return names.size;
}

function villageWarRoleValue(character: Character, clanMemberCount = 0) {
    const title = `${character.rankTitle ?? ""} ${character.storyTitle ?? ""}`.toLowerCase();
    const state = loadVillageState(character.village);
    if (state.seatedKage?.toLowerCase() === character.name.toLowerCase() || title.includes("kage")) return 30;
    // Village Elder seats — fixed roles, unaffected by clan size.
    if (isVillageElderTitle(character)) return 20;
    // ANBU — fixed roles, unaffected by clan size.
    if (isVillageAnbu(character) || title.includes("anbu")) return 15;
    // Clan leadership — gated by ≥8 total members so 1-person "clans"
    // can't farm the +20 bonus. If under the threshold, fall through
    // to the regular +5 contribution.
    if (isClanLeaderTitle(character) && clanMemberCount >= VILLAGE_WAR_CLAN_LEADER_MIN_MEMBERS) return 20;
    return 5;
}

function villageWarLossPenalty(character: Character, clanMemberCount = 0) {
    const title = `${character.rankTitle ?? ""} ${character.storyTitle ?? ""}`.toLowerCase();
    const state = loadVillageState(character.village);
    if (state.seatedKage?.toLowerCase() === character.name.toLowerCase() || title.includes("kage")) return 50;
    if (isVillageElderTitle(character)) return 20;
    if (isClanLeaderTitle(character) && clanMemberCount >= VILLAGE_WAR_CLAN_LEADER_MIN_MEMBERS) return 20;
    return 0;
}

function applyVillageWarDamage(war: VillageWar, damagedVillage: string, amount: number) {
    const nextHp = Math.max(0, (war.hp[damagedVillage] ?? VILLAGE_WAR_HP_MAX) - Math.max(0, Math.floor(amount)));
    const ended = nextHp <= 0;
    const winnerVillage = ended ? war.villages.find(village => village !== damagedVillage) : war.winnerVillage;
    // Canonical crate ID format `war-crate-${war.id}` — matches what
    // VillageWarScreen.claimVictory + claimPendingWarCrates check via
    // claimedWarCrateIds. Previously this used `village-crate-${id}-${ts}`
    // which slipped past dedup, letting winners triple-claim.
    const next = normalizeVillageWar({
        ...war,
        hp: { ...war.hp, [damagedVillage]: nextHp },
        winnerVillage,
        endedAt: ended ? Date.now() : war.endedAt,
        warCrateId: war.warCrateId ?? `war-crate-${war.id}`,
    });
    saveVillageWar(next);
    // On war end, append to both villages' warRecords and post end-of-war
    // notices so the village board reflects the outcome. Each village
    // gets its own POV ("won vs X" / "lost to X"). Idempotent — guarded
    // by checking the previous war state's endedAt.
    if (ended && !war.endedAt && winnerVillage) {
        try { recordWarOutcomeToVillages(next, damagedVillage, winnerVillage); } catch { /* best-effort */ }
    }
    return next;
}

// Append a war-history entry + end-of-war notice to BOTH warring
// villages so the outcome lands on each village's board. Called from
// applyVillageWarDamage when a write actually flips the war to ended.
function recordWarOutcomeToVillages(war: VillageWar, loserVillage: string, winnerVillage: string) {
    const dateStr = new Date().toLocaleDateString();
    const finalScore = `${war.hp[winnerVillage] ?? 0} – ${war.hp[loserVillage] ?? 0}`;
    // Server-stamped MVPs (set in api/world-state.ts at the moment the
    // war flips to ended). Fall back to "—" only if the server didn't
    // record any contributions for that side (e.g. AFK village).
    const winnerMvp = war.mvpByVillage?.[winnerVillage] ?? "—";
    const loserMvp = war.mvpByVillage?.[loserVillage] ?? "—";
    for (const village of war.villages) {
        const isWinner = village === winnerVillage;
        const state = loadVillageState(village);
        const record: DetailedVillageWarRecord = {
            opponent: village === war.villages[0] ? war.villages[1] : war.villages[0],
            winner: winnerVillage,
            finalScore,
            topDefender: isWinner ? winnerMvp : loserMvp,
            topAttacker: isWinner ? winnerMvp : loserMvp,
            mvpClan: "—",
            rewards: isWinner ? "Legendary War Crate (MVP: +1 extra crate, +10k ryo, +50 Honor Seals, +2 Fate Shards)" : "Loss consolation: +5k ryo, +25 Honor Seals, +1 Fate Shard (contributors only)",
            date: dateStr,
        };
        const noticeTitle = isWinner ? "Village War Won" : "Village War Lost";
        const noticeBody = isWinner
            ? `Our forces defeated ${loserVillage}. Final score ${finalScore}. Surviving raiders may claim a Legendary War Crate.`
            : `We have fallen to ${winnerVillage}. Final score ${finalScore}. Rebuild and rally — the next campaign begins.`;
        saveVillageState(village, normalizeVillageState(village, {
            ...state,
            warRecords: [record, ...(state.warRecords ?? [])].slice(0, 24),
            noticePosts: normalizeNoticePosts([
                makeNoticePost("order", noticeTitle, noticeBody, "System", "System", true),
                ...state.noticePosts,
            ]),
        }));
    }
}

export function recordVillageWarPvp(winner: Character, loser: Character, sector?: number, roster: PlayerRecord[] = []) {
    const war = activeVillageWarBetween(winner.village, loser.village);
    if (!war) return "";
    // No war damage during the pre-war pending window — the server
    // would reject the write anyway, but skipping client-side keeps
    // the UI quiet and saves a round-trip.
    if (war.pendingUntil && war.pendingUntil > Date.now()) {
        const minsLeft = Math.max(1, Math.ceil((war.pendingUntil - Date.now()) / 60_000));
        return ` Village War starts in ${minsLeft} min — fight didn't count yet.`;
    }
    // Clan-size gate: clan-leadership titles only get the +20 tier
    // when the clan has ≥8 total members. Computed from the roster
    // for both winner and loser; small-clan leaders fall back to +5/+0.
    const winnerClanSize = countClanMembers(winner.clan, winner.name, roster);
    const loserClanSize = countClanMembers(loser.clan, loser.name, roster);
    let damage = villageWarRoleValue(winner, winnerClanSize) + villageWarLossPenalty(loser, loserClanSize);
    // Home-defender bonus: when the WINNER is fighting in a sector
    // owned by their own village, scale war-credit damage 1.15×.
    // Notes: this ONLY affects the war HP ledger, not the actual PvP
    // combat — defenders and attackers fight identically. The bonus
    // gives organized defense a real-but-not-crushing edge (1-3 extra
    // war HP per regular fight, ~12 extra on a Kage v Kage). At +50%
    // this was big enough to swing wars on its own; +15% is a
    // noticeable advantage without being decisive.
    let homeBonus = false;
    if (sector !== undefined) {
        const territory = sharedSectorTerritoryCache[sector];
        if (territory?.ownerVillage === winner.village) {
            damage = Math.floor(damage * 1.15);
            homeBonus = true;
        }
    }
    const updated = applyVillageWarDamage(war, loser.village, damage);
    const tag = homeBonus ? " [Home Defender +15%]" : "";
    return ` Village War: ${loser.village} HP -${damage}${tag} (${updated.hp[loser.village]}/${VILLAGE_WAR_HP_MAX}).`;
}

export function recordVillageWarRaid(character: Character, sector: number, roster: PlayerRecord[] = []) {
    // Union return shape: every early return must declare the same
    // keys (with undefined values where needed) so the success path's
    // `warCrateId: string` access compiles against the inferred union.
    // bountyRyo / bountyFateShards are extras the caller adds to its
    // own ryo/fateShards assignment AFTER spreading characterPatch
    // (because the call sites explicitly set `ryo: rewarded.ryo + ryoGain`
    // which would otherwise clobber any bounty we tried to bake in).
    const empty = {
        note: "",
        characterPatch: {} as Partial<Character>,
        warCrate: false,
        warCrateId: undefined as string | undefined,
        bountyRyo: 0,
        bountyFateShards: 0,
    };
    const war = activeVillageWarsFor(character.village).find(candidate => candidate.warGroundSector === sector);
    if (!war || war.warGroundHp <= 0) return empty;
    // Pre-war pending window — server rejects damage writes anyway, so
    // bail early to avoid the noisy 409 in the console + UI.
    if (war.pendingUntil && war.pendingUntil > Date.now()) {
        const minsLeft = Math.max(1, Math.ceil((war.pendingUntil - Date.now()) / 60_000));
        return { ...empty, note: ` Village War starts in ${minsLeft} min — raid didn't damage HP yet.` };
    }
    const enemyVillage = war.villages.find(village => village !== character.village);
    if (!enemyVillage) return empty;
    // Apply the same clan-size gate to raid contributions — a 1-person
    // "clan" leader chipping the war ground only deals their +5
    // regular tier until the clan grows to ≥8 members.
    const myClanSize = countClanMembers(character.clan, character.name, roster);
    const damage = villageWarRoleValue(character, myClanSize);
    let next = normalizeVillageWar({
        ...war,
        warGroundHp: Math.max(0, war.warGroundHp - damage),
    });
    next = applyVillageWarDamage(next, enemyVillage, damage);
    let captureNote = "";
    // B (tug of war): the war ground is a contestable, recurring objective.
    // When warGroundHp hits 0, fire the capture event — but instead of
    // locking `capturedBy` forever, flip ownership to whichever village
    // landed the blow and reset warGroundHp to 500 so the other side can
    // push it back. Each capture/recapture pays the +750 enemy HP bonus.
    // The war only ends via enemy village HP reaching 0 (or Kage peace).
    if (next.warGroundHp <= 0) {
        const ownerChanged = next.capturedBy !== character.village;
        if (ownerChanged) {
            next = normalizeVillageWar({
                ...next,
                capturedBy: character.village,
                capturedAt: Date.now(),
                warGroundHp: 500, // reset for the next push from the other side
            });
            next = applyVillageWarDamage(next, enemyVillage, VILLAGE_WAR_GROUND_CAPTURE_DAMAGE);
            captureNote = next.capturedBy === character.village && (war.capturedBy && war.capturedBy !== character.village)
                ? ` War ground RECAPTURED by ${character.village}: ${enemyVillage} HP -${VILLAGE_WAR_GROUND_CAPTURE_DAMAGE}.`
                : ` War ground captured by ${character.village}: ${enemyVillage} HP -${VILLAGE_WAR_GROUND_CAPTURE_DAMAGE}.`;
        } else {
            saveVillageWar(next);
        }
    } else {
        saveVillageWar(next);
    }
    const today = currentDateKey();
    const sameDay = character.villageWarMissionDate === today;
    const currentProgress = sameDay ? character.villageWarRaidProgress ?? 0 : 0;
    const currentCompleted = sameDay ? character.villageWarMissionsCompleted ?? 0 : 0;
    const nextProgress = Math.min(VILLAGE_WAR_DAILY_MISSIONS * VILLAGE_WAR_RAIDS_PER_MISSION, currentProgress + 1);
    // A (bounty): every successful war-ground raid pays an inline reward,
    // capped at one per UTC day per player. Independent of war outcome —
    // even if you lose, you got paid for showing up. Honor Seals are a
    // Vanguard-only currency so we use 1 Fate Shard + 500 ryo instead.
    // Returned as bountyRyo / bountyFateShards rather than baked into
    // characterPatch because the call sites explicitly set `ryo:` and
    // `fateShards:` after spreading the patch, which would otherwise
    // clobber the bounty.
    const bountyAvailable = character.warGroundBountyDate !== today;
    const characterPatch: Partial<Character> = {
        villageWarMissionDate: today,
        villageWarRaidProgress: nextProgress,
        villageWarMissionsCompleted: currentCompleted,
    };
    let bountyNote = "";
    if (bountyAvailable) {
        characterPatch.warGroundBountyDate = today;
        bountyNote = ` 💰 War Ground bounty: +500 ryo, +1 Fate Shard (daily).`;
    }
    return {
        note: ` Village War raid: ${enemyVillage} HP -${damage}, War Ground HP -${damage}.${captureNote}${bountyNote}`,
        characterPatch,
        warCrate: Boolean(next.endedAt && next.winnerVillage === character.village),
        // Canonical crate ID the caller stamps into claimedWarCrateIds
        // alongside the inline inventory grant — without this, the
        // claimPendingWarCrates sweep on next login would scan the cache,
        // see warCrateId is unclaimed, and grant a SECOND crate.
        warCrateId: next.warCrateId,
        bountyRyo: bountyAvailable ? 500 : 0,
        bountyFateShards: bountyAvailable ? 1 : 0,
    };
}

export function claimVillageWarDailyMission(character: Character, missionIndex: number) {
    const today = currentDateKey();
    const progress = character.villageWarMissionDate === today ? character.villageWarRaidProgress ?? 0 : 0;
    const completed = character.villageWarMissionDate === today ? character.villageWarMissionsCompleted ?? 0 : 0;
    if (missionIndex !== completed) return { character, note: "Claim earlier village war missions first." };
    // War missions do NOT count toward the daily mission cap — each can only be done once per day.
    const required = (missionIndex + 1) * VILLAGE_WAR_RAIDS_PER_MISSION;
    if (progress < required) return { character, note: `Raid the enemy village ${required - progress} more time(s).` };
    const war = activeVillageWarsFor(character.village)[0];
    const enemyVillage = war?.villages.find(village => village !== character.village);
    if (!war || !enemyVillage) return { character, note: "Your village is not in an active war." };
    const updatedWar = applyVillageWarDamage(war, enemyVillage, VILLAGE_WAR_MISSION_DAMAGE);
    const wonWar = Boolean(updatedWar.endedAt && updatedWar.winnerVillage === character.village);
    return {
        character: {
            ...character,
            // Increment total + clan contrib but NOT dailyMissionsCompleted
            clanMissionContrib: (character.clanMissionContrib ?? 0) + 1,
            totalMissionsCompleted: (character.totalMissionsCompleted ?? 0) + 1,
            clanContribMonth: currentMonthKey(),
            inventory: wonWar ? [...character.inventory, LEGENDARY_WAR_CRATE_ID] : character.inventory,
            // Stamp the canonical crate ID alongside the inline grant so
            // claimPendingWarCrates can't double-credit on next sweep.
            claimedWarCrateIds: wonWar && updatedWar.warCrateId
                ? [...(character.claimedWarCrateIds ?? []), updatedWar.warCrateId]
                : (character.claimedWarCrateIds ?? []),
            villageWarMissionDate: today,
            villageWarRaidProgress: progress,
            villageWarMissionsCompleted: completed + 1,
        },
        note: `Village war mission complete. ${enemyVillage} HP -${VILLAGE_WAR_MISSION_DAMAGE}.${wonWar ? " Your village won the war. +1 Legendary War Crate." : ""}`,
    };
}
export function unlockVillageKageSystem(village: string, playerName: string): VillageState {
    // POST to server — server is the single source of truth for kage status.
    // If another player already unlocked the kage system for this village, the server
    // returns the existing state (first liberator keeps the seat).
    fetch('/api/village/kage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ village, playerName, action: 'unlock' }),
    }).then(r => r.ok ? r.json() : null).then((serverState) => {
        if (!serverState) return;
        const latest = loadVillageState(village);
        saveVillageState(village, normalizeVillageState(village, {
            ...latest,
            kageSystemUnlocked: true,
            seatedKage: serverState.seatedKage ?? latest.seatedKage,
            firstLiberator: serverState.firstLiberator ?? latest.firstLiberator,
        }));
    }).catch(() => {});

    const current = loadVillageState(village);
    if (current.kageSystemUnlocked) return current;
    const announcement = `The false Kage of ${village} has fallen. ${playerName} has broken the Hollow Gate Pact. The Kage seat is now open.`;
    const existingHistory = current.kageHistory ?? [];
    const newEntry: KageHistoryEntry = { name: playerName, village, seatedAt: Date.now() };
    const next = normalizeVillageState(village, {
        ...current,
        kageSystemUnlocked: true,
        firstLiberator: playerName,
        seatedKage: playerName,
        kageHistory: [...existingHistory, newEntry],
        notices: [announcement, `${playerName} has claimed the first open Kage seat of ${village}.`, "The false Kage has fallen. The village is no longer ruled by secrecy. The Kage seat is now open.", ...current.notices].slice(0, 8),
    });
    saveVillageState(village, next);
    return next;
}

export function claimPendingWarCrates(
    character: Character,
    clanData: { warHistory?: { result: string; warCrateId?: string; endedAt?: number }[] } | null,
): { character: Character; count: number; mvp?: boolean; consolation?: boolean } {
    const claimed = new Set(character.claimedWarCrateIds ?? []);
    const cratesToAdd: string[] = [];   // LEGENDARY_WAR_CRATE_ID inventory pushes
    const idsToAdd: string[] = [];      // claimedWarCrateIds bookkeeping
    let ryoBonus = 0;
    let honorBonus = 0;
    let shardsBonus = 0;
    let mvpAwarded = false;
    let consolationAwarded = false;
    // Lifetime stats — incremented per war, deduped via a `stats-${warId}`
    // marker in claimedWarCrateIds so multiple claim paths (winner +
    // MVP + consolation) all firing for the same war only count once
    // toward the Hall of Legends leaderboards.
    let warsWonDelta = 0;
    let mvpCountDelta = 0;
    let lifetimeDamageDelta = 0;
    const now = Date.now();
    const myName = character.name;
    const myVillage = character.village;

    // Clan war crates — check the last 3 history entries in case of back-to-back wars
    for (const record of (clanData?.warHistory ?? []).slice(0, 3)) {
        if (!record.warCrateId || record.result !== "Won") continue;
        if (claimed.has(record.warCrateId)) continue;
        if (record.endedAt && now - record.endedAt > WAR_CRATE_EXPIRY_MS) continue;
        cratesToAdd.push(record.warCrateId);
        idsToAdd.push(record.warCrateId);
    }

    // Clan war crates — scan the shared in-memory cache. Independent
    // of village wars: a player can be in both at once and earn from
    // each.
    for (const war of Object.values(sharedClanWarCache)) {
        if (!war.endedAt || now - war.endedAt > WAR_CRATE_EXPIRY_MS) continue;
        const myClan = character.clan;
        if (!myClan || !war.clans.includes(myClan)) continue;

        // 1. Winner crate — every player in the winning clan gets one.
        if (war.winnerClan === myClan && war.warCrateId && !claimed.has(war.warCrateId)) {
            cratesToAdd.push(war.warCrateId);
            idsToAdd.push(war.warCrateId);
            warsWonDelta += 1;
        }

        // 2. MVP bonus — top contributor on each side gets bonus
        //    currency on top of the winner crate (if they're on the
        //    winning side) or just the bonus (if on the losing side —
        //    earned, but unrewarded by a crate).
        const mvpName = war.mvpByClan?.[myClan];
        const mvpId = `clan-war-mvp-${war.id}-${myClan.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
        if (mvpName && mvpName.toLowerCase() === myName.toLowerCase() && !claimed.has(mvpId)) {
            idsToAdd.push(mvpId);
            ryoBonus += 10_000;
            honorBonus += 50;
            shardsBonus += 2;
            mvpAwarded = true;
            mvpCountDelta += 1;
        }

        // 3. Loss consolation — losing-side participants who actually
        //    contributed (sum of mode damages ≥ 20) get a small ryo +
        //    honor seal grant. Threshold filters out passive members
        //    who never queued.
        if (war.winnerClan && war.winnerClan !== myClan) {
            const consolId = `clan-war-consol-${war.id}-${myName.toLowerCase()}`;
            if (!claimed.has(consolId)) {
                let myDamage = 0;
                for (const ch of war.completedChallenges) {
                    if (ch.status !== "completed" || !ch.result || ch.result === "draw") continue;
                    const won = (ch.result === "from-wins" && ch.fromClan === myClan)
                        || (ch.result === "to-wins" && ch.fromClan !== myClan);
                    if (!won) continue;
                    const winners = ch.fromClan === myClan
                        ? [ch.fromPlayer, ch.fromPlayer2].filter(Boolean) as string[]
                        : [ch.acceptedPlayer, ch.acceptedPlayer2].filter(Boolean) as string[];
                    if (winners.some(p => p.toLowerCase() === myName.toLowerCase())) {
                        myDamage += CW_DAMAGE[ch.mode] ?? 0;
                    }
                }
                if (myDamage >= 20) {
                    idsToAdd.push(consolId);
                    ryoBonus += 2_500;
                    honorBonus += 10;
                    consolationAwarded = true;
                }
            }
        }

        // 4. Lifetime clan-war damage — credit each player's total
        //    contribution once per war for the HoL leaderboard.
        const statsId = `clan-war-stats-${war.id}-${myName.toLowerCase()}`;
        if (!claimed.has(statsId)) {
            let totalDamage = 0;
            for (const ch of war.completedChallenges) {
                if (ch.status !== "completed" || !ch.result || ch.result === "draw") continue;
                const winners = ch.fromClan === myClan
                    ? [ch.fromPlayer, ch.fromPlayer2].filter(Boolean) as string[]
                    : [ch.acceptedPlayer, ch.acceptedPlayer2].filter(Boolean) as string[];
                const won = (ch.result === "from-wins" && ch.fromClan === myClan)
                    || (ch.result === "to-wins" && ch.fromClan !== myClan);
                if (won && winners.some(p => p.toLowerCase() === myName.toLowerCase())) {
                    totalDamage += CW_DAMAGE[ch.mode] ?? 0;
                }
            }
            if (totalDamage > 0) {
                lifetimeDamageDelta += totalDamage;
                idsToAdd.push(statsId);
            }
        }
    }

    // Village war crates — scan the shared in-memory cache
    for (const war of Object.values(sharedVillageWarCache)) {
        // Skip wars older than expiry on either branch below.
        if (!war.endedAt || now - war.endedAt > WAR_CRATE_EXPIRY_MS) continue;

        // 1. Winner crate — every player in the winning village.
        if (war.warCrateId && war.winnerVillage === myVillage && !claimed.has(war.warCrateId)) {
            cratesToAdd.push(war.warCrateId);
            idsToAdd.push(war.warCrateId);
            warsWonDelta += 1;  // lifetime stat
        }

        // 2. MVP crate — top-contributor on EITHER side. Server stamps
        //    mvpByVillage[village] = display name; if it matches the
        //    current player and we haven't already claimed, grant an
        //    extra Legendary Crate + bonus currency. Recognizes the
        //    best raider per side even on the losing side.
        const mvpName = war.mvpByVillage?.[myVillage];
        const mvpId = `mvp-crate-${war.id}`;
        if (mvpName && mvpName === myName && !claimed.has(mvpId)) {
            cratesToAdd.push(mvpId);
            idsToAdd.push(mvpId);
            ryoBonus += 10_000;
            honorBonus += 50;
            shardsBonus += 2;
            mvpAwarded = true;
            mvpCountDelta += 1;  // lifetime stat
        }

        // 3. Loss-consolation — losing-side players who contributed
        //    ≥50 damage get a small inline grant (no inventory item).
        //    Server only stamps loserCrateId when a real winner exists,
        //    so draws skip this.
        if (war.loserCrateId && war.winnerVillage && war.winnerVillage !== myVillage && war.villages.includes(myVillage)) {
            if (!claimed.has(war.loserCrateId)) {
                const myContrib = war.contributions?.[myName.toLowerCase()];
                if (myContrib && myContrib.damage >= 50) {
                    idsToAdd.push(war.loserCrateId);
                    ryoBonus += 5_000;
                    honorBonus += 25;
                    shardsBonus += 1;
                    consolationAwarded = true;
                }
            }
        }

        // 4. Lifetime damage — credit the player's total contribution
        //    to this war ONCE (deduped via `stats-${warId}` marker).
        //    Fires regardless of which side won, so even losing-side
        //    raiders see their lifetime damage climb on the HoL
        //    leaderboard.
        const statsId = `stats-${war.id}`;
        if (!claimed.has(statsId) && war.villages.includes(myVillage)) {
            const myContrib = war.contributions?.[myName.toLowerCase()];
            if (myContrib && myContrib.damage > 0) {
                lifetimeDamageDelta += myContrib.damage;
                idsToAdd.push(statsId);
            }
        }
    }

    if (cratesToAdd.length === 0 && idsToAdd.length === 0 && ryoBonus === 0 && honorBonus === 0 && shardsBonus === 0 && warsWonDelta === 0 && mvpCountDelta === 0 && lifetimeDamageDelta === 0) {
        return { character, count: 0 };
    }

    // Honor Seals are Vanguard-only. For non-Vanguards, redirect what would
    // have been seals into Bone Charms (8:1) AND Fate Shards (25:1).
    const honorSealGain = vanguardOnlyHonorSeals(character, honorBonus);
    const charmSubstitute = nonVanguardCharmSubstitute(character, honorBonus);
    const shardSubstitute = nonVanguardShardSubstitute(character, honorBonus);

    return {
        character: {
            ...character,
            ryo: (character.ryo ?? 0) + ryoBonus,
            honorSeals: (character.honorSeals ?? 0) + honorSealGain,
            boneCharms: (character.boneCharms ?? 0) + charmSubstitute,
            fateShards: (character.fateShards ?? 0) + shardsBonus + shardSubstitute,
            inventory: [...character.inventory, ...cratesToAdd.map(() => LEGENDARY_WAR_CRATE_ID)],
            claimedWarCrateIds: [...(character.claimedWarCrateIds ?? []), ...idsToAdd],
            warsWon: (character.warsWon ?? 0) + warsWonDelta,
            warMvpCount: (character.warMvpCount ?? 0) + mvpCountDelta,
            lifetimeWarDamage: (character.lifetimeWarDamage ?? 0) + lifetimeDamageDelta,
        },
        count: cratesToAdd.length,
        mvp: mvpAwarded,
        consolation: consolationAwarded,
    };
}

// Weekly world-boss scheduling (seeded boss pick + spawn window + status)
// extracted to ./lib/weekly-boss. weeklyBossSchedule is imported back near the
// top of this file; it was not part of the public "../App" surface.

// (Removed: patchPlayerSaveCharacter + grantCurrencyToPlayer /
// grantInventoryItemToPlayer — the cross-player save-write gift paths that
// 403'd for non-admins. Clan/village treasury gifts now go through the atomic
// /api/{clan,village}/treasury/transfer endpoints. audit #18.)

// -- Shinobi Tiles card game (types, ELEMENT_COUNTERS, the 150-card catalog,
// and getAllTileCards) moved to ./data/tile-cards (imported back near the top).
// TileCard, TileCardArrow + getAllTileCards are re-exported here for the
// existing "../App" import sites (components/Shop, screens/Inventory).

// getItemById extracted to ./lib/items (imported back + re-exported above).


// makeJutsu + normalizeJutsu extracted to ./lib/jutsu (imported back above;
// normalizeJutsu re-exported below for the TagPicker "../App" import site).

// Shared-image helpers (compressDataUrl, publishSharedImage, readImageFile,
// isAnimatedImageFile, categoryFromImageKey) moved to ./lib/shared-images
// (imported back above for internal use). AiImagePrompt + KenneyAtlasPicker
// import compressDataUrl / publishSharedImage directly from ./lib/shared-images.

// capStat / xpNeeded / level→HP/chakra/stamina / rankFromLevel + total-XP
// curves moved to ./lib/stats (imported back above).

// Daily mission/hunt tracking + rank-title display moved to
// ./lib/character-progress (imported back above; dailyMissionsCompleted +
// dailyHuntsCompleted re-exported for the LeftProfileCard "../App" import site).

// baseStats, stat-budget + progressAfterXp moved to ./lib/stats (imported
// back above). statPointsEarnedFromXp stays here because it pulls
// effectiveCharacterXpGain from ./lib/progression.

export function weatherForSector(sector: number, biome: Biome) {
    const territory = loadSectorTerritory(sector);
    if (territory.ownerClan && territory.weather) return territory.weather;
    const table = biomeWeatherTables[biome];
    return table[(sector - 1) % table.length] ?? "clear";
}

// Territory + API constants moved to ./constants/game — imported above.
export type TerritoryBuffStat = "bukijutsuOffense" | "taijutsuOffense" | "ninjutsuOffense" | "genjutsuOffense";
type SectorTerritory = {
    sector: number;
    ownerClan?: string;
    ownerVillage?: string;
    backgroundImage?: string;
    controlScore: number;
    hp: number;
    weather?: WeatherType;
    terrainBuffStat: TerritoryBuffStat;
    guards: string[];
    warSupply: number;
    lastSupplyAt?: number;
    rebuiltAt?: number; // timestamp when sector was last destroyed — blocks recapture for TERRITORY_REBUILD_COOLDOWN_MS
    updatedAt: number;
};

let sharedSectorTerritoryCache: Record<number, SectorTerritory> = {};
let sharedVillageWarCache: Record<string, VillageWar> = {};
// Clan war cache — populated by ClanWarsPanel/ClanBattlesTab refreshes.
// Used by claimPendingWarCrates to grant unclaimed clan-war rewards
// (winner crate, MVP bonus, loser consolation) on next render.

function defaultSectorTerritory(sector: number): SectorTerritory {
    return { sector, controlScore: 0, hp: TERRITORY_HP_MAX, terrainBuffStat: "bukijutsuOffense", guards: [], warSupply: 0, updatedAt: Date.now() };
}

function normalizeSectorTerritory(sector: number, data?: Partial<SectorTerritory>): SectorTerritory {
    return {
        ...defaultSectorTerritory(sector),
        ...data,
        sector,
        controlScore: clampNumber(Math.floor(Number(data?.controlScore ?? 0)), 0, TERRITORY_CONTROL_MAX),
        hp: clampNumber(Math.floor(Number(data?.hp ?? TERRITORY_HP_MAX)), 0, TERRITORY_HP_MAX),
        guards: Array.isArray(data?.guards) ? data.guards.filter(Boolean).slice(0, 20) : [],
        warSupply: Math.max(0, Math.floor(Number(data?.warSupply ?? 0))),
        lastSupplyAt: data?.lastSupplyAt,
        terrainBuffStat: (data?.terrainBuffStat ?? "bukijutsuOffense") as TerritoryBuffStat,
        updatedAt: data?.updatedAt ?? Date.now(),
    };
}

function persistSharedWorldState(kind: "territory" | "war", payload: SectorTerritory | VillageWar) {
    if (typeof fetch === "undefined") return;
    fetch(WORLD_STATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "territory" ? { kind, territory: payload } : { kind, war: payload }),
    }).catch(() => {
        // The local cache already reflects the action; the next successful refresh will reconcile shared state.
    });
}

export function persistSharedGameState(payload: Record<string, unknown>) {
    if (typeof fetch === "undefined") return;
    fetch(GAME_STATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }).then(r => {
        if (!r.ok) console.warn("[persistSharedGameState] POST failed:", r.status, payload.kind);
        else if (payload.kind === "arenaActiveFights") console.log("[persistSharedGameState] fights saved OK");
    }).catch(err => {
        console.warn("[persistSharedGameState] error:", err);
    });
}

export function loadSectorTerritory(sector: number): SectorTerritory {
    const cached = sharedSectorTerritoryCache[sector];
    if (cached) return produceSectorWarSupply(cached);
    return defaultSectorTerritory(sector);
}

export function saveSectorTerritory(territory: SectorTerritory) {
    const normalized = normalizeSectorTerritory(territory.sector, { ...territory, updatedAt: Date.now() });
    sharedSectorTerritoryCache[normalized.sector] = normalized;
    persistSharedWorldState("territory", normalized);
    return normalized;
}

function produceSectorWarSupply(territory: SectorTerritory) {
    if (!territory.ownerClan) return territory;
    const now = Date.now();
    const lastSupplyAt = territory.lastSupplyAt ?? territory.updatedAt ?? now;
    const cycles = Math.floor((now - lastSupplyAt) / TERRITORY_SUPPLY_INTERVAL_MS);
    if (cycles <= 0) return territory;
    const next = normalizeSectorTerritory(territory.sector, {
        ...territory,
        warSupply: territory.warSupply + cycles * TERRITORY_DAILY_WAR_SUPPLY,
        lastSupplyAt: lastSupplyAt + cycles * TERRITORY_SUPPLY_INTERVAL_MS,
    });
    saveSectorTerritory(next);
    return next;
}

export function loadAllSectorTerritories() {
    return Array.from({ length: 60 }, (_, index) => loadSectorTerritory(index + 1));
}

export function clanOwnedTerritories(clanName?: string) {
    if (!clanName) return [];
    return loadAllSectorTerritories().filter(territory => territory.ownerClan === clanName);
}

export function villageOwnedTerritories(village?: string) {
    if (!village) return [];
    return loadAllSectorTerritories().filter(territory => territory.ownerVillage === village);
}

export function clanTerritoryWarMultiplier(clanName?: string) {
    return 1 + Math.min(10, clanOwnedTerritories(clanName).length) * 0.02;
}

export function clanTerritoryStartingScore(clanName?: string) {
    return clanOwnedTerritories(clanName).filter(territory => territory.hp >= TERRITORY_HP_MAX).length * 250;
}

export function villageTerritoryWarSupply(village?: string) {
    return villageOwnedTerritories(village).reduce((sum, territory) => sum + territory.warSupply, 0);
}

function guardIsVillageAnbu(name: string, village?: string) {
    if (!village) return false;
    const state = loadVillageState(village);
    return normalizeAnbuAppointees(state.anbuAppointees).some(appointee => appointee.toLowerCase() === name.toLowerCase());
}

export function sectorRaidDamageAmount(sector: number) {
    const territory = loadSectorTerritory(sector);
    if (!territory.ownerClan) return 250;
    const anbuCount = territory.guards.filter(guard => guardIsVillageAnbu(guard, territory.ownerVillage)).length;
    if (anbuCount > 0) return Math.max(50, 250 - anbuCount * 50);
    return territory.guards.length > 0 ? 150 : 250;
}

export function territoryScrollCount(character: Character) {
    return character.inventory.filter((itemId) => itemId === TERRITORY_CONTROL_SCROLL_ID).length;
}

export function removeTerritoryScrolls(character: Character, count: number) {
    let remaining = Math.max(0, Math.floor(count));
    return character.inventory.filter((itemId) => {
        if (itemId !== TERRITORY_CONTROL_SCROLL_ID || remaining <= 0) return true;
        remaining -= 1;
        return false;
    });
}

export function grantTerritoryScrolls(character: Character, count: number) {
    return { ...character, inventory: [...character.inventory, ...Array.from({ length: Math.max(0, Math.floor(count)) }, () => TERRITORY_CONTROL_SCROLL_ID)] };
}

export function damageSectorTerritory(sector: number, amount: number) {
    const territory = loadSectorTerritory(sector);
    if (!territory.ownerClan) return territory;
    const hp = Math.max(0, territory.hp - Math.max(0, Math.floor(amount)));
    const next = normalizeSectorTerritory(sector, hp <= 0 ? {
        ...territory,
        ownerClan: undefined,
        ownerVillage: undefined,
        backgroundImage: undefined,
        controlScore: 0,
        hp: TERRITORY_HP_MAX,
        weather: undefined,
        guards: [],
        warSupply: 0,
        lastSupplyAt: undefined,
        rebuiltAt: Date.now(),
    } : { ...territory, hp });
    saveSectorTerritory(next);
    return next;
}
// Stats / JutsuMastery moved to ./types/combat.
// AdminAccount + AdminRole moved to ./types/core — re-exported at the top of this file.

// The protected admin account. The Admin button is only visible to this
// username, the name is reserved server-side (no one else can register it),
// and the save survives server reset. Keep in sync with the same constant
// in api/_auth.ts.
// PROTECTED_ADMIN_USERNAME / isProtectedAdminName moved to ./constants/game.
// Pet-related types moved to ./types/pet — imported + re-exported above.
// Character moved to ./types/character — imported + re-exported above.
// The original definition is now in that module.
// Character / EndlessTowerRun / RewardCurrencyKey / CurrencyRewards /
// PlayerRecord / ServerPlayerSummary all moved to ./types/character —
// imported + re-exported at the top of this file.
