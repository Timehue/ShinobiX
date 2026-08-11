/*
 * Ranked seasons — monthly competitive cycle for the two ranked ladders
 * (player PvP rankedRating + pet petRankedRating).
 *
 * A "season" is just the live ladder rating wrapped in a clock. At the end of
 * each ~30-day window the rollover job:
 *   1. ranks every player on each ladder,
 *   2. rewards the top 3 of each ladder (champion gets a Warforged Relic + aura
 *      stones and a rankedSeasonsWon bump → the "Season Champion" achievement;
 *      2nd/3rd get aura stones),
 *   3. archives the final standings for the Hall of Legends "last season" view,
 *   4. SOFT-resets every played rating toward the 1000 default so the next
 *      season re-sorts fast without a full grind-from-scratch.
 *
 * Lifetime rankedWins / rankedLosses are NOT touched — only the ladder rating
 * resets, so lifetime stats + the clan-power board are unaffected.
 *
 * Pure helpers (rating math, podium selection, clock advance) are split out and
 * unit-tested; the runner fences admission with a persistent epoch and commits
 * each save through exact full-record CAS.
 */
import { isDeepStrictEqual } from 'node:util';
import { kv, type KvLike } from '../_storage.js';
import { mergePreservingImages } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { DEFAULT_RANKED_RATING } from '../_ranked-rating.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { commitPetRankedStartingPair } from '../pet/_ranked-engine.js';
import {
    getPetRankedJournal,
    listPendingPetRankedJournals,
} from '../pet/_ranked-journal.js';
import {
    cancelNonterminalPlayerRankedAdmissions,
    closePetRankedSeasonGate,
    completePlayerRankedAdmission,
    completePetRankedPreparation,
    ensurePetRankedSeasonGate,
    loadPetRankedPreparation,
    readPetRankedSeasonGateFresh,
    reopenPetRankedSeasonGate,
    type PetRankedPreparation,
    type PetRankedSeasonGate,
} from '../pet/_ranked-preparation.js';
import {
    settlePetRankedMatchDurably,
    type PetRankedLockRunner,
} from '../pet/_ranked-settlement.js';
import { hasRecentIpOrFpOverlapStrict } from '../_player-ips.js';
import type { PvpSession } from '../pvp/session.js';
import { SESSION_TTL } from '../combat-core/constants.js';
import {
    getPlayerRankedJournal,
    listPendingPlayerRankedJournals,
    recordCancelledPlayerRankedAdmission,
    settlePlayerRankedJournal,
} from '../pvp/_player-ranked-journal.js';
import { confirmPlayerRankedTerminalEffects } from '../pvp/_ranked-terminal-effects.js';
import { hasDurableVanguardTerminalOutcome } from '../pvp/_vanguard-rewards.js';
import {
    boundExactPvpSession,
    fencePlayerRankedSessionForClose,
} from '../pvp/_session-mutation.js';

const SAVE_PREFIX = 'save:';
export const SEASON_CURRENT_KEY = 'ranked:season:current';
export const SEASON_ARCHIVE_PREFIX = 'ranked:season:archive:';
export const SEASON_PLAN_PREFIX = 'ranked:season:plan:';
// Legacy pre-receipt once-marker. Kept exported so old rows/tools remain
// understandable; new settlements use the in-save receipt below.
export const SEASON_REWARDED_PREFIX = 'ranked:season:rewarded:';
export const SEASON_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;
const ARCHIVE_TTL_SECONDS = 400 * 24 * 60 * 60;
export const SEASON_SETTLEMENT_RECEIPTS_FIELD = 'rankedSeasonSettlementReceipts';
const MAX_SEASON_SETTLEMENT_RECEIPTS = 16;
const MAX_PARALLEL = 8;

// Reward table. Champion (#1) of each ladder gets the relic; the whole podium
// gets aura stones by placement. The Warforged Relic ("war material") is
// normally war-crate-only, so it's a meaningful prestige drop.
export const CHAMPION_RELIC_ID = 'warforged-relic';
export const PODIUM_AURA_STONES = [10, 6, 3] as const;

