import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from './_storage.js';
import { cors } from './_utils.js';
import { authedPlayerOrAdmin } from './_auth.js';
import { enforceRateLimitKv } from './_ratelimit.js';
import { withKvLock } from './_lock.js';
import { resolveClaimedWarSupply } from './_territory-supply.js';

const TERRITORY_CONTROL_MAX = 20000;
const TERRITORY_HP_MAX = 20000;
const VILLAGE_WAR_HP_MAX = 5000;
const VILLAGE_WAR_GROUND_HP_MAX = 1000;
const TERRITORY_KEY_PREFIX = 'world:territory:';
const VILLAGE_WAR_KEY_PREFIX = 'world:war:';
// Anti-cheat: cap how much HP a single raid request can drain so a malicious
// client can't drop a sector from full → 0 in one POST. Matches the 500/raid
// hit the legitimate Village War client UI deals.
const TERRITORY_HP_MAX_DELTA_PER_REQUEST = 1000;
// Same idea for raising HP via rebuild — bound the per-request gain.
const TERRITORY_HP_MAX_REPAIR_PER_REQUEST = 1000;
// Anti-cheat: hard ceiling on a single sector's stored War Supply. War Supply
// accrues at 100/day and is the one territory field a claiming clan/village
// writer can set freely (HP + ownership are clamped separately). Without a cap
// a client could POST an arbitrarily large warSupply and then bank it into the
// clan treasury via /api/clan/territory/collect-supply, which trusts the stored
// value as its accrual base. 36,500 == one full year (365 × 100) of
// uninterrupted accrual on one sector — far above any realistic uncollected
// balance, so legitimate play is never clamped.
const TERRITORY_WAR_SUPPLY_MAX = 36_500;
// Village War damage per write — typical legit raid is 5–50 (role × 1).
// 100 leaves plenty of headroom for elite raiders + the +750 capture
// bonus, which is applied as a SECOND write rather than one fat one.
const VILLAGE_WAR_HP_MAX_DELTA_PER_REQUEST = 100;
const VILLAGE_WAR_GROUND_HP_MAX_DELTA_PER_REQUEST = 100;
// Auto-finalize wars that have been running this long with no end.
// Two weeks is the sane upper bound for "Kages forgot about it" cleanup.
const VILLAGE_WAR_MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
// Cost to declare a war. Charged to the declaring Kage. Priced in
// Honor Seals (a Vanguard-profession currency, harder to amass than
// ryo) so the cost actually bites — a Kage shouldn't be casually
// declaring wars after a couple of grinding sessions.
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
const VILLAGE_STATE_KEY_PREFIX = 'game:village-state:';

function utcDateKey(ms = Date.now()): string {
    return new Date(ms).toISOString().slice(0, 10);
}

function utcDayIndex(ms: number): number {
    return Math.floor(ms / ONE_DAY_MS);
}

