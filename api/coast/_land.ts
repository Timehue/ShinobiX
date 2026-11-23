import { DEFAULT_HALL, type HallStyle } from "../../shared/coast-hall-style.js";
/*
 * Land on the Unmapped Coast: who holds a sector, and how a clan takes one.
 *
 * Land is held by clans only (owner ruling, 2026-11-18). A contestable sector
 * with no claim row belongs to the Unmoored, the coast's own faction, so
 * nothing is seeded and a server reset needs no extra step.
 *
 * A clan takes a sector from the Unmoored by a posted contest:
 *   1. A founder, leader or officer declares. The roster of members who have
 *      earned the right (level 75 or higher and The Crossing War finished) is
 *      frozen at that moment, and it must hold at least five.
 *   2. After a day's notice the contest opens for two days. Roster members
 *      fight the sector's garrison; each win is one point, capped per player so
 *      one strong member cannot carry it alone.
 *   3. Reaching the target takes the sector at once. A contest that closes
 *      short is lost, and the clan waits a day before trying that sector again.
 *
 * A sector another clan holds is taken the same way, with three differences:
 *   - It cannot be declared on while it is protected: for three days after it
 *     is taken or defended, and for seven days after its Landing is staked.
 *   - The holder answers. Both rosters are frozen at the declaration. A duel
 *     fought in the sector between one member of each roster scores a point
 *     for the winner's side, once per pair per day. The attackers can also
 *     fight the holder's garrison, which is stronger the taller its Landing.
 *   - It runs its full two days. At the close the attackers take the sector
 *     only if they met the target AND outscored the defence. The holder's
 *     Landing falls with the sector, and nothing passes to the new holder.
 *
 * The numbers in COAST_LAND were settled 2026-11-20 (the owner asked for them
 * to be decided for the game and its players). They are sized for a game of
 * 100 to 200 players and small clans: a day's notice and a two-day window so
 * every time zone gets an evening, five members so a contest is a clan's work
 * and not one player's, and one sector a clan so land is spread among clans.
 *
 * Locks. `coast:land` is the one lock for anything that decides who holds what:
 * declare, withdraw, settle, release. Scoring takes only the sector's own
 * contest key, so garrison wins across the coast never queue behind each other.
 * Order is always land lock, then contest key. Nothing here takes a save lock
 * or a clan lock.
 */
import { createHash, randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { TERRITORY_DAILY_WAR_SUPPLY, TERRITORY_SUPPLY_INTERVAL_MS } from '../_territory-supply.js';
import { cleanTreasuryItems } from '../_treasury-donate.js';
import { TERRITORY_BUFF_STATS, TERRITORY_CAPTURE_SCROLLS, TERRITORY_CONTROL_SCROLL_ID, terrainBuffStatToJutsuType, type TerritoryBuffStat } from '../clan/territory/_assign-core.js';
import { withKvLock } from '../_lock.js';
import { announce } from '../_announce.js';
import { clanBareSlug, clanRecordKey, safeName } from '../_utils.js';
import { clanLeadershipRole } from '../clan/_leadership.js';
import { hasQuestLineUnlock, parseQuestLines } from '../quests/_record.js';
import { deleteCoastLanding, destroyCoastLanding, readCoastLanding } from './_landing-store.js';
import { coastLandingExtraNoticeMs } from './_landing-rules.js';
import { OPEN_COAST_SECTOR_IDS, coastLayout, coastSectorName, isCoastSectorOpen } from '../../shared/coast-world.js';
import { isNpcClanRecord } from '../../shared/npc-clans.js';
import { COAST_MIN_LEVEL, coastRegionOf } from '../../shared/world-maps.js';
import { WEATHER_ELEMENTS, resolveSectorWeather, type SectorWeather } from '../../shared/sector-weather.js';

const HOUR = 60 * 60_000;

export const COAST_LAND = {
    /** How long a declaration is posted before the fighting opens. */
    noticeMs: 24 * HOUR,
    /** How long the fighting stays open. */
    windowMs: 48 * HOUR,
    /** Members with the right to contest land that a clan needs to declare. */
    minMembers: 5,
    /**
     * Garrison wins that take the sector. With the cap below, three members at
     * their cap or five members with three wins each. It was 20, which asked
     * four of a five-member roster to each win every fight they were allowed
     * inside two days; one absent member lost the contest.
     */
    target: 15,
    /** Wins one member may score in one contest. */
    perPlayerCap: 5,
    /** How long a sector cannot be declared on after it is taken or defended. */
    immunityMs: 72 * HOUR,
    /** How long a sector cannot be declared on after its Landing is staked. Given once per holding. */
    foundingGraceMs: 7 * 24 * HOUR,
    /** How long a clan waits before declaring again on a sector it failed to take. */
    retryCooldownMs: 24 * HOUR,
    /** Sectors one clan may hold. */
    maxHoldings: 1,
    /** How long a member must have been in the clan to count. */
    memberTenureMs: 48 * HOUR,
    /** The quest-line unlock that gives a shinobi the right to contest land. */
    unlock: 'contest-land',
    minLevel: COAST_MIN_LEVEL,
    /**
     * Territory Control Scrolls a clan pays from its treasury to declare. It is what capturing a home sector
     * cost before clans held land on the coast only (owner, 2026-11-21), so the scrolls keep the use they had.
     * Paid when the declaration is posted, given back if it is withdrawn before the fighting opens.
     */
    declareScrolls: TERRITORY_CAPTURE_SCROLLS,
} as const;

export const COAST_LAND_LOCK = 'coast:land';
export const coastClaimKey = (sector: number) => `coast:claim:${sector}`;
export const coastContestKey = (sector: number) => `coast:contest:${sector}`;
export const coastContestResultKey = (sector: number) => `coast:contest-last:${sector}`;
export const coastClanGenerationKey = (clanSlug: string) => `coast:clan:${clanSlug}`;

/** A clan's hold on one sector. No row means the Unmoored hold it. */
export interface CoastClaim {
    sector: number;
    clan: string;
    clanSlug: string;
    /** The clan generation that took it. A clan re-founded under the same name inherits nothing. */
    generation: string;
    since: number;
    immuneUntil: number;
    /** Rises each time the sector changes hands. A Clan Landing is bound to one epoch. */
    landingEpoch: number;
    /** The contest that won it, so a settlement that is retried writes the same claim. */
    contestId: string;
    /** Set once the staking of a Landing has given this holding its founding grace. */
    graceGiven?: boolean;
    /** War Supply has been paid out up to here (collectCoastClaimSupply). Absent means none has been, since `since`. */
    supplyAt?: number;
    /**
     * The school the holder's officers chose to favour on this ground (setCoastClaimSchool). Its members' jutsu
     * of that type hit 10% harder in fights on this sector. Absent until an officer chooses, and it does not
     * pass to the next holder: a sector that changes hands gets a new claim.
     */
    terrainBuffStat?: TerritoryBuffStat;
    /** The sky the holder's officers fixed over this ground (setCoastClaimWeather). Absent means the coast's own schedule. */
    weather?: SectorWeather;
}

/** The clan holding a contested sector, as it stood when the contest was declared. */
export interface CoastContestDefender {
    clan: string;
    clanSlug: string;
    generation: string;
    /** The holder's claim epoch, so its Landing can be brought down if the sector is taken. */
    landingEpoch: number;
    roster: string[];
}

export interface CoastContest {
    id: string;
    sector: number;
    clan: string;
    clanSlug: string;
    generation: string;
    declaredBy: string;
    declaredAt: number;
    opensAt: number;
    closesAt: number;
    target: number;
    perPlayerCap: number;
    /** Members who may score, frozen when the contest was declared. */
    roster: string[];
    wins: Record<string, number>;
    score: number;
    /** Fight proofs already counted, so a settlement that is retried scores once. */
    proofs: string[];
    /** Territory Control Scrolls the clan paid to post this, given back if it is withdrawn. Absent on a contest posted before declaring had a cost. */
    paid?: number;
    /** Present when the sector was held by a clan at the declaration. Absent against the Unmoored. */
    defender?: CoastContestDefender;
    /** Points the holder has scored by winning duels in the sector. */
    defense?: number;
    /** Pairs that have already scored a duel today (`a|b|day`): one point per pair per day. */
    duels?: string[];
    /** The pause (by its start time) this contest's clock was last moved for, so a retried resume moves it once. */
    resumedPauseAt?: number;
}

export interface CoastContestResult {
    id: string;
    sector: number;
    clan: string;
    clanSlug: string;
    generation: string;
    outcome: 'won' | 'lost' | 'withdrawn' | 'void';
    score: number;
    target: number;
    settledAt: number;
    /** The clan that held the sector, and what it scored, when the contest was against a clan. */
    defender?: string;
    defense?: number;
}

type ClanRecord = Record<string, unknown>;
type Refusal = { ok: false; status: number; error: string };
const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error });
const whole = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
const lockOptions = { failClosed: true, maxAttempts: 10, baseBackoffMs: 30 } as const;