export type RankedSeason = { id: number; startedAt: number; endsAt: number };
export type LadderEntry = { slug: string; name: string; village?: string; rating: number };
export type RankedLadder = 'player' | 'pet';
type RankedEntry = LadderEntry & { rank: number };
type RankedSeasonPlan = {
    seasonId: number;
    createdAt: number;
    playerSlugs: string[];
    playerTop: RankedEntry[];
    petTop: RankedEntry[];
    playerPodium: RankedEntry[];
    petPodium: RankedEntry[];
    expectedResetCount: number;
    expectedRewardedCount: number;
};

function rankedSeasonPlan(value: unknown, seasonId: number): RankedSeasonPlan | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const plan = value as Partial<RankedSeasonPlan> & Record<string, unknown>;
    const exactKeys = Object.keys(plan).sort().join('|') === [
        'seasonId', 'createdAt', 'playerSlugs', 'playerTop', 'petTop',
        'playerPodium', 'petPodium', 'expectedResetCount', 'expectedRewardedCount',
    ].sort().join('|');
    if (!exactKeys
        || plan.seasonId !== seasonId
        || !Number.isSafeInteger(plan.createdAt)
        || Number(plan.createdAt) <= 0
        || !Array.isArray(plan.playerSlugs)
        || plan.playerSlugs.length > 1_000_000
        || !plan.playerSlugs.every((slug) => typeof slug === 'string' && slug.length > 0 && slug.length <= 80)
        || new Set(plan.playerSlugs).size !== plan.playerSlugs.length
        || !Array.isArray(plan.playerTop)
        || !Array.isArray(plan.petTop)
        || !Array.isArray(plan.playerPodium)
        || !Array.isArray(plan.petPodium)
        || !Number.isSafeInteger(plan.expectedResetCount)
        || Number(plan.expectedResetCount) < 0
        || Number(plan.expectedResetCount) > plan.playerSlugs.length
        || !Number.isSafeInteger(plan.expectedRewardedCount)
        || Number(plan.expectedRewardedCount) < 0
        || Number(plan.expectedRewardedCount) > Math.min(6, plan.playerSlugs.length)) return null;

    const slugSet = new Set(plan.playerSlugs);
    const validEntries = (entries: unknown[], max: number) => entries.length <= max
        && entries.every((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
            const record = entry as Record<string, unknown>;
            const keys = Object.keys(record).sort().join('|');
            if (keys !== 'name|rank|rating|slug' && keys !== 'name|rank|rating|slug|village') return false;
            return typeof record.slug === 'string'
                && slugSet.has(record.slug)
                && typeof record.name === 'string'
                && record.name.length > 0
                && record.name.length <= 80
                && (record.village === undefined
                    || (typeof record.village === 'string' && record.village.length <= 80))
                && typeof record.rating === 'number'
                && Number.isFinite(record.rating)
                && Number(record.rating) >= 0
                && record.rank === index + 1;
        });
    if (!validEntries(plan.playerTop, 10)
        || !validEntries(plan.petTop, 10)
        || !validEntries(plan.playerPodium, 3)
        || !validEntries(plan.petPodium, 3)) return null;
    return plan as RankedSeasonPlan;
}

/** Soft reset: pull a rating halfway back to the default, floored at 0. */
export function softResetRating(rating: unknown, def: number = DEFAULT_RANKED_RATING): number {
    const r = Number(rating);
    const base = Number.isFinite(r) ? r : def;
    return Math.max(0, Math.round(def + (base - def) * 0.5));
}

/** Sorted top-N standings (for the archive / display). Highest rating first. */
export function leaderboard(entries: LadderEntry[], n: number): (LadderEntry & { rank: number })[] {
    return [...entries]
        .sort((a, b) => b.rating - a.rating || a.slug.localeCompare(b.slug))
        .slice(0, n)
        .map((e, i) => ({ ...e, rank: i + 1 }));
}

/**
 * Reward podium: the top 3 who actually CLIMBED this season (rating above the
 * default — you can't be #1 sitting at 1000). Returns at most 3, ranked.
 */
