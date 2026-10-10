import { leadershipNameKey } from '../../../shared/village-anbu';
import { elderSeatsForTerm } from "../../../shared/village-elders";
import { cacheVillageElders, resetVillageElders } from "./village-elder-focus";
/*
 * Shared world/game state — the polled, server-backed shared caches and their
 * full helper web, extracted verbatim from App.tsx:
 *   • sector territory (cache + load/save/damage/supply + scroll items)
 *   • village wars (cache + normalize, server-applied daily-mission damage,
 *     winner-crate eligibility)
 *   • village state (cache + load/save/normalize + kage unlock)
 *   • war rewards (claimServerWarRewards → /api/war/claim-reward)
 *   • arena spectator fights / tournament / pending clan pet battle /
 *     weekly-boss AI override (caches + hydrateSharedGameState)
 * The caches are reassigned by the hydrate functions, so cache + every
 * reassigner live here together (an imported binding cannot be reassigned).
 * App polls via hydrateSharedWorldState/hydrateSharedGameState and the
 * persist* writers POST changes back.
 */
import type { Biome, WeatherType } from "../types/core";
import { hydrateSectorPools } from "./sector-pool";
import { serverNow } from "./server-clock";
import type { Character } from "../types/character";
import type { NoticePost } from "../types/clan";
import { GAME_STATE_API, LEGENDARY_WAR_CRATE_ID, TERRITORY_BREACH_DURATION_MS, TERRITORY_CONTROL_MAX, TERRITORY_CONTROL_SCROLL_ID, TERRITORY_HP_MAX, WAR_CRATE_EXPIRY_MS, WORLD_STATE_API } from "../constants/game";
import type { TreasuryItemStack } from "./items";
import { villages } from "../data/sectors";
import { isWildSector, MAX_WILD_SECTOR, WILD_SECTOR_IDS } from "../../../shared/sector-geo";
import { resolveSectorWeather } from "../../../shared/sector-weather";
import { clampNumber, playerSlug } from "./utils";
import { cleanVillageTreasury, defaultVillageTreasury, makeVillageDailyAgenda, normalizeAnbuAppointees, normalizeVillageDailyAgenda } from "./village-state";
import { normalizeNoticePosts } from "./clan-notices";
import { sharedClanWarCache } from "./clan-war-api";
import { countItem, removeItem } from "./inventory";
import { villageLeadership } from "../data/village-leadership";
import { villageUpgradeDefinitions, VILLAGE_UPGRADE_MAX_LEVEL } from "./village-upgrades";

export type VillageWarRecord = {
    id: string;
    declarationGeneration?: number;
    villages: [string, string];
    hp?: Record<string, number>;
    /** Server-owned per-village max war HP (Ramparts raise it past 5,000). */
    hpMax?: Record<string, number>;
    /** Server-owned: village → when its Kage offered peace (ms). Both = peace. */
    peaceProposals?: Record<string, number>;
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
    winnerName?: string;
    endedAt?: number;
};
export type ArenaSpectatorFight = { id: string; title: string; mode: string; startedAt: number; fighters: string[]; battleId?: string; biome?: string };
type PendingClanPetBattle = { clanName?: string; points: number; opponentName: string; createdAt: number };
let sharedArenaTournamentCache: ArenaTournament | null = null;
let sharedArenaActiveFightsCache: ArenaSpectatorFight[] = [];
let sharedDojoCircuitEnabledCache = false;
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

/** The global Circuit is launch-controlled by a full admin, never by a client. */
export function loadDojoCircuitEnabled(): boolean {
    return sharedDojoCircuitEnabledCache;
}

/** Accept only the server-confirmed admin result; this does not publish a write. */
export function setSharedDojoCircuitEnabled(enabled: boolean): void {
    sharedDojoCircuitEnabledCache = enabled === true;
}

/** The timed boost event exactly as the last game-state frame carried it
 *  (admin-started, see shared/boost-event.ts). It is kept raw on purpose:
 *  lib/boost-event-state.ts sanitizes it on read, which keeps the boost-event
 *  module out of the startup bundle this file ships in. */
let sharedBoostEventPayloadCache: unknown = null;
export function sharedBoostEventPayload(): unknown {
    return sharedBoostEventPayloadCache;
}
export function setSharedBoostEventPayload(event: unknown): void {
    sharedBoostEventPayloadCache = event ?? null;
}

export function saveArenaTournament(tournament: ArenaTournament | null) {
    sharedArenaTournamentCache = tournament;
    persistSharedGameState({ kind: "arenaTournament", tournament });
}

export async function finalizeArenaTournamentWinner(tournamentId: string, winnerName: string): Promise<{
    tournament: ArenaTournament;
    character: Character;
    _saveVersion: number;
} | null> {
    if (typeof fetch === "undefined") return null;
    const response = await fetch(GAME_STATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "arenaTournamentWinner", tournamentId, winnerName }),
    });
    if (!response.ok) return null;
    const data = await response.json() as {
        tournament?: ArenaTournament;
        character?: Character;
        _saveVersion?: number;
    };
    if (!data.tournament || !data.character || !Number.isSafeInteger(data._saveVersion)) return null;
    sharedArenaTournamentCache = data.tournament;
    return { tournament: data.tournament, character: data.character, _saveVersion: Number(data._saveVersion) };
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

/** Publish one battle without replacing other fighters' board entries. */
export function registerArenaFight(fight: ArenaSpectatorFight) {
    locallyRegisteredFights.set(fight.id, fight);
    sharedArenaActiveFightsCache = [fight, ...sharedArenaActiveFightsCache.filter(f => f.id !== fight.id)].slice(0, 20);
    persistSharedGameState({ kind: "arenaActiveFight", action: "register", fight });
}