export function isContestableCoastSector(sector: number): boolean {
    return isCoastSectorOpen(sector) && coastLayout(sector)?.contestable === true;
}

/** `posted` before the fighting opens, `open` while it runs, `closed` once its time is up. */
export function coastContestPhase(contest: CoastContest, now: number): 'posted' | 'open' | 'closed' {
    return now < contest.opensAt ? 'posted' : now < contest.closesAt ? 'open' : 'closed';
}

// ── The pause switch ─────────────────────────────────────────────────────────

/*
 * An admin's stop for the land contests, for an incident. It is a row, not an
 * environment variable, so it is set from the admin tools and takes effect at
 * once on every server. While it is set no contest can be declared, no garrison
 * fight can start, no garrison win or duel scores, the tick settles no contest
 * and no Landing is charged upkeep (api/coast/_landing.ts). Each contest's clock
 * stands still, and when the pause is lifted its remaining time is given back.
 * An admin can still force-settle or cancel a contest while it is set.
 */
export const COAST_LAND_PAUSE_KEY = 'coast:land-paused';
export interface CoastLandPause { at: number; reason: string }
const PAUSED_SENTENCE = 'Land contests on the coast are paused for now. Nothing posted is lost.';

export async function readCoastLandPause(): Promise<CoastLandPause | null> {
    return kv.get<CoastLandPause>(COAST_LAND_PAUSE_KEY);
}

/**
 * The time a contest's clock reads. While the contests are paused it stands at
 * the moment of the pause, so a contest shows the phase it will be in again once
 * the pause is lifted, and one that was still posted can still be withdrawn.
 */
export async function coastContestClock(now: number): Promise<number> {
    const pause = await readCoastLandPause();
    return pause ? Math.min(now, pause.at) : now;
}

/** Pause the land contests. Pausing again keeps the first pause, so its clock is not reset. */
export async function pauseCoastLand(reason: string, now = Date.now()): Promise<CoastLandPause> {
    return withKvLock(COAST_LAND_LOCK, async () => {
        const standing = await readCoastLandPause();
        if (standing) return standing;
        const pause: CoastLandPause = { at: now, reason: reason.trim().slice(0, 200) };
        await kv.set(COAST_LAND_PAUSE_KEY, pause);
        return pause;
    }, lockOptions);
}

/**
 * Lift the pause. Each contest gets back the time the pause took from it: a
 * notice or a window that was still running when the pause began is moved later
 * by the length of the pause. One that had already closed stays closed.
 */
export async function resumeCoastLand(now = Date.now()): Promise<{ resumed: boolean; pausedMs: number; moved: number[] }> {
    return withKvLock(COAST_LAND_LOCK, async () => {
        const pause = await readCoastLandPause();
        if (!pause) return { resumed: false, pausedMs: 0, moved: [] };
        const pausedMs = Math.max(0, now - pause.at), moved: number[] = [];
        for (const sector of await coastKeys('coast:contest:')) {
            const shifted = await withKvLock(coastContestKey(sector), async () => {
                const contest = await readCoastContest(sector);
                if (!contest || contest.closesAt <= pause.at) return false;
                // Each contest is moved once for a pause. If a busy lock stops this
                // loop partway, the pause row stays and the admin lifts it again:
                // the contests already moved are skipped, not moved a second time.
                if (contest.resumedPauseAt === pause.at) return false;
                await kv.set(coastContestKey(sector), {
                    ...contest, closesAt: contest.closesAt + pausedMs, resumedPauseAt: pause.at,
                    ...(contest.opensAt > pause.at ? { opensAt: contest.opensAt + pausedMs } : {}),
                } satisfies CoastContest);
                return true;
            }, lockOptions);
            if (shifted) moved.push(sector);
        }
        await kv.del(COAST_LAND_PAUSE_KEY);
        return { resumed: true, pausedMs, moved };
    }, lockOptions);
}

// ── Clan identity ────────────────────────────────────────────────────────────

interface ClanGenerationRow { generation: string; createdAt: number; mintedAt: number }

/**
 * The generation of a clan as the coast knows it. A clan's name can be used
 * again after it dissolves, so a name alone must never carry a claim. The id is
 * minted the first time a clan acts on the coast, and is dropped when the clan
 * dissolves (releaseCoastHoldingsForClan) or its record is found gone.
 */
async function clanGeneration(clanSlug: string, clan: ClanRecord, mint: boolean): Promise<string | null> {
    const key = coastClanGenerationKey(clanSlug);
    const createdAt = whole(clan.createdAt);
    const row = await kv.get<ClanGenerationRow>(key);
    if (row && row.createdAt === createdAt) return row.generation;
    if (!mint) return null;
    const next: ClanGenerationRow = { generation: randomUUID(), createdAt, mintedAt: Date.now() };
    await kv.set(key, next);
    return next.generation;
}

async function loadClan(clanName: string): Promise<{ slug: string; record: ClanRecord } | null> {
    const slug = clanBareSlug(clanName);
    if (!slug) return null;
    const record = await kv.get<ClanRecord>(clanRecordKey(clanName));
    return record ? { slug, record } : null;
}

/**
 * A clan's coast generation by its name, for callers outside this file (the
 * clan quest lines record it at accept). `mint` is for a clan's first act on
 * the coast; it is taken under the land lock so two members acting at once
 * cannot mint two ids.
 */
export async function coastClanGenerationFor(clanName: string, mint: boolean): Promise<{ clanSlug: string; record: ClanRecord; generation: string } | null> {
    const clan = await loadClan(clanName);
    if (!clan) return null;
    const known = await clanGeneration(clan.slug, clan.record, false);
    if (known) return { clanSlug: clan.slug, record: clan.record, generation: known };
    if (!mint) return null;
    const generation = await withKvLock(COAST_LAND_LOCK, () => clanGeneration(clan.slug, clan.record, true), lockOptions);
    return generation ? { clanSlug: clan.slug, record: clan.record, generation } : null;
}