export function rewardPodium(entries: LadderEntry[], def: number = DEFAULT_RANKED_RATING): (LadderEntry & { rank: number })[] {
    return [...entries]
        .filter((e) => e.rating > def)
        .sort((a, b) => b.rating - a.rating || a.slug.localeCompare(b.slug))
        .slice(0, 3)
        .map((e, i) => ({ ...e, rank: i + 1 }));
}

/** Advance the season clock. New window starts where the old one ended. */
export function nextSeason(current: RankedSeason | null, now: number): RankedSeason {
    const id = (current?.id ?? 0) + 1;
    const startedAt = current?.endsAt && current.endsAt <= now ? current.endsAt : now;
    return { id, startedAt, endsAt: startedAt + SEASON_LENGTH_MS };
}

/** Per-player reward computed from both ladders' podiums (aggregated). */
export type SeasonReward = { auraStones: number; relics: number; championOf: RankedLadder[] };

export function computeRewards(
    playerPodium: (LadderEntry & { rank: number })[],
    petPodium: (LadderEntry & { rank: number })[],
): Map<string, SeasonReward> {
    const rewards = new Map<string, SeasonReward>();
    const add = (slug: string, aura: number, champion: RankedLadder | null) => {
        const cur = rewards.get(slug) ?? { auraStones: 0, relics: 0, championOf: [] };
        cur.auraStones += aura;
        if (champion) { cur.relics += 1; cur.championOf.push(champion); }
        rewards.set(slug, cur);
    };
    for (const e of playerPodium) add(e.slug, PODIUM_AURA_STONES[e.rank - 1] ?? 0, e.rank === 1 ? 'player' : null);
    for (const e of petPodium) add(e.slug, PODIUM_AURA_STONES[e.rank - 1] ?? 0, e.rank === 1 ? 'pet' : null);
    return rewards;
}

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function seasonSettlementReceipts(character: Record<string, unknown>): number[] {
    const raw = character[SEASON_SETTLEMENT_RECEIPTS_FIELD];
    if (!Array.isArray(raw)) return [];
    return raw
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value > 0)
        .slice(-MAX_SEASON_SETTLEMENT_RECEIPTS);
}

export type RankedCharacterSettlement = {
    character: Record<string, unknown>;
    changed: boolean;
    resetApplied: boolean;
    rewardApplied: boolean;
};

/** Apply one player's reset and payout atomically with an in-save season receipt. */
export function settleRankedSeasonCharacter(
    character: Record<string, unknown>,
    seasonId: number,
    reward?: SeasonReward,
): RankedCharacterSettlement {
    const receipts = seasonSettlementReceipts(character);
    if (receipts.includes(seasonId)) {
        return { character, changed: false, resetApplied: false, rewardApplied: false };
    }

    const oldP = num(character.rankedRating ?? DEFAULT_RANKED_RATING);
    const oldPet = num(character.petRankedRating ?? DEFAULT_RANKED_RATING);
    const newP = softResetRating(oldP);
    const newPet = softResetRating(oldPet);
    const resetApplied = newP !== oldP || newPet !== oldPet;
    const rewardApplied = !!reward;
    if (!resetApplied && !rewardApplied) {
        return { character, changed: false, resetApplied: false, rewardApplied: false };
    }

    const next: Record<string, unknown> = {
        ...character,
        rankedRating: newP,
        petRankedRating: newPet,
        [SEASON_SETTLEMENT_RECEIPTS_FIELD]: [...receipts, seasonId].slice(-MAX_SEASON_SETTLEMENT_RECEIPTS),
    };
    if (reward) {
        if (reward.auraStones > 0) next.auraStones = num(character.auraStones) + reward.auraStones;
        if (reward.relics > 0) {
            const inventory = Array.isArray(character.inventory) ? character.inventory as unknown[] : [];
            next.inventory = [...inventory, ...Array(reward.relics).fill(CHAMPION_RELIC_ID)];
            next.rankedSeasonsWon = num(character.rankedSeasonsWon) + reward.championOf.length;
        }
    }
    return { character: next, changed: true, resetApplied, rewardApplied };
}