export function removeArenaFight(fightId: string) {
    locallyRegisteredFights.delete(fightId);
    sharedArenaActiveFightsCache = sharedArenaActiveFightsCache.filter(f => f.id !== fightId);
    persistSharedGameState({ kind: "arenaActiveFight", action: "remove", fightId });
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
    dojoCircuitEnabled?: boolean;
    boostEvent?: unknown;
}): boolean {
    const villageStates: Record<string, VillageState> = {};
    const rawVS = data.villageStates;
    resetVillageElders();
    if (Array.isArray(rawVS)) {
        // Legacy array format
        rawVS.forEach((state) => {
            const village = String(state?.village ?? "").trim();
            if (!village) return;
            villageStates[sharedVillageStateKey(village)] = normalizeVillageState(village, withMemberFields(village, state));
            cacheVillageElders(village, state.elderAppointees, state.elderTerm?.nextSelectionAt);
        });
    } else if (rawVS && typeof rawVS === "object") {
        // Server returns object keyed by village name
        for (const [key, state] of Object.entries(rawVS)) {
            if (!state || typeof state !== "object") continue;
            const village = key.trim();
            if (!village) continue;
            villageStates[sharedVillageStateKey(village)] = normalizeVillageState(village, withMemberFields(village, state as Partial<VillageState>));
            cacheVillageElders(village, (state as Partial<VillageState>).elderAppointees, (state as Partial<VillageState>).elderTerm?.nextSelectionAt);
        }
    }
    // Re-apply any in-grace local Hollow Gate unlock bumps so a stale CDN-cached
    // poll can't momentarily revert a just-purchased unlock back to "locked".
    const hgNow = Date.now();
    for (const key of Object.keys(localHollowGateUnlockBump)) {
        const bump = localHollowGateUnlockBump[key];
        if (hgNow - bump.at > HOLLOW_GATE_BUMP_GRACE_MS) { delete localHollowGateUnlockBump[key]; continue; }
        const vs = villageStates[key];
        if (vs && (vs.hollowGateUnlockedUntil ?? 0) < bump.until) {
            villageStates[key] = { ...vs, hollowGateUnlockedUntil: bump.until };
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
    sharedDojoCircuitEnabledCache = data.dojoCircuitEnabled === true;
    sharedBoostEventPayloadCache = data.boostEvent ?? null;
    // See hydrateSharedWorldState: report change so the 5s poller skips the
    // wasted full-app re-render when the server payload is unchanged.
    const snapshot = JSON.stringify([
        sharedVillageStateCache,
        sharedArenaTournamentCache, sharedArenaActiveFightsCache,
        sharedPendingClanPetBattleCache, sharedWeeklyBossAiIdCache,
        sharedDojoCircuitEnabledCache, sharedBoostEventPayloadCache,
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

// provisions / materialPoints are the Village Stores (api/_village-stores.ts):
// server-credited only (donate endpoint), server-drained only (daily pass,
// war-structure). The blob re-asserts them at a zero delta like the currencies.
export type VillageTreasury = { ryo: number; honorSeals: number; fateShards: number; boneCharms: number; auraStones: number; mythicSeals: number; provisions?: number; materialPoints?: number; items: TreasuryItemStack[]; };
export type VillageTreasuryCurrencyKey = Exclude<keyof VillageTreasury, "items" | "provisions" | "materialPoints">;
export type DetailedVillageWarRecord = { opponent: string; winner: string; finalScore: string; topDefender: string; topAttacker: string; mvpClan: string; rewards: string; date: string; };
// Mirrors the server-owned reign record (api/village/_kage-challenge.ts
// KageHistoryEntry). The Kage system now writes this on every seat change; the
// Council Hall reads it from /api/village/kage (authoritative), not from any
// client-synthesized timestamp.
export type KageEndReason = "defeated" | "forfeit" | "admin-reset" | "abdicated";
export type KageHistoryEntry = {
    name: string;
    village: string;
    seatedAt: number;
    endedAt?: number;
    endedReason?: KageEndReason;
    wonBy?: string;
    defenseCount?: number;
};
type VillageAgendaKind = "missions" | "explore" | "ai" | "pet" | "control";
export type VillageAgendaTask = { id: string; kind: VillageAgendaKind; label: string; target: number };
export type VillageDailyAgenda = { date: string; tasks: VillageAgendaTask[] };
export type VillageState = { treasury: VillageTreasury; upgrades: Record<string, number>; contributionPoints: number; notices: string[]; noticePosts: NoticePost[]; warRecords: DetailedVillageWarRecord[]; kageSystemUnlocked: boolean; firstLiberator?: string; seatedKage?: string; anbuAppointees: string[]; anbuEarned?: string[]; anbuMembers?: string[]; elderAppointees: string[]; elderTerm?: import("../../../shared/elder-elections").ElderCouncil; kageHistory?: KageHistoryEntry[]; dailyAgenda: VillageDailyAgenda; hollowGateUnlockedUntil?: number; };
function defaultVillageWarRecords(village: string): DetailedVillageWarRecord[] { const leadership = villageLeadership[village]; return (leadership?.pastWars ?? ["No recorded wars yet."]).map((war, index) => ({ opponent: war.replace(/^Won |^Lost |^Draw at /, ""), winner: war.startsWith("Won") ? village : war.startsWith("Lost") ? "Enemy Village" : "Draw", finalScore: index === 0 ? "112 - 88" : index === 1 ? "76 - 91" : "64 - 64", topDefender: leadership?.elders?.[index % 3] ?? "Village Guard", topAttacker: leadership?.kage ?? "Kage Council", mvpClan: index === 0 ? "Fated Reunion" : "Unclaimed", rewards: index === 0 ? "Village standing / guard medals" : "Archive record", date: index === 0 ? "Recent Season" : "Previous Season" })); }
function defaultVillageState(village: string): VillageState { const notices = ["Town Hall upgrades are open for donation funding.", "Village Guard queue is accepting defenders."]; return { treasury: defaultVillageTreasury(), upgrades: {}, contributionPoints: 0, notices, noticePosts: normalizeNoticePosts(undefined), warRecords: defaultVillageWarRecords(village), kageSystemUnlocked: false, elderAppointees: ["", "", ""], anbuAppointees: ["", "", ""], dailyAgenda: makeVillageDailyAgenda(village), hollowGateUnlockedUntil: 0 }; }
function sharedVillageStateKey(village: string) { return village.toLowerCase().replace(/[^a-z0-9]/g, ""); }
let sharedVillageStateCache: Record<string, VillageState> = {};
/* A village's members-only fields (owner ruling 2026-10-08): the public game-state
 * frame no longer carries them, so lib/village-member-state.ts reads them from
 * GET /api/village/state and every public poll merges them back in. Until that
 * read lands a village has no entry here, and its defaults are never written
 * back (saveVillageState). Edits count local writes, so a read that began
 * before one cannot put the older figures back. */
const VILLAGE_MEMBER_FIELDS = ["treasury", "upgrades", "contributionPoints", "notices", "noticePosts", "dailyAgenda"] as const;
const villageMemberFields: Record<string, Partial<VillageState>> = {};
let villageMemberEdits = 0;
function withMemberFields(village: string, state: Partial<VillageState>): Partial<VillageState> { return { ...state, ...villageMemberFields[sharedVillageStateKey(village)] }; }
export function villageMemberEditCount(): number { return villageMemberEdits; }
export function villageMemberStateLoaded(village: string): boolean { return sharedVillageStateKey(village) in villageMemberFields; }
export function adoptVillageMemberState(village: string, fields: Partial<VillageState>, editsAtRead: number): boolean {
    if (editsAtRead !== villageMemberEdits) return false;
    const key = sharedVillageStateKey(village);
    const before = JSON.stringify(sharedVillageStateCache[key]);
    villageMemberFields[key] = fields;
    sharedVillageStateCache[key] = normalizeVillageState(village, { ...loadVillageState(village), ...fields });
    return JSON.stringify(sharedVillageStateCache[key]) !== before;
}
/* Village upgrades are SHARED village infrastructure bought from the treasury
 * seal pool (api/village/_upgrade.ts). Levels live on the village record; the
 * copy on the character is a server-validated mirror. Clamped 0..50 and
 * restricted to the known tracks so a stale or hostile blob cannot inflate a
 * bonus that the server reads back. */
export function cleanVillageUpgrades(raw?: unknown): Record<string, number> {
    const source = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
    const out: Record<string, number> = {};
    for (const def of villageUpgradeDefinitions) {
        const level = Math.max(0, Math.min(VILLAGE_UPGRADE_MAX_LEVEL, Math.floor(Number(source[def.key]) || 0)));
        if (level > 0) out[def.key] = level;
    }
    return out;
}

export function normalizeVillageState(village: string, state?: Partial<VillageState>): VillageState { const base = defaultVillageState(village); const notices = state?.notices?.length ? state.notices.slice(0, 8) : base.notices; return { treasury: cleanVillageTreasury(state?.treasury), upgrades: cleanVillageUpgrades(state?.upgrades), contributionPoints: Math.max(0, Math.floor(Number(state?.contributionPoints ?? 0))), notices, /* Do NOT fold legacy `notices` strings into noticePosts: makeNoticePost stamps each with Date.now(), so a village whose noticePosts were stripped server-side (System-authored posts fail the author===caller check) would re-mint the string board into fresh, re-timestamped "System" orders on every load. The Orders board shows persisted structured posts only. */ noticePosts: normalizeNoticePosts(state?.noticePosts, [], 60), warRecords: state?.warRecords?.length ? state.warRecords : base.warRecords, kageSystemUnlocked: Boolean(state?.kageSystemUnlocked ?? base.kageSystemUnlocked), firstLiberator: state?.firstLiberator ?? base.firstLiberator, seatedKage: state?.seatedKage ?? base.seatedKage, anbuAppointees: normalizeAnbuAppointees(state?.anbuAppointees), anbuEarned: state?.anbuEarned ?? [], anbuMembers: state?.anbuMembers ?? [], elderAppointees: elderSeatsForTerm(state?.elderAppointees, state?.elderTerm?.nextSelectionAt), elderTerm: state?.elderTerm, kageHistory: state?.kageHistory ?? [], dailyAgenda: normalizeVillageDailyAgenda(village, state?.dailyAgenda), hollowGateUnlockedUntil: Math.max(0, Math.floor(Number(state?.hollowGateUnlockedUntil ?? base.hollowGateUnlockedUntil ?? 0))) || 0 }; }
export function loadVillageState(village: string): VillageState { return sharedVillageStateCache[sharedVillageStateKey(village)] ?? defaultVillageState(village); }

// ── Hollow Gate: 30-day timed village unlock ────────────────────────────
// Replaces the old permanent `hollowGateUnlocked` boolean. The shrine is
// "open" while its expiry timestamp is still in the future; once it lapses
// the World Map shrine vanishes and a seated Kage must break the seal again.
export const HOLLOW_GATE_UNLOCK_DAYS = 30;
export const HOLLOW_GATE_UNLOCK_MS = HOLLOW_GATE_UNLOCK_DAYS * 24 * 60 * 60 * 1000;
export function isHollowGateUnlocked(state: Pick<VillageState, "hollowGateUnlockedUntil"> | null | undefined, now: number = Date.now()): boolean {
    return (state?.hollowGateUnlockedUntil ?? 0) > now;
}
// Whole days remaining on the unlock window (0 when closed). Rounds up so a
// partial last day still reads as "1d left".
export function hollowGateDaysLeft(state: Pick<VillageState, "hollowGateUnlockedUntil"> | null | undefined, now: number = Date.now()): number {
    const until = state?.hollowGateUnlockedUntil ?? 0;
    return until > now ? Math.max(1, Math.ceil((until - now) / (24 * 60 * 60 * 1000))) : 0;
}
// Re-buying while still active STACKS another 30 days onto the remaining
// window (extend, never shorten); from expired/never it's 30 days from now.
export function extendHollowGateUnlock(currentUntil: number | undefined, now: number = Date.now()): number {
    return Math.max(now, currentUntil ?? 0) + HOLLOW_GATE_UNLOCK_MS;
}
// Optimistic-write guard. A just-purchased unlock is held locally for a
// short grace window so a stale CDN-cached game-state poll can't clobber
// it back to "locked" before the server's value propagates. The server is
// monotonic for non-admins (never lowers the expiry), so after the grace
// the server value wins (and an admin re-lock still takes effect).
const HOLLOW_GATE_BUMP_GRACE_MS = 20_000;
const localHollowGateUnlockBump: Record<string, { until: number; at: number }> = {};

export function saveVillageState(village: string, state: VillageState) {
    const normalized = normalizeVillageState(village, state);
    const key = sharedVillageStateKey(village);
    const prevUntil = sharedVillageStateCache[key]?.hollowGateUnlockedUntil ?? 0;
    const nextUntil = normalized.hollowGateUnlockedUntil ?? 0;
    if (nextUntil > prevUntil) localHollowGateUnlockBump[key] = { until: nextUntil, at: Date.now() };
    else if (nextUntil < prevUntil) delete localHollowGateUnlockBump[key];
    sharedVillageStateCache[key] = normalized;
    // This edit is the newest copy of the members-only fields until the next
    // read. Before the first one they are only defaults, so none are sent: the
    // server keeps what is stored for anything a write leaves out.
    const member = villageMemberFields[key];
    villageMemberEdits++;
    if (member) villageMemberFields[key] = Object.fromEntries(VILLAGE_MEMBER_FIELDS.map((field) => [field, normalized[field]])) as Partial<VillageState>;
    // Orders have their own atomic actions. Routine village writes must never
    // replay a stale board over someone else's newly posted or deleted order.
    // The treasury is the same: every movement has its own endpoint, and the
    // copy here comes from a poll that can be seconds old, so replaying it would
    // assert figures from before another villager's donation. So are the
    // upgrade levels (/api/village/upgrade). The server keeps the stored values
    // either way (api/_village-state-validate.ts); sending them only filled its
    // suppression log on every Town Hall action.
    const { noticePosts: _orders, anbuAppointees: _anbuSeats, anbuEarned: _earnedAnbu, anbuMembers: _anbuMembers, elderAppointees: _elders, elderTerm: _elderTerm, treasury: _treasury, upgrades: _upgrades, ...villageFields } = normalized;
    if (!member) for (const field of VILLAGE_MEMBER_FIELDS) delete (villageFields as Partial<VillageState>)[field];
    persistSharedGameState({ kind: "villageState", village, state: villageFields });
}
export function adoptVillageOrders(village: string, noticePosts: NoticePost[]): void {
    const key = sharedVillageStateKey(village);
    sharedVillageStateCache[key] = { ...loadVillageState(village), noticePosts };
    if (villageMemberFields[key]) { villageMemberFields[key] = { ...villageMemberFields[key], noticePosts }; villageMemberEdits++; }
}
export function adoptVillageAnbu(village: string, roster: { appointed: string[]; earned: string[]; members: string[] }): void {
    sharedVillageStateCache[sharedVillageStateKey(village)] = { ...loadVillageState(village), anbuAppointees: roster.appointed, anbuEarned: roster.earned, anbuMembers: roster.members };
}
export function isVillageAnbu(character: Character) {
    const state = loadVillageState(character.village);
    return (state.anbuMembers ?? []).some(name => leadershipNameKey(name) === leadershipNameKey(character.name));
}

export const VILLAGE_WAR_HP_MAX = 5000;
export const VILLAGE_WAR_GROUND_HP_MAX = 1000;
export const VILLAGE_WAR_DAILY_MISSIONS = 2;
export const VILLAGE_WAR_RAIDS_PER_MISSION = 3;
export const VILLAGE_WAR_MISSION_DAMAGE = 30;

/** A village's max war HP in this war. The server stamps `hpMax` when Ramparts
 *  raise it past VILLAGE_WAR_HP_MAX; rows without it use the 5,000 base. Every
 *  HP bar and percentage reads this, never the bare constant. */
export function villageWarHpMax(war: { hpMax?: Record<string, number> } | null | undefined, village: string): number {
    const max = Math.floor(Number(war?.hpMax?.[village]));
    return Number.isSafeInteger(max) && max > 0 ? max : VILLAGE_WAR_HP_MAX;
}

type VillageWarContribution = {
    damage: number;
    raids: number;
    pvpKills: number;
    side: string;       // village name
    name: string;       // display name (for rendering leaderboard)
};
export type VillageWar = {
    id: string;
    /** Server-owned rematch generation. Pair ids remain stable, so durable
     * reward/dedupe identities must include this when present. */
    declarationGeneration?: number;
    villages: [string, string];
    hp: Record<string, number>;
    /** Server-owned per-village max war HP (see villageWarHpMax). */
    hpMax?: Record<string, number>;
    /** Server-owned: village → when its Kage offered peace (ms). Both = peace. */
    peaceProposals?: Record<string, number>;
    warGroundSector: number;
    warGroundHp: number;
    startedAt: number;
    updatedAt: number;
    capturedBy?: string;
    capturedAt?: number;
    winnerVillage?: string;
    endedAt?: number;
    warCrateId?: string;
    // Server-managed: keyed by the player's safeName slug. Drives the live
    // damage leaderboard during war and the MVP-stamp on war end.
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

/** The two warring villages' positive whole-number entries of a server-owned
 *  per-village map (hpMax, peaceProposals); undefined when there are none. */
function villageNumberMap(raw: unknown, villages: readonly string[]): Record<string, number> | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const out: Record<string, number> = {};
    for (const village of villages) {
        const value = Math.floor(Number((raw as Record<string, unknown>)[village]));
        if (Number.isSafeInteger(value) && value > 0) out[village] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeVillageWar(data: Partial<VillageWar> & { villages: [string, string] }): VillageWar {
    const [first, second] = data.villages;
    const hpMax = villageNumberMap(data.hpMax, data.villages);
    const peaceProposals = villageNumberMap(data.peaceProposals, data.villages);
    const pendingUntil = Math.floor(Number(data.pendingUntil));
    // Ramparts can lift a village past VILLAGE_WAR_HP_MAX, so the clamp is that
    // village's own max. Clamping to the bare 5,000 cut the extra HP off.
    const hpOf = (village: string) => {
        const max = villageWarHpMax({ hpMax }, village);
        return clampNumber(Math.floor(Number(data.hp?.[village] ?? max)), 0, max);
    };
    return {
        id: data.id ?? villageWarId(first, second),
        ...(Number.isSafeInteger(Number(data.declarationGeneration)) && Number(data.declarationGeneration) > 0
            ? { declarationGeneration: Math.floor(Number(data.declarationGeneration)) }
            : {}),
        villages: [first, second],
        hp: { [first]: hpOf(first), [second]: hpOf(second) },
        ...(hpMax ? { hpMax } : {}),
        ...(peaceProposals ? { peaceProposals } : {}),
        ...(Number.isSafeInteger(pendingUntil) && pendingUntil > 0 ? { pendingUntil } : {}),
        // Bound MUST match api/world-state.ts (which already reads MAX_WILD_SECTOR).
        // This mirror kept `60` through the 61-66 expansion, so a war ground on a
        // new sector normalized to 61-66 on the server and 60 on the client — the
        // two disagreed about which sector the war was being fought over.
        warGroundSector: clampNumber(Math.floor(Number(data.warGroundSector ?? firstOpenWarGroundSector())), 1, MAX_WILD_SECTOR),
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

// Village win/loss war records, surfaced on the Hall of Legends "Village Wars"
// tab. Self-describing (each row carries its village name) — populated by the
// world-state GET, which reads village:war-standing:* and stamps the name.
export type WarStandingRecord = { wins: number; losses: number; lastResult?: "win" | "loss"; updatedAt: number; village: string };
let sharedWarStandingsCache: WarStandingRecord[] = [];
export function loadWarStandings(): WarStandingRecord[] { return sharedWarStandingsCache; }

let lastSharedWorldStateSnapshot = "";

// Late-change bus: signals that land AFTER hydrateSharedWorldState has already
// returned, so they cannot be reported through its return value.
//
// Currently only per-viewer Village Intel (lib/village-intel). That block is
// deliberately NOT part of this payload — it lives on its own authenticated
// endpoint (GET /api/village/intel), because attaching a per-viewer block to
// this shared, CDN-cached document forced `private, no-store` on every
// logged-in poll (authFetch patches window.fetch for all /api/ URLs, so every
// signed-in poll is authenticated) and collapsed the cache entirely. The world
// poll only NUDGES the intel module here; the module owns its own slow cadence,
// its own login gate, and its own cache.
const sharedWorldStateLateListeners = new Set<() => void>();
/** Subscribe to change signals that land after hydrateSharedWorldState returned
 *  (currently: the Village Intel poll). Returns the unsubscribe. */
export function subscribeSharedWorldStateLateChanges(listener: () => void): () => void {
    sharedWorldStateLateListeners.add(listener);
    return () => { sharedWorldStateLateListeners.delete(listener); };
}
/** Fire the late-change listeners (lib/village-intel calls this when its poll
 *  actually changed something). */
export function notifySharedWorldStateLateChange(): void {
    sharedWorldStateLateListeners.forEach((listener) => listener());
}
// Lazy import: village-intel drags village-stores (~3 KB gz) into the startup
// graph if imported statically, and the module self-throttles + no-ops when
// nobody is signed in, so this stays a cheap nudge on every world poll.
//
// A failed chunk is NOT retried by the next poll. The browser caches a failed
// chunk fetch for the page, so every later import() here rejects at once with
// no request (see ./lazyWithRetry), and Village Intel stops refreshing; nothing
// short of a page reload restarts it. WorldMap and VillageWarMap import
// village-intel statically, so the same cached failure breaks them too:
// measured 2026-09-13 in Chromium, Firefox and WebKit, one aborted nudge
// request made the World Map's own load fail later and fall to the screen
// error boundary.
function nudgeVillageIntel(): void {
    void import("./village-intel")
        .then((m) => m.maybeRefreshVillageIntel())
        .catch(() => { /* chunk fetch failed; nothing short of a page reload fetches it again */ });
}

export function hydrateSharedWorldState(data: { territories?: Partial<SectorTerritory>[]; wars?: (Partial<VillageWar> & { villages?: [string, string] })[]; standings?: Partial<WarStandingRecord>[]; sectorPools?: unknown; sectorPoolCaps?: unknown }): boolean {
    // Shared per-sector gathering pool usage rides the same poll (lib/sector-pool).
    const poolsChanged = hydrateSectorPools(data);
    // Village Intel is a SEPARATE authenticated endpoint on a slower cadence.
    nudgeVillageIntel();
    const territories: Record<number, SectorTerritory> = {};
    (data.territories ?? []).forEach(territory => {
        const sector = Math.floor(Number(territory?.sector ?? 0));
        if (isWildSector(sector)) {
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
    sharedWarStandingsCache = Array.isArray(data.standings)
        ? data.standings
            .filter((s): s is WarStandingRecord => Boolean(s && s.village))
            .map(s => ({ wins: Math.max(0, Math.floor(Number(s.wins ?? 0))), losses: Math.max(0, Math.floor(Number(s.losses ?? 0))), lastResult: s.lastResult, updatedAt: Number(s.updatedAt ?? 0), village: String(s.village) }))
        : [];
    // Report whether anything actually changed so the poller can skip a wasted
    // full-app re-render when the server payload is identical (common in the
    // village / when idle). The cache still updates every poll, so any re-render
    // from another source (e.g. the heartbeat) reads current data.
    const snapshot = JSON.stringify([sharedSectorTerritoryCache, sharedVillageWarCache, sharedWarStandingsCache]);
    const changed = snapshot !== lastSharedWorldStateSnapshot || poolsChanged;
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

/** Adopt a war row a server command returned (mission damage, peace, surrender,
 *  declaration) without publishing anything. The server row is the truth; the
 *  next world poll replaces it with the same or a newer one. */
export function applyAuthoritativeVillageWar(war: unknown): VillageWar | null {
    const row = war as (Partial<VillageWar> & { villages?: unknown }) | null | undefined;
    if (!row || !Array.isArray(row.villages) || row.villages.length !== 2) return null;
    const normalized = normalizeVillageWar({ ...row, villages: [String(row.villages[0]), String(row.villages[1])] });
    sharedVillageWarCache[normalized.id] = normalized;
    return normalized;
}

export function activeVillageWarsFor(village: string) {
    return villages
        .filter(otherVillage => otherVillage !== village)
        .map(otherVillage => loadVillageWar(village, otherVillage))
        .filter((war): war is VillageWar => Boolean(war && !war.endedAt && war.villages.includes(village)));
}

// Every active (un-ended) village war in the world, regardless of the player's
// own village — for the Daily Briefing's global world report. Reads the same
// hydrated cache App's 15s world-state poll keeps fresh.
export function activeVillageWarsGlobal(): VillageWar[] {
    return Object.values(sharedVillageWarCache).filter(war => !war.endedAt);
}

// Town Hall's "War records" panel. Derived straight from the server-hydrated
// war cache (endedAt/winnerVillage/hp/mvpByVillage are all stamped by
// api/world-state.ts) rather than a client-appended list. The only producer
// that ever appended to VillageState.warRecords was recordWarOutcomeToVillages,
// reached only when the client computed a war's end itself. It was removed with
// the rest of that path (recordVillageWarRaid, applyVillageWarDamage): PvP war
// damage settles server-side (settlePvpVillageWarContinuation), and the server
// applies mission damage and ends the war itself.
export function endedVillageWarRecordsFor(village: string, limit = 24): DetailedVillageWarRecord[] {
    return Object.values(sharedVillageWarCache)
        .filter((war): war is VillageWar & { endedAt: number } => Boolean(war.endedAt) && war.villages.includes(village))
        .sort((a, b) => b.endedAt - a.endedAt)
        .slice(0, limit)
        .map(war => {
            const opponent = war.villages.find(candidate => candidate !== village) ?? war.villages[0];
            const mvp = war.mvpByVillage?.[village] ?? "—";
            return {
                opponent,
                winner: war.winnerVillage ?? "Draw",
                finalScore: `${war.hp[village] ?? 0} – ${war.hp[opponent] ?? 0}`,
                topDefender: mvp,
                topAttacker: mvp,
                mvpClan: "—",
                rewards: !war.winnerVillage
                    ? "No decisive victor — no crate awarded."
                    : war.winnerVillage === village
                        ? "Legendary War Crate (MVP: +1 extra crate, +10k ryo, +50 Honor Seals, +2 Fate Shards)"
                        : "Loss consolation: +5k ryo, +25 Honor Seals, +1 Fate Shard (contributors only)",
                date: new Date(war.endedAt).toLocaleDateString(),
            };
        });
}

/**
 * Whether `character` earned the winner's Legendary War Crate in this ended war.
 * Owner ruling: winning is not enough. The crate goes to members of the winning
 * village who fought: war damage on the server's contribution ledger (keyed by
 * the safeName slug), or the side's MVP. Mirrors the server's claim gate, so
 * neither the War Hall banner nor the claim sweep asks for a crate the server
 * would refuse. The id is always the server-stamped `warCrateId`.
 */
export function villageWarCrateEarnedBy(
    war: Pick<VillageWar, "endedAt" | "winnerVillage" | "warCrateId" | "contributions" | "mvpByVillage">,
    character: Pick<Character, "name" | "village">,
): boolean {
    const winner = String(war.winnerVillage ?? "").trim();
    if (!war.endedAt || !war.warCrateId || !winner || winner !== String(character.village ?? "").trim()) return false;
    const name = String(character.name ?? "").trim().toLowerCase();
    if (name && String(war.mvpByVillage?.[winner] ?? "").trim().toLowerCase() === name) return true;
    const entry = war.contributions?.[playerSlug(String(character.name ?? ""))];
    return Number(entry?.damage) > 0 && (!entry?.side || entry.side === winner);
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
            seatedKage: serverState.seatedKage,
            firstLiberator: serverState.firstLiberator ?? latest.firstLiberator,
        }));
    }).catch(() => {});

    // Leadership appears only after the server verifies liberation.
    return loadVillageState(village);
}

/*
 * `claimPendingWarCrates` lived here and was REMOVED (2026-08-18). It derived
 * crates, ryo, Honor Seals and Fate Shards from the browser's cached war state.
 * It had no callers — every war reward settles through claimServerWarRewards
 * below, which posts to /api/war/claim-reward and lets api/war/_reward.ts
 * recompute the payout against the authoritative world:war / clan-war record.
 *
 * It was deleted rather than left dormant because it was a live double-pay
 * waiting to be re-wired: the server already grants the MVP and consolation
 * legs, so restoring the inline sweep would pay both. Its own guard no longer
 * protected anything either — SERVER_SETTLEMENT_STATUS.clientWarCrateGrant is
 * permanently `true`, so `if (!isServerSettlementReady(...)) return` had stopped
 * short-circuiting. Several comments across the client still described it as the
 * live sweep, which is how dead code gets resurrected on purpose.
 */

/**
 * P0.2c — claim WINNER war crates (village + clan) through the server
 * (POST /api/village/claim-war-crate) instead of granting them inline. Scans three
 * sources for wars this player won a crate in (unclaimed + within the 7-day window):
 * the shared village-war cache (village wins), the shared clan-war cache (live clan
 * wins), and clanData.warHistory (older clan wins that aged out of the cache); the
 * server validates each against the authoritative world:war / clan-war record.
 * Returns the warCrateIds it actually granted. Called from the post-poll sweep, so
 * the war-end state has already propagated server-side (no race). Network and
 * server failures fail closed and are retried by the next polling sweep; only an
 * explicit granted response is mirrored into client state.
 */
/**
 * War claims that already got a server answer, and until when to trust it.
 * Both sweeps run on every world poll (15s) and clan-war poll (30s) and used to
 * re-post every war from the last 7 days each time — with a handful of recent
 * wars that outran the 30/min `claim-war-reward` limit. A GRANTED claim is final
 * for the session. A "nothing to grant" answer is only rechecked after
 * WAR_CLAIM_RECHECK_MS: usually final, but a clan war's end can be persisted
 * lazily after the client already sees it as ended, and its payout must still
 * arrive without a reload. Only a parsed 2xx lands here; a failure is retried.
 */
const settledWarClaims = new Map<string, number>();
const WAR_CLAIM_RECHECK_MS = 5 * 60_000;
const warClaimKey = (character: Character, id: string) => `${character.name.toLowerCase()}|${id}`;
const warClaimSettled = (key: string) => (settledWarClaims.get(key) ?? 0) > Date.now();
const settleWarClaim = (key: string, granted: boolean) =>
    settledWarClaims.set(key, granted ? Number.POSITIVE_INFINITY : Date.now() + WAR_CLAIM_RECHECK_MS);

/** Test-only: forget the settled-claim memory. */
export function __resetSettledWarClaimsForTest(): void {
    settledWarClaims.clear();
}

/** Crates the server granted, plus the versioned save its last grant wrote. */
export type WarCrateClaimResult = { ids: string[]; character: Character | null; _saveVersion: unknown };

export async function claimServerWarCrates(
    character: Character,
    clanData: { warHistory?: { result: string; warCrateId?: string; endedAt?: number }[] } | null = null,
): Promise<WarCrateClaimResult> {
    const claimed = new Set(character.claimedWarCrateIds ?? []);
    const now = Date.now();
    const eligible = new Set<string>();   // dedupe across the three sources
    for (const war of Object.values(sharedVillageWarCache)) {
        if (!war.endedAt || now - war.endedAt > WAR_CRATE_EXPIRY_MS) continue;
        // Only fighters of the winning side (see villageWarCrateEarnedBy): asking
        // for anyone else's crate is a refusal re-posted every recheck window.
        if (war.warCrateId && !claimed.has(war.warCrateId) && villageWarCrateEarnedBy(war, character)) eligible.add(war.warCrateId);
    }
    const myClan = character.clan;
    if (myClan) {
        for (const war of Object.values(sharedClanWarCache)) {
            if (!war.endedAt || now - war.endedAt > WAR_CRATE_EXPIRY_MS) continue;
            if (war.warCrateId && war.winnerClan === myClan && !claimed.has(war.warCrateId)) eligible.add(war.warCrateId);
        }
    }
    for (const record of (clanData?.warHistory ?? []).slice(0, 3)) {
        if (!record.warCrateId || record.result !== "Won") continue;
        if (record.endedAt && now - record.endedAt > WAR_CRATE_EXPIRY_MS) continue;
        if (!claimed.has(record.warCrateId)) eligible.add(record.warCrateId);
    }
    const result: WarCrateClaimResult = { ids: [], character: null, _saveVersion: undefined };
    if (eligible.size === 0) return result;
    for (const warCrateId of eligible) {
        const settledKey = warClaimKey(character, `crate:${warCrateId}`);
        if (warClaimSettled(settledKey)) continue;
        try {
            const r = await fetch("/api/village/claim-war-crate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, warCrateId }),
            });
            if (!r.ok) continue;
            const res = (await r.json().catch(() => null)) as { granted?: boolean; character?: Character; _saveVersion?: unknown } | null;
            if (res) settleWarClaim(settledKey, res.granted === true);
            if (res?.granted) {
                result.ids.push(warCrateId);
                // The grant is a versioned server write. Keep its save so the
                // caller adopts that version; mirroring only the crate left the
                // client a version behind and turned the next autosave into a 409.
                if (res.character) { result.character = res.character; result._saveVersion = res._saveVersion; }
            }
            // a definitive granted:false (server says not-winner / already-claimed / …) is respected.
        } catch {
            // Fail closed. The polling caller retries after connectivity returns.
        }
    }
    return result;
}

export type ServerWarRewardClaim = {
    character: Character;
    _saveVersion: unknown;
    granted: boolean;
    crates: number;
    mvp: boolean;
    consolation: boolean;
    lifetimeDamage: number;
};

/**
 * Settle every non-history war reward against its authoritative server record.
 * No cached winner/MVP/contribution value is trusted
 * for a durable mutation; the cache supplies only the canonical kind/id to claim.
 */
export async function claimServerWarRewards(character: Character): Promise<ServerWarRewardClaim | null> {
    const now = Date.now();
    const candidates = new Map<string, { kind: "village" | "clan"; warId: string }>();
    for (const war of Object.values(sharedVillageWarCache)) {
        if (!war.endedAt || now - war.endedAt > WAR_CRATE_EXPIRY_MS) continue;
        if (war.villages.includes(character.village)) candidates.set(`village:${war.id}`, { kind: "village", warId: war.id });
    }
    if (character.clan) {
        for (const war of Object.values(sharedClanWarCache)) {
            if (!war.endedAt || now - war.endedAt > WAR_CRATE_EXPIRY_MS) continue;
            if (war.clans.includes(character.clan)) candidates.set(`clan:${war.id}`, { kind: "clan", warId: war.id });
        }
    }
    if (candidates.size === 0) return null;

    let latest: Character | null = null;
    let latestSaveVersion: unknown;
    let granted = false;
    let crates = 0;
    let mvp = false;
    let consolation = false;
    let lifetimeDamage = 0;
    for (const candidate of candidates.values()) {
        const settledKey = warClaimKey(character, `${candidate.kind}:${candidate.warId}`);
        if (warClaimSettled(settledKey)) continue;
        try {
            const response = await fetch("/api/war/claim-reward", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, ...candidate }),
            });
            if (!response.ok) continue;
            const result = await response.json() as Partial<ServerWarRewardClaim>;
            settleWarClaim(settledKey, result.granted === true);
            // A no-op claim returns the stored save unchanged; adopting it could
            // only paint over unsaved local edits, so commit granted claims only.
            if (result.character && result.granted === true) {
                latest = result.character;
                latestSaveVersion = result._saveVersion;
            }
            granted ||= result.granted === true;
            crates += Number(result.crates ?? 0);
            mvp ||= result.mvp === true;
            consolation ||= result.consolation === true;
            lifetimeDamage += Number(result.lifetimeDamage ?? 0);
        } catch {
            // Fail closed; the next world/clan poll retries the idempotent claim.
        }
    }
    return latest ? { character: latest, _saveVersion: latestSaveVersion, granted, crates, mvp, consolation, lifetimeDamage } : null;
}

/**
 * Apply server-granted war crates (village + clan) to the character locally (mirror)
 * so the player's next save reflects them. Deduped against claimedWarCrateIds (the
 * poll may already have synced the server's write) and bumps warsWon per new crate,
 * matching the server winner-crate grant. Use with a
 * functional setCharacter so it composes on the LATEST character, never a stale snapshot.
 */
export function applyWarCrateGrants(character: Character, warCrateIds: string[]): { character: Character; count: number } {
    const claimed = new Set(character.claimedWarCrateIds ?? []);
    const fresh = warCrateIds.filter((id) => !claimed.has(id));
    if (fresh.length === 0) return { character, count: 0 };
    return {
        character: {
            ...character,
            inventory: [...character.inventory, ...fresh.map(() => LEGENDARY_WAR_CRATE_ID)],
            claimedWarCrateIds: [...(character.claimedWarCrateIds ?? []), ...fresh],
            warsWon: (character.warsWon ?? 0) + fresh.length,
        },
        count: fresh.length,
    };
}

// Weekly world-boss scheduling (seeded boss pick + spawn window + status)
// extracted to ./lib/weekly-boss. weeklyBossSchedule is imported back near the
// top of this file; it was not part of the public "../App" surface.

// (Removed: patchPlayerSaveCharacter + grantCurrencyToPlayer /
// grantInventoryItemToPlayer — the cross-player save-write gift paths that
// 403'd for non-admins. Clan/village treasury gifts now go through the atomic
// /api/{clan,village}/treasury/transfer endpoints. audit #18.)

// -- Shinobi Chronicle Showdown card catalog (the TileCard type, the 150-card
// catalog, and getAllTileCards) moved to ./data/tile-cards (imported back near
// the top). TileCard + getAllTileCards are re-exported here for the existing
// "../App" import sites (components/Shop, screens/Inventory).

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

/**
 * The weather a sector shows right now — ONE sky for every player. Derived
 * from (biome, sector, weather window) by shared/sector-weather so the server
 * seals the identical value when it applies weather to a sector fight
 * (api/pvp/session.ts). A holding clan's stamped `territory.weather` wins.
 * A breached or dormant holding stops supplying it: that gate lives INSIDE the
 * shared resolver, so the sky shown here and the sky sealed into the fight by
 * api/pvp/session.ts are the same value — and it now matches the terrain buff,
 * which the server already suspended on the same condition.
 */
export function weatherForSector(sector: number, biome: Biome): WeatherType {
    return resolveSectorWeather(biome, sector, serverNow(), loadSectorTerritory(sector));
}

// Territory + API constants moved to ./constants/game — imported above.
export type TerritoryBuffStat = "bukijutsuOffense" | "taijutsuOffense" | "ninjutsuOffense" | "genjutsuOffense";
export type SectorTerritory = {
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
    breachedAt?: number;
    breachEndsAt?: number;
    rewardSuspendedAt?: number;
    inactiveReleaseAt?: number;
    releaseReason?: string;
    updatedAt: number;
};

let sharedSectorTerritoryCache: Record<number, SectorTerritory> = {};
let sharedVillageWarCache: Record<string, VillageWar> = {};
// Clan war cache — populated by ClanWarsPanel/ClanBattlesTab refreshes.
// Read by claimServerWarRewards to decide which ended clan wars to ASK the
// server about; the payout itself (winner crate, MVP, consolation) is computed
// by api/war/_reward.ts from the authoritative record, never from this cache.

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

// Territory rows only. Village-war writes are server commands whose answer the
// caller waits for (postVillageWarUpdate): firing them and forgetting let the UI
// report war damage the server had refused.
function persistSharedWorldState(payload: SectorTerritory) {
    if (typeof fetch === "undefined") return;
    fetch(WORLD_STATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "territory", territory: payload }),
    }).catch(() => {
        // The local cache already reflects the action; the next successful refresh will reconcile shared state.
    });
}

/** POST a village-war write or command to /api/world-state and return the HTTP
 *  status with the parsed body (`{ war }` or `{ error }`). Throws only when the
 *  request never reached the server. */
export async function postVillageWarUpdate(body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> | null }> {
    const response = await fetch(WORLD_STATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null) as unknown;
    return {
        status: response.status,
        data: data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null,
    };
}

export function persistSharedGameState(payload: Record<string, unknown>) {
    if (typeof fetch === "undefined") return;
    fetch(GAME_STATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }).then(r => {
        if (!r.ok) console.warn("[persistSharedGameState] POST failed:", r.status, payload.kind);
    }).catch(err => {
        console.warn("[persistSharedGameState] error:", err);
    });
}