function normalizeVillageKey(village: string): string {
    return village.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function isSeatedKageOf(playerName: string, village: string): Promise<boolean> {
    if (!village) return false;
    try {
        const vs = await kv.get<Record<string, unknown>>(`${VILLAGE_STATE_KEY_PREFIX}${normalizeVillageKey(village)}`);
        const seated = String(vs?.seatedKage ?? '').trim().toLowerCase();
        return seated === playerName.trim().toLowerCase();
    } catch {
        return false;
    }
}

async function hasActiveWarBetween(actorVillage: string, defenderVillage: string): Promise<boolean> {
    if (!actorVillage || !defenderVillage) return false;
    try {
        const id = villageWarId(actorVillage, defenderVillage);
        const war = await kv.get<VillageWar>(`${VILLAGE_WAR_KEY_PREFIX}${id}`);
        if (!war || war.endedAt) return false;
        return war.villages.includes(actorVillage) && war.villages.includes(defenderVillage);
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
    // side at the moment the war flips to ended. The MVP crate is keyed
    // off `mvp-crate-${warId}-${village}` and granted client-side to
    // whichever player matches the name on next claim sweep.
    mvpByVillage?: Record<string, string>;
    // Loss-consolation crate ID. Stamped at war end ONLY if a winner
    // exists (i.e., draws give no consolation). Any losing-village
    // player who contributed ≥ VILLAGE_WAR_LOSER_MIN_CONTRIB damage
    // can claim it once. Client-side dedup via claimedWarCrateIds.
    loserCrateId?: string;
    // Pre-war window. While `pendingUntil > now`, HP can't drop, the
    // war can't be ended, and the decay grace + 14-day max timers
    // count from `pendingUntil` instead of `startedAt`. The Kage
    // cannot cancel a pending war — declaration commits the cost,
    // no refunds, war must run its course.
    pendingUntil?: number;
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
    const sector = clampNumber(Math.floor(Number(data.sector ?? 1)), 1, 60);
    return {
        ...defaultSectorTerritory(sector),
        ...data,
        sector,
        controlScore: clampNumber(Math.floor(Number(data.controlScore ?? 0)), 0, TERRITORY_CONTROL_MAX),
        hp: clampNumber(Math.floor(Number(data.hp ?? TERRITORY_HP_MAX)), 0, TERRITORY_HP_MAX),
        guards: Array.isArray(data.guards) ? data.guards.filter(Boolean).map(String).slice(0, 20) : [],
        warSupply: Math.min(TERRITORY_WAR_SUPPLY_MAX, Math.max(0, Math.floor(Number(data.warSupply ?? 0)))),
        terrainBuffStat: normalizeTerrainBuffStat(data.terrainBuffStat),
        updatedAt: data.updatedAt ?? Date.now(),
    };
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
            [first]: clampNumber(Math.floor(Number(data.hp?.[first] ?? VILLAGE_WAR_HP_MAX)), 0, VILLAGE_WAR_HP_MAX),
            [second]: clampNumber(Math.floor(Number(data.hp?.[second] ?? VILLAGE_WAR_HP_MAX)), 0, VILLAGE_WAR_HP_MAX),
        },
        warGroundSector: clampNumber(Math.floor(Number(data.warGroundSector ?? 40)), 1, 60),
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

// Returns true if either village is currently in an active (non-ended)
// war. Used to enforce the one-war-at-a-time rule on war creation.
async function villageHasActiveWar(village: string): Promise<boolean> {
    const wars = await getByPrefix<VillageWar>(VILLAGE_WAR_KEY_PREFIX);
    return wars.some(w => !w.endedAt && w.villages.includes(village));
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

    const totalDamage = daysOwed * VILLAGE_WAR_DECAY_PER_DAY;
    const newHp: Record<string, number> = {};
    for (const v of war.villages) {
        const before = Number(war.hp?.[v] ?? VILLAGE_WAR_HP_MAX);
        newHp[v] = Math.max(0, before - totalDamage);
    }

    const a = newHp[war.villages[0]];
    const b = newHp[war.villages[1]];
    let endedAt = war.endedAt;
    let winnerVillage = war.winnerVillage;
    let capturedBy = war.capturedBy;
    let capturedAt = war.capturedAt;
    if (a <= 0 && b <= 0) {
        // Mutual exhaustion → draw. No winner, no crate. Stamp endedAt.
        endedAt = now;
        winnerVillage = undefined;
    } else if (a <= 0 || b <= 0) {
        endedAt = now;
        winnerVillage = a <= 0 ? war.villages[1] : war.villages[0];
        if (!capturedBy) {
            capturedBy = winnerVillage;
            capturedAt = now;
        }
    }

    return {
        war: {
            ...war,
            hp: newHp,
            endedAt,
            winnerVillage,
            capturedBy,
            capturedAt,
            lastDecayDate: todayKey,
            updatedAt: now,
        },
        changed: true,
    };
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        let territories: SectorTerritory[];
        let warsRaw: VillageWar[];
        try {
            [territories, warsRaw] = await Promise.all([
                getByPrefix<SectorTerritory>(TERRITORY_KEY_PREFIX),
                getByPrefix<VillageWar>(VILLAGE_WAR_KEY_PREFIX),
            ]);
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
        const wars: VillageWar[] = [];
        const writes: Promise<unknown>[] = [];
        for (const w of warsRaw) {
            const { war, changed } = applyWarDecay(w, now);
            wars.push(war);
            if (changed) {
                writes.push(
                    withKvLock(`${VILLAGE_WAR_KEY_PREFIX}${war.id}`, async () => {
                        // Re-read under the lock so we don't clobber a
                        // concurrent raid write that just landed.
                        const fresh = await kv.get<VillageWar>(`${VILLAGE_WAR_KEY_PREFIX}${war.id}`);
                        if (!fresh) return;
                        const { war: redecayed, changed: stillChanged } = applyWarDecay(fresh, now);
                        if (stillChanged) await kv.set(`${VILLAGE_WAR_KEY_PREFIX}${war.id}`, redecayed);
                    }).catch(() => undefined),
                );
            }
        }
        // Don't block the GET response on the persist — let writes run in
        // background. The response already shows the decayed state.
        if (writes.length > 0) void Promise.all(writes);
        // CDN caches this for 15 s so all players polling every 15 s share
        // one Supabase round-trip per window instead of one per player.
        // stale-while-revalidate=10 keeps the response instant while revalidating.
        res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=10');
        return res.status(200).json({ territories, wars });
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
            if (body?.kind === 'territory') {
                const incomingTerritory = normalizeSectorTerritory({ ...body.territory, updatedAt: Date.now() });

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
                        const claimingClan = String(incomingTerritory.ownerClan ?? '').trim();
                        const claimingVillage = String(incomingTerritory.ownerVillage ?? '').trim();
                        const matchesClan = !!claimingClan && actorClan === claimingClan;
                        const matchesVillage = !!claimingVillage && actorVillage === claimingVillage;

                        prev = await kv.get<SectorTerritory>(`${TERRITORY_KEY_PREFIX}${incomingTerritory.sector}`);
                        const prevClan = String(prev?.ownerClan ?? '').trim();
                        const prevVillage = String(prev?.ownerVillage ?? '').trim();
                        const actorOwnsPrev =
                            (prevClan && actorClan === prevClan) ||
                            (prevVillage && actorVillage === prevVillage);

                        // Raider case: actor's village is currently AT WAR with the owner village.
                        let raiderDuringWar = false;
                        if (!matchesClan && !matchesVillage && !actorOwnsPrev && prevVillage && actorVillage && actorVillage !== prevVillage) {
                            raiderDuringWar = await hasActiveWarBetween(actorVillage, prevVillage);
                        }

                        const actorInvolved = matchesClan || matchesVillage || actorOwnsPrev || raiderDuringWar;
                        if (!actorInvolved) {
                            return res.status(403).json({ error: 'You are not a participant in this sector (no active war with the owner village).' });
                        }

                        // Per-request HP delta cap — applies to all non-admin writers.
                        const prevHp = Number(prev?.hp ?? TERRITORY_HP_MAX);
                        const newHp = incomingTerritory.hp;
                        if (newHp < prevHp - TERRITORY_HP_MAX_DELTA_PER_REQUEST) {
                            return res.status(400).json({ error: `HP can only drop by ${TERRITORY_HP_MAX_DELTA_PER_REQUEST} per request.` });
                        }
                        if (newHp > prevHp + TERRITORY_HP_MAX_REPAIR_PER_REQUEST) {
                            return res.status(400).json({ error: `HP can only rise by ${TERRITORY_HP_MAX_REPAIR_PER_REQUEST} per request.` });
                        }
                        // Raiders may not increase HP (only defenders / owners may rebuild).
                        if (raiderDuringWar && newHp > prevHp) {
                            return res.status(400).json({ error: 'Raiders may not rebuild the enemy sector.' });
                        }
                        // Raider scope: restrict raider writes to the HP
                        // field only. Without this clamp a raider could
                        // POST a full sector blob overwriting ownerVillage,
                        // controlScore, guards, terrainBuffStat, weather,
                        // backgroundImage, rebuiltAt etc. — flipping the
                        // sector to a different owner or changing the
                        // terrain buff stat for their own next raid.
                        // We also block ownerVillage/ownerClan changes on
                        // ANY non-claimingClan/Village write so an
                        // attacker can't sneak an ownership flip through
                        // the raider or rebuild path.
                        if (raiderDuringWar && prev) {
                            // Preserve every field from prev except hp + updatedAt
                            // (the only legitimate raider mutation). Sector id is
                            // already preserved by the incoming key.
                            const raiderClampedHp = incomingTerritory.hp;
                            Object.assign(incomingTerritory, prev, {
                                hp: raiderClampedHp,
                                updatedAt: Date.now(),
                            });
                        } else if (!matchesClan && !matchesVillage && prev) {
                            // Owner-rebuild path (case 2 — actorOwnsPrev): same
                            // clamp pattern. Don't allow this writer to flip
                            // ownership; only HP + a small set of recovery
                            // fields can change.
                            const ownerClampedHp = incomingTerritory.hp;
                            const ownerClampedRebuilt = Number(incomingTerritory.rebuiltAt ?? prev.rebuiltAt ?? 0);
                            Object.assign(incomingTerritory, prev, {
                                hp: ownerClampedHp,
                                rebuiltAt: ownerClampedRebuilt,
                                updatedAt: Date.now(),
                            });
                        }
                        // Claiming clan/village path (matchesClan || matchesVillage):
                        // The original code passed the full incomingTerritory
                        // through. We additionally guard against the
                        // "drop-HP-and-claim-in-one-write" gambit: a fresh
                        // claimant cannot flip ownerVillage/ownerClan unless
                        // either there was no prior owner OR the prior HP
                        // was already 0 (i.e., a defender flipped the sector
                        // to contested state on an EARLIER write).
                        else if ((matchesClan || matchesVillage) && prev) {
                            const prevOwnerVillage = String(prev.ownerVillage ?? '').trim();
                            const prevOwnerClan = String(prev.ownerClan ?? '').trim();
                            const ownershipFlipping =
                                (claimingVillage && claimingVillage !== prevOwnerVillage) ||
                                (claimingClan && claimingClan !== prevOwnerClan);
                            const prevHpZero = Number(prev.hp ?? 0) <= 0;
                            if (ownershipFlipping && !prevHpZero && (prevOwnerVillage || prevOwnerClan)) {
                                return res.status(400).json({ error: 'Owner can only change after the sector reaches 0 HP.' });
                            }
                        }

                        // ── Server-authoritative War Supply (anti-mint, audit H4) ──
                        // collectTerritorySupply banks a sector's stored warSupply
                        // straight into the clan treasury, so warSupply must never
                        // come from the client. The raider / owner-rebuild branches
                        // above already carried prev via Object.assign; this owns
                        // warSupply + lastSupplyAt for the claiming path (and the
                        // prev === null first-write case): same owner → carry prev
                        // (accrual is recomputed lazily from lastSupplyAt at collect
                        // time, so nothing is lost); fresh claim / ownership flip →
                        // reset to 0 and re-anchor to now. The absolute cap in
                        // normalizeSectorTerritory remains a backstop for the
                        // admin-exempt path.
                        if (matchesClan || matchesVillage) {
                            const owned = resolveClaimedWarSupply(prev, incomingTerritory, Date.now());
                            incomingTerritory.warSupply = owned.warSupply;
                            incomingTerritory.lastSupplyAt = owned.lastSupplyAt;
                        }
                    } catch {
                        return res.status(500).json({ error: 'Unable to verify territory participation.' });
                    }
                }

                // Serialize concurrent raid POSTs through a per-territory
                // lock so two simultaneous writers can't lose each other's
                // updates. The lock falls through to unlocked on contention
                // (per _lock.ts behavior) — better to race occasionally
                // than to drop a raid entirely.
                await withKvLock(`${TERRITORY_KEY_PREFIX}${incomingTerritory.sector}`, async () => {
                    await kv.set(`${TERRITORY_KEY_PREFIX}${incomingTerritory.sector}`, incomingTerritory);
                });
                return res.status(200).json({ territory: incomingTerritory });
            }

            if (body?.kind === 'war') {
                const war = normalizeVillageWar({ ...body.war, updatedAt: Date.now() });
                if (!war) return res.status(400).json({ error: 'Invalid war.' });

                // All war reads + validation + write are serialized through a
                // per-war lock so concurrent raids / claim attempts can't
                // race-overwrite. Lock falls through to unlocked on contention
                // (per _lock.ts) — better to race than to drop the write.
                const warKey = `${VILLAGE_WAR_KEY_PREFIX}${war.id}`;
                const result = await withKvLock(warKey, async () => {
                    let existing = await kv.get<VillageWar>(warKey);

                    // Lazy-finalize stale wars (>14d active, no end). Counts
                    // from `pendingUntil` if set, so the pre-war window
                    // doesn't eat into the 14-day clock. Auto-end with no
                    // winner, no crate.
                    if (existing && !existing.endedAt) {
                        const liveStart = warEffectiveStartMs(existing);
                        if ((Date.now() - liveStart) > VILLAGE_WAR_MAX_DURATION_MS) {
                            const expired: VillageWar = {
                                ...existing,
                                endedAt: liveStart + VILLAGE_WAR_MAX_DURATION_MS,
                                updatedAt: Date.now(),
                                // No winnerVillage — abandoned wars award nothing.
                            };
                            await kv.set(warKey, expired);
                            return { status: 409 as const, body: { error: 'War has timed out (14 days). Auto-finalized with no winner.', war: expired } };
                        }
                    }

                    // Apply daily decay to `existing` so the validation
                    // (HP delta caps, freeze-on-end, win condition) runs
                    // against the post-decay state. If decay just ended
                    // the war, the freeze check below catches the in-
                    // flight write and rejects it as "war has ended".
                    if (existing) {
                        const decayResult = applyWarDecay(existing);
                        if (decayResult.changed) {
                            existing = decayResult.war;
                            await kv.set(warKey, existing);
                        }
                    }

                    // Frozen-once-ended: any further mutation after endedAt
                    // is set is rejected (except admin) so post-end actors
                    // can't change winnerVillage / resurrect HP.
                    if (existing?.endedAt && !identity.admin) {
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

                    const isCreating = !existing;
                    const isEnding = !existing?.endedAt && !!war.endedAt;
                    const isClaimingWin = !existing?.winnerVillage && !!war.winnerVillage;
                    const isClaimingCapture = !existing?.capturedBy && !!war.capturedBy;

                    if (!identity.admin) {
                        try {
                            if (isCreating) {
                                // 1. Only Kage of a warring village may declare war.
                                const kage = await isSeatedKageOf(identity.name, actorVillage);
                                if (!kage) {
                                    return { status: 403 as const, body: { error: 'Only the seated Kage of a warring village can declare a war.' } };
                                }
                                // 2. Cooldown: same village-pair can't re-war within 7 days.
                                const cd = await kv.get(warCooldownKey(war.villages[0], war.villages[1]));
                                if (cd) {
                                    return { status: 409 as const, body: { error: 'These two villages were at war within the last 7 days. Rematch cooldown active.' } };
                                }
                                // 3. Single-war rule: neither village may already be in an active war.
                                for (const v of war.villages) {
                                    if (await villageHasActiveWar(v)) {
                                        return { status: 409 as const, body: { error: `${v} is already in an active war. Only one war at a time per village.` } };
                                    }
                                }
                                // 4. Cost check. Charge the declaring Kage
                                //    VILLAGE_WAR_DECLARATION_COST_HONOR_SEALS honor seals.
                                //    The snapshot read at line ~540 is OUTSIDE
                                //    the save lock; a concurrent save can
                                //    drop honorSeals between the snapshot and
                                //    the deduct below. The deduct re-reads
                                //    inside the lock and PROPAGATES a failure
                                //    back to the outer handler so we don't
                                //    create a war for free when the deduct
                                //    silently skipped.
                                const honorSeals = Number(actorChar?.honorSeals ?? 0);
                                if (honorSeals < VILLAGE_WAR_DECLARATION_COST_HONOR_SEALS) {
                                    return { status: 400 as const, body: { error: `Declaring war costs ${VILLAGE_WAR_DECLARATION_COST_HONOR_SEALS} Honor Seals. You hold ${honorSeals}.` } };
                                }
                                // 5. Deduct under the Kage's save lock so a concurrent save can't double-spend.
                                const deductOk = await withKvLock(`save:${identity.name}`, async () => {
                                    const fresh = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                                    const freshChar = (fresh?.character ?? null) as Record<string, unknown> | null;
                                    if (!fresh || !freshChar) return false;
                                    const freshSeals = Number(freshChar.honorSeals ?? 0);
                                    if (freshSeals < VILLAGE_WAR_DECLARATION_COST_HONOR_SEALS) return false; // raced
                                    await kv.set(`save:${identity.name}`, {
                                        ...fresh,
                                        character: { ...freshChar, honorSeals: Math.max(0, freshSeals - VILLAGE_WAR_DECLARATION_COST_HONOR_SEALS) },
                                    });
                                    return true;
                                });
                                if (!deductOk) {
                                    return { status: 400 as const, body: { error: `Honor Seal balance changed under you; declaration was not charged and the war was not created. Retry.` } };
                                }
                                // 6. Stamp canonical crate ID + initialize empty contributions map.
                                war.warCrateId = `war-crate-${war.id}`;
                                war.contributions = {};
                                // 7. Set the pre-war pending window. HP cannot
                                //    drop and the war cannot be ended until
                                //    `pendingUntil` has passed. Gives the
                                //    defending village time to rally. No
                                //    cancellation — the Kage has already paid
                                //    the 500 Honor Seals and the war commits
                                //    at this moment.
                                war.pendingUntil = Date.now() + VILLAGE_WAR_PENDING_WINDOW_MS;
                            } else if (isClaimingWin) {
                                // Naming a winner REQUIRES the enemy village's
                                // HP to actually be 0 in the persisted record.
                                // The war ground is a contestable tug-of-war
                                // objective that pays bonus damage but does
                                // NOT end the war on its own — without this
                                // check a Kage of the LOSING village could
                                // declare themselves winner.
                                const winnerVillage = war.winnerVillage;
                                const enemyVillage = war.villages.find(v => v !== winnerVillage);
                                const persistedEnemyHp = enemyVillage ? Number(existing?.hp?.[enemyVillage] ?? VILLAGE_WAR_HP_MAX) : VILLAGE_WAR_HP_MAX;
                                const hpWin = persistedEnemyHp <= 0 && winnerVillage === actorVillage;
                                if (!hpWin) {
                                    return { status: 403 as const, body: { error: 'Cannot declare a winner — the enemy village HP is not depleted.' } };
                                }
                            } else if (isClaimingCapture) {
                                // Capturing the war ground is now a flippable
                                // event — anyone in a warring village can
                                // claim the capture flag as long as it isn't
                                // already theirs (the client checks current
                                // capturedBy). No HP-depletion gate.
                                if (existing?.capturedBy === actorVillage) {
                                    return { status: 409 as const, body: { error: 'Your village already holds the war ground.' } };
                                }
                            } else if (isEnding) {
                                // Ending WITHOUT a winner = "call peace".
                                // Allowed only by Kage (either side). Anyone
                                // else who wants to end the war needs to also
                                // satisfy the win-condition gate above.
                                const kage = await isSeatedKageOf(identity.name, actorVillage);
                                if (!kage) {
                                    return { status: 403 as const, body: { error: 'Only the Kage may call peace; otherwise win the war legitimately.' } };
                                }
                            }

                            // Pre-war pending gate. While `pendingUntil`
                            // hasn't passed, no HP write, no end / win /
                            // capture call. The Kage who declared the war
                            // cannot cancel it during this window either —
                            // declaration committed the cost and the war
                            // must run its course. Non-mutating updates
                            // (e.g. lazy decay/contribution merges from
                            // earlier in this handler) are allowed; only
                            // an actively-attempted state change errors.
                            if (existing && warIsPending(existing)) {
                                const wantsDamage = existing.villages.some(v => {
                                    const prev = Number(existing.hp?.[v] ?? VILLAGE_WAR_HP_MAX);
                                    const next = Number(war.hp?.[v] ?? prev);
                                    return next !== prev;
                                }) || Number(war.warGroundHp ?? existing.warGroundHp) !== Number(existing.warGroundHp);
                                if (wantsDamage || isEnding || isClaimingWin || isClaimingCapture) {
                                    const minsLeft = Math.max(1, Math.ceil(((existing.pendingUntil ?? 0) - Date.now()) / 60_000));
                                    return { status: 409 as const, body: { error: `War is still pending — fighting begins in ${minsLeft} min.` } };
                                }
                            }

                            // Per-write HP delta cap. Cap each direction
                            // independently so a write touching both sides
                            // can't bypass via offset.
                            if (existing) {
                                for (const village of existing.villages) {
                                    const prev = Number(existing.hp?.[village] ?? VILLAGE_WAR_HP_MAX);
                                    const next = Number(war.hp?.[village] ?? prev);
                                    if (prev - next > VILLAGE_WAR_HP_MAX_DELTA_PER_REQUEST) {
                                        return { status: 400 as const, body: { error: `Village HP can drop by at most ${VILLAGE_WAR_HP_MAX_DELTA_PER_REQUEST} per request.` } };
                                    }
                                    if (next - prev > VILLAGE_WAR_HP_MAX_DELTA_PER_REQUEST) {
                                        return { status: 400 as const, body: { error: `Village HP can rise by at most ${VILLAGE_WAR_HP_MAX_DELTA_PER_REQUEST} per request.` } };
                                    }
                                }
                                const prevGround = Number(existing.warGroundHp ?? VILLAGE_WAR_GROUND_HP_MAX);
                                const nextGround = Number(war.warGroundHp ?? prevGround);
                                if (prevGround - nextGround > VILLAGE_WAR_GROUND_HP_MAX_DELTA_PER_REQUEST) {
                                    return { status: 400 as const, body: { error: `War ground HP can drop by at most ${VILLAGE_WAR_GROUND_HP_MAX_DELTA_PER_REQUEST} per request.` } };
                                }
                            }
                        } catch {
                            return { status: 500 as const, body: { error: 'Unable to verify war participation.' } };
                        }
                    }

                    // ── Contribution tracking ─────────────────────────────
                    // Contributions are server-managed. Clients cannot write
                    // them directly — we always overwrite with the merged
                    // server-derived map. The damage delta is the actor's
                    // contribution for THIS write. Skip for admin writes
                    // (no real attribution).
                    if (existing && !identity.admin && actorVillage) {
                        const enemyVillage = war.villages.find(v => v !== actorVillage);
                        const prevEnemyHp = enemyVillage ? Number(existing.hp?.[enemyVillage] ?? VILLAGE_WAR_HP_MAX) : VILLAGE_WAR_HP_MAX;
                        const newEnemyHp = enemyVillage ? Number(war.hp?.[enemyVillage] ?? prevEnemyHp) : prevEnemyHp;
                        const enemyDmg = Math.max(0, prevEnemyHp - newEnemyHp);
                        const prevGround = Number(existing.warGroundHp ?? VILLAGE_WAR_GROUND_HP_MAX);
                        const newGround = Number(war.warGroundHp ?? prevGround);
                        const groundDmg = Math.max(0, prevGround - newGround);
                        const totalDmg = enemyDmg + groundDmg;
                        const contribs = { ...(existing.contributions ?? {}) };
                        if (totalDmg > 0) {
                            const key = identity.name;
                            const prev = contribs[key] ?? { damage: 0, raids: 0, pvpKills: 0, side: actorVillage, name: String(actorChar?.name ?? identity.name) };
                            contribs[key] = {
                                damage: prev.damage + totalDmg,
                                raids: prev.raids + 1,
                                pvpKills: prev.pvpKills,
                                side: actorVillage,
                                name: String(actorChar?.name ?? prev.name),
                            };
                        }
                        war.contributions = contribs;
                    } else if (existing) {
                        // Preserve server-owned contributions for admin writes too.
                        war.contributions = existing.contributions ?? {};
                    }

                    // ── On-end stamping ──────────────────────────────────
                    // When this write flips the war from active → ended,
                    // compute MVP-per-side from contributions, stamp the
                    // loser-consolation crate ID (only if there's a real
                    // winner — draws give no consolation), and set the
                    // 7-day rematch cooldown. Idempotent on subsequent
                    // writes because the frozen-once-ended check above
                    // rejects them.
                    if (isEnding) {
                        const contribs = war.contributions ?? {};
                        const mvpByVillage: Record<string, string> = {};
                        for (const village of war.villages) {
                            const sideEntries = Object.values(contribs).filter(c => c.side === village);
                            if (sideEntries.length === 0) continue;
                            sideEntries.sort((a, b) => b.damage - a.damage);
                            mvpByVillage[village] = sideEntries[0].name;
                        }
                        war.mvpByVillage = mvpByVillage;
                        if (war.winnerVillage) {
                            war.loserCrateId = `loser-crate-${war.id}`;
                        }
                        await kv.set(
                            warCooldownKey(war.villages[0], war.villages[1]),
                            Date.now(),
                            { ex: VILLAGE_WAR_REMATCH_COOLDOWN_SEC },
                        );
                    }

                    await kv.set(warKey, war);
                    return { status: 200 as const, body: { war } };
                });
                return res.status(result.status).json(result.body);
            }

            return res.status(400).json({ error: 'Invalid world state update.' });
        } catch (err) {
            console.error('[world-state]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