export type SeasonRolloverResult = {
    ok: boolean;
    // 'inactive' = ranked seasons not started yet (admin must start them).
    action: 'initialized' | 'pending' | 'rolled-over' | 'skipped' | 'inactive';
    seasonId?: number;
    nextSeasonId?: number;
    playerChampion?: string;
    petChampion?: string;
    resetCount?: number;
    rewardedCount?: number;
    error?: string;
};

/**
 * Start ranked seasons (admin action). Initialises season 1 if no season exists
 * yet; a no-op if one is already active. Ranked seasons do NOT auto-start — an
 * admin kicks them off from the Admin Panel.
 */
export type RankedSeasonStore = Pick<
    KvLike,
    'get' | 'set' | 'compareSet' | 'del' | 'delIfEqual' | 'keys'
>;

const unlockedRankedLock: PetRankedLockRunner = async <T>(
    _key: string,
    action: () => Promise<T>,
): Promise<T> => action();

const productionRankedLock: PetRankedLockRunner = <T>(
    key: string,
    action: () => Promise<T>,
): Promise<T> => withKvLock(key, action, { failClosed: true });

function validSeason(value: unknown): value is RankedSeason {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join('|') !== 'endsAt|id|startedAt') return false;
    return Number.isSafeInteger(record.id)
        && Number(record.id) > 0
        && Number.isSafeInteger(record.startedAt)
        && Number(record.startedAt) > 0
        && Number.isSafeInteger(record.endsAt)
        && Number(record.endsAt) > Number(record.startedAt);
}

async function readCurrentSeason(store: Pick<KvLike, 'get'>): Promise<RankedSeason | null> {
    const raw = await store.get<unknown>(SEASON_CURRENT_KEY);
    if (raw === null) return null;
    if (!validSeason(raw)) throw new Error('ranked-season-current-invalid');
    return raw;
}

async function compareSetWithReadback(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    key: string,
    expected: unknown | null,
    value: unknown,
): Promise<boolean> {
    try {
        return await store.compareSet(key, expected, value);
    } catch (error) {
        const recovered = await store.get<unknown>(key).catch(() => null);
        if (isDeepStrictEqual(recovered, value)) return true;
        throw error;
    }
}

async function putImmutable(
    store: Pick<KvLike, 'get' | 'set'>,
    key: string,
    value: unknown,
    ttlSeconds: number,
): Promise<void> {
    try {
        if (await store.set(key, value, { nx: true, ex: ttlSeconds }) === 'OK') return;
    } catch (error) {
        const recovered = await store.get<unknown>(key).catch(() => null);
        if (isDeepStrictEqual(recovered, value)) return;
        throw error;
    }
    if (isDeepStrictEqual(await store.get<unknown>(key), value)) return;
    throw new Error(`ranked-season-immutable-conflict:${key}`);
}

export async function startRankedSeasonWithStore(
    store: RankedSeasonStore,
    now: number = Date.now(),
): Promise<SeasonRolloverResult> {
    const current = await readCurrentSeason(store);
    if (current) {
        const gate = await readPetRankedSeasonGateFresh(store);
        if (!gate) await ensurePetRankedSeasonGate(store, current.id, now);
        else if (gate.state === 'open' && gate.seasonId !== current.id) {
            throw new Error('ranked-season-gate-current-conflict');
        }
        return { ok: true, action: 'skipped', seasonId: current.id };
    }
    const timestamp = Math.max(1, Math.floor(Number(now) || Date.now()));
    const season: RankedSeason = {
        id: 1,
        startedAt: timestamp,
        endsAt: timestamp + SEASON_LENGTH_MS,
    };
    const gate = await ensurePetRankedSeasonGate(store, season.id, timestamp);
    if (gate.state !== 'open'
        || gate.seasonId !== season.id
        || gate.admissions.length !== 0
        || gate.playerAdmissions.length !== 0) {
        throw new Error('ranked-season-initialization-blocked');
    }
    if (!await compareSetWithReadback(store, SEASON_CURRENT_KEY, null, season)) {
        const winner = await readCurrentSeason(store);
        if (!winner || !isDeepStrictEqual(winner, season)) throw new Error('ranked-season-start-conflict');
    }
    return { ok: true, action: 'initialized', seasonId: season.id };
}

export async function startRankedSeason(now: number = Date.now()): Promise<SeasonRolloverResult> {
    return startRankedSeasonWithStore(kv, now);
}