export function loadSectorTerritory(sector: number): SectorTerritory {
    return sharedSectorTerritoryCache[sector] ?? defaultSectorTerritory(sector);
}

// Accept a territory record returned by a server-authoritative command without
// publishing it back through the generic world-state route. This keeps the
// Clan Hall instant while ensuring the server response remains the source of
// truth for scroll spend, control progress, and capture ownership.
export function applyAuthoritativeSectorTerritory(territory: SectorTerritory) {
    const normalized = normalizeSectorTerritory(territory.sector, territory);
    sharedSectorTerritoryCache[normalized.sector] = normalized;
    return normalized;
}

export function saveSectorTerritory(territory: SectorTerritory) {
    const normalized = normalizeSectorTerritory(territory.sector, { ...territory, updatedAt: Date.now() });
    sharedSectorTerritoryCache[normalized.sector] = normalized;
    persistSharedWorldState(normalized);
    return normalized;
}

// War-supply accrual is SERVER-owned (api/_territory-supply.ts derives it
// lazily from `lastSupplyAt` at collect time and ignores any client-sent
// warSupply). The old client producer that ticked it from the device clock
// and POSTed the territory on every read is gone — reads no longer write.

export function territoryBreachDeadline(territory: SectorTerritory) {
    if (!territory.breachedAt) return 0;
    return territory.breachEndsAt ?? territory.breachedAt + TERRITORY_BREACH_DURATION_MS;
}

