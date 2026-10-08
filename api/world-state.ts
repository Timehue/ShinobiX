import { readVillageAnbu } from './village/_anbu.js';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { MAX_WILD_SECTOR } from '../shared/sector-geo.js';
import type { VercelRequest, VercelResponse } from './_vercel.js';
import { kv } from './_storage.js';
import { storedValueEquals } from './_stored-value.js';
import { cors, safeName, clanBareSlug, clanRecordKey, setSafeRecordValue } from './_utils.js';
import { authedPlayerOrAdmin } from './_auth.js';
import { enforceRateLimitKv } from './_ratelimit.js';
import { withKvLock, LockContendedError } from './_lock.js';
import { cachedFor } from './_proc-cache.js';
import { collectTerritorySupply, resolveClaimedWarSupply } from './_territory-supply.js';
import { territoryGuardsAfterSelfUpdate } from './_territory-guard.js';
import {
    beginTerritoryBreach,
    clearTerritoryLifecycleForCapture,
    settleExpiredTerritoryBreach,
} from './_territory-lifecycle.js';
import { readAllSectorPoolUsage, SECTOR_POOL_CAPS, type SectorPoolRow } from './world/_sector-pool.js';
import { computeSpoils, bumpStanding, type WarStanding } from './_war-spoils.js';
import { villageWarMapEnabled, villageStoresEnabled } from './_release-flags.js';
// When the default-on Village War Map campaign is enabled,
// war declaration is funded from the village WR pool instead of the Kage's Honor
// Seals, and war settlement applies the comeback-morale/spoils rules. When OFF,
// every path below is byte-for-byte the legacy behavior.
import { DECLARE_WAR_WR, discountedWrCost } from './_war-economy.js';
import { normalizeVillageWarRecord, villageWarKey } from './_war-state.js';
import { villageWarHpMax, VILLAGE_WAR_HP_CEILING } from './_war-structures.js';
import {
    abortWarDeclarationFunding,
    newWarDeclarationFundingOwnerId,
    reserveWarDeclarationFunding,
    settleReservedWarDeclarationFunding,
    warDeclarationFundingFingerprint,
    warDeclarationFundingMarkerFromRow,
    type WarDeclarationFundingMarker,
    type WarDeclarationFundingSource,
} from './_war-declaration-funding.js';
import {
    warHasMercenaryFundingField,
    type WarMercenaryFundingMarker,
} from './_war-mercenary-hire.js';
import {
    allocateVillageWarDeclarationGeneration,
    claimVillageWarReservations,
    releaseVillageWarReservations,
    reserveClaimedVillageWarReservations,
    villageWarReservationBlocks,
    villageWarReservationFromRow,
    type VillageWarReservationPlan,
} from './_war-village-reservation.js';
import { CENTRAL_SECTORS, homeSectorsForVillage, isWarVillage, NON_WAR_SPECIAL_SECTORS, WAR_VILLAGES } from './_war-map-sectors.js';
import { territoryVillageOwnershipError } from './_territory-ownership.js';
import { settlementMoralePatch } from './_war-morale.js';
import { heldSectorsForVillage } from './_war-held-sectors.js';
import {
    activeContestOnSector,
    activeSectorWarsForVillage,
    listFundingSectorWars,
} from './_sector-war-store.js';
import {
    validateWarBattle,
    embeddedWarBattleReplay,
    embeddedWarBattleOutcome,
    parseEmbeddedWarBattleReceipts,
    stampEmbeddedWarBattleReplay,
    warBattleDeclineMessage,
    warBattleReceiptKey,
    WAR_BATTLE_DAMAGE_BUDGET,
    warMissionTokenKey,
    normalizeWarMissionToken,
    warMissionTokenAuthorizes,
    type WarBattleShape,
    type WarMissionToken,
} from './_war-battle-receipt.js';
import { kageKey } from './village/_kage-settle.js';
import {
    commitWarBattleSettlement,
    projectPvpVillageWarSettlement,
} from './_war-battle-settlement.js';
import { sealedSectorWarRoleOf, sectorControlSwing } from './_war-role.js';
import {
    pvpSessionMayGrantProgress,
    sealedWorldRaidAttacker,
    type PvpSession,
} from './pvp/session.js';
import { pvpWarGroundRewardEligible } from './pvp/_war-ground-reward.js';
import { raidProgressionReceiptId } from './missions/_raid-progression.js';
import type { RaidTerritoryDamageResult } from './missions/_raid-territory.js';
import { recordAudit } from './_audit.js';

/** The fields an admin territory correction is judged by, for the audit log.
 *  Never the whole record: it can carry a background image. */
function territoryAuditSummary(territory: SectorTerritory | null): Record<string, unknown> | null {
    if (!territory) return null;
    return {
        ownerVillage: territory.ownerVillage ?? null,
        ownerClan: territory.ownerClan ?? null,
        hp: territory.hp ?? null,
        guards: Array.isArray(territory.guards) ? territory.guards.length : 0,
    };
}

const TERRITORY_CONTROL_MAX = 75000;
const TERRITORY_HP_MAX = 20000;
// Base village war HP. A village's real maximum for a war is sealed into the war
// row (`hpMax`) from its Ramparts level (api/_war-structures.ts villageWarHpMax);
// rows without it are base-HP rows.
const VILLAGE_WAR_HP_MAX = 5000;
const VILLAGE_WAR_GROUND_HP_MAX = 1000;
const TERRITORY_KEY_PREFIX = 'world:territory:';
const VILLAGE_WAR_KEY_PREFIX = 'world:war:';
// Anti-cheat: hard ceiling on a single sector's stored War Supply. War Supply
// accrues at 100/day and is the one territory field a claiming clan/village
// writer can set freely (HP + ownership are clamped separately). Without a cap
// a client could POST an arbitrarily large warSupply and then bank it into the
// clan treasury via /api/clan/territory/collect-supply, which trusts the stored
// value as its accrual base. 36,500 == one full year (365 × 100) of
// uninterrupted accrual on one sector — far above any realistic uncollected
// balance, so legitimate play is never clamped.
const TERRITORY_WAR_SUPPLY_MAX = 36_500;
// Auto-finalize wars that have been running this long with no end.
// Two weeks is the sane upper bound for "Kages forgot about it" cleanup.
const VILLAGE_WAR_MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
// Cost to declare a war while the Village War Map campaign is switched OFF
// (DISABLE_VILLAGE_WAR=1): 500 of the declaring Kage's own Honor Seals. With the
// campaign on (the default) the village's War Resources pay instead —
// DECLARE_WAR_WR × the comeback discount, debited from shared:village-war.
const VILLAGE_WAR_DECLARATION_COST_HONOR_SEALS = 500;
// Rematch cooldown — same village-pair can't war again within 7 days
// of the previous war ending. Prevents grudge-spamming the same enemy.
const VILLAGE_WAR_REMATCH_COOLDOWN_SEC = 7 * 24 * 60 * 60;
// Pre-war window. When a Kage declares, the war is stamped pending for
// this long before HP can actually drop. Gives the defending village
// time to wake up, log in, and rally — stops the "declare while enemy
// is asleep, drain 5000 HP in PvP overnight" scenario.
const VILLAGE_WAR_PENDING_WINDOW_MS = 60 * 60 * 1000; // 1 hour
// War decay: after this many days of war, both sides take a flat
// VILLAGE_WAR_DECAY_PER_DAY HP loss at each UTC daily reset to push the
// conflict toward natural resolution. Untouched wars drain at
// 500/day/side starting day 4, so a war with no activity ends ~day 13
// (5000 → 0 at 500/day = 10 decay days after the 3-day grace).
const VILLAGE_WAR_DECAY_GRACE_DAYS = 3;
const VILLAGE_WAR_DECAY_PER_DAY = 500;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const VILLAGE_WAR_DECAY_GRACE_MS = VILLAGE_WAR_DECAY_GRACE_DAYS * ONE_DAY_MS;
const PVP_WAR_CONTINUATION_TTL_SEC = 21 * 24 * 60 * 60;
const WAR_DECLARATION_FUNDING_LEASE_MS = 30_000;

type PvpWarContinuationOutcome = 'applied' | 'superseded' | 'not-applicable';
type PvpWarContinuationReceipt = {
    version: 1;
    battleId: string;
    actorName: string;
    outcome: PvpWarContinuationOutcome;
    warId?: string;
    settledAt: number;
    warGroundRewardEligible: boolean;
};

function utcDateKey(ms = Date.now()): string {
    return new Date(ms).toISOString().slice(0, 10);
}

function utcDayIndex(ms: number): number {
    return Math.floor(ms / ONE_DAY_MS);
}