/**
 * Run a season rollover IF the current window has ended. Safe to call on every
 * daily cron tick — it no-ops (`inactive` until an admin starts seasons,
 * `pending` until the clock expires). The persistent transition gate and exact
 * CAS writes make overlapping/restarted runners idempotent; no long lease is
 * trusted for correctness. Does NOT auto-start a season.
 */
export async function runRankedSeasonRollover(now: number = Date.now()): Promise<SeasonRolloverResult> {
    return runRankedSeasonRolloverWithStore(kv, now, { lock: productionRankedLock });
}

/**
 * Force a rollover NOW regardless of the clock (admin action) — ends the current
 * season immediately (reward + archive + soft reset) and starts the next.
 * `inactive` if seasons haven't been started.
 */
export async function forceRankedSeasonRollover(now: number = Date.now()): Promise<SeasonRolloverResult> {
    return runRankedSeasonRolloverWithStore(kv, now, { force: true, lock: productionRankedLock });
}

/** Settle one durable admission before it can leave the closing gate. */
async function settlePreparedAdmission(
    store: RankedSeasonStore,
    preparation: PetRankedPreparation,
    lock: PetRankedLockRunner,
    now: number,
): Promise<void> {
    await lock(`pet-ranked-start:${preparation.matchId}`, async () => {
        const journal = await getPetRankedJournal(store, preparation.matchId);
        if (journal?.state !== 'completed') {
            const claimed = await commitPetRankedStartingPair(
                store,
                [preparation.a, preparation.b],
                preparation.matchId,
            );
            if (!claimed.ok) throw new Error(`pet-ranked-rollover-active-conflict:${claimed.conflictPlayer}`);
        }
        await settlePetRankedMatchDurably(store, {
            matchToken: preparation.matchId,
            token: preparation.token,
            lock,
            now,
        });
        await completePetRankedPreparation(store, preparation);
    });
}

/**
 * Admission is closed before this runs. Every gate preparation and every exact
 * pending journal is helped forward. The final empty reads are race-free
 * because close and reserve serialize on one exact-CAS season authority.
 */