export function territoryIsBreached(territory: SectorTerritory, now = Date.now()) {
    const deadline = territoryBreachDeadline(territory);
    return Boolean(territory.ownerClan && territory.breachedAt && deadline && (now < deadline || territory.hp <= 0));
}

export function territoryRewardsSuspended(territory: SectorTerritory, now = Date.now()) {
    return territoryIsBreached(territory, now) || Boolean(territory.rewardSuspendedAt);
}

export function territoryBreachMinsLeft(territory: SectorTerritory, now = Date.now()) {
    const deadline = territoryBreachDeadline(territory);
    return deadline > now ? Math.ceil((deadline - now) / 60_000) : 0;
}

export function territoryInactiveReleaseMinsLeft(territory: SectorTerritory, now = Date.now()) {
    return territory.inactiveReleaseAt && territory.inactiveReleaseAt > now
        ? Math.ceil((territory.inactiveReleaseAt - now) / 60_000)
        : 0;
}

export function loadAllSectorTerritories() {
    return WILD_SECTOR_IDS.map((sector) => loadSectorTerritory(sector));
}

export function clanOwnedTerritories(clanName?: string) {
    if (!clanName) return [];
    return loadAllSectorTerritories().filter(territory => territory.ownerClan === clanName);
}

export function villageOwnedTerritories(village?: string) {
    if (!village) return [];
    return loadAllSectorTerritories().filter(territory => territory.ownerVillage === village
        && !territoryRewardsSuspended(territory));
}