function normalizeVillageKey(village: string): string {
    return village.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A village's current war HP on a row (its sealed maximum when unset). */
function villageWarHpOf(war: Pick<VillageWar, 'hp' | 'hpMax'>, village: string): number {
    const fallback = Number(war.hpMax?.[village]) || VILLAGE_WAR_HP_MAX;
    const value = Math.floor(Number(war.hp?.[village] ?? fallback));
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * The one way a village war ends, whatever ended it (the killing blow, a war
 * mission, decay, the 14-day limit, a surrender, an agreed peace).
 *
 * Every ending stamps the MVP of each side, and a war with a winner also stamps
 * the winner's crate id and the losers' consolation id. Only some endings used
 * to: a war that ran out on decay or hit the 14-day limit had no MVP and no
 * consolation id, so the MVP crate and the consolation the War Hall promises
 * were silently never claimable for the commonest way a quiet war ends. Pure.
 */
function stampVillageWarEnding(war: VillageWar, args: { endedAt: number; winnerVillage?: string }): VillageWar {
    const next: VillageWar = {
        ...war,
        endedAt: args.endedAt,
        updatedAt: Math.max(Math.floor(Number(war.updatedAt) || 0), args.endedAt),
    };
    if (args.winnerVillage) next.winnerVillage = args.winnerVillage;
    else delete next.winnerVillage;
    const contributions = war.contributions ?? {};
    const mvpByVillage: Record<string, string> = {};
    for (const village of war.villages) {
        const side = Object.values(contributions)
            .filter((entry) => entry && entry.side === village && Number(entry.damage) > 0)
            .sort((a, b) => Number(b.damage) - Number(a.damage));
        if (side[0]?.name) setSafeRecordValue(mvpByVillage, village, side[0].name);
    }
    next.mvpByVillage = mvpByVillage;
    if (next.winnerVillage) {
        const token = villageWarGenerationToken(war);
        next.warCrateId = war.warCrateId ?? `war-crate-${token}`;
        next.loserCrateId = `loser-crate-${token}`;
    } else {
        delete next.loserCrateId;
    }
    return next;
}

/**
 * End a live war whose HP already shows a result.
 *
 * A war used to stay open at 0 HP whenever its last damage came from a path
 * that did not end it (the old client write lane never auto-ended), and that
 * inverted results: a later PvP win could only end the war while the target
 * still had HP, so the side that hit 0 first could still "win" when the other
 * side reached 0 next. Any reader that finds one side at 0 now ends the war for
 * the other side; both at 0 is a draw. Pure; returns null when nothing changes.
 */
function endZeroHpVillageWar(war: VillageWar, now: number): VillageWar | null {
    if (!warIsMutableGameplayActive(war) || war.endedAt || warIsPending(war)) return null;
    const [first, second] = war.villages;
    const firstDown = villageWarHpOf(war, first) <= 0;
    const secondDown = villageWarHpOf(war, second) <= 0;
    if (!firstDown && !secondDown) return null;
    const boundedEnd = Math.min(Math.max(now, warEffectiveStartMs(war)), warEffectiveStartMs(war) + VILLAGE_WAR_MAX_DURATION_MS);
    return stampVillageWarEnding(war, {
        endedAt: boundedEnd,
        winnerVillage: firstDown && secondDown ? undefined : (firstDown ? second : first),
    });
}

/**
 * A war row as the public, CDN-cached GET shows it. Each mercenary hire receipt
 * records the hirer's personal Honor Seal balance after the hire
 * (`balanceAfter`), which is a private save field (api/player/roster.ts treats
 * honor seals as sensitive) and was being served to every viewer. Only that is
 * dropped; every field a client or a settlement reads is kept as stored.
 */
function publicVillageWar(war: VillageWar): VillageWar {
    const receipts = war.mercenaryHireReceipts;
    if (!receipts || typeof receipts !== 'object') return war;
    const scrubbed: Record<string, unknown> = {};
    for (const [hireId, receipt] of Object.entries(receipts)) {
        if (receipt && typeof receipt === 'object' && !Array.isArray(receipt)) {
            const { balanceAfter: _balance, ...rest } = receipt as Record<string, unknown>;
            setSafeRecordValue(scrubbed, hireId, rest);
        } else {
            setSafeRecordValue(scrubbed, hireId, receipt);
        }
    }
    return { ...war, mercenaryHireReceipts: scrubbed };
}

/**
 * Bring a live war up to `now` the same way on every path: the 14-day limit
 * (no winner), then any owed daily decay, then a zero-HP ending. Every reader
 * that holds the war lock runs this before acting, so whichever request comes
 * first after a deadline settles it and nothing acts on a stale row. Pure.
 */
function bringVillageWarCurrent(war: VillageWar, now: number): { war: VillageWar; changed: boolean } {
    if (!warIsMutableGameplayActive(war) || war.endedAt) return { war, changed: false };
    const liveStart = warEffectiveStartMs(war);
    if (now - liveStart > VILLAGE_WAR_MAX_DURATION_MS) {
        // Timed out: no winner, so no spoils and no crates — but the MVPs are
        // still stamped like every other ending.
        return { war: stampVillageWarEnding(war, { endedAt: liveStart + VILLAGE_WAR_MAX_DURATION_MS }), changed: true };
    }
    const decayed = applyWarDecay(war, now);
    const zero = endZeroHpVillageWar(decayed.war, now);
    return zero ? { war: zero, changed: true } : decayed;
}

// The war ground is neutral ground both villages can reach: one of the central
// keep's sectors, chosen from the pair so every war between the same two
// villages fights over the same place. The declaring Kage used to send it (the
// War Hall sent the first sector with no clan owner, which was often a village
// gate), so a war could be fought over one side's own doorstep.
const WAR_GROUND_SECTORS: readonly number[] = CENTRAL_SECTORS.filter(
    (sector) => !NON_WAR_SPECIAL_SECTORS.includes(sector),
);
function villageWarGroundSector(warId: string): number {
    const digest = createHash('sha256').update(String(warId)).digest();
    return WAR_GROUND_SECTORS[digest[0] % WAR_GROUND_SECTORS.length];
}

async function isSeatedKageOf(playerName: string, village: string): Promise<boolean> {
    if (!village) return false;
    try {
        // Authoritative seat: read the village:kage:<slug> row directly, NOT the
        // lagging game:village-state mirror. The mirror only refreshes on a
        // validated villageState write, so reading it here let a just-dethroned
        // Kage keep war-declare / call-peace power (and blocked the new Kage)
        // until some member's next save rehydrated it. Every other Kage power
        // already reads this authoritative row.
        const state = await kv.get<{ seatedKage?: string }>(kageKey(village));
        const seated = safeName(String(state?.seatedKage ?? ''));
        return !!seated && seated === safeName(playerName);
    } catch {
        return false;
    }
}

type TerritoryBuffStat = 'bukijutsuOffense' | 'taijutsuOffense' | 'ninjutsuOffense' | 'genjutsuOffense';
type WeatherType = 'clear' | 'rain' | 'thunderstorm' | 'ashfall' | 'tornado' | 'desertHaze';

const VALID_TERRAIN_BUFF_STATS: ReadonlySet<TerritoryBuffStat> = new Set<TerritoryBuffStat>([
    'bukijutsuOffense', 'taijutsuOffense', 'ninjutsuOffense', 'genjutsuOffense',
]);

function normalizeTerrainBuffStat(value: unknown): TerritoryBuffStat {
    if (typeof value === 'string' && VALID_TERRAIN_BUFF_STATS.has(value as TerritoryBuffStat)) {
        return value as TerritoryBuffStat;
    }
    return 'bukijutsuOffense';
}

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
    rebuiltAt?: number;
    breachedAt?: number;
    breachEndsAt?: number;
    rewardSuspendedAt?: number;
    inactiveReleaseAt?: number;
    releaseReason?: string;
    // Exact server-owned raid settlement receipts. Never accepted from a
    // client territory payload; preserved under the territory row lock.
    serverRaidDamageReceipts?: unknown[];
    serverRaidDamagePending?: unknown;
    updatedAt: number;
};

type VillageWar = {
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
    // Optimization hint: set true once the losing penalty has been settled (the
    // NX marker war:settled:<id> remains the real once-only guard). Lets the
    // polled GET skip re-attempting settlement on already-settled wars.
    settled?: boolean;
    // Server-stamped at war-create so every grant path uses the same
    // canonical ID. claimedWarCrateIds on each player save dedupes via
    // exact string equality, so a single ID = one crate per player per
    // war, no matter which client path triggers the grant.
    warCrateId?: string;
    // YYYY-MM-DD of the last UTC day daily decay was applied. Used by
    // applyWarDecay to avoid double-applying within the same day even
    // if multiple readers / writers race.
    lastDecayDate?: string;
    // Per-player contribution accumulator, populated server-side as
    // damage deltas are detected on incoming writes. Keyed by lowercase
    // player name → totals + display name + which village side they
    // fought for. The MVP-per-side is computed from this on war end.
    contributions?: Record<string, { damage: number; raids: number; pvpKills: number; side: string; name: string }>;
    // Village → display name of the MVP for that side. Stamped server-
    // side whenever the war ends (stampVillageWarEnding). The MVP crate is
    // claimed through /api/war/claim-reward (api/war/_reward.ts), which
    // matches this name against the claimant.
    mvpByVillage?: Record<string, string>;
    // Loss-consolation crate ID. Stamped at war end ONLY if a winner
    // exists (i.e., draws give no consolation). A losing-village player
    // with at least 50 war damage can claim it once through
    // /api/war/claim-reward (claimedWarCrateIds dedupes it).
    loserCrateId?: string;
    // Server-owned. Each village's maximum war HP for this war, sealed at
    // declaration from its Ramparts level and raised (never lowered) when it
    // buys Ramparts mid-war. Rows without it are base-HP (5,000) rows.
    hpMax?: Record<string, number>;
    // Server-owned. Village → when its seated Kage offered peace. A peace with
    // no winner needs both villages' offers; one offer alone changes nothing.
    peaceProposals?: Record<string, number>;
    // Server-owned. The village whose Kage surrendered (it lost the war).
    surrenderedBy?: string;
    // Pre-war window. While `pendingUntil > now`, HP can't drop, the
    // war can't be ended, and the decay grace + 14-day max timers
    // count from `pendingUntil` instead of `startedAt`. The Kage
    // cannot cancel a pending war — declaration commits the cost,
    // no refunds, war must run its course.
    pendingUntil?: number;
    // Server-only, atomic with the war projection. A client retry with the same
    // battle id returns this row instead of spending the fight again.
    pvpBattleReceipts?: Record<string, string>;
    lastPvpBattleEndedAt?: number;
    warMissionTokenReceipts?: Record<string, number>;
    declaredBy?: string;
    /** Permanent monotonic identity for this pair-row generation (rematches increment). */
    declarationGeneration?: number;
    declarationFunding?: WarDeclarationFundingMarker;
    /** Hidden exact-once mercenary debit saga; gameplay resumes on activation/abort. */
    mercenaryFunding?: WarMercenaryFundingMarker;
    /** Permanent per-generation mercenary strikes, keyed by stable hire id. */
    mercenaryHireReceipts?: Record<string, unknown>;
};

function clampNumber(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

function defaultSectorTerritory(sector: number): SectorTerritory {
    return {
        sector,
        controlScore: 0,
        hp: TERRITORY_HP_MAX,
        terrainBuffStat: 'bukijutsuOffense',
        guards: [],
        warSupply: 0,
        updatedAt: Date.now(),
    };
}

function normalizeSectorTerritory(data: Partial<SectorTerritory>): SectorTerritory {
    const sector = clampNumber(Math.floor(Number(data.sector ?? 1)), 1, MAX_WILD_SECTOR);
    return {
        ...defaultSectorTerritory(sector),
        ...data,
        sector,
        controlScore: clampNumber(Math.floor(Number(data.controlScore ?? 0)), 0, TERRITORY_CONTROL_MAX),
        hp: clampNumber(Math.floor(Number(data.hp ?? TERRITORY_HP_MAX)), 0, TERRITORY_HP_MAX),
        guards: Array.isArray(data.guards)
            ? (() => {
                // Dedup by lowercase comparison but keep the first display-case
                // spelling we see. UI expects "Alice", not "alice".
                const seen = new Set<string>();
                const out: string[] = [];
                for (const raw of data.guards as unknown[]) {
                    if (!raw) continue;
                    const display = String(raw).trim();
                    if (!display) continue;
                    const lower = display.toLowerCase();
                    if (seen.has(lower)) continue;
                    seen.add(lower);
                    out.push(display);
                    if (out.length >= 20) break;
                }
                return out;
            })()
            : [],
        warSupply: Math.min(TERRITORY_WAR_SUPPLY_MAX, Math.max(0, Math.floor(Number(data.warSupply ?? 0)))),
        terrainBuffStat: normalizeTerrainBuffStat(data.terrainBuffStat),
        serverRaidDamageReceipts: [],
        updatedAt: data.updatedAt ?? Date.now(),
    };
}

function preserveServerRaidSettlementAuthority(
    next: SectorTerritory,
    source: SectorTerritory | null | undefined,
): SectorTerritory {
    next.serverRaidDamageReceipts = Array.isArray(source?.serverRaidDamageReceipts)
        ? source.serverRaidDamageReceipts
        : [];
    // This pin is written only by the server raid saga. Never copy it from an
    // incoming client payload; a territory writer must carry the locked row's
    // value until the saga helps it into the immutable per-proof terminal key.
    delete next.serverRaidDamagePending;
    if (source && Object.prototype.hasOwnProperty.call(source, 'serverRaidDamagePending')) {
        next.serverRaidDamagePending = source.serverRaidDamagePending;
    }
    return next;
}

function clanActorIsMember(clan: Record<string, unknown>, actor: string): boolean {
    if (safeName(String(clan.founderName ?? '')) === actor) return true;
    const members = Array.isArray(clan.members) ? clan.members : [];
    return members.some((member) => safeName(String(
        typeof member === 'string' ? member : (member as Record<string, unknown>)?.name ?? '',
    )) === actor);
}

function clanActorCanManageTerritory(clan: Record<string, unknown>, actor: string): boolean {
    if (safeName(String(clan.founderName ?? '')) === actor) return true;
    const overrides = (clan.roleOverrides ?? {}) as Record<string, unknown>;
    const role = Object.entries(overrides).find(([name]) => safeName(name) === actor)?.[1];
    return role === 'Leader' || role === 'Officer';
}

async function actorIsAppointedVillageAnbu(actor: string, actorVillage: string, territoryVillage: string): Promise<boolean> {
    if (!actorVillage || actorVillage.toLowerCase() !== territoryVillage.toLowerCase()) return false;
    return (await readVillageAnbu(territoryVillage)).members.some(name => safeName(name) === actor);
}

function preserveServerTerritoryLifecycle(
    next: SectorTerritory,
    source: SectorTerritory | null | undefined,
): SectorTerritory {
    const fields = [
        'breachedAt',
        'breachEndsAt',
        'rewardSuspendedAt',
        'inactiveReleaseAt',
        'releaseReason',
    ] as const;
    for (const field of fields) {
        if (source && Object.prototype.hasOwnProperty.call(source, field)) {
            (next as Record<string, unknown>)[field] = source[field];
        } else {
            delete (next as Record<string, unknown>)[field];
        }
    }
    return next;
}

async function commitSectorTerritoryExact(
    key: string,
    expected: SectorTerritory | null,
    candidate: SectorTerritory,
): Promise<SectorTerritory> {
    try {
        if (await kv.compareSet(key, expected, candidate)) return candidate;
    } catch (error) {
        // A capture clears its owner and lifecycle fields to explicit undefined;
        // the read-back is the JSON form without them.
        const recovered = await kv.get<unknown>(key).catch(() => null);
        if (storedValueEquals(recovered, candidate)) return candidate;
        throw error;
    }
    throw new Error('sector-territory-publication-conflict');
}

function villageWarId(villageA: string, villageB: string) {
    return [villageA, villageB]
        .sort((a, b) => a.localeCompare(b))
        .map(village => village.toLowerCase().replace(/[^a-z0-9]/g, ''))
        .join('-vs-');
}

function normalizeVillageWar(data: Partial<VillageWar> & { villages?: [string, string] }): VillageWar | null {
    if (!Array.isArray(data.villages) || data.villages.length !== 2) return null;
    const [first, second] = data.villages.map(String) as [string, string];
    if (!first || !second || first === second) return null;
    return {
        id: data.id ?? villageWarId(first, second),
        villages: [first, second],
        hp: {
            [first]: clampNumber(Math.floor(Number(data.hp?.[first] ?? VILLAGE_WAR_HP_MAX)), 0, VILLAGE_WAR_HP_CEILING),
            [second]: clampNumber(Math.floor(Number(data.hp?.[second] ?? VILLAGE_WAR_HP_MAX)), 0, VILLAGE_WAR_HP_CEILING),
        },
        warGroundSector: clampNumber(Math.floor(Number(data.warGroundSector ?? 40)), 1, MAX_WILD_SECTOR),
        warGroundHp: clampNumber(Math.floor(Number(data.warGroundHp ?? VILLAGE_WAR_GROUND_HP_MAX)), 0, VILLAGE_WAR_GROUND_HP_MAX),
        startedAt: data.startedAt ?? Date.now(),
        updatedAt: data.updatedAt ?? Date.now(),
        capturedBy: data.capturedBy,
        capturedAt: data.capturedAt,
        winnerVillage: data.winnerVillage,
        endedAt: data.endedAt,
        warCrateId: data.warCrateId,
        lastDecayDate: data.lastDecayDate,
        contributions: data.contributions,
        mvpByVillage: data.mvpByVillage,
        loserCrateId: data.loserCrateId,
        pendingUntil: data.pendingUntil,
        lastPvpBattleEndedAt: data.lastPvpBattleEndedAt,
        warMissionTokenReceipts: data.warMissionTokenReceipts,
    };
}

function declarationFundingMarker(war: VillageWar | null | undefined): WarDeclarationFundingMarker | null {
    return warDeclarationFundingMarkerFromRow(war);
}

function warHasFundingField(war: VillageWar | null | undefined): boolean {
    return !!war && Object.prototype.hasOwnProperty.call(war, 'declarationFunding');
}

/** Legacy rows are active; versioned rows are playable only after their debit is durable. */
function warIsGameplayActive(war: VillageWar | null | undefined): war is VillageWar {
    if (!war) return false;
    if (!warHasFundingField(war)) return true;
    return declarationFundingMarker(war)?.status === 'active';
}

/** Declared hostility stays authoritative while a mercenary strike settles. */
function warIsMutableGameplayActive(war: VillageWar | null | undefined): war is VillageWar {
    return warIsGameplayActive(war) && !warHasMercenaryFundingField(war);
}

/** Funding reserves both villages so another declaration cannot race past its debit saga. */
function warReservesVillage(war: VillageWar | null | undefined): war is VillageWar {
    if (!war || war.endedAt) return false;
    if (!warHasFundingField(war)) return true;
    const status = declarationFundingMarker(war)?.status;
    return status === 'funding' || status === 'active' || status === undefined;
}

function declarationGenerationOf(
    war: VillageWar,
    marker: WarDeclarationFundingMarker | null = declarationFundingMarker(war),
): number {
    const stored = Math.floor(Number(war.declarationGeneration));
    if (Number.isSafeInteger(stored) && stored > 0) return stored;
    const parsed = /:g([1-9][0-9]*)$/.exec(String(marker?.declarationId ?? ''));
    const fromId = parsed ? Number(parsed[1]) : 1;
    return Number.isSafeInteger(fromId) && fromId > 0 ? fromId : 1;
}

/** Stable per-generation suffix for rewards/settlement markers; legacy rows keep their old ids. */
function villageWarGenerationToken(war: VillageWar): string {
    const marker = declarationFundingMarker(war);
    if (!marker && !war.declarationGeneration) return war.id;
    return `${war.id}-g${declarationGenerationOf(war, marker)}`;
}

function declarationReservationPlan(
    warKey: string,
    war: VillageWar,
    marker: Pick<WarDeclarationFundingMarker, 'declarationId' | 'fingerprint' | 'source'>,
    ownerId: string,
    now: number,
): VillageWarReservationPlan {
    return {
        pairId: villageWarId(war.villages[0], war.villages[1]),
        warKey,
        villages: [...war.villages] as [string, string],
        generation: declarationGenerationOf(war, marker as WarDeclarationFundingMarker),
        declarationId: marker.declarationId,
        fingerprint: marker.fingerprint,
        source: marker.source,
        ownerId,
        now,
        leaseMs: WAR_DECLARATION_FUNDING_LEASE_MS,
    };
}

// Effective "war is live from" timestamp. While in the pre-war pending
// window, no decay should accrue and the 14-day max-duration timer
// shouldn't count down. After pendingUntil passes (or for legacy wars
// without it), the war is hot starting from startedAt.
function warEffectiveStartMs(war: VillageWar): number {
    if (war.pendingUntil && war.pendingUntil > Date.now()) {
        return war.pendingUntil; // still pending — counter starts at activation
    }
    if (war.pendingUntil) return war.pendingUntil;
    return war.startedAt;
}

function warIsPending(war: VillageWar): boolean {
    return !!war.pendingUntil && war.pendingUntil > Date.now();
}

// Cooldown key for the village pair. Set with 7-day TTL when a war
// ends so the same two villages can't immediately re-declare.
function warCooldownKey(villageA: string, villageB: string): string {
    return `war:cooldown:${villageWarId(villageA, villageB)}`;
}

async function ensureWarRematchCooldown(war: VillageWar): Promise<void> {
    if (!war.endedAt) return;
    const deadline = Math.floor(Number(war.endedAt)) + VILLAGE_WAR_REMATCH_COOLDOWN_SEC * 1000;
    const remainingSeconds = Math.ceil((deadline - Date.now()) / 1000);
    if (!Number.isSafeInteger(deadline) || remainingSeconds <= 0) return;
    await kv.set(
        warCooldownKey(war.villages[0], war.villages[1]),
        deadline,
        { ex: remainingSeconds },
    );
}

// Returns true if either village is currently in an active (non-ended)
// war. Used to enforce the one-war-at-a-time rule on war creation.
// Exported for the sector-war endpoint (api/village/sector-war.ts): a village in
// an active village war cannot run sector wars, and vice-versa (§17.1 mutual
// exclusion). Same predicate the declare path uses for the one-war-at-a-time rule.
export async function villageHasActiveWar(
    village: string,
    ignoreReservation?: { declarationId: string; fingerprint: string },
): Promise<boolean> {
    if (await villageWarReservationBlocks(kv, village, Date.now(), ignoreReservation)) return true;
    const wars = await getByPrefix<VillageWar>(VILLAGE_WAR_KEY_PREFIX);
    return wars.some(w => warReservesVillage(w) && w.villages.includes(village));
}

async function villageHasCompetingWar(village: string, declarationId: string): Promise<boolean> {
    const wars = await getByPrefix<VillageWar>(VILLAGE_WAR_KEY_PREFIX);
    return wars.some((candidate) => {
        if (!warReservesVillage(candidate) || !candidate.villages.includes(village)) return false;
        return declarationFundingMarker(candidate)?.declarationId !== declarationId;
    });
}

type DeclarationHelpResult =
    | { status: 'active'; row: VillageWar; replayed: boolean }
    | { status: 'insufficient'; have: number; cost: number }
    | { status: 'busy' | 'blocked' | 'conflict' | 'stale-lease' };

/**
 * Any authenticated request may help an already-authorized immutable funding
 * saga. Current Kage seating is deliberately irrelevant after row publication:
 * dethronement or a lost ACK must not strand both village reservations forever.
 */
async function helpForwardVillageWarDeclaration(
    warKey: string,
    fundingRow: VillageWar,
    now: number,
): Promise<DeclarationHelpResult> {
    const initialMarker = declarationFundingMarker(fundingRow);
    if (!initialMarker) return { status: 'conflict' };
    if (initialMarker.status === 'active') return { status: 'active', row: fundingRow, replayed: true };

    const ownerId = newWarDeclarationFundingOwnerId();
    const baseWar = { ...fundingRow } as VillageWar;
    delete baseWar.declarationFunding;
    const reservationPlan = declarationReservationPlan(warKey, fundingRow, initialMarker, ownerId, now);
    const claims = await claimVillageWarReservations(kv, reservationPlan);
    if (claims.status === 'busy') return { status: 'busy' };
    if (claims.status === 'blocked') {
        // A funding row that never acquired both village authorities has no
        // right to debit. Fence its source before letting the winning pair use
        // the village. A pre-existing receipt fails closed as conflict.
        const aborted = await abortWarDeclarationFunding(
            kv,
            warKey,
            fundingRow as VillageWar & { declarationFunding: WarDeclarationFundingMarker },
            'source-fenced',
            now,
        );
        if (aborted.status === 'aborted') {
            await releaseVillageWarReservations(kv, reservationPlan, 'funding-conflict', now);
            return { status: 'blocked' };
        }
        return { status: aborted.status === 'stale-lease' ? 'stale-lease' : 'conflict' };
    }

    const fundingPlan = {
        warKey,
        declarationId: initialMarker.declarationId,
        fingerprint: initialMarker.fingerprint,
        war: baseWar,
        source: initialMarker.source,
        ownerId,
        now,
        leaseMs: WAR_DECLARATION_FUNDING_LEASE_MS,
    };
    const reservation = await reserveWarDeclarationFunding(kv, fundingPlan);
    if (reservation.status === 'busy' || reservation.status === 'conflict') {
        return { status: reservation.status };
    }
    const promotion = await reserveClaimedVillageWarReservations(kv, reservationPlan);
    if (promotion.status === 'conflict') {
        if (reservation.status === 'acquired') {
            const aborted = await abortWarDeclarationFunding(kv, warKey, reservation.row, 'source-fenced', now);
            if (aborted.status === 'aborted') {
                await releaseVillageWarReservations(kv, reservationPlan, 'funding-conflict', now);
            }
        }
        return { status: 'conflict' };
    }

    try {
        const result = await settleReservedWarDeclarationFunding(kv, fundingPlan, reservation);
        if (result.status === 'active') {
            return { status: 'active', row: result.row as VillageWar, replayed: true };
        }
        if (result.status === 'insufficient') {
            await releaseVillageWarReservations(kv, reservationPlan, 'funding-aborted', now);
            return result;
        }
        return { status: result.status };
    } catch (error) {
        // Terminal account failures publish an exact aborted pair tombstone.
        // Release is proof-gated and therefore a no-op if another worker funded.
        await releaseVillageWarReservations(kv, reservationPlan, 'funding-aborted', now).catch(() => undefined);
        throw error;
    }
}

/** The villages `village` is currently in declared hostility with. A target-first
 *  mercenary marker freezes mutation but does not erase daily/mission authority. */
export async function activeVillageWarEnemiesOf(village: string): Promise<string[]> {
    const wars = await getByPrefix<VillageWar>(VILLAGE_WAR_KEY_PREFIX);
    const out: string[] = [];
    for (const w of wars) {
        if (!warIsGameplayActive(w) || w.endedAt || !w.villages.includes(village)) continue;
        const enemy = w.villages.find(v => v !== village);
        if (enemy) out.push(enemy);
    }
    return out;
}

/** Damage-producing mercenary surfaces must not consume a band while the exact
 * village-war row is frozen by a target-first hire marker. */
export async function mutableVillageWarEnemiesOf(village: string): Promise<string[]> {
    const wars = await getByPrefix<VillageWar>(VILLAGE_WAR_KEY_PREFIX);
    const out: string[] = [];
    for (const w of wars) {
        if (!warIsMutableGameplayActive(w) || w.endedAt || !w.villages.includes(village)) continue;
        const enemy = w.villages.find(candidate => candidate !== village);
        if (enemy) out.push(enemy);
    }
    return out;
}

/** Live hostility for combat bonuses; a settling mercenary strike does not end the war. */
export async function villagesAreAtWar(village: string, enemyVillage: string): Promise<boolean> {
    if (!village || !enemyVillage || village === enemyVillage) return false;
    const war = await kv.get<VillageWar>(`${VILLAGE_WAR_KEY_PREFIX}${villageWarId(village, enemyVillage)}`);
    return warIsGameplayActive(war) && !war.endedAt && !warIsPending(war)
        && war.villages.includes(village) && war.villages.includes(enemyVillage);
}

/** Active (non-ended, non-pending) village wars as village pairs. Used by the
 *  roaming-merc cron to hunt enemy players during an all-out war (pending wars are
 *  excluded — HP is frozen in the pre-war window, so there's nothing to chip). */
export async function listActiveVillageWars(): Promise<Array<{ villages: [string, string] }>> {
    const wars = await getByPrefix<VillageWar>(VILLAGE_WAR_KEY_PREFIX);
    return wars
        .filter(w => warIsMutableGameplayActive(w) && !w.endedAt && !warIsPending(w))
        .map(w => ({ villages: w.villages }));
}

/**
 * Sector War (Phase 4c) — flip a sector's persistent owner to the capturing
 * village once its 72h war SETTLES with the attacker ahead (api/_sector-war-settle.ts
 * settleDueSectorWars → settleSectorWar). Writes `world:territory:<sector>.ownerVillage` under the per-territory
 * lock, clears any stale clan owner, marks the sector freshly secured (full territory
 * HP — it must be defended anew), and resets War Supply for the new owner via
 * resolveClaimedWarSupply (anti-mint, same as the claiming-write path). Only ever
 * reached from settlement (which every Sector Map-gated path funnels through).
 */
export async function captureSectorForVillage(
    sector: number,
    ownerVillage: string,
    now: number = Date.now(),
): Promise<SectorTerritory> {
    const s = Math.floor(Number(sector) || 0);
    const key = `${TERRITORY_KEY_PREFIX}${s}`;
    return await withKvLock(key, async () => {
        const prev = await kv.get<SectorTerritory>(key);
        // Already this village's: a settlement pass that flipped the sector but
        // failed before stamping its war is being retried. Sectors change hands
        // only through settlement, so this can only be that war's own earlier
        // pass. Running the capture again reset the sector's HP to full and
        // dropped any clan claim made on it since.
        if (prev && String(prev.ownerVillage ?? '').trim() === ownerVillage) {
            return normalizeSectorTerritory(prev as Partial<SectorTerritory>);
        }
        // Strict: an unreadable contest row could be this sector's pending
        // declaration, so it blocks the capture until it is repaired.
        const pendingDeclaration = (await listFundingSectorWars(kv, { strict: true }))
            .some(candidate => candidate.sector === s);
        if (pendingDeclaration) {
            // A hidden row-first declaration has sealed this exact defender but
            // has not reached receipt-backed activation yet. Let its recovery
            // activate or exact-abort before any older settlement changes the
            // owner underneath it.
            throw new Error('sector-war-declaration-funding-reserves-territory');
        }
        const ownershipError = territoryVillageOwnershipError({
            sector: s,
            actorVillage: ownerVillage,
            previousOwnerVillage: prev?.ownerVillage,
            requestedOwnerVillage: ownerVillage,
        });
        if (ownershipError) throw new Error(ownershipError);
        const next = preserveServerRaidSettlementAuthority(normalizeSectorTerritory(clearTerritoryLifecycleForCapture({
            ...(prev ?? defaultSectorTerritory(s)),
            ownerVillage,
            ownerClan: undefined,
            hp: TERRITORY_HP_MAX,
            updatedAt: now,
        }) as Partial<SectorTerritory>), prev);
        const owned = resolveClaimedWarSupply(prev ?? null, next, now);
        next.warSupply = owned.warSupply;
        next.lastSupplyAt = owned.lastSupplyAt;
        return commitSectorTerritoryExact(key, prev, next);
    }, { failClosed: true });
}

/**
 * Sector War (Phase 4d) — one-time, idempotent seed of home-sector ownership.
 * For each of the 32 home war sectors, if its territory record has no ownerVillage
 * yet, set it to the sector's home village (preserving HP / supply / guards /
 * everything else) so the war map starts from a defined ownership state. A sector
 * already owned by anyone is left untouched. Admin-triggered via the gated endpoint.
 */
export async function seedHomeSectorOwnership(now: number = Date.now()): Promise<{ seeded: number; sectors: number[] }> {
    const seeded: number[] = [];
    for (const village of WAR_VILLAGES) {
        for (const sector of homeSectorsForVillage(village)) {
            const key = `${TERRITORY_KEY_PREFIX}${sector}`;
            const changed = await withKvLock(key, async () => {
                const prev = await kv.get<SectorTerritory>(key);
                if (prev && String(prev.ownerVillage ?? '').trim()) return false; // already owned
                const next = preserveServerRaidSettlementAuthority(normalizeSectorTerritory({
                    ...(prev ?? defaultSectorTerritory(sector)),
                    ownerVillage: village,
                    updatedAt: now,
                }), prev);
                await commitSectorTerritoryExact(key, prev, next);
                return true;
            }, { failClosed: true });
            if (changed) seeded.push(sector);
        }
    }
    return { seeded: seeded.length, sectors: seeded };
}

// Minimum damage contribution required to qualify for the loss-
// consolation crate. Keeps the consolation away from AFK villagers.
const VILLAGE_WAR_LOSER_MIN_CONTRIB = 50;

/**
 * Apply daily war decay. After VILLAGE_WAR_DECAY_GRACE_DAYS days of
 * the war existing, both sides take VILLAGE_WAR_DECAY_PER_DAY HP at
 * each UTC daily reset. Pushes inactive wars toward resolution so the
 * leaderboard isn't perpetually clogged.
 *
 * Idempotent within a single UTC day (gated by `lastDecayDate`). Safe
 * to call from both GET and POST paths — concurrent callers converge
 * on the same post-decay state.
 *
 * If decay drives both sides to 0 → ends as a draw (no winner, no
 * crate). If only one side hits 0 → ends with the other as winner.
 *
 * Returns the (possibly mutated) war and a `changed` flag so callers
 * know whether to write it back to KV.
 */
function applyWarDecay(war: VillageWar, now: number = Date.now()): { war: VillageWar; changed: boolean } {
    if (!warIsMutableGameplayActive(war)) return { war, changed: false };
    if (war.endedAt) return { war, changed: false };
    // Pending wars don't decay — the grace clock starts at activation.
    if (warIsPending(war)) return { war, changed: false };
    const ageMs = now - warEffectiveStartMs(war);
    if (ageMs < VILLAGE_WAR_DECAY_GRACE_MS) return { war, changed: false };

    const todayKey = utcDateKey(now);
    if (war.lastDecayDate === todayKey) return { war, changed: false };

    // Count UTC day-boundaries we owe decay for. First decay tick
    // happens on the first UTC day boundary at-or-after
    // (effective-start + grace). Subsequent ticks happen at each UTC
    // day boundary thereafter. "Effective start" is `pendingUntil` if
    // the war went through a pre-war window, else `startedAt`.
    const effectiveStart = warEffectiveStartMs(war);
    let referenceMs: number;
    if (war.lastDecayDate) {
        // Parse YYYY-MM-DD as a UTC midnight.
        referenceMs = Date.parse(war.lastDecayDate + 'T00:00:00Z');
        if (!Number.isFinite(referenceMs)) referenceMs = effectiveStart + VILLAGE_WAR_DECAY_GRACE_MS;
    } else {
        referenceMs = effectiveStart + VILLAGE_WAR_DECAY_GRACE_MS;
    }
    const daysOwed = utcDayIndex(now) - utcDayIndex(referenceMs);
    if (daysOwed <= 0) return { war, changed: false };

    // Apply the owed days ONE AT A TIME and stop at the first day a side runs
    // out. Lumping them together (daysOwed × decay in one step) turned results
    // into draws: at 300 vs 900 with two days owed, both sides fell below 0 in
    // the single step, while day by day the 900 side was still standing when
    // the 300 side fell. A war with no reader for a couple of days is ordinary
    // at this population.
    const newHp: Record<string, number> = {};
    for (const v of war.villages) setSafeRecordValue(newHp, v, villageWarHpOf(war, v));
    let fallenDay = -1;
    for (let day = 0; day < daysOwed; day++) {
        for (const v of war.villages) {
            setSafeRecordValue(newHp, v, Math.max(0, newHp[v] - VILLAGE_WAR_DECAY_PER_DAY));
        }
        if (newHp[war.villages[0]] <= 0 || newHp[war.villages[1]] <= 0) {
            fallenDay = day;
            break;
        }
    }

    const decayed: VillageWar = {
        ...war,
        hp: newHp,
        lastDecayDate: todayKey,
        updatedAt: now,
    };
    if (fallenDay < 0) return { war: decayed, changed: true };
    const a = newHp[war.villages[0]];
    const b = newHp[war.villages[1]];
    // Mutual exhaustion → draw (no winner, no crate); otherwise the side still
    // standing wins. Either way the ending is stamped like every other ending.
    return {
        war: stampVillageWarEnding(decayed, {
            endedAt: now,
            winnerVillage: a <= 0 && b <= 0 ? undefined : (a <= 0 ? war.villages[1] : war.villages[0]),
        }),
        changed: true,
    };
}

// A hired merc band can SOFTEN an enemy in a village war but must never deliver
// the war-ending blow — ending a war fires spoils / MVP crates / the losing
// penalty, which stay with real player actions. So merc damage floors the enemy's
// war HP here (a player has to land the last hit through the normal raid path).
const VILLAGE_WAR_MERC_HP_FLOOR = 1;

/** Apply a mercenary's village-war win: chip `damage` off the ENEMY village's war
 *  HP in the live war between `attackerVillage` and `enemyVillage`, under the same
 *  per-war lock the raid path uses. Returns the enemy's new HP, or null when there
 *  is no live, non-pending war between them (so the caller no-ops cleanly). The
 *  enemy HP is floored at VILLAGE_WAR_MERC_HP_FLOOR — mercs soften, players finish.
 *  Server-authoritative: the merc fight is resolved server-side; this never trusts
 *  a client outcome. */
export async function applyMercVillageWarDamage(
    attackerVillage: string,
    enemyVillage: string,
    damage: number,
    now: number = Date.now(),
): Promise<{ enemyHp: number; enemyHpMax: number } | null> {
    const warKey = `${VILLAGE_WAR_KEY_PREFIX}${villageWarId(attackerVillage, enemyVillage)}`;
    return withKvLock(warKey, async () => {
        let war = await kv.get<VillageWar>(warKey);
        if (!warIsMutableGameplayActive(war) || war.endedAt) return null;
        // Bring the war current first, like every other war writer: its 14-day
        // limit, any owed decay, a zero-HP ending. Decay alone let a merc chip a
        // war that had already timed out but that nobody had polled since.
        const current = bringVillageWarCurrent(war, now);
        if (current.changed) {
            const publication = await commitWarBattleSettlement(kv, warKey, war, current.war);
            if (publication.status === 'conflict') return null;
            war = publication.row;
            if (war.endedAt) await ensureWarRematchCooldown(war);
        }
        if (war.endedAt || warIsPending(war)) return null; // over, or pre-war window (HP frozen)
        if (!war.villages.includes(enemyVillage)) return null;
        const before = villageWarHpOf(war, enemyVillage);
        const enemyHpMax = Number(war.hpMax?.[enemyVillage]) || VILLAGE_WAR_HP_MAX;
        // The floor only stops a merc from dealing the final blow. It must never
        // RAISE a village that is already at or below it (that healed a village
        // sitting at 0 back to 1).
        if (before <= VILLAGE_WAR_MERC_HP_FLOOR) return { enemyHp: before, enemyHpMax };
        const after = Math.max(VILLAGE_WAR_MERC_HP_FLOOR, before - Math.max(0, Math.floor(damage)));
        if (after !== before) {
            const publication = await commitWarBattleSettlement(kv, warKey, war, {
                ...war,
                hp: { ...war.hp, [enemyVillage]: after },
                updatedAt: now,
            });
            if (publication.status === 'conflict') return null;
        }
        return { enemyHp: after, enemyHpMax };
    }, { failClosed: true });
}

/**
 * Ramparts bought DURING a war raise that village's war HP at once: its sealed
 * maximum moves up to the new villageWarHpMax and its current HP rises by the
 * same amount. Never lowers anything (a village going dormant mid-war keeps the
 * walls it already had for this war). Returns how many live wars changed.
 * Called by api/village/war-structure.ts after a Ramparts purchase.
 */
export async function raiseVillageWarRampartsHp(village: string, now: number = Date.now()): Promise<number> {
    const wars = await getByPrefix<VillageWar>(VILLAGE_WAR_KEY_PREFIX);
    let changed = 0;
    for (const listed of wars) {
        if (!warIsMutableGameplayActive(listed) || listed.endedAt || !listed.villages.includes(village)) continue;
        const key = `${VILLAGE_WAR_KEY_PREFIX}${listed.id}`;
        const raised = await withKvLock(key, async () => {
            const fresh = await kv.get<VillageWar>(key);
            if (!warIsMutableGameplayActive(fresh) || fresh.endedAt || !fresh.villages.includes(village)) return false;
            // A war already decided on HP is over even before a reader stamps
            // it; walls bought now must not lift a fallen village back up.
            if (endZeroHpVillageWar(fresh, now)) return false;
            const record = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(villageWarKey(village))) ?? undefined);
            const target = villageWarHpMax(record);
            const currentMax = Number(fresh.hpMax?.[village]) || VILLAGE_WAR_HP_MAX;
            if (target <= currentMax) return false;
            const hpMax = { ...(fresh.hpMax ?? {}) };
            setSafeRecordValue(hpMax, fresh.villages[0], Number(hpMax[fresh.villages[0]]) || VILLAGE_WAR_HP_MAX);
            setSafeRecordValue(hpMax, fresh.villages[1], Number(hpMax[fresh.villages[1]]) || VILLAGE_WAR_HP_MAX);
            setSafeRecordValue(hpMax, village, target);
            const hp = { ...fresh.hp };
            setSafeRecordValue(hp, village, Math.min(target, villageWarHpOf(fresh, village) + (target - currentMax)));
            const publication = await commitWarBattleSettlement(kv, key, fresh, {
                ...fresh,
                hpMax,
                hp,
                updatedAt: Math.max(Math.floor(Number(fresh.updatedAt) || 0), now),
            });
            return publication.status === 'committed';
        }, { failClosed: true });
        if (raised) changed += 1;
    }
    return changed;
}