async function drainRankedWork(
    store: RankedSeasonStore,
    closing: PetRankedSeasonGate,
    lock: PetRankedLockRunner,
    now: number,
): Promise<void> {
    for (let pass = 0; pass < 16; pass += 1) {
        const gate = await readPetRankedSeasonGateFresh(store);
        if (!gate
            || gate.state !== 'closing'
            || gate.seasonId !== closing.seasonId
            || gate.epoch !== closing.epoch
            || gate.transitionId !== closing.transitionId) {
            throw new Error('ranked-season-transition-authority-changed');
        }

        // A terminal session may have committed immediately before close while
        // its journal response/ack was lost. Help it publish before the
        // terminal-vs-no-contest gate CAS is decided.
        for (const admitted of gate.playerAdmissions) {
            if (admitted.phase !== 'active' || !admitted.battleId) continue;
            const sessionKey = `pvp:${admitted.battleId}`;
            const boundary = await fencePlayerRankedSessionForClose(
                store,
                admitted,
                String(closing.transitionId ?? ''),
                now,
            );
            if (boundary.status === 'terminal') {
                await confirmPlayerRankedTerminalEffects(store, boundary.session, {
                    now,
                    eligible: async (a, b) => !(await hasRecentIpOrFpOverlapStrict(a, b, store)),
                    lock,
                });
            }
        }

        // Anything that did not win terminalization is an explicit no-contest.
        const cancelled = await cancelNonterminalPlayerRankedAdmissions(store, closing, now);
        for (const admission of cancelled) {
            await recordCancelledPlayerRankedAdmission(store, admission);
        }

        const afterCancellation = await readPetRankedSeasonGateFresh(store);
        for (const admission of afterCancellation?.playerAdmissions ?? []) {
            if (admission.phase !== 'terminal') continue;
            if (!admission.battleId) throw new Error('player-ranked-terminal-battle-missing');
            const sessionKey = `pvp:${admission.battleId}`;
            const session = await store.get<PvpSession>(sessionKey);
            if (!session || session.status !== 'done') {
                const completed = await getPlayerRankedJournal(store, admission.matchId);
                if (!session
                    && completed?.state === 'completed'
                    && completed.confirmations.a
                    && completed.confirmations.b
                    && completed.items.a.confirmed
                    && completed.items.b.confirmed
                    && completed.terminal.battleId === admission.battleId
                    && completed.terminal.fingerprint === admission.terminalFingerprint
                    && await hasDurableVanguardTerminalOutcome(store, completed.terminal)) {
                    // Crash after exact TTL compaction but before gate removal:
                    // once that bounded row expires, absence is itself proof
                    // that no non-expiring session leaked. Finish the still-
                    // discoverable exact terminal admission.
                    await completePlayerRankedAdmission(store, admission);
                    continue;
                }
                throw new Error('player-ranked-terminal-session-unreadable');
            }
            // Publication may have committed before consumable settlement. Run
            // the full hook for already-terminal admissions on every restart;
            // Elo and compaction are forbidden until exact item receipts land.
            const journal = await confirmPlayerRankedTerminalEffects(store, session, {
                now,
                eligible: async (a, b) => !(await hasRecentIpOrFpOverlapStrict(a, b, store)),
                lock,
            });
            await settlePlayerRankedJournal(store, journal, now);
            await boundExactPvpSession(store, sessionKey, session, SESSION_TTL);
        }

        for (const journal of await listPendingPlayerRankedJournals(store)) {
            await settlePlayerRankedJournal(store, journal, now);
        }

        for (const admitted of gate.admissions) {
            const preparation = await loadPetRankedPreparation(store, admitted.matchId);
            if (!preparation || !isDeepStrictEqual(preparation, admitted)) {
                throw new Error('ranked-season-preparation-unreadable');
            }
            await settlePreparedAdmission(store, preparation, lock, now);
        }

        // Older pending journals can outlive their mirrored preparation. They
        // still embed the immutable token and must resolve before the snapshot.
        const pending = await listPendingPetRankedJournals(store);
        for (const journal of pending) {
            await settlePetRankedMatchDurably(store, {
                matchToken: journal.matchId,
                token: journal.token,
                lock,
                now,
            });
            const preparation = await loadPetRankedPreparation(store, journal.matchId);
            if (preparation) await completePetRankedPreparation(store, preparation);
        }

        const verifiedGate = await readPetRankedSeasonGateFresh(store);
        const verifiedPending = await listPendingPetRankedJournals(store);
        if (verifiedGate?.state === 'closing'
            && verifiedGate.seasonId === closing.seasonId
            && verifiedGate.epoch === closing.epoch
            && verifiedGate.admissions.length === 0
            && verifiedGate.playerAdmissions.length === 0
            && verifiedPending.length === 0
            && (await listPendingPlayerRankedJournals(store)).length === 0) {
            return;
        }
    }
    throw new Error('ranked-season-drain-busy');
}

async function applySeasonSettlement(
    store: RankedSeasonStore,
    slug: string,
    seasonId: number,
    reward: SeasonReward | undefined,
): Promise<void> {
    const key = `${SAVE_PREFIX}${slug}`;
    for (let attempt = 0; attempt < 24; attempt += 1) {
        const record = await store.get<Record<string, unknown>>(key);
        const character = (record?.character ?? null) as Record<string, unknown> | null;
        if (!record || !character) throw new Error(`ranked-season-plan-save-unreadable:${slug}`);
        const settlement = settleRankedSeasonCharacter(character, seasonId, reward);
        if (!settlement.changed) return;
        const updated = mergePreservingImages(
            bumpSaveVersion({ ...record, character: settlement.character }),
            record,
        ) as Record<string, unknown>;
        try {
            if (await store.compareSet(key, record, updated)) return;
        } catch (error) {
            // The exact intended bytes may already have been followed by an
            // unrelated save mutation. The embedded receipt is the authority
            // for a commit whose acknowledgement was lost.
            const recovered = await store.get<Record<string, unknown>>(key).catch(() => null);
            const recoveredCharacter = (recovered?.character ?? null) as Record<string, unknown> | null;
            if (recoveredCharacter && seasonSettlementReceipts(recoveredCharacter).includes(seasonId)) return;
            throw error;
        }
    }
    throw new Error(`ranked-season-save-cas-busy:${slug}`);
}