export function villageTerritoryWarSupply(village?: string) {
    return villageOwnedTerritories(village).reduce((sum, territory) => sum + territory.warSupply, 0);
}

function guardIsVillageAnbu(name: string, village?: string) {
    if (!village) return false;
    const state = loadVillageState(village);
    return (state.anbuMembers ?? []).some(appointee => leadershipNameKey(appointee) === leadershipNameKey(name));
}

export function sectorRaidDamageAmount(sector: number) {
    const territory = loadSectorTerritory(sector);
    if (!territory.ownerClan) return 250;
    const anbuCount = territory.guards.filter(guard => guardIsVillageAnbu(guard, territory.ownerVillage)).length;
    if (anbuCount > 0) return Math.max(50, 250 - anbuCount * 50);
    return territory.guards.length > 0 ? 150 : 250;
}

export function territoryScrollCount(character: Character) {
    return countItem(character, TERRITORY_CONTROL_SCROLL_ID);
}

// Returns a NEW Character with `count` scrolls removed (drains the counted
// stack). Callers spread the result, e.g. `updateCharacter(removeTerritoryScrolls(c, n))`.
export function removeTerritoryScrolls(character: Character, count: number) {
    return removeItem(character, TERRITORY_CONTROL_SCROLL_ID, count);
}

export function damageSectorTerritory(sector: number, amount: number) {
    const territory = loadSectorTerritory(sector);
    if (!territory.ownerClan) return territory;
    const hp = Math.max(0, territory.hp - Math.max(0, Math.floor(amount)));
    const now = Date.now();
    const next = normalizeSectorTerritory(sector, hp <= 0 ? {
        ...territory,
        hp: 0,
        breachedAt: territory.breachedAt ?? now,
        breachEndsAt: territory.breachEndsAt ?? now + TERRITORY_BREACH_DURATION_MS,
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