// ── Village-war losing penalty ──────────────────────────────────────────────
// When a war ends WITH a winner, the winner village siphons a slice of the
// loser's village treasury (api/_war-spoils.ts) and both villages' W/L standing
// is bumped. Runs once per generation via an NX settlement marker placed inside
// the village-state locks, so the lazy GET trigger (and wars that ended while
// everyone was offline) settle exactly once — never double-applying, and never
// retry-looping after a KV hiccup. Draws / 14-day timeouts have no winner → skip.
const VILLAGE_STATE_PREFIX = 'game:village-state:';
const WAR_STANDING_PREFIX = 'village:war-standing:';
// Comeback morale uses the legacy loss-stamp field for storage compatibility;
// settlementMoralePatch owns both starting it on a loss and ending it on a win.
function villageStateKey(village: string): string {
    return `${VILLAGE_STATE_PREFIX}${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
function warStandingKey(village: string): string {
    return `${WAR_STANDING_PREFIX}${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
function vnum(v: unknown): number { const x = Number(v); return Number.isFinite(x) ? x : 0; }

// Per-war receipts written into each village-state row in the SAME write that
// moves its treasury (see settleVillageWarSpoils). Server-owned: pinned against
// client blob writes in api/_village-state-validate.ts.
const WAR_SPOILS_RECEIPTS_FIELD = 'warSpoilsReceipts';
const WAR_SPOILS_RECEIPTS_KEPT = 32;
type WarSpoils = ReturnType<typeof computeSpoils>;
type WarSpoilsReceipt = { side: 'winner' | 'loser'; spoils: WarSpoils; at: number };

function warSpoilsReceiptsOf(state: Record<string, unknown>): Record<string, WarSpoilsReceipt> {
    const raw = state[WAR_SPOILS_RECEIPTS_FIELD];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, WarSpoilsReceipt> = {};
    for (const [token, value] of Object.entries(raw as Record<string, unknown>)) {
        const receipt = value as Partial<WarSpoilsReceipt> | null;
        if (!receipt || (receipt.side !== 'winner' && receipt.side !== 'loser') || !receipt.spoils) continue;
        setSafeRecordValue(out, token, {
            side: receipt.side,
            spoils: {
                ryo: vnum(receipt.spoils.ryo),
                honorSeals: vnum(receipt.spoils.honorSeals),
                fateShards: vnum(receipt.spoils.fateShards),
            },
            at: vnum(receipt.at),
        });
    }
    return out;
}

function withWarSpoilsReceipt(
    receipts: Record<string, WarSpoilsReceipt>,
    token: string,
    receipt: WarSpoilsReceipt,
): Record<string, WarSpoilsReceipt> {
    const next: Record<string, WarSpoilsReceipt> = {};
    const kept = Object.entries({ ...receipts, [token]: receipt })
        .sort(([, a], [, b]) => b.at - a.at)
        .slice(0, WAR_SPOILS_RECEIPTS_KEPT);
    for (const [key, value] of kept) setSafeRecordValue(next, key, value);
    return next;
}

/** Bump a village's W/L record once per war (`warToken` dedupes retries).
 *  Caller holds no lock on this key; the bump takes its own. */
async function bumpVillageStanding(village: string, result: 'win' | 'loss', now: number, warToken: string): Promise<void> {
    const key = warStandingKey(village);
    await withKvLock(key, async () => {
        const rec = await kv.get<WarStanding & { settledWars?: unknown }>(key);
        const settledWars = Array.isArray(rec?.settledWars) ? rec!.settledWars.map(String) : [];
        if (settledWars.includes(warToken)) return;
        // Stamp the display name onto the record — the key is only a slug, so the
        // standings board can't recover it otherwise.
        await kv.set(key, {
            ...bumpStanding(rec, result, now),
            village,
            settledWars: [warToken, ...settledWars].slice(0, WAR_SPOILS_RECEIPTS_KEPT),
        });
    }, { failClosed: true });
}

/**
 * Apply a won war's spoils, morale and standings — exactly once, and finish
 * them if an earlier attempt stopped partway. Returns true once the war is
 * settled (now or earlier), false when it has nothing to settle. Throws on a
 * storage failure; nothing is ever marked done until every part has landed.
 *
 * The old version placed its "settled" NX marker FIRST and then wrote the
 * loser's and the winner's treasuries as two plain writes. Any failure between
 * them was permanent: the marker blocked every retry, so a failed winner write
 * burned the loser's spoils, and a failed loser read meant no spoils, no
 * comeback rally and no W/L record ever. Its second lock also ran without
 * failClosed, so under contention the settlement wrote unlocked and a
 * concurrent village-state writer restoring its stale read could mint or burn
 * the transfer. Now each village's write carries its own receipt (with the
 * exact spoils amount) in the same value as its treasury change, so a retry
 * applies only what is missing, and the marker is written last.
 */
async function settleVillageWarSpoils(war: VillageWar, now: number): Promise<boolean> {
    if (!warIsGameplayActive(war) || !war.endedAt || !war.winnerVillage) return false;
    const winner = war.winnerVillage;
    const loser = war.villages.find(v => v !== winner);
    if (!loser) return false;
    const winnerKey = villageStateKey(winner);
    const loserKey = villageStateKey(loser);
    // Lock both village-state rows in a stable (sorted) order so a concurrent
    // donate/agenda credit can't be clobbered and two settles can't deadlock.
    const [k1, k2] = [winnerKey, loserKey].sort();
    const token = villageWarGenerationToken(war);
    const markerKey = `war:settled:${token}`;
    await withKvLock<void>(k1, async () => withKvLock<void>(k2, async () => {
        // The marker is written only after every part below has landed. (A
        // marker from the old code, which wrote it first, stays final too: it
        // cannot tell what landed after it.)
        if (await kv.get<Record<string, unknown>>(markerKey)) return;
        const loserState = (await kv.get<Record<string, unknown>>(loserKey)) ?? {};
        const winnerState = (await kv.get<Record<string, unknown>>(winnerKey)) ?? {};
        const loserReceipts = warSpoilsReceiptsOf(loserState);
        const winnerReceipts = warSpoilsReceiptsOf(winnerState);
        let spoils = loserReceipts[token]?.spoils;
        if (!spoils) {
            const lt = (loserState.treasury ?? {}) as Record<string, unknown>;
            spoils = computeSpoils({ ryo: vnum(lt.ryo), honorSeals: vnum(lt.honorSeals), fateShards: vnum(lt.fateShards) });
            await kv.set(loserKey, {
                ...loserState,
                ...settlementMoralePatch('loser', now),
                treasury: { ...lt, ryo: vnum(lt.ryo) - spoils.ryo, honorSeals: vnum(lt.honorSeals) - spoils.honorSeals, fateShards: vnum(lt.fateShards) - spoils.fateShards },
                [WAR_SPOILS_RECEIPTS_FIELD]: withWarSpoilsReceipt(loserReceipts, token, { side: 'loser', spoils, at: now }),
            });
        }
        if (!winnerReceipts[token]) {
            const wt = (winnerState.treasury ?? {}) as Record<string, unknown>;
            // Winners already receive spoils, crates, standing, and map control;
            // do not add a progression-speed buff on top of those advantages.
            await kv.set(winnerKey, {
                ...winnerState,
                ...settlementMoralePatch('winner', now),
                treasury: { ...wt, ryo: vnum(wt.ryo) + spoils.ryo, honorSeals: vnum(wt.honorSeals) + spoils.honorSeals, fateShards: vnum(wt.fateShards) + spoils.fateShards },
                [WAR_SPOILS_RECEIPTS_FIELD]: withWarSpoilsReceipt(winnerReceipts, token, { side: 'winner', spoils, at: now }),
            });
        }
        await bumpVillageStanding(winner, 'win', now, token);
        await bumpVillageStanding(loser, 'loss', now, token);
        await kv.set(markerKey, { status: 'done', ts: now, winner, loser, spoils }, { ex: 90 * 24 * 60 * 60 });
        await kv.set(`audit:village-war-settle:${token}`, { ts: now, winner, loser, spoils }, { ex: 90 * 24 * 60 * 60 }).catch(() => undefined);
    }, { failClosed: true }), { failClosed: true });
    return true;
}

async function settleVillageWar(war: VillageWar, now: number): Promise<void> {
    if (!warIsMutableGameplayActive(war) || !war.endedAt || !war.winnerVillage) return;
    try {
        if (!(await settleVillageWarSpoils(war, now))) return;
        // The war IS settled now. Stamp the war record so the polled GET skips it
        // from now on. Pure optimization — the receipts and marker above are the
        // real once-only guard, so this is safe even if it races or fails (worst
        // case: one more harmless no-op attempt next poll).
        await withKvLock(`${VILLAGE_WAR_KEY_PREFIX}${war.id}`, async () => {
            const fresh = await kv.get<VillageWar>(`${VILLAGE_WAR_KEY_PREFIX}${war.id}`);
            if (!warIsMutableGameplayActive(fresh) || fresh.settled) return;
            await commitWarBattleSettlement(
                kv,
                `${VILLAGE_WAR_KEY_PREFIX}${war.id}`,
                fresh,
                { ...fresh, settled: true },
            );
        }).catch(() => undefined);
    } catch (err) {
        // A contended or failed pass changes nothing that a retry can't finish;
        // the next poll tries again.
        console.warn('[world-state] village-war settlement deferred', (err as Error)?.message ?? err);
    }
}

// Throws on KV failure so the GET handler can distinguish "genuinely empty"
// from "storage is down". Previously this swallowed errors and returned [],
// which made territories/wars silently VANISH during a KV outage — the client
// saw a 200 with an empty map and rendered "no wars / no territory" instead of
// a transient error. The caller now surfaces a degraded response instead.
async function getByPrefix<T>(prefix: string) {
    const keys = await kv.keys(`${prefix}*`);
    if (!keys.length) return [] as T[];
    // Use mget to fetch all values in one round-trip instead of N individual gets.
    const values = await kv.mget<T[]>(...keys);
    return values.filter(Boolean) as T[];
}

function pvpWarContinuationKey(actorName: string, battleId: string): string {
    return `pvp:war-continuation:${safeName(actorName)}:${battleId}`;
}

function parsePvpWarContinuationReceipt(value: unknown): PvpWarContinuationReceipt | null {
    if (value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('pvp-war-continuation-receipt-invalid');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new Error('pvp-war-continuation-receipt-invalid');
    }
    const row = value as Partial<PvpWarContinuationReceipt>;
    const allowedKeys = new Set([
        'version',
        'battleId',
        'actorName',
        'outcome',
        'warId',
        'settledAt',
        'warGroundRewardEligible',
    ]);
    if (Object.keys(row).some((key) => !allowedKeys.has(key))) {
        throw new Error('pvp-war-continuation-receipt-invalid');
    }
    const actorName = safeName(String(row.actorName ?? ''));
    const warIdValid = row.warId === undefined
        || (typeof row.warId === 'string' && /^[a-z0-9]+-vs-[a-z0-9]+$/.test(row.warId));
    if (row.version !== 1
        || typeof row.battleId !== 'string'
        || !row.battleId.trim()
        || !actorName
        || row.actorName !== actorName
        || (row.outcome !== 'applied' && row.outcome !== 'superseded' && row.outcome !== 'not-applicable')
        || !warIdValid
        || (row.outcome !== 'not-applicable' && row.warId === undefined)
        || !Number.isSafeInteger(row.settledAt)
        || Number(row.settledAt) <= 0
        || typeof row.warGroundRewardEligible !== 'boolean'
        || (row.outcome === 'not-applicable' && row.warGroundRewardEligible)) {
        throw new Error('pvp-war-continuation-receipt-invalid');
    }
    return row as PvpWarContinuationReceipt;
}

function exactPvpWarContinuationReceipt(value: unknown, expected: PvpWarContinuationReceipt): boolean {
    const row = parsePvpWarContinuationReceipt(value);
    return !!row
        && row.battleId === expected.battleId
        && row.actorName === expected.actorName
        && row.outcome === expected.outcome
        && row.warId === expected.warId
        && row.settledAt === expected.settledAt
        && row.warGroundRewardEligible === expected.warGroundRewardEligible;
}

function pvpWarContinuationReceiptMatchesSession(
    receipt: PvpWarContinuationReceipt,
    args: { battleId: string; actor: string; settledAt: number; warId?: string },
): boolean {
    if (receipt.battleId !== args.battleId
        || receipt.actorName !== args.actor
        || receipt.settledAt !== args.settledAt) return false;
    if (receipt.outcome === 'not-applicable') {
        return receipt.warId === args.warId && !receipt.warGroundRewardEligible;
    }
    return !!args.warId && receipt.warId === args.warId;
}

async function commitPvpWarContinuationReceipt(receipt: PvpWarContinuationReceipt): Promise<void> {
    const key = pvpWarContinuationKey(receipt.actorName, receipt.battleId);
    try {
        if (await kv.compareSet(key, null, receipt, { ex: PVP_WAR_CONTINUATION_TTL_SEC })) return;
    } catch (error) {
        const recovered = await kv.get<unknown>(key).catch(() => null);
        if (exactPvpWarContinuationReceipt(recovered, receipt)) return;
        throw error;
    }
    const current = await kv.get<unknown>(key);
    if (exactPvpWarContinuationReceipt(current, receipt)) return;
    throw new Error('pvp-war-continuation-receipt-conflict');
}

/**
 * Spend a war-mission token against the live war (the player half of the war
 * lane; see the `kind: 'war'` handler).
 *
 * /api/village/war-mission verified the raid count and minted a single-use
 * token sealing the damage. The damage applied is the TOKEN's, against the
 * stored HP — the client's cached row is never read, so a stale cache can no
 * longer turn a valid mission into a refused "heal". A mission that takes the
 * enemy to 0 ends the war for the actor's village, the same as a killing blow.
 * Idempotent: the token id is stamped on the row in the same compare-and-set
 * that applies its damage. Caller holds the war lock.
 */
async function applyVillageWarMissionToken(args: {
    warKey: string;
    existing: VillageWar;
    expected: VillageWar | null;
    actorName: string;
    actorDisplayName: string;
    actorVillage: string;
    tokenId: string;
    now: number;
}): Promise<{ status: number; body: Record<string, unknown> }> {
    const { existing, tokenId, now } = args;
    if (!tokenId) {
        return { status: 403, body: { error: 'Village-war damage comes from real battles and war missions, so that update was not applied.' } };
    }
    if (existing.warMissionTokenReceipts?.[tokenId]) {
        return { status: 200, body: { war: existing, replayed: true } };
    }
    if (warIsPending(existing)) {
        const minsLeft = Math.max(1, Math.ceil(((existing.pendingUntil ?? 0) - now) / 60_000));
        return { status: 409, body: { error: `War is still pending — fighting begins in ${minsLeft} min.` } };
    }
    const tokenKey = warMissionTokenKey(tokenId);
    const token = normalizeWarMissionToken(await kv.get<Partial<WarMissionToken>>(tokenKey));
    if (!token || !warMissionTokenAuthorizes(token, {
        actorName: args.actorName,
        actorVillage: args.actorVillage,
        claimedDamage: token.damage,
        now,
    })) {
        return { status: 403, body: { error: 'That war-mission reward is not valid for you, or it has expired.' } };
    }
    const enemy = existing.villages.find((village) => village !== args.actorVillage);
    if (!enemy) return { status: 403, body: { error: 'Only members of the warring villages can update this war.' } };

    const receipts = { ...(existing.warMissionTokenReceipts ?? {}) };
    if (Object.keys(receipts).length >= 2_048) {
        return { status: 503, body: { error: 'Village-war mission receipt ledger is full.' } };
    }
    setSafeRecordValue(receipts, tokenId, now);

    const before = villageWarHpOf(existing, enemy);
    const dealt = Math.min(before, token.damage);
    const contributions = { ...(existing.contributions ?? {}) };
    const key = args.actorName;
    const prior = contributions[key];
    // A war can outlive a village transfer: never move a player's earlier damage
    // to the other side (the PvP settlement follows the same rule).
    if (dealt > 0 && (!prior || prior.side === args.actorVillage)) {
        const base = prior ?? { damage: 0, raids: 0, pvpKills: 0, side: args.actorVillage, name: args.actorDisplayName };
        setSafeRecordValue(contributions, key, {
            damage: Math.max(0, Math.floor(Number(base.damage) || 0)) + dealt,
            raids: Math.max(0, Math.floor(Number(base.raids) || 0)) + 1,
            pvpKills: Math.max(0, Math.floor(Number(base.pvpKills) || 0)),
            side: args.actorVillage,
            name: args.actorDisplayName || base.name,
        });
    }
    let next: VillageWar = {
        ...existing,
        hp: { ...existing.hp },
        contributions,
        warMissionTokenReceipts: receipts,
        updatedAt: Math.max(Math.floor(Number(existing.updatedAt) || 0), now),
    };
    setSafeRecordValue(next.hp, enemy, before - dealt);
    if (before - dealt <= 0) next = stampVillageWarEnding(next, { endedAt: now, winnerVillage: args.actorVillage });

    const publication = await commitWarBattleSettlement(kv, args.warKey, args.expected, next);
    if (publication.status === 'conflict') {
        return { status: 503, body: { error: 'Village-war state changed; retry.' } };
    }
    if (publication.row.endedAt) await ensureWarRematchCooldown(publication.row);
    // The receipt on the row already makes the token single-use; deleting it is
    // only cleanup.
    await kv.del(tokenKey).catch(() => undefined);
    return { status: 200, body: { war: publication.row, dealt } };
}

export async function settlePvpVillageWarContinuation(
    battleId: string,
    actorName: string,
    validatedSession?: PvpSession,
    raidTerritoryProof?: RaidTerritoryDamageResult,
): Promise<{ status: number; body: Record<string, unknown> }> {
    const actor = safeName(actorName);
    const receiptKey = pvpWarContinuationKey(actor, battleId);
    const session = validatedSession ?? await kv.get<PvpSession>(`pvp:${battleId}`);
    if (!session) return { status: 404, body: { error: 'Battle session not found or expired.' } };
    if (session.battleId !== battleId) {
        return { status: 409, body: { error: 'Battle recovery proof does not match this session.' } };
    }
    if (session.status !== 'done' || (session.winner !== 'p1' && session.winner !== 'p2')) {
        return { status: 409, body: { error: 'Battle not yet decided.' } };
    }
    const winnerFighter = session.winner === 'p1' ? session.p1 : session.p2;
    const loserFighter = session.winner === 'p1' ? session.p2 : session.p1;
    const winnerName = safeName(winnerFighter?.name);
    const loserName = safeName(loserFighter?.name);
    if (!actor || winnerName !== actor) {
        return { status: 403, body: { error: 'Only the recorded winner may settle village-war progress.' } };
    }
    if (!pvpSessionMayGrantProgress(session)
        || session.rewardAuthority === 'admin'
        || (session.ranked === true && session.rankedKind === 'pet')) {
        return { status: 403, body: { error: 'This battle has no server progression authority.' } };
    }

    // Participant villages are sealed in the fighter snapshots at session
    // creation. Current saves may change villages after the fight and must never
    // redirect an old battle into a different live war.
    const actorVillage = String(winnerFighter?.character?.village ?? '').trim();
    const loserVillage = String(loserFighter?.character?.village ?? '').trim();
    const p1Village = String(session.p1?.character?.village ?? '').trim();
    const p2Village = String(session.p2?.character?.village ?? '').trim();
    const validationNow = Date.now();
    const createdAt = Number(session.createdAt);
    const settledAt = Number(session.endedAt);
    if (!loserName || loserName === actor
        || !Number.isSafeInteger(createdAt) || createdAt <= 0
        || !Number.isSafeInteger(settledAt) || settledAt < createdAt
        || settledAt > validationNow + 60_000) {
        return { status: 403, body: { error: 'Battle authority is malformed.' } };
    }
    const sealedWarId = actorVillage && loserVillage && actorVillage !== loserVillage
        ? villageWarId(actorVillage, loserVillage)
        : undefined;
    let priorReceipt: PvpWarContinuationReceipt | null;
    try {
        priorReceipt = parsePvpWarContinuationReceipt(await kv.get<unknown>(receiptKey));
    } catch {
        return { status: 503, body: { error: 'Village-war continuation receipt is malformed.' } };
    }
    if (priorReceipt) {
        if (!pvpWarContinuationReceiptMatchesSession(priorReceipt, {
            battleId,
            actor,
            settledAt,
            warId: sealedWarId,
        })) {
            return { status: 503, body: { error: 'Village-war continuation receipt conflicts with this battle.' } };
        }
        const war = priorReceipt.outcome !== 'not-applicable' && priorReceipt.warId
            ? await kv.get<VillageWar>(`${VILLAGE_WAR_KEY_PREFIX}${priorReceipt.warId}`).catch(() => null)
            : null;
        if (priorReceipt.outcome !== 'not-applicable'
            && priorReceipt.warId
            && (!war || war.id !== priorReceipt.warId)) {
            return { status: 503, body: { error: 'Village-war continuation row is unavailable.' } };
        }
        if (war?.endedAt) await ensureWarRematchCooldown(war);
        return {
            status: 200,
            body: {
                ok: true,
                settlement: priorReceipt.outcome,
                replayed: true,
                warGroundRewardEligible: priorReceipt.warGroundRewardEligible,
                ...(war ? { war } : {}),
            },
        };
    }
    const writeNoop = async (): Promise<{ status: number; body: Record<string, unknown> }> => {
        const receipt: PvpWarContinuationReceipt = {
            version: 1,
            battleId,
            actorName: actor,
            outcome: 'not-applicable',
            ...(sealedWarId ? { warId: sealedWarId } : {}),
            settledAt,
            warGroundRewardEligible: false,
        };
        await commitPvpWarContinuationReceipt(receipt);
        return {
            status: 200,
            body: {
                ok: true,
                settlement: 'not-applicable',
                replayed: false,
                warGroundRewardEligible: false,
            },
        };
    };
    if (!actorVillage || !loserVillage || actorVillage === loserVillage) return writeNoop();

    const warId = sealedWarId!;
    const warKey = `${VILLAGE_WAR_KEY_PREFIX}${warId}`;
    const winnerSide = session.winner;
    const loserSide = winnerSide === 'p1' ? 'p2' : 'p1';
    const actorRole = sealedSectorWarRoleOf(
        session.warRoleEvidence,
        winnerSide,
        actorVillage,
        createdAt,
    );
    const loserRole = sealedSectorWarRoleOf(
        session.warRoleEvidence,
        loserSide,
        loserVillage,
        createdAt,
    );
    const rewardSector = Math.floor(Number(session.rewardSector));
    const worldAttacker = sealedWorldRaidAttacker(session);
    const sealedWorldRaid = session.rewardAuthority === 'world'
        && worldAttacker?.side === session.winner
        && worldAttacker.name === actor;
    const territoryEvidence = session.worldTerritoryEvidence;
    // A sealed World raid may only APPLY territory damage against an exact,
    // verified proof. That check is evaluated here but enforced at the points of
    // application rather than returned immediately, because a battle that cannot
    // affect this war at all — no war row, war already inactive, non-overlapping
    // window, or finished after canonical peace — resolves to a durable
    // not-applicable receipt and applies nothing, so it needs no proof.
    //
    // Returning 503 up front made those cases permanently unsettleable:
    // pvp/claim-rewards throws on any non-200 from this settler and retries
    // forever, and the world-state publish route calls it with no proof at all.
    // 503 also advertises "retry", which is the wrong shape for a condition that
    // can never resolve on its own.
    const expectedRaidProofId = raidProgressionReceiptId(`pvp-raid:${battleId}`);
    const raidProofAmount = Number(raidTerritoryProof?.amount);
    const raidProofVerified = !!territoryEvidence
        && territoryEvidence.version === 1
        && territoryEvidence.sector === rewardSector
        && raidTerritoryProof?.proofId === expectedRaidProofId
        && raidTerritoryProof.playerName === actor
        && raidTerritoryProof.sector === rewardSector
        && (raidProofAmount === 0 || raidProofAmount === territoryEvidence.raidDamage)
        && raidTerritoryProof.at === settledAt;
    const raidProofUnverified = sealedWorldRaid && !raidProofVerified;
    const raidProofPending = {
        status: 503,
        body: { error: 'The sealed raid-territory proof is still finalizing.' },
    };
    // A war-ground raid is judged on the WAR's terms: a sealed World raid the
    // attacker won, fought in the war-ground sector between the two warring
    // villages, whose raid proof has settled. It used to also require that the
    // sector's TERRITORY row took damage (`amount > 0`), but territory raids only
    // damage clan-owned sectors (api/pvp/session.ts seals raidDamage 0 for an
    // unowned or village-owned one), so on the usual war ground no real fight
    // ever counted as a war-ground raid — the bonus damage, the daily war-ground
    // bounty and the capture were reachable only through the old no-fight client
    // writes. The territory amount still only governs the territory itself.
    const warGroundRaidVerified = sealedWorldRaid && raidProofVerified;
    let pvpDamage = sectorControlSwing(actorRole, loserRole);
    // The home-defense multiplier is sector-history authority, not current map
    // state. Only a verified World session carries a territory owner snapshot
    // sealed at creation; ranked/Clan War/legacy challenge rows have no such
    // proof and therefore fail closed to the neutral role swing. Re-reading the
    // current territory here let a delayed claim gain or lose 15% after an
    // unrelated capture, and let a client-chosen non-World rewardSector steer
    // village-war damage.
    const homeVillage = sealedWorldRaid
        ? String(territoryEvidence?.ownerVillage ?? '').trim()
        : '';
    if (homeVillage === actorVillage) {
        pvpDamage = Math.max(1, Math.floor(pvpDamage * 1.15));
    }
    return withKvLock(warKey, async () => {
        for (let attempt = 0; attempt < 6; attempt += 1) {
            const raw = await kv.get<VillageWar>(warKey);
            if (!raw) return writeNoop();
            // A target-first mercenary marker freezes this exact row. Never
            // consume a finished PvP continuation as a durable no-op while the
            // strike can still be helped forward; the claim must retry against
            // the post-activation row.
            if (warHasMercenaryFundingField(raw)) {
                return { status: 503, body: { error: 'A mercenary strike is settling; retry village-war rewards.' } };
            }
            if (!warIsGameplayActive(raw)) return writeNoop();
            try {
                parseEmbeddedWarBattleReceipts(raw.pvpBattleReceipts);
            } catch {
                return { status: 503, body: { error: 'Village-war embedded battle receipts are malformed.' } };
            }

            if (embeddedWarBattleReplay(raw.pvpBattleReceipts, battleId, actor)) {
                // This battle is already recorded against the war, so the raid
                // did land and a proof must exist. Reporting eligibility from an
                // unverified proof could under- or over-pay the ground reward, so
                // this stays retryable until the caller supplies it.
                if (raidProofUnverified) return raidProofPending;
                const warGroundRewardEligible = warGroundRaidVerified
                    && pvpWarGroundRewardEligible({
                        actorVillage,
                        loserVillage,
                        rewardSector,
                        battleCreatedAt: createdAt,
                        battleEndedAt: settledAt,
                        war: raw,
                    });
                const embeddedOutcome = embeddedWarBattleOutcome(raw.pvpBattleReceipts, battleId, actor);
                const receipt: PvpWarContinuationReceipt = {
                    version: 1,
                    battleId,
                    actorName: actor,
                    outcome: embeddedOutcome ?? (raw.endedAt ? 'superseded' : 'applied'),
                    warId,
                    settledAt,
                    warGroundRewardEligible,
                };
                await commitPvpWarContinuationReceipt(receipt);
                if (raw.endedAt) await ensureWarRematchCooldown(raw);
                return {
                    status: 200,
                    body: {
                        ok: true,
                        settlement: receipt.outcome,
                        replayed: true,
                        warGroundRewardEligible,
                        war: raw,
                    },
                };
            }

            const effectiveStart = warEffectiveStartMs(raw);
            const exactCheck = validateWarBattle({
                battle: session,
                actorName: actor,
                actorVillage,
                warVillages: raw.villages,
                p1Village,
                p2Village,
                warStartedAt: effectiveStart,
                budgetSpent: 0,
                validationNow,
            });
            if (!exactCheck.ok) {
                // A valid sanctioned battle that simply did not overlap this
                // war gets a durable canonical no-op rather than depending on a
                // missing process-local client cache.
                if (exactCheck.reason === 'battle-predates-war' || exactCheck.reason === 'not-a-cross-village-battle') {
                    return writeNoop();
                }
                return { status: 403, body: { error: warBattleDeclineMessage(exactCheck.reason) } };
            }

            const boundedEnd = effectiveStart + VILLAGE_WAR_MAX_DURATION_MS;
            if (!Number.isSafeInteger(boundedEnd)) {
                return { status: 503, body: { error: 'Village-war lifetime is malformed.' } };
            }
            const recordedEnd = raw.endedAt === undefined ? boundedEnd : Number(raw.endedAt);
            if (!Number.isSafeInteger(recordedEnd) || recordedEnd < effectiveStart) {
                return { status: 503, body: { error: 'Village-war terminal time is malformed.' } };
            }
            if (settledAt > Math.min(boundedEnd, recordedEnd)) return writeNoop();

            const legacySpent = Math.max(0, Math.floor(Number(
                await kv.get<number>(warBattleReceiptKey(raw.id, battleId)),
            ) || 0));
            if (legacySpent > 0) {
                // Pre-cutover wrote this external marker BEFORE the absolute war
                // row. It cannot prove whether damage/winner landed, so claiming
                // success would permanently hide a marker-before-body crash.
                return {
                    status: 503,
                    body: { error: 'Legacy village-war settlement is ambiguous and requires reconciliation.' },
                };
            }

            // A battle that started before an ending blow may still help-forward
            // its receipt after the war ends, but it may never mutate HP/winner.
            if (raw.endedAt && settledAt > Number(raw.endedAt)) return writeNoop();
            // Past every not-applicable exit: this battle is about to mutate the
            // war row. A sealed World raid may not do that on an unverified
            // proof, so enforce the gate here, where something is actually
            // applied, rather than before the no-op paths could resolve.
            if (raidProofUnverified) return raidProofPending;
            const attemptNow = Date.now();
            // The 14-day limit, owed decay and a zero-HP ending first, so this
            // battle lands on the war as it stands now (and a war already won
            // on HP cannot be won again by the other side).
            const current = bringVillageWarCurrent(raw, attemptNow).war;
            const commitAt = Math.max(
                attemptNow,
                Math.floor(Number(current.updatedAt) || 0),
                effectiveStart,
            );
            if (!Number.isSafeInteger(commitAt) || commitAt <= 0) {
                return { status: 503, body: { error: 'Village-war settlement clock is malformed.' } };
            }
            const isWarGroundRaid = warGroundRaidVerified && rewardSector === current.warGroundSector;
            const warGroundRewardEligible = isWarGroundRaid
                && pvpWarGroundRewardEligible({
                    actorVillage,
                    loserVillage,
                    rewardSector,
                    battleCreatedAt: createdAt,
                    battleEndedAt: settledAt,
                    war: raw,
                });
            // The war row's own ground HP decides a capture (the projection flips
            // it when a raid takes the ground to 0). This used to also require
            // `raidTerritoryProof.destroyed`, which the raid settlement never sets
            // (api/missions/_raid-territory.ts), so a real fight could grind the
            // ground to 0 and then never capture it.
            const captureAuthorized = isWarGroundRaid;
            const projected = projectPvpVillageWarSettlement(current, {
                actorName: actor,
                actorDisplayName: String(session.winner === 'p1' ? session.p1?.name : session.p2?.name),
                actorVillage,
                loserVillage,
                pvpDamage,
                raidDamage: isWarGroundRaid ? actorRole.win : 0,
                captureAuthorized,
                terminalAt: settledAt,
                settlementAt: commitAt,
            });
            const outcome: PvpWarContinuationOutcome = current.endedAt ? 'superseded' : 'applied';
            const candidate = projected.row as VillageWar;
            candidate.pvpBattleReceipts = stampEmbeddedWarBattleReplay(
                current.pvpBattleReceipts,
                battleId,
                actor,
                outcome,
            );
            const publication = await commitWarBattleSettlement(kv, warKey, raw, candidate);
            if (publication.status === 'conflict') continue;

            await commitPvpWarContinuationReceipt({
                version: 1,
                battleId,
                actorName: actor,
                outcome,
                warId,
                settledAt,
                warGroundRewardEligible,
            });
            if (publication.row.endedAt) await ensureWarRematchCooldown(publication.row);
            return {
                status: 200,
                body: {
                    ok: true,
                    settlement: outcome,
                    replayed: false,
                    warGroundRewardEligible,
                    war: publication.row,
                    damage: { village: projected.enemyDamage, ground: projected.groundDamage },
                },
            };
        }
        return { status: 503, body: { error: 'Village-war state changed; retry settlement.' } };
    }, { failClosed: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        let territories: SectorTerritory[];
        let warsRaw: VillageWar[];
        let standingRows: WarStanding[];
        let sectorPools: Record<number, SectorPoolRow>;
        // Village Stores — INTEL is NOT here. It is per-viewer, so attaching it
        // to this shared GET forced `private, no-store` on every logged-in poll
        // and defeated the CDN cache outright. It lives on its own authenticated
        // endpoint instead (api/village/intel.ts → GET /api/village/intel).
        try {
            // Proc-cached like game-state.ts: this GET is polled by every online
            // client, and each CDN miss cost 3 keyspace scans + 3 mgets. The 3s
            // cache bounds origin storage work to one build per window regardless
            // of poll fan-in (single-flight); the CDN s-maxage below still applies
            // on top. Treat the cached arrays as immutable — the decay/settle
            // logic below already derives fresh objects instead of mutating.
            [territories, warsRaw, standingRows, sectorPools] = await cachedFor('world-state:frame', 3_000, () => Promise.all([
                getByPrefix<SectorTerritory>(TERRITORY_KEY_PREFIX),
                getByPrefix<VillageWar>(VILLAGE_WAR_KEY_PREFIX),
                getByPrefix<WarStanding>(WAR_STANDING_PREFIX),
                // Shared per-sector gathering usage (today's raw counts). The
                // viewer applies the owner-village bonus to the caps itself.
                // Gated on the Village Stores kill switch so turning the campaign
                // off also drops this 4th keyspace scan + mget from the frame.
                villageStoresEnabled()
                    ? readAllSectorPoolUsage().catch(() => ({} as Record<number, SectorPoolRow>))
                    : Promise.resolve({} as Record<number, SectorPoolRow>),
            ]));
        } catch (err) {
            // Storage is down — fail safe with an explicit degraded flag and a
            // non-cacheable 503 instead of a 200 with empty data. The client
            // keeps its last-known territories/wars rather than wiping the map.
            console.error('[world-state] GET read failed', err);
            res.setHeader('Cache-Control', 'no-store');
            return res.status(503).json({ degraded: true, error: 'World state temporarily unavailable.' });
        }
        // Apply daily decay lazily on read. Wars that crossed a UTC day
        // boundary since their last decay get -500 HP per side per day.
        // Persist the result so subsequent reads (and the cached CDN
        // response) reflect the decayed state. Fire-and-forget writes —
        // GET shouldn't block on the persist, and concurrent GETs that
        // both decay converge on the same idempotent result.
        const now = Date.now();
        const projectedTerritories: SectorTerritory[] = [];
        const wars: VillageWar[] = [];
        const writes: Promise<unknown>[] = [];
        for (const territory of territories) {
            const settled = settleExpiredTerritoryBreach(territory, now);
            projectedTerritories.push(settled.row as SectorTerritory);
            if (settled.changed) {
                const territoryKey = `${TERRITORY_KEY_PREFIX}${territory.sector}`;
                writes.push(withKvLock(territoryKey, async () => {
                    const fresh = await kv.get<SectorTerritory>(territoryKey);
                    if (!fresh) return;
                    const refreshed = settleExpiredTerritoryBreach(fresh, now);
                    if (refreshed.changed) await commitSectorTerritoryExact(
                        territoryKey,
                        fresh,
                        refreshed.row as SectorTerritory,
                    );
                }, { failClosed: true }).catch(() => undefined));
            }
        }
        territories = projectedTerritories;
        const currentWars: VillageWar[] = [];
        for (const w of warsRaw) {
            if (!warIsGameplayActive(w)) continue;
            // The 14-day limit, owed decay and a zero-HP ending all land here
            // too, so a quiet war still finishes on time with nobody acting.
            const { war, changed } = bringVillageWarCurrent(w, now);
            currentWars.push(war);
            wars.push(publicVillageWar(war));
            if (changed) {
                writes.push(
                    withKvLock(`${VILLAGE_WAR_KEY_PREFIX}${war.id}`, async () => {
                        // Re-read under the lock so we don't clobber a
                        // concurrent raid write that just landed.
                        const fresh = await kv.get<VillageWar>(`${VILLAGE_WAR_KEY_PREFIX}${war.id}`);
                        if (!fresh) return;
                        const { war: current, changed: stillChanged } = bringVillageWarCurrent(fresh, now);
                        if (!stillChanged) return;
                        const publication = await commitWarBattleSettlement(
                            kv,
                            `${VILLAGE_WAR_KEY_PREFIX}${war.id}`,
                            fresh,
                            current,
                        );
                        if (publication.status === 'committed' && publication.row.endedAt) {
                            await ensureWarRematchCooldown(publication.row);
                        }
                    }, { failClosed: true }).catch(() => undefined),
                );
            }
        }
        // Lazily apply the losing penalty (treasury spoils + W/L standing) to any
        // war that has ended with a winner — exactly once each (see
        // settleVillageWar) — even wars that ended on the decay timer while
        // offline. Runs on the full rows: the settlement is keyed on the war's
        // generation, which the public projection must not be trusted to keep.
        for (const w of currentWars) {
            if (w.endedAt && w.winnerVillage && !w.settled) void settleVillageWar(w, now);
        }
        // Don't block the GET response on the persist — let writes run in
        // background. The response already shows the decayed state.
        if (writes.length > 0) void Promise.all(writes);
        // CDN caches this for 15 s so all players polling every 15 s share
        // one Supabase round-trip per window instead of one per player.
        // stale-while-revalidate=10 keeps the response instant while revalidating.
        // Village W/L war records (self-describing — each row carries its village
        // name). Only surface villages that have actually warred.
        const standings = standingRows
            .filter(s => s && s.village && (vnum(s.wins) + vnum(s.losses)) > 0)
            .sort((a, b) => (vnum(b.wins) - vnum(b.losses)) - (vnum(a.wins) - vnum(a.losses)));
        const payload = { territories, wars, standings, sectorPools, sectorPoolCaps: SECTOR_POOL_CAPS };
        // Content-hash ETag → unchanged polls get a 304 (empty body) instead of
        // re-downloading the full territory/war/standings map every 15s. The lazy
        // decay/settle writes above were already dispatched, so the 304 path does
        // not skip them. Freshness is identical; only the repeat bytes are saved.
        // (Mirrors api/game-state.ts. Pairs with the client's `cache: "no-cache"`.)
        //
        // The hash covers the NON-VOLATILE slice only. `sectorPools` still rides
        // the body, but it moves every time anyone explores anywhere, so hashing
        // it churned the ETag continuously and the 304 fast path never fired.
        //
        // Be honest about what that costs: the client polls with
        // `cache: "no-cache"`, so it revalidates every time and a 304 re-hydrates
        // the body it already had. The pool counts in that body are therefore
        // pinned until the territory/war/standings slice actually changes — which
        // can be many minutes, NOT the 3s proc-cache + 12s s-maxage window (that
        // window bounds the 200 path only). The client compensates: an explore /
        // open-chest response carries the server's exact per-viewer pool view,
        // and lib/sector-pool keeps it until a poll's counts have caught up with
        // it, so the on-screen counter never runs backwards.
        const etag = `W/"${createHash('sha1').update(JSON.stringify({ territories, wars, standings })).digest('base64')}"`;
        // s-maxage lowered 15→12 to offset the 3s proc cache above, keeping the
        // total worst-case staleness at the original ~15s (see api/_proc-cache.ts).
        res.setHeader('Cache-Control', 's-maxage=12, stale-while-revalidate=10');
        res.setHeader('ETag', etag);
        if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }
        return res.status(200).json(payload);
    }

    if (req.method === 'POST') {
        // Require a logged-in player at minimum. We also gate territory and
        // war writes to participants (or admin) — see per-kind checks below.
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        // Coarse rate limit on the whole endpoint. Legitimate gameplay
        // generates at most ~1 write/sec under heavy raid grinding; 60/min
        // gives a 2× safety margin and still blocks scripted attacks.
        // Admins exempt for migration / repair scripts.
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'world-state-write', 60, 60_000, identity.name))) return;
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const hasPvpWarBattleId = body?.kind === 'war'
                && Object.prototype.hasOwnProperty.call(body as Record<string, unknown>, 'battleId');
            const pvpWarBattleId = hasPvpWarBattleId
                ? String((body as Record<string, unknown>).battleId ?? '').trim()
                : '';
            if (hasPvpWarBattleId) {
                if (!pvpWarBattleId) {
                    return res.status(400).json({ error: 'battleId must be a non-empty PvP session id.' });
                }
                if (identity.admin) {
                    return res.status(403).json({ error: 'Admin sessions do not publish player village-war progress.' });
                }
                const settlement = await settlePvpVillageWarContinuation(pvpWarBattleId, identity.name);
                return res.status(settlement.status).json(settlement.body);
            }
            if (body?.kind === 'territory') {
                const rawTerritory = body?.territory && typeof body.territory === 'object'
                    ? body.territory as Record<string, unknown>
                    : {};
                const ownerVillageProvided = Object.prototype.hasOwnProperty.call(rawTerritory, 'ownerVillage');
                const ownerClanProvided = Object.prototype.hasOwnProperty.call(rawTerritory, 'ownerClan');
                const incomingTerritory = normalizeSectorTerritory({ ...rawTerritory, updatedAt: Date.now() });

                // Participation gate. Three valid writer cases:
                //   1. Actor matches the claiming clan/village (defender / claimant)
                //   2. Actor matches the PREVIOUS owner (rebuilding own sector)
                //   3. Actor's village has an active war with the current owner village
                //      (raider during an active village war)
                // After identity is confirmed we also enforce a per-request HP delta
                // cap so a malicious client can't drop a sector to 0 in one POST.
                let prev: SectorTerritory | null = null;
                if (!identity.admin) {
                    try {
                        const actorSave = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                        const actorChar = (actorSave?.character ?? null) as Record<string, unknown> | null;
                        const actorClan = String(actorChar?.clan ?? '').trim();
                        const actorVillage = String(actorChar?.village ?? '').trim();
                        let claimingClan = String(incomingTerritory.ownerClan ?? '').trim();
                        let claimingVillage = String(incomingTerritory.ownerVillage ?? '').trim();

                        prev = await kv.get<SectorTerritory>(`${TERRITORY_KEY_PREFIX}${incomingTerritory.sector}`);
                        // PATCH-style clients may omit owner fields, and older raid
                        // clients explicitly sent an empty owner when HP reached zero.
                        // Preserve stored ownership in both cases; captures replace it
                        // through the verified claimant/settlement paths below.
                        if (prev && (!ownerVillageProvided || !claimingVillage)) {
                            incomingTerritory.ownerVillage = prev.ownerVillage;
                            claimingVillage = String(prev.ownerVillage ?? '').trim();
                        }
                        if (prev && (!ownerClanProvided || !claimingClan)) {
                            incomingTerritory.ownerClan = prev.ownerClan;
                            claimingClan = String(prev.ownerClan ?? '').trim();
                        }
                        const prevClan = String(prev?.ownerClan ?? '').trim();
                        const prevVillage = String(prev?.ownerVillage ?? '').trim();
                        if (prev && prevClan) {
                            const clanRec = await kv.get<Record<string, unknown>>(clanRecordKey(prevClan));
                            if (!clanRec) {
                                return res.status(409).json({ error: 'The owning clan record is unavailable. Retry after territory cleanup.' });
                            }
                            const actorSlug = safeName(identity.name);
                            const actorInOwnerClan = clanBareSlug(actorClan) === clanBareSlug(prevClan)
                                && clanActorIsMember(clanRec, actorSlug);
                            const actorIsAnbu = await actorIsAppointedVillageAnbu(actorSlug, actorVillage, prevVillage);
                            if (!actorInOwnerClan && !actorIsAnbu) {
                                return res.status(403).json({ error: 'Only the owning clan or a current village ANBU may update this territory.' });
                            }

                            // HP is combat/economy authority. Raids apply damage
                            // through their sealed settlement and repairs spend
                            // treasury scrolls through assign-scrolls. The legacy
                            // full-row endpoint must never raise or lower it.
                            if (Object.prototype.hasOwnProperty.call(rawTerritory, 'hp')
                                && incomingTerritory.hp !== prev.hp) {
                                return res.status(403).json({ error: 'Territory HP can only change through verified raids or Territory Control Scroll repairs.' });
                            }

                            const weatherProvided = Object.prototype.hasOwnProperty.call(rawTerritory, 'weather');
                            const terrainProvided = Object.prototype.hasOwnProperty.call(rawTerritory, 'terrainBuffStat');
                            const settingsChanging = (weatherProvided && incomingTerritory.weather !== prev.weather)
                                || (terrainProvided && incomingTerritory.terrainBuffStat !== prev.terrainBuffStat);
                            if (settingsChanging && (!actorInOwnerClan || !clanActorCanManageTerritory(clanRec, actorSlug))) {
                                return res.status(403).json({ error: 'Only clan leadership may change territory weather or terrain.' });
                            }

                            const guardsProvided = Object.prototype.hasOwnProperty.call(rawTerritory, 'guards');
                            const nextGuards = guardsProvided
                                ? territoryGuardsAfterSelfUpdate(prev.guards, incomingTerritory.guards, actorSlug)
                                : prev.guards;
                            if (!nextGuards) {
                                return res.status(403).json({ error: 'You may only add or remove yourself from territory guards.' });
                            }

                            // Rebuild the row from server state and apply only the
                            // two intended client commands. This also protects
                            // images, ownership, control, supply, cooldowns, and
                            // future server fields from full-object overwrite.
                            Object.assign(incomingTerritory, prev, {
                                weather: weatherProvided ? incomingTerritory.weather : prev.weather,
                                terrainBuffStat: terrainProvided ? incomingTerritory.terrainBuffStat : prev.terrainBuffStat,
                                guards: nextGuards,
                                updatedAt: Date.now(),
                            });
                            claimingClan = prevClan;
                            claimingVillage = prevVillage;
                        }
                        // Village ownership and territory HP are server authority on
                        // EVERY row, not only clan rows (owner rulings 2026-10-08):
                        // a war sector changes hands only when a 72-hour sector war
                        // settles (captureSectorForVillage), an all-out village war
                        // never moves the map, and HP changes only through verified
                        // raid settlement or Territory Control Scroll repairs. This
                        // route used to accept both from the client. A war village's
                        // members could grind an enemy home sector to 0 with the War
                        // Hall's no-fight Raid button (1,000 HP a request) and then
                        // write their own village in as its owner, bypassing the
                        // sector war entirely; and any player could stamp their
                        // village onto an unowned wilderness or central sector, which
                        // the war economy then counted as held.
                        if (claimingVillage !== prevVillage) {
                            return res.status(403).json({ error: 'A sector changes hands only when a sector war settles.' });
                        }
                        const storedHp = Number(prev?.hp ?? TERRITORY_HP_MAX);
                        if (Object.prototype.hasOwnProperty.call(rawTerritory, 'hp')
                            && incomingTerritory.hp !== storedHp) {
                            return res.status(403).json({ error: 'Territory HP can only change through verified raids or Territory Control Scroll repairs.' });
                        }
                        // normalizeSectorTerritory defaults an omitted hp to full;
                        // a PATCH that leaves it out keeps the stored value.
                        incomingTerritory.hp = storedHp;
                        // rebuiltAt is lifecycle state (api/_territory-lifecycle.ts):
                        // it holds off clan recaptures for the rebuild cooldown, so
                        // an owner restamping it could lock clans out indefinitely.
                        incomingTerritory.rebuiltAt = prev?.rebuiltAt;
                        // Clan control progress and clan ownership are purchased
                        // with treasury scrolls. They are owned exclusively by
                        // /api/clan/territory/assign-scrolls, which validates clan
                        // leadership and debits the canonical treasury under the
                        // same locks. Keeping those fields writable here let any
                        // clan member capture a sector without spending a scroll.
                        const previousControlScore = Number(prev?.controlScore ?? 0);
                        if (incomingTerritory.controlScore !== previousControlScore) {
                            return res.status(403).json({ error: 'Clan control can only be changed by assigning Territory Control Scrolls.' });
                        }
                        if (claimingClan !== prevClan) {
                            return res.status(403).json({ error: 'Clan territory ownership can only be changed by the clan territory command.' });
                        }
                        const ownershipError = territoryVillageOwnershipError({
                            sector: incomingTerritory.sector,
                            actorVillage,
                            previousOwnerVillage: prevVillage,
                            requestedOwnerVillage: claimingVillage,
                            claimingClanChanges: !!claimingClan && claimingClan !== prevClan,
                        });
                        if (ownershipError) {
                            return res.status(403).json({ error: ownershipError });
                        }
                        // With ownership and HP pinned above, the only writers left
                        // are the sector's own owners updating its non-authority
                        // fields (guards, weather, terrain, art). There is no raider
                        // case any more: raids are fights, settled server-side.
                        const matchesClan = !!claimingClan && actorClan === claimingClan;
                        const matchesVillage = !!claimingVillage && actorVillage === claimingVillage;
                        if (!matchesClan && !matchesVillage) {
                            return res.status(403).json({ error: 'Only the sector\'s owners can update it.' });
                        }

                        // ── Server-authoritative War Supply (anti-mint, audit H4) ──
                        // collectTerritorySupply banks a sector's stored warSupply
                        // straight into the clan treasury, so warSupply must never
                        // come from the client. Ownership cannot change on this route,
                        // so this always carries the stored supply forward (accrual is
                        // recomputed lazily from lastSupplyAt at collect time). The
                        // absolute cap in normalizeSectorTerritory remains a backstop
                        // for the admin-exempt path.
                        const owned = resolveClaimedWarSupply(prev, incomingTerritory, Date.now());
                        incomingTerritory.warSupply = owned.warSupply;
                        incomingTerritory.lastSupplyAt = owned.lastSupplyAt;
                    } catch {
                        return res.status(500).json({ error: 'Unable to verify territory participation.' });
                    }
                }

                // Serialize concurrent territory POSTs through the same
                // fail-closed lock as the authoritative raid saga. Falling
                // through unlocked could erase a crash-pinned proof between
                // its HP commit and terminal-key help-forward.
                let committedTerritory = incomingTerritory;
                let territoryConflict = false;
                let territoryBefore: SectorTerritory | null = null;
                await withKvLock(`${TERRITORY_KEY_PREFIX}${incomingTerritory.sector}`, async () => {
                    const key = `${TERRITORY_KEY_PREFIX}${incomingTerritory.sector}`;
                    const fresh = await kv.get<SectorTerritory>(key);
                    territoryBefore = fresh;
                    if (!identity.admin && !isDeepStrictEqual(fresh, prev)) {
                        territoryConflict = true;
                        return;
                    }
                    const ownerVillageChanging = String(committedTerritory.ownerVillage ?? '').trim()
                        !== String(fresh?.ownerVillage ?? '').trim();
                    if (ownerVillageChanging) {
                        // Active contests and their hidden funding predecessors
                        // both bind the defender village. This check shares the
                        // exact territory writer lock with sector declaration,
                        // closing the post-activation HP=0 capture race too.
                        const authorityNow = Date.now();
                        const [activeContest, pendingDeclarations] = await Promise.all([
                            activeContestOnSector(incomingTerritory.sector, authorityNow, { strict: true }),
                            listFundingSectorWars(kv, { strict: true }),
                        ]);
                        if (activeContest
                            || pendingDeclarations.some(candidate => candidate.sector === incomingTerritory.sector)) {
                            territoryConflict = true;
                            return;
                        }
                    }
                    committedTerritory = preserveServerTerritoryLifecycle(preserveServerRaidSettlementAuthority({
                        ...incomingTerritory,
                    }, fresh), fresh);
                    // A village conquest cannot leave the defeated clan owning
                    // a sector inside the enemy village. Village capture strips
                    // clan control; a qualifying clan must earn 75 scrolls and
                    // claim the newly secured sector again.
                    if (ownerVillageChanging && fresh?.ownerClan) {
                        committedTerritory = clearTerritoryLifecycleForCapture({
                            ...committedTerritory,
                            ownerClan: undefined,
                            backgroundImage: undefined,
                            controlScore: 0,
                            weather: undefined,
                            terrainBuffStat: 'bukijutsuOffense',
                            guards: [],
                        }) as SectorTerritory;
                    }
                    if (fresh
                        && fresh.ownerClan
                        && committedTerritory.ownerClan
                        && fresh.hp > 0
                        && committedTerritory.hp <= 0) {
                        const breachNow = Date.now();
                        const bankedSupply = collectTerritorySupply(fresh, breachNow).collected;
                        committedTerritory = preserveServerRaidSettlementAuthority(
                            beginTerritoryBreach(committedTerritory, breachNow, bankedSupply) as SectorTerritory,
                            fresh,
                        );
                    }
                    try {
                        if (!(await kv.compareSet(key, fresh, committedTerritory))) {
                            territoryConflict = true;
                        }
                    } catch (error) {
                        // Carried-over owner and weather fields can be explicitly
                        // undefined; the read-back is the JSON form without them.
                        const recovered = await kv.get<unknown>(key).catch(() => null);
                        if (!storedValueEquals(recovered, committedTerritory)) throw error;
                    }
                }, { failClosed: true });
                if (territoryConflict) {
                    return res.status(409).json({ error: 'Territory changed while this update was being verified. Retry.' });
                }
                if (identity.admin) {
                    // An admin territory write is the supported correction for
                    // a settled sector, so it leaves a trail
                    // (GET /api/admin/audit-log?domain=sector). Best-effort.
                    await recordAudit({
                        domain: 'sector',
                        action: 'territory.admin-write',
                        actor: 'admin',
                        entityType: 'territory',
                        entityId: String(committedTerritory.sector),
                        before: territoryAuditSummary(territoryBefore),
                        after: territoryAuditSummary(committedTerritory),
                    });
                }
                return res.status(200).json({ territory: committedTerritory });
            }

            if (body?.kind === 'war-command') {
                // Peace and surrender (owner ruling 2026-10-08): a no-winner
                // peace needs BOTH seated Kages to offer it; either Kage may
                // instead surrender, which ends the war as a loss for their
                // village. Either Kage used to be able to end the war with no
                // winner on their own — including the losing Kage one hit before
                // their village fell, erasing the loss and its spoils.
                if (identity.admin) {
                    return res.status(403).json({ error: 'Peace and surrender are decisions for the seated Kages.' });
                }
                const command = String((body as Record<string, unknown>).command ?? '');
                if (command !== 'propose-peace' && command !== 'withdraw-peace' && command !== 'surrender') {
                    return res.status(400).json({ error: 'Unknown war command.' });
                }
                const rawVillages = (body as Record<string, unknown>).villages;
                const villages = Array.isArray(rawVillages) ? rawVillages.map((v) => String(v ?? '').trim()) : [];
                if (villages.length !== 2 || !villages[0] || !villages[1] || villages[0] === villages[1]) {
                    return res.status(400).json({ error: 'Name the two warring villages.' });
                }
                const actorSave = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                const actorVillage = String((actorSave?.character as Record<string, unknown> | undefined)?.village ?? '').trim();
                if (!actorVillage || !villages.includes(actorVillage)) {
                    return res.status(403).json({ error: 'Only members of the warring villages can do that.' });
                }
                if (!(await isSeatedKageOf(identity.name, actorVillage))) {
                    return res.status(403).json({ error: 'Only your village\'s seated Kage can offer peace or surrender.' });
                }
                const warKey = `${VILLAGE_WAR_KEY_PREFIX}${villageWarId(villages[0], villages[1])}`;
                const result = await withKvLock(warKey, async () => {
                    const stored = await kv.get<VillageWar>(warKey);
                    if (!stored || !warIsGameplayActive(stored)) {
                        return { status: 404, body: { error: 'There is no active war between these villages.' } as Record<string, unknown> };
                    }
                    if (warHasMercenaryFundingField(stored)) {
                        return { status: 503, body: { error: 'A mercenary strike is settling; retry.' } };
                    }
                    const now = Date.now();
                    let war = stored;
                    const brought = bringVillageWarCurrent(stored, now);
                    if (brought.changed) {
                        const caught = await commitWarBattleSettlement(kv, warKey, stored, brought.war);
                        if (caught.status === 'conflict') return { status: 503, body: { error: 'Village-war state changed; retry.' } };
                        war = caught.row;
                        if (war.endedAt) await ensureWarRematchCooldown(war);
                    }
                    if (war.endedAt) {
                        return { status: 409, body: { error: 'This war has already ended.', war: publicVillageWar(war) } };
                    }
                    const enemy = war.villages.find((village) => village !== actorVillage)!;
                    const updatedAt = Math.max(Math.floor(Number(war.updatedAt) || 0), now);
                    let next: VillageWar;
                    if (command === 'surrender') {
                        next = stampVillageWarEnding({ ...war, surrenderedBy: actorVillage }, { endedAt: now, winnerVillage: enemy });
                    } else {
                        const proposals: Record<string, number> = { ...(war.peaceProposals ?? {}) };
                        if (command === 'withdraw-peace') delete proposals[actorVillage];
                        else setSafeRecordValue(proposals, actorVillage, now);
                        next = { ...war, peaceProposals: proposals, updatedAt };
                        if (command === 'propose-peace' && proposals[enemy]) {
                            // Both Kages offered peace: the war ends with no winner.
                            next = stampVillageWarEnding(next, { endedAt: now });
                        }
                    }
                    const publication = await commitWarBattleSettlement(kv, warKey, war, next);
                    if (publication.status === 'conflict') return { status: 503, body: { error: 'Village-war state changed; retry.' } };
                    if (publication.row.endedAt) await ensureWarRematchCooldown(publication.row);
                    await kv.set(`audit:village-war-command:${normalizeVillageKey(actorVillage)}:${now}`, {
                        ts: now, command, actor: identity.name, village: actorVillage, warId: war.id,
                    }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
                    return { status: 200, body: { war: publicVillageWar(publication.row) } };
                }, { failClosed: true });
                return res.status(result.status).json(result.body);
            }

            if (body?.kind === 'war') {
                const mutationNow = Date.now();
                const war = normalizeVillageWar({ ...body.war, updatedAt: mutationNow });
                if (!war) return res.status(400).json({ error: 'Invalid war.' });
                // The pair is the storage authority. A client-supplied id must
                // never create an alternate row that evades exclusion/cooldown.
                war.id = villageWarId(war.villages[0], war.villages[1]);

                // All war reads + validation + write are serialized through a
                // per-war lock so concurrent raids / claim attempts can't
                // race-overwrite. failClosed:true (see the options object on
                // the closing line far below) — this is currency/war-critical,
                // so a contended lock throws LockContendedError rather than
                // racing unlocked; the outer catch turns that into a 500.
                const warKey = `${VILLAGE_WAR_KEY_PREFIX}${war.id}`;
                const result = await withKvLock(warKey, async () => {
                    let existing = await kv.get<VillageWar>(warKey);
                    let expectedWarRow = existing;
                    if (existing && warHasMercenaryFundingField(existing)) {
                        return { status: 503 as const, body: { error: 'A mercenary strike is settling; retry.' } };
                    }
                    if (existing && Object.prototype.hasOwnProperty.call(existing, 'mercenaryHireReceipts')
                        && (!existing.mercenaryHireReceipts
                            || typeof existing.mercenaryHireReceipts !== 'object'
                            || Array.isArray(existing.mercenaryHireReceipts))) {
                        return { status: 503 as const, body: { error: 'Village-war mercenary receipts are malformed.' } };
                    }
                    if (existing && warHasFundingField(existing)) {
                        const marker = declarationFundingMarker(existing);
                        if (!marker) {
                            return { status: 503 as const, body: { error: 'Village-war funding state is malformed.' } };
                        }
                        if (marker.status === 'funding') {
                            if (identity.admin) {
                                return { status: 409 as const, body: { error: 'Village-war declaration is still funding.' } };
                            }
                            const funding = await withKvLock(
                                marker.source.recordKey,
                                () => helpForwardVillageWarDeclaration(warKey, existing!, mutationNow),
                                { failClosed: true },
                            );
                            if (funding.status === 'active') {
                                const declaredVillage = existing.villages.find(village => normalizeVillageKey(village) === normalizeVillageKey(marker.source.accountId))
                                    ?? existing.villages[0];
                                await kv.set(`audit:village-war-declare:${normalizeVillageKey(declaredVillage)}:${marker.declarationId}`, {
                                    ts: funding.row.startedAt, action: 'declare-war', actor: identity.name,
                                    village: declaredVillage, villages: funding.row.villages,
                                }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
                                return { status: 200 as const, body: { war: funding.row, replayed: true } };
                            }
                            if (funding.status === 'insufficient') {
                                return { status: 400 as const, body: { error: `Declaration funding is insufficient (${funding.have}/${funding.cost}).` } };
                            }
                            return funding.status === 'conflict'
                                ? { status: 409 as const, body: { error: 'Village-war declaration funding conflicted.' } }
                                : { status: 503 as const, body: { error: 'Village-war declaration funding is still settling; retry.' } };
                        }
                    }
                    // An ended pair row is the exact predecessor of a rematch,
                    // not an immutable dead-end. Non-admin callers enter the
                    // full declaration authority path below.
                    const isCreating = !existing
                        || (!identity.admin && (!!existing.endedAt || declarationFundingMarker(existing)?.status === 'aborted'));
                    if (existing && !isCreating) {
                        // The no-battle command lane may submit bounded HP/capture
                        // deltas, but never rewrites the identity/chronology rows
                        // trusted by server-derived PvP settlement.
                        war.id = existing.id;
                        war.villages = [...existing.villages] as [string, string];
                        war.startedAt = existing.startedAt;
                        war.pendingUntil = existing.pendingUntil;
                        war.warGroundSector = existing.warGroundSector;
                        war.warCrateId = existing.warCrateId;
                        war.lastDecayDate = existing.lastDecayDate;
                        war.settled = existing.settled;
                        war.pvpBattleReceipts = { ...(existing.pvpBattleReceipts ?? {}) };
                        war.lastPvpBattleEndedAt = existing.lastPvpBattleEndedAt;
                        war.warMissionTokenReceipts = { ...(existing.warMissionTokenReceipts ?? {}) };
                        war.declaredBy = existing.declaredBy;
                        war.declarationGeneration = existing.declarationGeneration;
                        war.declarationFunding = existing.declarationFunding;
                        war.mercenaryHireReceipts = { ...(existing.mercenaryHireReceipts ?? {}) };
                        war.hpMax = existing.hpMax;
                        war.peaceProposals = existing.peaceProposals;
                        war.surrenderedBy = existing.surrenderedBy;
                    }

                    // Bring the stored war up to now before judging this write:
                    // the 14-day limit (counted from `pendingUntil`, so the
                    // pre-war window doesn't eat into it), owed daily decay, and
                    // a zero-HP ending. If that ended the war, the freeze check
                    // below rejects the in-flight write as "war has ended".
                    if (existing && !isCreating && !existing.endedAt) {
                        const timedOut = Date.now() - warEffectiveStartMs(existing) > VILLAGE_WAR_MAX_DURATION_MS;
                        const brought = bringVillageWarCurrent(existing, Date.now());
                        if (brought.changed) {
                            const publication = await commitWarBattleSettlement(kv, warKey, existing, brought.war);
                            if (publication.status === 'conflict') {
                                return { status: 503 as const, body: { error: 'Village-war state changed; retry.' } };
                            }
                            if (publication.row.endedAt) await ensureWarRematchCooldown(publication.row);
                            if (timedOut) {
                                return { status: 409 as const, body: { error: 'War has timed out (14 days). Auto-finalized with no winner.', war: publication.row } };
                            }
                            existing = publication.row;
                            expectedWarRow = publication.row;
                        }
                    }

                    // Frozen-once-ended: any further mutation after endedAt
                    // is set is rejected (except admin) so post-end actors
                    // can't change winnerVillage / resurrect HP.
                    if (existing?.endedAt && !identity.admin && !isCreating) {
                        return { status: 409 as const, body: { error: 'War has already ended; no further updates accepted.', war: existing } };
                    }

                    // Pull actor's village+character once for both validation
                    // (non-admin path) and contribution tracking (all paths).
                    // Admins act on behalf of no village — their writes don't
                    // attribute contributions.
                    let actorChar: Record<string, unknown> | null = null;
                    let actorVillage = '';
                    if (!identity.admin) {
                        try {
                            const actorSave = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                            actorChar = (actorSave?.character ?? null) as Record<string, unknown> | null;
                            actorVillage = String(actorChar?.village ?? '').trim();
                            if (!actorVillage || !war.villages.includes(actorVillage)) {
                                return { status: 403 as const, body: { error: 'Only members of the warring villages can update this war.' } };
                            }
                        } catch {
                            return { status: 500 as const, body: { error: 'Unable to verify war participation.' } };
                        }
                    }

                    // A player can no longer write an existing war row at all.
                    // Battles settle server-side by battle id (above), peace and
                    // surrender go through `kind: 'war-command'`, and the one
                    // thing left on this lane is spending a war-mission token,
                    // whose sealed damage the SERVER applies. This lane used to
                    // accept client-proposed HP, captures, winners and endings,
                    // and every one of those had a hole: a capture could be
                    // ping-ponged with an account in the enemy village to drain
                    // HP with no fight, bundling a capture with an end let any
                    // member call peace, a mission that took the enemy to 0 was
                    // refused (and nothing ever ended the war at 0 HP), and a
                    // stale cached HP turned a valid mission into a "heal" 400.
                    if (!identity.admin && !isCreating && existing) {
                        return await applyVillageWarMissionToken({
                            warKey,
                            existing,
                            expected: expectedWarRow,
                            actorName: identity.name,
                            actorDisplayName: String(actorChar?.name ?? identity.name),
                            actorVillage,
                            tokenId: String((body as Record<string, unknown>)?.warMissionToken ?? '').trim(),
                            now: Date.now(),
                        });
                    }

                    const isEnding = !isCreating && !existing?.endedAt && !!war.endedAt;
                    const isClaimingWin = !isCreating && !existing?.winnerVillage && !!war.winnerVillage;
                    const isClaimingCapture = !isCreating && !!war.capturedBy && war.capturedBy !== existing?.capturedBy;
                    if (existing && !isCreating) {
                        if (!isClaimingCapture) {
                            war.capturedBy = existing.capturedBy;
                            war.capturedAt = existing.capturedAt;
                        }
                        if (!isClaimingWin) war.winnerVillage = existing.winnerVillage;
                        if (!isEnding) war.endedAt = existing.endedAt;
                        if (!isEnding) {
                            war.mvpByVillage = existing.mvpByVillage;
                            war.loserCrateId = existing.loserCrateId;
                        }
                    }

                    if (!identity.admin) {
                        try {
                            if (isCreating) {
                                // 0. Both sides must be real war villages. The
                                // pair came straight from the request body, so a
                                // Kage could declare on a village that does not
                                // exist — which can never fight back, decays to a
                                // "win" and paid out crates for every member.
                                if (!war.villages.every((village) => isWarVillage(village))) {
                                    return { status: 400 as const, body: { error: 'Village wars are fought between the four great villages.' } };
                                }
                                // 1. Only Kage of a warring village may declare war.
                                const kage = await isSeatedKageOf(identity.name, actorVillage);
                                if (!kage) {
                                    return { status: 403 as const, body: { error: 'Only the seated Kage of a warring village can declare a war.' } };
                                }
                                // 2. Cooldown: derive it from the authoritative
                                // predecessor too. The TTL key is an accelerator,
                                // not the only guard (end-row commit and TTL-key
                                // publication cannot be one cross-key transaction).
                                if (existing?.endedAt) {
                                    const rematchAt = Math.floor(Number(existing.endedAt))
                                        + VILLAGE_WAR_REMATCH_COOLDOWN_SEC * 1000;
                                    if (!Number.isSafeInteger(rematchAt) || mutationNow < rematchAt) {
                                        return { status: 409 as const, body: { error: 'These two villages were at war within the last 7 days. Rematch cooldown active.' } };
                                    }
                                }
                                const cd = await kv.get(warCooldownKey(war.villages[0], war.villages[1]));
                                if (cd) {
                                    return { status: 409 as const, body: { error: 'These two villages were at war within the last 7 days. Rematch cooldown active.' } };
                                }

                                const source: WarDeclarationFundingSource = villageWarMapEnabled()
                                    ? {
                                        kind: 'war-resources',
                                        recordKey: villageWarKey(actorVillage),
                                        accountId: actorVillage,
                                        amount: discountedWrCost(
                                            DECLARE_WAR_WR,
                                            await heldSectorsForVillage(actorVillage),
                                        ),
                                    }
                                    : {
                                        kind: 'honor-seals',
                                        recordKey: `save:${identity.name}`,
                                        accountId: identity.name,
                                        amount: VILLAGE_WAR_DECLARATION_COST_HONOR_SEALS,
                                    };
                                const previousGeneration = existing ? declarationGenerationOf(existing) : 0;
                                const generation = await allocateVillageWarDeclarationGeneration(
                                    kv,
                                    war.id,
                                    previousGeneration + 1,
                                    mutationNow,
                                );
                                const declarationId = generation.declarationId;
                                // The predecessor's spoils must land BEFORE this
                                // row replaces it: settlement is keyed on the old
                                // generation and only ever found through the row,
                                // so a war nobody polled between its end and the
                                // rematch would otherwise never pay out.
                                if (existing?.endedAt && existing.winnerVillage && !existing.settled) {
                                    try {
                                        await settleVillageWarSpoils(existing, mutationNow);
                                    } catch {
                                        return { status: 503 as const, body: { error: 'The last war between these villages is still settling; retry.' } };
                                    }
                                }
                                // Each village's war HP is sealed now from its
                                // Ramparts level (+1.5% per level, dormancy-aware).
                                const hpMax: Record<string, number> = {};
                                const [firstRecord, secondRecord] = await Promise.all(
                                    war.villages.map((village) => kv.get<Record<string, unknown>>(villageWarKey(village))),
                                );
                                setSafeRecordValue(hpMax, war.villages[0], villageWarHpMax(normalizeVillageWarRecord(war.villages[0], firstRecord ?? undefined)));
                                setSafeRecordValue(hpMax, war.villages[1], villageWarHpMax(normalizeVillageWarRecord(war.villages[1], secondRecord ?? undefined)));
                                war.startedAt = mutationNow;
                                war.updatedAt = mutationNow;
                                war.hpMax = hpMax;
                                war.hp = { ...hpMax };
                                war.warGroundSector = villageWarGroundSector(war.id);
                                delete war.peaceProposals;
                                delete war.surrenderedBy;
                                war.warGroundHp = VILLAGE_WAR_GROUND_HP_MAX;
                                war.pendingUntil = mutationNow + VILLAGE_WAR_PENDING_WINDOW_MS;
                                war.declaredBy = safeName(identity.name);
                                war.declarationGeneration = generation.generation;
                                delete war.endedAt;
                                delete war.winnerVillage;
                                delete war.capturedBy;
                                delete war.capturedAt;
                                delete war.settled;
                                delete war.lastDecayDate;
                                delete war.mvpByVillage;
                                delete war.loserCrateId;
                                delete war.lastPvpBattleEndedAt;
                                delete war.declarationFunding;
                                // Stamp canonical crate ID + initialize empty contributions map.
                                war.warCrateId = `war-crate-${war.id}-g${generation.generation}`;
                                war.contributions = {};
                                war.pvpBattleReceipts = {};
                                war.warMissionTokenReceipts = {};
                                const fingerprint = warDeclarationFundingFingerprint({
                                    policyVersion: 2,
                                    declarationId,
                                    generation: generation.generation,
                                    warId: war.id,
                                    villages: [...war.villages].sort((a, b) => a.localeCompare(b)),
                                    declaredBy: war.declaredBy,
                                    warGroundSector: war.warGroundSector,
                                    source,
                                    predecessor: existing
                                        ? {
                                            generation: declarationGenerationOf(existing),
                                            declarationId: declarationFundingMarker(existing)?.declarationId ?? null,
                                            endedAt: existing.endedAt,
                                            updatedAt: existing.updatedAt,
                                        }
                                        : null,
                                });
                                const ownerId = newWarDeclarationFundingOwnerId();
                                const reservationPlan: VillageWarReservationPlan = {
                                    pairId: war.id,
                                    warKey,
                                    villages: [...war.villages] as [string, string],
                                    generation: generation.generation,
                                    declarationId,
                                    fingerprint,
                                    source,
                                    ownerId,
                                    now: mutationNow,
                                    leaseMs: WAR_DECLARATION_FUNDING_LEASE_MS,
                                };

                                // Claim BOTH village authorities before checking
                                // exclusions. A concurrent A-B / A-C declaration
                                // collides on A's exact row; sector-war declaration
                                // also sees this claiming row and fails closed.
                                let claims = await claimVillageWarReservations(kv, reservationPlan);
                                if (claims.status === 'blocked') {
                                    // A crashed funding saga on another pair is
                                    // help-forwarded by any later declaration that
                                    // needs one of its villages. The immutable row
                                    // already passed Kage authorization; the helper
                                    // cannot alter its identity/source.
                                    const blockingReservation = villageWarReservationFromRow(claims.row);
                                    // A SECTOR declaration's row is a sector
                                    // contest, not a village-war pair row: this
                                    // helper cannot fund it (it read `villages`
                                    // off a row that has none, and the request
                                    // died as a 500). Its own endpoint resumes it
                                    // when that Kage declares again.
                                    if (blockingReservation?.declarationId.startsWith('sector:')) {
                                        return { status: 409 as const, body: { error: `${claims.village} is opening a sector war right now. Try again in a minute.` } };
                                    }
                                    const blockingWar = blockingReservation
                                        ? await kv.get<VillageWar>(blockingReservation.warKey)
                                        : null;
                                    const blockingMarker = declarationFundingMarker(blockingWar);
                                    if (blockingReservation && blockingWar && blockingMarker
                                        && blockingMarker.declarationId === blockingReservation.declarationId
                                        && blockingMarker.fingerprint === blockingReservation.fingerprint
                                        && blockingMarker.status !== 'active') {
                                        const helped = await withKvLock(
                                            blockingMarker.source.recordKey,
                                            () => helpForwardVillageWarDeclaration(blockingReservation.warKey, blockingWar, mutationNow),
                                            { failClosed: true },
                                        );
                                        if (helped.status === 'active') {
                                            return { status: 409 as const, body: { error: `${claims.village} is already reserved by an active village war.` } };
                                        }
                                        if (helped.status === 'insufficient' || helped.status === 'blocked') {
                                            claims = await claimVillageWarReservations(kv, reservationPlan);
                                        } else {
                                            return { status: 503 as const, body: { error: 'An earlier village-war declaration is still settling; retry.' } };
                                        }
                                    }
                                }
                                if (claims.status === 'busy') {
                                    return { status: 503 as const, body: { error: 'Village-war reservation is settling; retry.' } };
                                }
                                if (claims.status === 'blocked') {
                                    return { status: 409 as const, body: { error: `${claims.village} is already reserved by another active village war.` } };
                                }

                                // Recheck legacy pair rows after both durable
                                // claims. This preserves exclusion with wars that
                                // predate the reservation index.
                                for (const v of war.villages) {
                                    if (await villageHasCompetingWar(v, declarationId)) {
                                        await releaseVillageWarReservations(kv, reservationPlan, 'claim-conflict', mutationNow);
                                        return { status: 409 as const, body: { error: `${v} is already in an active war. Only one war at a time per village.` } };
                                    }
                                }

                                // Village wars and sector wars are mutually
                                // exclusive. The claims above close the opposite
                                // direction while these authoritative scans run.
                                // This holds whether or not the sector-war
                                // campaign is switched on: with DISABLE_VILLAGE_WAR
                                // set, sector wars are paused, not gone, and a
                                // village war declared over them would overlap
                                // them the moment the switch is lifted.
                                for (const v of war.villages) {
                                    const sieges = await activeSectorWarsForVillage(v, Date.now(), { strict: true });
                                    if (sieges.length) {
                                        await releaseVillageWarReservations(kv, reservationPlan, 'claim-conflict', mutationNow);
                                        return { status: 409 as const, body: { error: `${v} has ${sieges.length} active sector war${sieges.length === 1 ? '' : 's'}. Sector wars and a village war cannot run at the same time — finish or call them off first.` } };
                                    }
                                }

                                const fundingPlan = {
                                    warKey,
                                    declarationId,
                                    fingerprint,
                                    war,
                                    expectedWar: existing ?? null,
                                    source,
                                    ownerId,
                                    now: mutationNow,
                                    leaseMs: WAR_DECLARATION_FUNDING_LEASE_MS,
                                };
                                let funding;
                                try {
                                    funding = await withKvLock(source.recordKey, async () => {
                                        // Publish the non-playable pair successor,
                                        // then permanently bind both village rows.
                                        // Only after both bindings are durable may
                                        // the source intent/debit be written.
                                        const pairReservation = await reserveWarDeclarationFunding(kv, fundingPlan);
                                        if (pairReservation.status === 'busy' || pairReservation.status === 'conflict') {
                                            return pairReservation;
                                        }
                                        const promotion = await reserveClaimedVillageWarReservations(kv, reservationPlan);
                                        if (promotion.status === 'conflict') {
                                            if (pairReservation.status === 'acquired') {
                                                await abortWarDeclarationFunding(
                                                    kv,
                                                    warKey,
                                                    pairReservation.row,
                                                    'source-fenced',
                                                    mutationNow,
                                                );
                                            }
                                            return { status: 'conflict' as const, row: await kv.get<Record<string, unknown>>(warKey) };
                                        }
                                        return settleReservedWarDeclarationFunding(kv, fundingPlan, pairReservation);
                                    }, { failClosed: true });
                                } catch (error) {
                                    await releaseVillageWarReservations(kv, reservationPlan, 'funding-aborted', mutationNow).catch(() => undefined);
                                    throw error;
                                }
                                if (funding.status === 'active') {
                                    await kv.set(`audit:village-war-declare:${normalizeVillageKey(actorVillage)}:${declarationId}`, {
                                        ts: mutationNow, action: 'declare-war', actor: identity.name,
                                        village: actorVillage, villages: war.villages,
                                    }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
                                    // An Honor Seal declaration debits THIS caller's save and bumps its
                                    // stored version, so echo the exact committed version the saga
                                    // returned (api/save/_version-echo-coverage.test.ts) — otherwise the
                                    // client's next autosave 409s and rolls back its in-flight state.
                                    // The war-resources branch debits the village pool and versions no
                                    // save, so it has nothing to echo.
                                    const declaredSaveVersion = source.kind === 'honor-seals'
                                        ? Math.floor(Number(funding.sourceRow?._saveVersion) || 0)
                                        : 0;
                                    return {
                                        status: 200 as const,
                                        body: {
                                            war: funding.row,
                                            replayed: funding.replayed,
                                            ...(declaredSaveVersion > 0 ? { _saveVersion: declaredSaveVersion } : {}),
                                        },
                                    };
                                }
                                if (funding.status === 'insufficient') {
                                    await releaseVillageWarReservations(kv, reservationPlan, 'funding-aborted', mutationNow);
                                    const unit = source.kind === 'war-resources' ? 'War Resources' : 'Honor Seals';
                                    // A refused Honor declaration spends nothing, but its source intent
                                    // and the abort fence that releases it still versioned THIS caller's
                                    // save. Echo that too — otherwise the commonest outcome, trying to
                                    // declare without the seals, strands the version and costs the
                                    // player their in-flight local state for no gain at all.
                                    const refusedSaveVersion = source.kind === 'honor-seals'
                                        ? Math.floor(Number(funding.sourceRow?._saveVersion) || 0)
                                        : 0;
                                    return {
                                        status: 400 as const,
                                        body: {
                                            error: `Declaring war costs ${funding.cost} ${unit}. You hold ${funding.have}.`,
                                            ...(refusedSaveVersion > 0 ? { _saveVersion: refusedSaveVersion } : {}),
                                        },
                                    };
                                }
                                if (funding.status === 'conflict') {
                                    await releaseVillageWarReservations(kv, reservationPlan, 'funding-conflict', mutationNow);
                                    return { status: 409 as const, body: { error: 'A different village-war declaration already owns this pair.' } };
                                }
                                return { status: 503 as const, body: { error: 'Village-war declaration funding is settling; retry.' } };
                            }
                        } catch (declareErr) {
                            console.error('[world-state] village-war declaration failed', declareErr);
                            return { status: 500 as const, body: { error: 'Unable to verify war participation.' } };
                        }
                    }

                    // ── Admin support write ───────────────────────────────
                    // Only an admin reaches this point with a write to apply:
                    // a player's declaration returned above, and a player's
                    // update to an existing war went to the war-mission lane.
                    // Server-owned ledgers are carried from the locked row, and
                    // an admin-ended war is stamped like every other ending.
                    if (existing) war.contributions = existing.contributions ?? {};
                    if (isClaimingCapture) war.capturedAt = mutationNow;
                    let finalWar: VillageWar = war;
                    if (isEnding && existing) {
                        const effectiveStart = warEffectiveStartMs(existing);
                        const boundedEnd = effectiveStart + VILLAGE_WAR_MAX_DURATION_MS;
                        if (!Number.isSafeInteger(effectiveStart)
                            || effectiveStart <= 0
                            || !Number.isSafeInteger(boundedEnd)) {
                            return { status: 503 as const, body: { error: 'Village-war chronology is malformed.' } };
                        }
                        finalWar = stampVillageWarEnding(war, {
                            endedAt: Math.min(Math.max(mutationNow, effectiveStart), boundedEnd),
                            winnerVillage: war.winnerVillage,
                        });
                    }
                    finalWar.pvpBattleReceipts = { ...(existing?.pvpBattleReceipts ?? {}) };
                    finalWar.lastPvpBattleEndedAt = existing?.lastPvpBattleEndedAt;
                    finalWar.warMissionTokenReceipts = { ...(existing?.warMissionTokenReceipts ?? {}) };

                    const publication = await commitWarBattleSettlement(kv, warKey, expectedWarRow, finalWar);
                    if (publication.status === 'conflict') {
                        return { status: 503 as const, body: { error: 'Village-war state changed; retry settlement.' } };
                    }
                    if (isEnding) await ensureWarRematchCooldown(publication.row);
                    return { status: 200 as const, body: { war: publication.row } };
                }, { failClosed: true });
                return res.status(result.status).json(result.body);
            }

            return res.status(400).json({ error: 'Invalid world state update.' });
        } catch (err) {
            // Lock contention on a fail-closed path is an ordinary, retryable
            // outcome (two writers on one war or sector), not a server fault.
            if (err instanceof LockContendedError) {
                return res.status(503).json({ error: 'That war is busy right now — try again in a moment.' });
            }
            console.error('[world-state]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