/** True while the clan that a claim or contest names still exists as that same generation. */
async function holderLive(row: { clan: string; clanSlug: string; generation: string }): Promise<boolean> {
    const clan = await loadClan(row.clan);
    if (!clan || clan.slug !== row.clanSlug) return false;
    return (await clanGeneration(clan.slug, clan.record, false)) === row.generation;
}

/** Whether one saved player has earned the right to contest land. */
export function hasCoastLandRight(save: unknown): boolean {
    const record = save && typeof save === 'object' ? save as Record<string, unknown> : {};
    const character = record.character && typeof record.character === 'object' ? record.character as Record<string, unknown> : {};
    return whole(character.level) >= COAST_LAND.minLevel && hasQuestLineUnlock(parseQuestLines(record.questLines), COAST_LAND.unlock);
}

/** The members of a clan who count toward a contest: the right earned, and long enough in the clan. */
export async function eligibleCoastMembers(clan: ClanRecord, clanSlug: string, now: number): Promise<string[]> {
    const members = Array.isArray(clan.members) ? clan.members as Array<Record<string, unknown>> : [];
    const names = new Map<string, number>();
    for (const member of members) {
        const slug = safeName(String(member?.name ?? ''));
        // A member row with no join date is from before join dates were kept, so it is long-standing.
        if (slug) names.set(slug, whole(member.joinedAt));
    }
    const eligible: string[] = [];
    await Promise.all([...names].map(async ([slug, joinedAt]) => {
        if (joinedAt > 0 && now - joinedAt < COAST_LAND.memberTenureMs) return;
        const save = await kv.get<Record<string, unknown>>(`save:${slug}`);
        const character = (save?.character ?? {}) as Record<string, unknown>;
        // The clan row is only a list; the member's own save says where they belong now.
        if (clanBareSlug(String(character.clan ?? '')) !== clanSlug) return;
        if (hasCoastLandRight(save)) eligible.push(slug);
    }));
    return eligible.sort();
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function coastKeys(prefix: string): Promise<number[]> {
    return (await kv.keys(`${prefix}*`)).map(key => Number(key.slice(prefix.length))).filter(Number.isInteger);
}

export async function readCoastClaim(sector: number): Promise<CoastClaim | null> {
    return kv.get<CoastClaim>(coastClaimKey(sector));
}
export async function readCoastContest(sector: number): Promise<CoastContest | null> {
    return kv.get<CoastContest>(coastContestKey(sector));
}

export interface CoastLandView {
    sector: number;
    name: string;
    region: number;
    /** The weather over it right now, and whether its holder fixed it or the coast's schedule turned it up. */
    sky: { weather: SectorWeather; fixed: boolean };
    /** The clan holding it, or null while the Unmoored do. */
    holder: { clan: string; since: number; immuneUntil: number; terrainBuffStat?: TerritoryBuffStat; weather?: SectorWeather; hallStyle?: HallStyle } | null;
    contest: {
        id: string; clan: string; phase: 'posted' | 'open' | 'closed'; opensAt: number; closesAt: number; score: number; target: number; roster: number;
        /** Set when the sector's holder is defending it. */
        defender?: { clan: string; score: number; roster: number };
    } | null;
}

/** Every contestable sector, with who holds it and any contest posted on it. Public to every player. */
export async function coastLandViews(now: number): Promise<CoastLandView[]> {
    const sectors = OPEN_COAST_SECTOR_IDS.filter(isContestableCoastSector);
    const clock = await coastContestClock(now);
    return Promise.all(sectors.map(async (sector): Promise<CoastLandView> => {
        const [claim, contest] = await Promise.all([readCoastClaim(sector), readCoastContest(sector)]);
        const hall = claim ? await standingLandingOf(claim, sector) : null;
        const fixed = !!claim?.weather && Object.hasOwn(WEATHER_ELEMENTS, claim.weather);
        return {
            sector, name: coastSectorName(sector) ?? `Sector ${sector}`, region: coastRegionOf(sector),
            sky: { weather: resolveSectorWeather(coastLayout(sector)?.biome, sector, now, fixed ? { ownerClan: claim!.clan, weather: claim!.weather } : null), fixed },
            holder: claim ? {
                clan: claim.clan, since: claim.since, immuneUntil: claim.immuneUntil,
                ...(hall && hall.tier > 0 ? { hallStyle: hall.hallStyle ?? DEFAULT_HALL } : {}),
                ...(terrainBuffStatToJutsuType(claim.terrainBuffStat) ? { terrainBuffStat: claim.terrainBuffStat } : {}),
                ...(claim.weather && Object.hasOwn(WEATHER_ELEMENTS, claim.weather) ? { weather: claim.weather } : {}),
            } : null,
            contest: contest ? {
                id: contest.id, clan: contest.clan, phase: coastContestPhase(contest, clock), opensAt: contest.opensAt, closesAt: contest.closesAt,
                score: contest.score, target: contest.target, roster: contest.roster.length,
                ...(contest.defender ? { defender: { clan: contest.defender.clan, score: whole(contest.defense), roster: contest.defender.roster.length } } : {}),
            } : null,
        };
    }));
}

// ── Declare and withdraw ─────────────────────────────────────────────────────

export type CoastDeclareResult = { ok: true; contest: CoastContest } | Refusal;

const placeName = (sector: number) => coastSectorName(sector) ?? `Sector ${sector}`;

/**
 * Tell the server what happened to a piece of ground. A holder must not have to
 * open a status screen to learn that its sector has been declared on. Posted
 * once per contest (the receipt id), after the land lock is released, and never
 * allowed to fail the action that caused it.
 */
async function announceLand(kind: 'declared' | 'settled', contest: Pick<CoastContest, 'id' | 'sector' | 'clan' | 'declaredBy' | 'defender' | 'declaredAt' | 'opensAt'>, outcome?: CoastContestResult['outcome']): Promise<void> {
    const place = placeName(contest.sector), holder = contest.defender?.clan;
    // A holder's Watch Fire makes the notice longer, so the wait is read from the contest.
    const noticeHours = Math.round((contest.opensAt - contest.declaredAt) / HOUR);
    const opens = noticeHours === 24 ? 'in a day' : `in ${noticeHours} hours`;
    const text = kind === 'declared'
        ? { title: `${contest.clan} has declared for ${place}`, message: `${holder ? `${holder} holds it.` : 'The Unmoored hold it.'} The contest opens ${opens} and runs for ${noticeHours === 24 ? 'two' : 'two days'}.` }
        : outcome === 'won'
            ? { title: `${contest.clan} has taken ${place}`, message: holder ? `${holder} has lost the ground, and its Landing with it.` : 'The Unmoored garrison has been driven off.' }
            : outcome === 'lost' && holder
                ? { title: `${holder} has held ${place}`, message: `${contest.clan} could not take it.` }
                : null;
    if (!text) return;
    await announce({
        type: kind === 'declared' ? 'coast_land_declared' : 'coast_land_settled', importance: kind === 'declared' ? 'medium' : 'high',
        ...text, player: contest.declaredBy, meta: { sector: contest.sector, clan: contest.clan, ...(holder ? { defender: holder } : {}), ...(outcome ? { outcome } : {}) },
    }, { receiptId: `coast-land:${kind}:${contest.id}` }).catch(() => null);
}

/**
 * Take scrolls out of a clan's treasury, or put them back. Under the clan record's own lock and never under the
 * land lock: the coast's lock takes no clan lock (api/clan/_dissolve.ts relies on that). False when the treasury
 * does not hold enough, or the clan is gone.
 */
async function moveClanScrolls(clanName: string, delta: number): Promise<boolean> {
    if (!delta) return true;
    const key = clanRecordKey(clanName);
    return withKvLock(key, async () => {
        const record = await kv.get<Record<string, unknown>>(key);
        if (!record) return false;
        const treasury = (record.treasury ?? {}) as Record<string, unknown>;
        const items = cleanTreasuryItems(treasury.items);
        const held = items.find(stack => stack.itemId === TERRITORY_CONTROL_SCROLL_ID)?.count ?? 0;
        if (held + delta < 0) return false;
        const rest = items.filter(stack => stack.itemId !== TERRITORY_CONTROL_SCROLL_ID);
        const next = held + delta > 0 ? [...rest, { itemId: TERRITORY_CONTROL_SCROLL_ID, count: held + delta }] : rest;
        await kv.set(key, { ...record, treasury: { ...treasury, items: next } });
        return true;
    }, lockOptions);
}

/**
 * Give a declaration's scrolls back. A refund that fails must not undo what caused it (the contest is already
 * withdrawn or refused), so it is logged with enough to put right by hand and never thrown.
 */
async function refundDeclareScrolls(clanName: string, scrolls: number, why: string, sector: number): Promise<void> {
    if (!(scrolls > 0)) return;
    const paidBack = await moveClanScrolls(clanName, scrolls).catch(() => false);
    if (!paidBack) console.error('[coast/land] scroll refund failed', JSON.stringify({ clan: clanBareSlug(clanName), scrolls, why, sector }));
}

/**
 * Declare for a sector. The clan pays COAST_LAND.declareScrolls from its treasury.
 *
 * The land lock and the clan lock are never held together, so this runs in three steps: check that the
 * declaration would stand, take the scrolls, then post it. If the last step is refused (another clan declared in
 * between, say) the scrolls go back. A crash between the second and third step can lose the scrolls and can
 * never post a contest that was not paid for.
 */
export async function declareCoastContest(input: { playerName: string; sector: number; now?: number }): Promise<CoastDeclareResult> {
    const checked = await declareCoastContestLocked({ ...input, dryRun: true });
    if (!checked.ok) return checked;
    const cost = COAST_LAND.declareScrolls, payer = checked.contest.clan;
    if (!(await moveClanScrolls(payer, -cost))) {
        return refuse(409, `The clan hall needs ${cost} Territory Control Scrolls to declare for land.`);
    }
    let result: CoastDeclareResult;
    try {
        result = await declareCoastContestLocked(input);
    } catch (error) {
        await refundDeclareScrolls(payer, cost, 'declare-threw', input.sector);
        throw error;
    }
    if (!result.ok) {
        await refundDeclareScrolls(payer, cost, 'declare-refused', input.sector);
        return result;
    }
    await announceLand('declared', result.contest);
    return result;
}

async function declareCoastContestLocked(input: { playerName: string; sector: number; now?: number; dryRun?: boolean }): Promise<CoastDeclareResult> {
    const player = safeName(input.playerName), sector = Math.floor(Number(input.sector));
    if (!isContestableCoastSector(sector)) return refuse(400, 'That ground cannot be held.');
    return withKvLock(COAST_LAND_LOCK, async (): Promise<CoastDeclareResult> => {
        const now = input.now ?? Date.now();
        if (await readCoastLandPause()) return refuse(409, PAUSED_SENTENCE);
        const save = await kv.get<Record<string, unknown>>(`save:${player}`);
        const character = (save?.character ?? {}) as Record<string, unknown>;
        const clan = await loadClan(String(character.clan ?? ''));
        if (!clan) return refuse(403, 'Only a clan can hold land on the coast. Found or join one first.');
        if (isNpcClanRecord(clan.record)) return refuse(403, 'That clan does not contest land.');
        if (!clanLeadershipRole(clan.record, player)) return refuse(403, "Only a clan's founder, leaders and officers can declare for land.");

        let holder = await readCoastClaim(sector);
        if (holder && !(await holderLive(holder))) {
            await dropClaim(holder, 'clan-gone'); // the clan is gone; the Unmoored have it back
            holder = null;
        }
        if (holder?.clanSlug === clan.slug) return refuse(409, 'Your clan already holds that ground.');
        if (holder && now < holder.immuneUntil) return refuse(409, `${holder.clan} holds that ground, and it is protected for now. It can be declared on later.`);
        const posted = await readCoastContest(sector);
        if (posted) return refuse(409, posted.clanSlug === clan.slug ? 'Your clan has already declared here.' : `${posted.clan} has already declared here.`);

        const generation = (await clanGeneration(clan.slug, clan.record, true))!;
        const mine = (row: { clanSlug: string; generation: string } | null) => !!row && row.clanSlug === clan.slug && row.generation === generation;
        const held = (await Promise.all((await coastKeys('coast:claim:')).map(readCoastClaim))).filter(mine).length;
        if (held >= COAST_LAND.maxHoldings) return refuse(409, COAST_LAND.maxHoldings === 1 ? 'Your clan already holds a sector. It can hold one.' : `Your clan already holds ${held} sectors.`);
        const outgoing = (await Promise.all((await coastKeys('coast:contest:')).map(readCoastContest))).some(mine);
        if (outgoing) return refuse(409, 'Your clan already has a contest posted. Finish it first.');

        const last = await kv.get<CoastContestResult>(coastContestResultKey(sector));
        if (last && mine(last) && last.outcome === 'lost' && now - last.settledAt < COAST_LAND.retryCooldownMs) {
            return refuse(409, 'The garrison there is still on its guard after your last attempt. Wait a day before declaring again.');
        }

        const roster = await eligibleCoastMembers(clan.record, clan.slug, now);
        if (!roster.includes(player)) return refuse(403, 'You have not earned the right to contest land yet. Finish The Crossing War first.');
        if (roster.length < COAST_LAND.minMembers) {
            return refuse(409, `Your clan needs ${COAST_LAND.minMembers} members who have earned the right to contest land. It has ${roster.length}.`);
        }

        // A holder whose Landing has a lit Watch Fire sees the declaration coming:
        // the fighting opens later, and still runs its full time.
        const notice = COAST_LAND.noticeMs + (holder ? coastLandingExtraNoticeMs(await standingLandingOf(holder, sector)) : 0);
        const contest: CoastContest = {
            id: randomUUID().replace(/-/g, ''), sector, clan: String(clan.record.name ?? character.clan), clanSlug: clan.slug, generation,
            declaredBy: player, declaredAt: now, opensAt: now + notice, closesAt: now + notice + COAST_LAND.windowMs,
            target: COAST_LAND.target, perPlayerCap: COAST_LAND.perPlayerCap, roster, wins: {}, score: 0, proofs: [],
            paid: COAST_LAND.declareScrolls,
        };
        if (holder) {
            // The holder's roster is frozen now too: whoever is in the clan, with the right, at this moment.
            const defending = await loadClan(holder.clan);
            contest.defender = {
                clan: holder.clan, clanSlug: holder.clanSlug, generation: holder.generation, landingEpoch: holder.landingEpoch,
                roster: defending ? await eligibleCoastMembers(defending.record, holder.clanSlug, now) : [],
            };
            contest.defense = 0;
            contest.duels = [];
        }
        // The check before the scrolls are taken: everything above stands, and nothing is written.
        if (input.dryRun) return { ok: true, contest };
        await kv.set(coastContestKey(sector), contest);
        return { ok: true, contest };
    }, lockOptions);
}

/** Take a declaration back before the fighting opens. The scrolls it cost come back, and it leaves no cooldown. */
export async function withdrawCoastContest(input: { playerName: string; sector: number; now?: number }): Promise<{ ok: true } | Refusal> {
    const withdrawn = await withdrawCoastContestLocked(input);
    if (!withdrawn.ok) return withdrawn;
    // Outside the land lock, as the payment was. A contest posted before declaring had a cost carries none to give back.
    await refundDeclareScrolls(withdrawn.clan, withdrawn.paid, 'withdrawn', input.sector);
    return { ok: true };
}

async function withdrawCoastContestLocked(input: { playerName: string; sector: number; now?: number }): Promise<{ ok: true; clan: string; paid: number } | Refusal> {
    const player = safeName(input.playerName), sector = Math.floor(Number(input.sector));
    return withKvLock(COAST_LAND_LOCK, async () => {
        const now = input.now ?? Date.now();
        const contest = await readCoastContest(sector);
        if (!contest) return refuse(404, 'No contest is posted there.');
        const clan = await loadClan(contest.clan);
        if (!clan || clan.slug !== contest.clanSlug || !clanLeadershipRole(clan.record, player)) return refuse(403, "Only that clan's founder, leaders and officers can withdraw it.");
        if (coastContestPhase(contest, await coastContestClock(now)) !== 'posted') return refuse(409, 'The fighting has opened. It can no longer be withdrawn.');
        await withKvLock(coastContestKey(sector), () => archive(contest, 'withdrawn', now), lockOptions);
        return { ok: true as const, clan: contest.clan, paid: Math.max(0, Math.floor(Number(contest.paid) || 0)) };
    }, lockOptions);
}

// ── Garrison fights ──────────────────────────────────────────────────────────

/**
 * Whether this player may fight the garrison for the contest on a sector right
 * now. Throws a sentence the player can read; the fight route shows it as it is.
 */
export async function coastGarrisonFightStart(playerName: string, save: Record<string, unknown>, sector: number, contestId: string, now: number): Promise<CoastContest> {
    const player = safeName(playerName);
    if (await readCoastLandPause()) throw new Error(PAUSED_SENTENCE);
    const contest = await readCoastContest(sector);
    if (!contest || contest.id !== contestId) throw new Error('No contest is being fought here.');
    const phase = coastContestPhase(contest, now);
    if (phase === 'posted') throw new Error('The contest here has been posted but the fighting has not opened yet.');
    if (phase === 'closed') throw new Error('The contest here is over.');
    const character = (save.character ?? {}) as Record<string, unknown>;
    if (clanBareSlug(String(character.clan ?? '')) !== contest.clanSlug || !contest.roster.includes(player)) {
        throw new Error("You are not on this contest's roster. It was fixed when the contest was declared.");
    }
    if (whole(contest.wins[player]) >= contest.perPlayerCap) throw new Error(`You have done your part here: ${contest.perPlayerCap} wins. The rest is for your clan to finish.`);
    return contest;
}

/**
 * Who stands guard for a contest. The Unmoored post their own. A clan's
 * garrison carries its name and is stronger the taller its Landing stands,
 * which is what raising a Landing is for.
 */
export async function coastGarrisonGuard(contest: CoastContest): Promise<{ name: string; statBonus: number }> {
    if (!contest.defender) return { name: 'Unmoored Garrison Guard', statBonus: 3 };
    const landing = await standingLandingOf(contest.defender, contest.sector);
    return { name: `${contest.defender.clan} Garrison Guard`, statBonus: 3 + (landing ? Math.min(3, whole(landing.tier)) : 0) };
}

/** The Landing a holder has standing on this sector under its present claim, if any. */
async function standingLandingOf(holder: { clanSlug: string; landingEpoch: number }, sector: number) {
    const landing = await readCoastLanding(holder.clanSlug);
    return landing && landing.status !== 'destroyed' && landing.sector === sector && landing.landingEpoch === holder.landingEpoch ? landing : null;
}

const proofId = (proof: string) => createHash('sha256').update(proof).digest('hex').slice(0, 24);

export type CoastScoreResult = { counted: boolean; reason?: string; score?: number; target?: number; taken?: boolean };

/**
 * Count one garrison win the server has settled. Called after the fight's own
 * settlement, with that fight's token as proof. A retried settlement finds its
 * proof already counted and scores nothing more.
 */
export async function recordCoastGarrisonWin(input: { playerName: string; sector: number; contestId: string; proofId: string; now?: number }): Promise<CoastScoreResult> {
    const player = safeName(input.playerName), sector = Math.floor(Number(input.sector)), proof = proofId(input.proofId);
    // A fight that began before a pause and ends inside it scores nothing: a pause
    // is for an incident, and a win that lands during one could take a sector
    // while every other clan is stopped. The fight itself is settled as usual.
    if (await readCoastLandPause()) return { counted: false, reason: 'paused' };
    const scored = await withKvLock(coastContestKey(sector), async (): Promise<CoastScoreResult> => {
        const now = input.now ?? Date.now();
        const contest = await readCoastContest(sector);
        if (!contest || contest.id !== input.contestId) return { counted: false, reason: 'no-contest' };
        if (contest.proofs.includes(proof)) return { counted: false, reason: 'replayed', score: contest.score, target: contest.target };
        // Against the Unmoored, a fight started inside the window still counts if
        // it ends a little after it: nobody is on the other side. Where a clan
        // is defending, the close is the close for both sides. The row outlives
        // the close until the next settle tick, and a point that landed in that
        // gap could turn a contest the holder had already seen off.
        const phase = coastContestPhase(contest, now);
        if (phase === 'posted') return { counted: false, reason: 'not-open' };
        if (phase === 'closed' && contest.defender) return { counted: false, reason: 'closed', score: contest.score, target: contest.target };
        if (!contest.roster.includes(player)) return { counted: false, reason: 'not-on-roster' };
        if (whole(contest.wins[player]) >= contest.perPlayerCap) return { counted: false, reason: 'capped', score: contest.score, target: contest.target };
        const next: CoastContest = {
            ...contest, score: contest.score + 1, wins: { ...contest.wins, [player]: whole(contest.wins[player]) + 1 }, proofs: [...contest.proofs, proof],
        };
        await kv.set(coastContestKey(sector), next);
        // Against the Unmoored the sector falls the moment the target is met.
        // Against a clan the contest runs its full time, so the holder can answer.
        return { counted: true, score: next.score, target: next.target, ...(!next.defender && next.score >= next.target ? { taken: true } : {}) };
    }, lockOptions);
    if (scored.taken) {
        const settled = await settleCoastContest(sector, input.now ?? Date.now());
        return { ...scored, taken: settled?.outcome === 'won' };
    }
    return scored;
}

/**
 * Count one duel the server has settled, fought in a sector whose holder is
 * defending it. The winner's side scores a point when the two fighters are on
 * opposite rosters, once per pair per day, so two clans cannot trade wins to
 * run up a score. The caller has already checked that the duel was a real world
 * fight between two separate players (api/coast/_land-duel.ts).
 */
export async function recordCoastContestDuel(input: { sector: number; winner: string; loser: string; battleId: string; now?: number }): Promise<CoastScoreResult & { side?: 'attack' | 'defense'; defense?: number }> {
    const winner = safeName(input.winner), loser = safeName(input.loser), sector = Math.floor(Number(input.sector)), proof = proofId(`duel:${input.battleId}`);
    if (await readCoastLandPause()) return { counted: false, reason: 'paused' };
    return withKvLock(coastContestKey(sector), async () => {
        const now = input.now ?? Date.now();
        const contest = await readCoastContest(sector);
        if (!contest?.defender) return { counted: false, reason: 'no-contest' };
        if (contest.proofs.includes(proof)) return { counted: false, reason: 'replayed', score: contest.score, target: contest.target };
        // `now` is when the duel ended (api/coast/_land-duel.ts), not when its
        // settlement was read, so a duel is judged by the window it was fought in.
        const phase = coastContestPhase(contest, now);
        if (phase !== 'open') return { counted: false, reason: phase === 'posted' ? 'not-open' : 'closed', score: contest.score, target: contest.target };
        const attack =contest.roster.includes(winner) && contest.defender.roster.includes(loser);
        const defense = contest.defender.roster.includes(winner) && contest.roster.includes(loser);
        if (!attack && !defense) return { counted: false, reason: 'not-on-roster' };
        const pair = `${[winner, loser].sort().join('|')}|${new Date(now).toISOString().slice(0, 10)}`;
        if ((contest.duels ?? []).includes(pair)) return { counted: false, reason: 'pair-used', score: contest.score, target: contest.target };
        const next: CoastContest = {
            ...contest, proofs: [...contest.proofs, proof], duels: [...(contest.duels ?? []), pair],
            ...(attack ? { score: contest.score + 1 } : { defense: whole(contest.defense) + 1 }),
        };
        await kv.set(coastContestKey(sector), next);
        return { counted: true, side: attack ? 'attack' as const : 'defense' as const, score: next.score, target: next.target, defense: whole(next.defense) };
    }, lockOptions);
}

// ── Settlement ───────────────────────────────────────────────────────────────

async function archive(contest: CoastContest, outcome: CoastContestResult['outcome'], now: number): Promise<CoastContestResult> {
    const result: CoastContestResult = {
        id: contest.id, sector: contest.sector, clan: contest.clan, clanSlug: contest.clanSlug, generation: contest.generation,
        outcome, score: contest.score, target: contest.target, settledAt: now,
        ...(contest.defender ? { defender: contest.defender.clan, defense: whole(contest.defense) } : {}),
    };
    // The result is written before the contest row is removed, so a crash between
    // the two leaves a contest that settles to the same answer on the next pass.
    await kv.set(coastContestResultKey(contest.sector), result);
    await kv.del(coastContestKey(contest.sector));
    return result;
}

/**
 * Settle the contest on one sector if it is due: won once the target is met,
 * lost once its time is up. `force` settles it now, whichever way the score
 * stands (an admin tool, and how a test or a live journey ends a contest).
 */
export async function settleCoastContest(sector: number, now = Date.now(), options: { force?: boolean } = {}): Promise<CoastContestResult | null> {
    let settledContest: CoastContest | null = null;
    const result = await withKvLock(COAST_LAND_LOCK, () => withKvLock(coastContestKey(sector), async () => {
        const contest = await readCoastContest(sector);
        if (!contest) return null;
        settledContest = contest;
        const met = contest.score >= contest.target, against = contest.defender;
        // Against the Unmoored a met target settles at once. Against a clan, only the close does.
        if (!options.force && coastContestPhase(contest, now) !== 'closed' && (against || !met)) return null;

        const prior = await readCoastClaim(sector);
        // The holder is still defending if the claim is still theirs. If their clan has gone
        // since the declaration, the ground is the Unmoored's and only the target matters.
        const defended = !!against && !!prior && prior.clanSlug === against.clanSlug && prior.generation === against.generation;
        if (!met || (defended && contest.score <= whole(contest.defense))) {
            // A holder that saw the contest off cannot be declared on again for a while.
            if (defended && prior) await kv.set(coastClaimKey(sector), { ...prior, immuneUntil: Math.max(prior.immuneUntil, now + COAST_LAND.immunityMs) } satisfies CoastClaim);
            return archive(contest, 'lost', now);
        }

        // The clan must still be the clan that declared, and still have room for the sector.
        if (!(await holderLive(contest))) return archive(contest, 'void', now);
        if (prior?.contestId !== contest.id) {
            const held = (await Promise.all((await coastKeys('coast:claim:')).map(readCoastClaim)))
                .filter(claim => claim && claim.clanSlug === contest.clanSlug && claim.generation === contest.generation && claim.sector !== sector).length;
            if (held >= COAST_LAND.maxHoldings) return archive(contest, 'void', now);
            const claim: CoastClaim = {
                sector, clan: contest.clan, clanSlug: contest.clanSlug, generation: contest.generation,
                since: now, immuneUntil: now + COAST_LAND.immunityMs, landingEpoch: whole(prior?.landingEpoch) + 1, contestId: contest.id,
            };
            // One write changes the holder and raises the epoch.
            await kv.set(coastClaimKey(sector), claim);
        }
        // The old holder's Landing falls with the sector, and nothing of it passes on. Safe to repeat.
        if (against) await destroyCoastLanding({ clanSlug: against.clanSlug, sector, landingEpoch: against.landingEpoch }, 'sector-taken', now);
        return archive(contest, 'won', now);
    }, lockOptions), lockOptions);
    const contest = settledContest as CoastContest | null;
    if (result && contest) await announceLand('settled', contest, result.outcome);
    return result;
}

/**
 * The scheduled pass: settle every contest that is due, and hand back to the
 * Unmoored any sector whose clan no longer exists.
 */
export async function settleDueCoastLand(now = Date.now()): Promise<{ settled: CoastContestResult[]; released: number[] }> {
    const settled: CoastContestResult[] = [];
    // While the contests are paused their clocks are stopped, so none is settled
    // by time. A sector whose clan is gone is still handed back below.
    const paused = !!(await readCoastLandPause());
    for (const sector of paused ? [] : await coastKeys('coast:contest:')) {
        const result = await settleCoastContest(sector, now);
        if (result) settled.push(result);
    }
    const released: number[] = [];
    for (const sector of await coastKeys('coast:claim:')) {
        const claim = await readCoastClaim(sector);
        if (!claim || await holderLive(claim)) continue;
        const gone = await withKvLock(COAST_LAND_LOCK, async () => {
            const current = await readCoastClaim(sector);
            if (!current || await holderLive(current)) return false;
            await dropClaim(current, 'clan-gone');
            return true;
        }, lockOptions);
        if (gone) released.push(sector);
    }
    return { settled, released };
}

/**
 * Take a claim away. The Landing standing on it falls with it: the claim row is
 * removed first, so nothing can be built on ground the clan no longer holds.
 * Call under the land lock.
 */
async function dropClaim(claim: CoastClaim, reason: string): Promise<void> {
    await kv.del(coastClaimKey(claim.sector));
    await destroyCoastLanding(claim, reason);
}

/**
 * Give one sector back to the Unmoored: an admin tool, and what happens when a
 * Landing's upkeep goes unpaid too long. `expect` makes it a no-op unless the
 * sector is still held under that same epoch, so a late caller cannot take a
 * sector the clan has since lost and won again.
 */
export async function releaseCoastClaim(sector: number, reason = 'released', expect?: { clanSlug: string; landingEpoch: number }): Promise<boolean> {
    return withKvLock(COAST_LAND_LOCK, async () => {
        const claim = await readCoastClaim(sector);
        if (!claim) return false;
        if (expect && (claim.clanSlug !== expect.clanSlug || claim.landingEpoch !== expect.landingEpoch)) return false;
        await dropClaim(claim, reason);
        return true;
    }, lockOptions);
}

// ── Admin tools ──────────────────────────────────────────────────────────────
// Each is called only from api/coast/admin.ts, which checks for a full admin
// and writes the audit row. force-settle and release are above.

/**
 * Call a contest off, whatever its score. It leaves no cooldown and changes no holder, and the clan that declared
 * gets back the scrolls the declaration cost: an admin took the contest away, the clan did not lose it.
 */
export async function cancelCoastContest(sector: number, now = Date.now()): Promise<CoastContestResult | null> {
    let refund: { clan: string; paid: number } | null = null;
    const result = await withKvLock(COAST_LAND_LOCK, () => withKvLock(coastContestKey(sector), async () => {
        const contest = await readCoastContest(sector);
        if (!contest) return null;
        refund = { clan: contest.clan, paid: Math.max(0, Math.floor(Number(contest.paid) || 0)) };
        return archive(contest, 'void', now);
    }, lockOptions), lockOptions);
    // Outside the land lock, as the payment was (the land lock never nests a clan lock).
    const owed = refund as { clan: string; paid: number } | null;
    if (owed) await refundDeclareScrolls(owed.clan, owed.paid, 'admin-cancelled', sector);
    return result;
}

/**
 * Give a sector to a clan without a contest: for putting right a holding lost
 * to a fault. It follows the same rules a won contest does. The clan must exist
 * and have room, the epoch rises, and whoever held the ground before loses the
 * Landing that stood on it. It refuses while a contest is posted there, so an
 * admin settles or cancels that first and never overwrites a fight in progress.
 */
export async function grantCoastClaim(input: { sector: number; clanName: string; now?: number }): Promise<{ ok: true; claim: CoastClaim } | Refusal> {
    const sector = Math.floor(Number(input.sector));
    if (!isContestableCoastSector(sector)) return refuse(400, 'That ground cannot be held.');
    return withKvLock(COAST_LAND_LOCK, async () => {
        const now = input.now ?? Date.now();
        const clan = await loadClan(input.clanName);
        if (!clan) return refuse(404, 'No clan has that name.');
        if (isNpcClanRecord(clan.record)) return refuse(409, 'That clan does not hold land.');
        if (await readCoastContest(sector)) return refuse(409, 'A contest is posted there. Settle or cancel it first.');
        const prior = await readCoastClaim(sector);
        const generation = (await clanGeneration(clan.slug, clan.record, true))!;
        if (prior && prior.clanSlug === clan.slug && prior.generation === generation) return refuse(409, 'That clan already holds that ground.');
        const held = (await Promise.all((await coastKeys('coast:claim:')).map(readCoastClaim)))
            .filter(row => row && row.clanSlug === clan.slug && row.generation === generation).length;
        if (held >= COAST_LAND.maxHoldings) return refuse(409, 'That clan already holds as much ground as a clan may. Release it first.');
        const claim: CoastClaim = {
            sector, clan: String(clan.record.name ?? input.clanName), clanSlug: clan.slug, generation,
            since: now, immuneUntil: now + COAST_LAND.immunityMs, landingEpoch: whole(prior?.landingEpoch) + 1, contestId: `admin:${randomUUID().replace(/-/g, '')}`,
        };
        await kv.set(coastClaimKey(sector), claim);
        if (prior) await destroyCoastLanding(prior, 'admin-granted', now);
        return { ok: true as const, claim };
    }, lockOptions);
}

/** Set when a held sector may next be declared on. A time in the past ends its protection now. */
export async function setCoastClaimImmunity(sector: number, immuneUntil: number): Promise<CoastClaim | null> {
    return withKvLock(COAST_LAND_LOCK, async () => {
        const claim = await readCoastClaim(sector);
        if (!claim) return null;
        const next: CoastClaim = { ...claim, immuneUntil: Math.max(0, Math.floor(immuneUntil)) };
        await kv.set(coastClaimKey(sector), next);
        return next;
    }, lockOptions);
}

/**
 * Take the War Supply a clan's coast sector has produced, and mark it paid.
 *
 * War Supply pays for clan buildings. A sector a clan held on the home map used
 * to produce it; clans hold land on the coast only now (api/_home-clan-territory.ts),
 * so the coast sector produces it instead, at the same rate: one day's worth for
 * each whole day held. The claim is advanced under the land lock before anything
 * is credited, so a failure after this can lose supply and can never pay it twice.
 * The caller credits the clan treasury (api/clan/territory/collect-supply.ts).
 */
/**
 * What a held sector has produced and not yet paid out: whole days only, counted from the last collection or, for
 * a sector never collected from, from the day it was taken. The one sum for the collection below and for the
 * figure a clan is shown (coastLandingView), so the screen never promises more than a collection pays. A Treasury
 * Vault's bonus is added by the collect route on top of this.
 */
export function coastClaimSupplyDue(claim: Pick<CoastClaim, 'since' | 'supplyAt'>, now: number): { days: number; supply: number; paidTo: number } {
    const base = Number.isFinite(Number(claim.supplyAt)) && Number(claim.supplyAt) > 0 ? Number(claim.supplyAt) : claim.since;
    const days = Math.max(0, Math.floor((now - base) / TERRITORY_SUPPLY_INTERVAL_MS));
    return { days, supply: days * TERRITORY_DAILY_WAR_SUPPLY, paidTo: base + days * TERRITORY_SUPPLY_INTERVAL_MS };
}

export async function collectCoastClaimSupply(clanName: string, now = Date.now()): Promise<{ collected: number; sector: number | null }> {
    const slug = clanBareSlug(clanName);
    if (!slug) return { collected: 0, sector: null };
    return withKvLock(COAST_LAND_LOCK, async () => {
        for (const sector of await coastKeys('coast:claim:')) {
            const claim = await readCoastClaim(sector);
            if (claim?.clanSlug !== slug || !(await holderLive(claim))) continue;
            const due = coastClaimSupplyDue(claim, now);
            if (due.days < 1) return { collected: 0, sector };
            await kv.set(coastClaimKey(sector), { ...claim, supplyAt: due.paidTo });
            return { collected: due.supply, sector };
        }
        return { collected: 0, sector: null };
    }, lockOptions);
}

/**
 * Choose the school a clan favours on the sector it holds.
 *
 * On the home map a clan chose one offense stat for a captured sector and its members' jutsu of that type hit 10%
 * harder there. Clans hold land on the coast only now (api/_home-clan-territory.ts), and the owner carried the
 * bonus over (2026-11-21). The rule is the home one: founder, leaders and officers choose, it can be changed at
 * any time, and it costs nothing. A fight seals the school it started with, so a change never moves a live fight.
 */
export async function setCoastClaimSchool(input: { playerName: string; sector: number; terrainBuffStat: unknown }): Promise<{ ok: true; claim: CoastClaim } | Refusal> {
    const stat = TERRITORY_BUFF_STATS.find(known => known === input.terrainBuffStat);
    if (!stat) return refuse(400, 'Choose Bukijutsu, Taijutsu, Ninjutsu or Genjutsu.');
    return changeHeldClaim(input, 'choose the school its ground favours', claim => ({ ...claim, terrainBuffStat: stat }));
}

/** What an officer may set the sky over a held sector to. `scheduled` gives it back to the coast's own weather. */
export const COAST_CLAIM_WEATHER: readonly (SectorWeather | 'scheduled')[] = ['scheduled', ...Object.keys(WEATHER_ELEMENTS) as SectorWeather[]];

/**
 * Fix the weather over the sector a clan holds, or hand it back to the schedule.
 *
 * On the home map a holding clan stamped one sky on its sector, and that sky held until the clan changed it or
 * lost the ground. The owner carried it to the coast with the school (2026-11-21, "Yes, add both"). The rule is
 * the home one: founder, leaders and officers choose, at any time, at no cost. A stamped sky is a combat modifier
 * a clan picks for its own element, so a fight only gets it where the server has placed that fight on the sector
 * (api/_sector-weather-seal.ts); and like the school it goes when the sector changes hands.
 */
export async function setCoastClaimWeather(input: { playerName: string; sector: number; weather: unknown }): Promise<{ ok: true; claim: CoastClaim } | Refusal> {
    const weather = COAST_CLAIM_WEATHER.find(known => known === input.weather);
    if (!weather) return refuse(400, 'Choose a listed weather, or the scheduled sky.');
    return changeHeldClaim(input, 'fix the weather over its ground', ({ weather: _dropped, ...claim }) => (weather === 'scheduled' ? claim : { ...claim, weather }));
}

/** One change to a held claim by an officer of the clan that holds it, under the land lock. */
async function changeHeldClaim(
    input: { playerName: string; sector: number }, deed: string, change: (claim: CoastClaim) => CoastClaim,
): Promise<{ ok: true; claim: CoastClaim } | Refusal> {
    const player = safeName(input.playerName), sector = Math.floor(Number(input.sector));
    if (!isContestableCoastSector(sector)) return refuse(400, 'That ground cannot be held.');
    return withKvLock(COAST_LAND_LOCK, async () => {
        const save = await kv.get<Record<string, unknown>>(`save:${player}`);
        const character = (save?.character ?? {}) as Record<string, unknown>;
        const clan = await loadClan(String(character.clan ?? ''));
        const claim = await readCoastClaim(sector);
        if (!clan || !claim || claim.clanSlug !== clan.slug || !(await holderLive(claim))) return refuse(403, 'Your clan does not hold that ground.');
        if (!clanLeadershipRole(clan.record, player)) return refuse(403, `Only a clan's founder, leaders and officers can ${deed}.`);
        const next = change(claim);
        if (next.terrainBuffStat !== claim.terrainBuffStat || next.weather !== claim.weather) await kv.set(coastClaimKey(sector), next);
        return { ok: true as const, claim: next };
    }, lockOptions);
}

/**
 * The sky a holding clan has fixed over a sector, in the shape the shared weather schedule takes an override in
 * (shared/sector-weather.ts). Null on ground that is not held, whose holder is gone, or whose holder has left
 * the sky to the schedule.
 */
export async function coastWeatherStamp(sector: number): Promise<{ ownerClan: string; weather: SectorWeather } | null> {
    if (!isContestableCoastSector(sector)) return null;
    const claim = await readCoastClaim(sector);
    if (!claim?.weather || !Object.hasOwn(WEATHER_ELEMENTS, claim.weather) || !(await holderLive(claim))) return null;
    return { ownerClan: claim.clan, weather: claim.weather };
}

/**
 * The school a sector's holder favours, and whose members it favours. Null on ground that is not held, whose
 * holder is gone, or whose holder has chosen no school. Read when a fight on the sector is sealed: a player fight
 * (api/pvp/session.ts) and an AI fight (api/missions/ai-fight-start.ts) both ask here, so the two cannot differ.
 */
export async function coastHomeSchool(sector: number): Promise<{ clanSlug: string; school: string } | null> {
    if (!isContestableCoastSector(sector)) return null;
    const claim = await readCoastClaim(sector);
    const school = terrainBuffStatToJutsuType(claim?.terrainBuffStat);
    if (!claim || !school || !(await holderLive(claim))) return null;
    return { clanSlug: claim.clanSlug, school };
}

/** The school that favours this saved player on this sector, or '' when none does. */
export async function coastHomeSchoolFor(sector: unknown, save: Record<string, unknown> | null | undefined): Promise<string> {
    const home = await coastHomeSchool(Math.floor(Number(sector)));
    const character = (save?.character ?? {}) as Record<string, unknown>;
    return home && clanBareSlug(String(character.clan ?? '')) === home.clanSlug ? home.school : '';
}

/**
 * The claim on one sector, if the clan that holds it still exists as the generation that took it. One read of
 * the claim, where liveCoastClaimOf lists every claim on the coast: for callers that already know the sector.
 */
export async function liveCoastClaimAt(sector: number): Promise<CoastClaim | null> {
    if (!isContestableCoastSector(sector)) return null;
    const claim = await readCoastClaim(sector);
    return claim && await holderLive(claim) ? claim : null;
}

/** The sector a clan holds right now, if it still exists as the generation that took it. */
export async function liveCoastClaimOf(clanName: string): Promise<CoastClaim | null> {
    const slug = clanBareSlug(clanName);
    if (!slug) return null;
    for (const sector of await coastKeys('coast:claim:')) {
        const claim = await readCoastClaim(sector);
        if (claim?.clanSlug === slug && await holderLive(claim)) return claim;
    }
    return null;
}

/**
 * A clan is dissolving: everything it holds or has posted on the coast goes
 * with it, and so does its generation, so the next clan under that name starts
 * with nothing. Safe to run again.
 */
export async function releaseCoastHoldingsForClan(clanName: string): Promise<{ claims: number; contests: number }> {
    const slug = clanBareSlug(clanName);
    if (!slug) return { claims: 0, contests: 0 };
    return withKvLock(COAST_LAND_LOCK, async () => {
        let claims = 0, contests = 0;
        for (const sector of await coastKeys('coast:claim:')) {
            if ((await readCoastClaim(sector))?.clanSlug === slug) { await kv.del(coastClaimKey(sector)); claims += 1; }
        }
        // The Landing row goes entirely: there is no clan left for its receipts to answer to.
        await deleteCoastLanding(slug);
        for (const sector of await coastKeys('coast:contest:')) {
            // Under the contest's own key too, so a garrison win landing now cannot write the row back.
            contests += await withKvLock(coastContestKey(sector), async () => {
                const contest = await readCoastContest(sector);
                if (contest?.clanSlug !== slug) return 0;
                await archive(contest, 'void', Date.now());
                return 1;
            }, lockOptions);
        }
        await kv.del(coastClanGenerationKey(slug));
        return { claims, contests };
    }, lockOptions);
}