async function performDurableRollover(
    store: RankedSeasonStore,
    fresh: RankedSeason,
    now: number,
    lock: PetRankedLockRunner,
): Promise<SeasonRolloverResult> {
    const closing = await closePetRankedSeasonGate(store, fresh.id, now);
    await drainRankedWork(store, closing, lock, now);

    const saveKeys = await store.keys(`${SAVE_PREFIX}*`);
    const playerKeys = saveKeys.filter((key) => {
        const name = key.slice(SAVE_PREFIX.length);
        return !name.startsWith('Admin ') && name !== 'Rill';
    });
    const playerLadder: LadderEntry[] = [];
    const petLadder: LadderEntry[] = [];
    for (let i = 0; i < playerKeys.length; i += MAX_PARALLEL) {
        const slice = playerKeys.slice(i, i + MAX_PARALLEL);
        const records = await Promise.all(
            slice.map((key) => store.get<Record<string, unknown>>(key)),
        );
        records.forEach((record, index) => {
            const character = (record?.character ?? null) as Record<string, unknown> | null;
            if (!record || !character) {
                throw new Error(`ranked-season-snapshot-save-unreadable:${playerKeys[i + index]}`);
            }
            const slug = playerKeys[i + index].slice(SAVE_PREFIX.length);
            const name = typeof character.name === 'string' ? character.name : slug;
            const village = typeof character.village === 'string' ? character.village : undefined;
            playerLadder.push({ slug, name, village, rating: num(character.rankedRating ?? DEFAULT_RANKED_RATING) });
            petLadder.push({ slug, name, village, rating: num(character.petRankedRating ?? DEFAULT_RANKED_RATING) });
        });
        if (i + MAX_PARALLEL < playerKeys.length) await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const planKey = `${SEASON_PLAN_PREFIX}${fresh.id}`;
    const rawStoredPlan = await store.get<unknown>(planKey);
    const storedPlan = rawStoredPlan === null ? null : rankedSeasonPlan(rawStoredPlan, fresh.id);
    if (rawStoredPlan !== null && !storedPlan) throw new Error('ranked-season-plan-invalid');
    const computedPlayerPodium = rewardPodium(playerLadder);
    const computedPetPodium = rewardPodium(petLadder);
    const computedRewards = computeRewards(computedPlayerPodium, computedPetPodium);
    const petRatingBySlug = new Map(petLadder.map((entry) => [entry.slug, entry.rating]));
    const plan: RankedSeasonPlan = storedPlan ?? {
        seasonId: fresh.id,
        // Persisted close time makes forced rollover deterministic on restart.
        createdAt: closing.changedAt,
        playerSlugs: playerLadder.map((entry) => entry.slug).sort(),
        playerTop: leaderboard(playerLadder, 10),
        petTop: leaderboard(petLadder, 10),
        playerPodium: computedPlayerPodium,
        petPodium: computedPetPodium,
        expectedResetCount: playerLadder.filter((entry) => (
            softResetRating(entry.rating) !== entry.rating
            || softResetRating(petRatingBySlug.get(entry.slug)) !== petRatingBySlug.get(entry.slug)
        )).length,
        expectedRewardedCount: computedRewards.size,
    };
    if (!storedPlan) await putImmutable(store, planKey, plan, ARCHIVE_TTL_SECONDS);

    const archive = {
        id: fresh.id,
        endedAt: plan.createdAt,
        player: plan.playerTop.map((entry) => ({
            name: entry.name,
            village: entry.village,
            rating: entry.rating,
            rank: entry.rank,
        })),
        pet: plan.petTop.map((entry) => ({
            name: entry.name,
            village: entry.village,
            rating: entry.rating,
            rank: entry.rank,
        })),
    };
    await putImmutable(store, `${SEASON_ARCHIVE_PREFIX}${fresh.id}`, archive, ARCHIVE_TTL_SECONDS);

    const rewards = computeRewards(plan.playerPodium, plan.petPodium);
    const failedSlugs: string[] = [];
    for (let i = 0; i < plan.playerSlugs.length; i += MAX_PARALLEL) {
        const slice = plan.playerSlugs.slice(i, i + MAX_PARALLEL);
        await Promise.all(slice.map(async (slug) => {
            try {
                await applySeasonSettlement(store, slug, fresh.id, rewards.get(slug));
            } catch (error) {
                failedSlugs.push(slug);
                console.error('[ranked-season] rollover apply failed', slug, error);
            }
        }));
        if (i + MAX_PARALLEL < plan.playerSlugs.length) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (failedSlugs.length > 0) {
        return {
            ok: false,
            action: 'skipped',
            seasonId: fresh.id,
            error: `${failedSlugs.length} player settlement(s) failed; transition remains closed for retry.`,
        };
    }

    const next = nextSeason(fresh, closing.changedAt);
    if (!await compareSetWithReadback(store, SEASON_CURRENT_KEY, fresh, next)) {
        const winner = await readCurrentSeason(store);
        if (!winner || !isDeepStrictEqual(winner, next)) throw new Error('ranked-season-advance-conflict');
    }
    await reopenPetRankedSeasonGate(store, fresh.id, next.id, now);

    await store.set(`audit:ranked-season:${fresh.id}`, {
        ts: plan.createdAt,
        endedSeason: fresh.id,
        nextSeason: next.id,
        playerChampion: plan.playerPodium[0]?.name,
        petChampion: plan.petPodium[0]?.name,
        resetCount: plan.expectedResetCount,
        rewardedCount: plan.expectedRewardedCount,
    }, { ex: ARCHIVE_TTL_SECONDS }).catch(() => null);
    await store.del(planKey).catch(() => 0);

    return {
        ok: true,
        action: 'rolled-over',
        seasonId: fresh.id,
        nextSeasonId: next.id,
        playerChampion: plan.playerPodium[0]?.name,
        petChampion: plan.petPodium[0]?.name,
        resetCount: plan.expectedResetCount,
        rewardedCount: plan.expectedRewardedCount,
    };
}

async function runRolloverCore(
    store: RankedSeasonStore,
    now: number,
    force: boolean,
    lock: PetRankedLockRunner,
): Promise<SeasonRolloverResult> {
    const current = await readCurrentSeason(store);
    if (!current) return { ok: true, action: 'inactive' };
    let gate = await readPetRankedSeasonGateFresh(store);
    if (!gate) gate = await ensurePetRankedSeasonGate(store, current.id, now);

    // Recover a crash after advancing current but before reopening admission.
    if (gate.state === 'closing' && gate.nextSeasonId === current.id) {
        if (gate.admissions.length !== 0 || gate.playerAdmissions.length !== 0) {
            throw new Error('ranked-season-advanced-with-pending-admissions');
        }
        if ((await listPendingPetRankedJournals(store)).length !== 0) {
            throw new Error('ranked-season-advanced-with-pending-journals');
        }
        if ((await listPendingPlayerRankedJournals(store)).length !== 0) {
            throw new Error('ranked-season-advanced-with-pending-player-journals');
        }
        await reopenPetRankedSeasonGate(store, gate.seasonId, current.id, now);
        return { ok: true, action: 'skipped', seasonId: current.id };
    }
    if (gate.seasonId !== current.id) throw new Error('ranked-season-gate-current-conflict');
    if (gate.state === 'open' && !force && now < current.endsAt) {
        return { ok: true, action: 'pending', seasonId: current.id };
    }
    // Persisted close is itself authority to resume, regardless of the latest
    // invocation's force flag or wall-clock relationship to endsAt.
    return performDurableRollover(store, current, now, lock);
}

export async function runRankedSeasonRolloverWithStore(
    store: RankedSeasonStore,
    now: number = Date.now(),
    options: { force?: boolean; lock?: PetRankedLockRunner } = {},
): Promise<SeasonRolloverResult> {
    try {
        return await runRolloverCore(
            store,
            now,
            options.force === true,
            options.lock ?? unlockedRankedLock,
        );
    } catch (error) {
        return {
            ok: false,
            action: 'skipped',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
