import { SHOWDOWN_DAILY_WIN_CAP } from '../../shared/pet-showdown-contract.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { creditRankedOutcome } from '../_ranked-rating.js';
import { resolveRankedPetDuel } from './_ranked-duel.js';
import { replayCasualPetDuel, parseDuelInputLog } from './_duel-replay.js';
import type { SealedDuelParams } from './_duel-replay.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import {
    type WfBuyPolicy,
    type WfDoctrine,
    type WfStance,
} from '../_pet-sim/pet-warfront-sim.js';
import {
    RITE_BAND_SIZE,
    isValidRitePlan,
    runWarfrontRite,
    type RitePlan,
} from '../_pet-sim/pet-warfront-rite.js';
import type { WfTheme } from '../_pet-sim/pet-warfront-map.js';
import { writeSaveProjected } from '../save/_projected-write.js';
import { bumpLegacyStats, legacyBootstrapBeforeCounterIncrement } from '../_legacy-track.js';
import { petWitnessReceiptForSettlement, recordPetArenaVictory } from '../card-clash/_pet-witness.js';
import { casualPvePetSnapshot, parseCasualPveBattleSeal, parseSealedPetSnapshots, type CasualPveBattleSeal } from './_casual-pve-seal.js';
import { removePetItem } from './_progress.js';
import { applyDungeonPetTerminal } from '../dungeon/_encounter-proof.js';
import {
    DUNGEON_PET_RESULT_TTL_SECONDS,
    DUNGEON_RARE_BEAST_ID,
    buildDungeonRareBeast,
    dungeonPetResultKey,
    parseDungeonPetBattleBinding,
    parseDungeonPetResultReceipt,
    type DungeonPetBattleBinding,
    type DungeonPetResultReceipt,
} from './_dungeon-battle.js';
import {
    PET_RANKED_ACTIVE_REGISTRY_KEY,
    PET_RANKED_QUEUE_KEY,
    PET_RANKED_TOKEN_TTL_SECONDS,
    isRankedPetMatchToken,
    isRankedPetSettlementIntent,
    petRankedSettlementIntentKey,
    petRankedStartClaimKey,
    pruneRankedPetActiveRegistry,
    type RankedPetMatchToken,
    type RankedPetSettlementIntent,
} from './_ranked-authority.js';
import {
    HOLLOW_GATE_PET_AUTHORITY_VERSION,
    hollowGateCombatBindingKey,
    hollowGatePetAuthorityMatches,
    hollowGatePetReceiptMatchesBinding,
    parseHollowGatePetResultReceipt,
    type HollowGateCombatBinding,
    type HollowGatePetResultReceipt,
} from '../hollow-gate/_combat-session.js';
import {
    hollowGatePetResultKey,
    retireHollowGatePetChildLease,
    writeHollowGatePetResult,
} from '../hollow-gate/_pet-authority.js';

// Pet Arena reward recorder. Non-ranked wins require a short-lived start token
// minted by /api/pet/battle-start for the same reportKey. The battle is still
// client-resolved, but bare result-only reward posts no longer pay out.

const ARENA_WIN_RATE_LIMIT = 5_000;   // ms — one win per 5s per player
// The faucet ceiling lives in the shared contract so the server, the arena
// entry and the lobby copy all read one number.
const DAILY_ARENA_WIN_CAP = SHOWDOWN_DAILY_WIN_CAP;
// In-save receipt window. Derived from the cap so it is never narrower than the
// faucet it records: a hardcoded width silently becomes too small the day
// someone raises DAILY_ARENA_WIN_CAP. (Twin constant in pet/showdown.ts — the
// two share the array.)
const RECEIPT_HISTORY = Math.max(64, DAILY_ARENA_WIN_CAP);
// Durable receipt lifetime. Must outlast anything that can still be presented
// for payment — a battle token leases 15 minutes, a Showdown session 45 — with
// room to spare on both.
const PAID_RECEIPT_TTL_SECONDS = 24 * 60 * 60;
// Ranked-rating credit receipt window. A stale tab re-reporting hours later
// must not re-apply the Elo swing. Matches the 24h receipt in pvp/claim-rewards.ts.
const RANKED_RECEIPT_TTL_SECONDS = 24 * 60 * 60;
// Cheap unauthenticated flood shield. It is intentionally IP-only: a body name
// is attacker-controlled until auth succeeds and must never spend that player's
// settlement budget.
const PREAUTH_RESULT_RATE_LIMIT = 120;
const RANKED_RESULT_RECEIPT_TTL_SECONDS = 24 * 60 * 60;
// The dedicated 24-hour result receipt is the primary lost-response authority.
// This bounded in-save history is also a durable fallback while its entry is
// retained, including enough outcome evidence to resume winner-only side effects
// if the shared receipt store stays unavailable until the short proof expires.
const RANKED_SAVE_RECEIPT_CAP = 256;
// Warfront settlement must follow the battle the player actually commanded,
// not the automatic baseline sealed at kickoff. Keep the same anti-seed-oracle
// floor and small playback skew as the start route.
const WARFRONT_MIN_SETTLE_MS = 60_000;
const WARFRONT_SETTLE_CLOCK_SKEW_MS = 5_000;

/**
 * The Hollow Warfront Rite transcript, straight off an untrusted request body.
 *
 * The plan is the ONLY thing the client contributes to the replay — the bands,
 * the seed and the AI's own order all come from the sealed token — so this has
 * to reject anything that is not a genuine batting order. Omission retains the
 * sealed automatic baseline; a present but rejected transcript is a 400 so a
 * client can never settle a different fight than the one it displayed.
 */
function parseWarfrontRitePlan(raw: unknown): RitePlan | null {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw as {
        formation?: unknown;
        deployment?: unknown;
        reformAfterClash?: unknown;
        reform?: unknown;
        reformDeployment?: unknown;
        reforms?: unknown;
    };
    if (!Array.isArray(source.formation)) return null;
    const formation = source.formation.map((value) => Number(value));
    const deployment = Array.isArray(source.deployment) ? source.deployment.map((value) => Number(value)) : undefined;
    const atRaw = source.reformAfterClash;
    const reformAfterClash = atRaw === null || atRaw === undefined ? null : Number(atRaw);
    if (reformAfterClash !== null && !Number.isInteger(reformAfterClash)) return null;
    const reform = Array.isArray(source.reform) ? source.reform.map((value) => Number(value)) : null;
    const reformDeployment = Array.isArray(source.reformDeployment)
        ? source.reformDeployment.map((value) => Number(value))
        : null;
    let reforms: RitePlan["reforms"];
    if (source.reforms !== undefined) {
        if (!Array.isArray(source.reforms)) return null;
        reforms = [];
        for (const rawReform of source.reforms) {
            if (!rawReform || typeof rawReform !== 'object') return null;
            const entry = rawReform as { afterClash?: unknown; formation?: unknown; deployment?: unknown };
            if (!Array.isArray(entry.formation) || !Array.isArray(entry.deployment)) return null;
            reforms.push({
                afterClash: Number(entry.afterClash),
                formation: entry.formation.map((value) => Number(value)),
                deployment: entry.deployment.map((value) => Number(value)),
            });
        }
    }
    const plan: RitePlan = { formation, deployment, reformAfterClash, reform, reformDeployment, reforms };
    // The engine's own validator is the single source of truth for legality, so
    // the client and the server can never disagree about what a legal plan is.
    return isValidRitePlan(plan, RITE_BAND_SIZE) ? plan : null;
}
const WARFRONT_THEMES: readonly WfTheme[] = ['central', 'forest', 'snow', 'volcano', 'shadow'];

type RankedPetSettlementReceipt = {
    a: string;
    b: string;
    winnerName: string | null;
    settledAt: number;
};

type PetBattleOutcome = 'win' | 'loss' | 'draw';
/**
 * Authoritative receipt committed with each participant's save. The legacy
 * representation was only the match-token string; that proves a rating write
 * happened but cannot recover winner-only side effects after the shared proof
 * and result receipt are both unavailable.
 */
type RankedPetSaveReceipt = RankedPetSettlementReceipt & {
    matchToken: string;
    outcome: PetBattleOutcome;
};

type RankedPetSaveReceiptEntry = string | RankedPetSaveReceipt;
/** Spend exactly the consumable sealed at kickoff. A second tab may replace or
 * unequip it while the fight is playing; in that case the equip endpoint has
 * returned the old item to inventory, so remove that returned copy without
 * destroying the newly equipped item. */
function spendSealedCasualConsumables(
    character: Record<string, unknown>,
    participatingPetIds: readonly string[],
    sealedPlayerPets: readonly Pet[] | null,
): Record<string, unknown> {
    const participating = new Set(participatingPetIds);
    const sealedById = sealedPlayerPets
        ? new Map(sealedPlayerPets.map((pet) => [String(pet.id), pet.loadout?.consumable]))
        : null;
    let nextCharacter = character;
    const pets = Array.isArray(character.pets)
        ? character.pets as Array<Record<string, unknown>>
        : [];
    const nextPets = pets.map((pet) => {
        const petId = String(pet?.id ?? '');
        if (!participating.has(petId) || !pet.loadout || typeof pet.loadout !== 'object') return pet;
        const current = typeof (pet.loadout as Record<string, unknown>).consumable === 'string'
            ? String((pet.loadout as Record<string, unknown>).consumable)
            : undefined;
        // Pre-v1 receipts retain the historical clearing rule. A versioned PvE
        // receipt consumes only what its immutable battle snapshot actually used.
        const sealed = sealedById ? sealedById.get(petId) : current;
        if (!sealed || current !== sealed) return pet;
        return { ...pet, loadout: { ...(pet.loadout as Record<string, unknown>), consumable: undefined } };
    });
    nextCharacter = { ...nextCharacter, pets: nextPets };
    if (!sealedById) return nextCharacter;
    for (const petId of participating) {
        const sealed = sealedById.get(petId);
        if (!sealed) continue;
        const currentPet = nextPets.find((pet) => String(pet?.id ?? '') === petId);
        const current = currentPet?.loadout && typeof currentPet.loadout === 'object'
            ? (currentPet.loadout as Record<string, unknown>).consumable
            : undefined;
        // If the same item was present it was cleared above. Otherwise the old
        // sealed item was returned to inventory by the authoritative equip route.
        if (current === undefined) {
            const originalPet = pets.find((pet) => String(pet?.id ?? '') === petId);
            const original = originalPet?.loadout && typeof originalPet.loadout === 'object'
                ? (originalPet.loadout as Record<string, unknown>).consumable
                : undefined;
            if (original === sealed) continue;
        }
        nextCharacter = removePetItem(nextCharacter, sealed) ?? nextCharacter;
    }
    return nextCharacter;
}

function paidReceiptKey(playerName: string, receipt: string): string {
    return `pet:battle-paid:${playerName}:${receipt}`;
}

function rankedPetResultKey(matchToken: string): string {
    return `pet:ranked-result:${matchToken}`;
}

function characterFromSave(record: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
    const character = record?.character;
    return character && typeof character === 'object' && !Array.isArray(character)
        ? character as Record<string, unknown>
        : null;
}

function isRankedPetSaveReceipt(entry: unknown): entry is RankedPetSaveReceipt {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const value = entry as Partial<RankedPetSaveReceipt>;
    if (typeof value.matchToken !== 'string' || !value.matchToken) return false;
    if (typeof value.a !== 'string' || !value.a || typeof value.b !== 'string' || !value.b) return false;
    if (value.winnerName !== null && value.winnerName !== value.a && value.winnerName !== value.b) return false;
    if (value.outcome !== 'win' && value.outcome !== 'loss' && value.outcome !== 'draw') return false;
    return Number.isFinite(Number(value.settledAt)) && Number(value.settledAt) > 0;
}

function readRankedPetSaveReceipts(character: Record<string, unknown>): RankedPetSaveReceiptEntry[] {
    return Array.isArray(character.redeemedPetRankedMatchTokens)
        ? (character.redeemedPetRankedMatchTokens as unknown[])
            .filter((entry): entry is RankedPetSaveReceiptEntry => (
                (typeof entry === 'string' && entry.length > 0) || isRankedPetSaveReceipt(entry)
            ))
        : [];
}

function rankedPetSaveReceiptToken(entry: RankedPetSaveReceiptEntry): string {
    return typeof entry === 'string' ? entry : entry.matchToken;
}

function findRankedPetSaveReceipt(
    character: Record<string, unknown>,
    matchToken: string,
    playerName: string,
): { legacy: true } | { legacy: false; receipt: RankedPetSaveReceipt } | null {
    const entry = readRankedPetSaveReceipts(character)
        .find((candidate) => rankedPetSaveReceiptToken(candidate) === matchToken);
    if (!entry) return null;
    if (typeof entry === 'string') return { legacy: true };
    if (entry.a !== playerName && entry.b !== playerName) return null;
    const expectedOutcome: PetBattleOutcome = entry.winnerName === null
        ? 'draw'
        : entry.winnerName === playerName ? 'win' : 'loss';
    // Reject corrupt/internally inconsistent evidence rather than letting it
    // mint a winner-only Legacy stat.
    if (entry.outcome !== expectedOutcome) return null;
    return { legacy: false, receipt: entry };
}

function makeRankedPetSaveReceipt(
    matchToken: string,
    token: RankedPetMatchToken,
    winnerName: string | null,
    playerName: string,
): RankedPetSaveReceipt {
    return {
        matchToken,
        a: token.a,
        b: token.b,
        winnerName,
        outcome: winnerName === null ? 'draw' : winnerName === playerName ? 'win' : 'loss',
        settledAt: Date.now(),
    };
}

async function writeRankedSettlementReceipt(
    matchToken: string,
    token: Pick<RankedPetMatchToken, 'a' | 'b'>,
    winnerName: string | null,
    settledAt = Date.now(),
): Promise<RankedPetSettlementReceipt> {
    const receipt: RankedPetSettlementReceipt = {
        a: token.a,
        b: token.b,
        winnerName,
        settledAt,
    };
    // This write is required before proof retirement. If it fails, the caller
    // returns retryable 503 and leaves the original proof live.
    await kv.set(rankedPetResultKey(matchToken), receipt, { ex: RANKED_RESULT_RECEIPT_TTL_SECONDS });
    return receipt;
}

async function retireRankedMatchProof(key: string, token: RankedPetMatchToken): Promise<void> {
    // Write a tombstone before deleting. If deletion is temporarily unavailable,
    // later reports still see `settledAt` and can only replay the result receipt.
    // The dedicated result receipt is already durable when this runs, so failure
    // here is cleanup degradation rather than a reason to tell a paid player that
    // their settlement failed.
    try {
        await kv.set(key, { ...token, settledAt: Date.now() }, { ex: PET_RANKED_TOKEN_TTL_SECONDS });
    } catch (error) {
        console.warn('[pet/battle-result] ranked proof could not be tombstoned', error);
        return;
    }
    await kv.del(key).catch((error) => {
        console.warn('[pet/battle-result] ranked proof tombstoned but not deleted', error);
    });
}

/** The rated result, resolved on the Showdown engine from the sealed token.
 *
 *  This used to run the legacy `runPetDuel` here while the screen played
 *  `runPetDuelCinematic` over a DIFFERENT, client-supplied seed — so the fight
 *  a player watched and the fight that moved their Elo were unrelated. Both now
 *  come from resolveRankedPetDuel, and api/pet/ranked-watch.ts hands the client
 *  the very log this call produces. */
function rankedWinnerFromToken(token: RankedPetMatchToken): string | null {
    return resolveRankedPetDuel(token).winnerName;
}

async function establishRankedSettlementIntent(
    matchToken: string,
    token: RankedPetMatchToken,
): Promise<RankedPetSettlementIntent> {
    const key = petRankedSettlementIntentKey(matchToken);
    const existing = await kv.get<RankedPetSettlementIntent>(key);
    if (existing) {
        if (!isRankedPetSettlementIntent(existing)
            || existing.matchToken !== matchToken
            || existing.token.pairId !== token.pairId
            || existing.token.a !== token.a
            || existing.token.b !== token.b
            || existing.token.seed !== token.seed) {
            throw new Error('Ranked settlement intent conflicts with the live proof.');
        }
        return existing;
    }
    const candidate: RankedPetSettlementIntent = {
        version: 1,
        matchToken,
        token,
        winnerName: rankedWinnerFromToken(token),
        createdAt: Date.now(),
    };
    const placed = await kv.set(key, candidate, { nx: true });
    const committed = placed ? candidate : await kv.get<RankedPetSettlementIntent>(key);
    if (!isRankedPetSettlementIntent(committed)
        || committed.matchToken !== matchToken
        || committed.token.pairId !== token.pairId
        || committed.token.a !== token.a
        || committed.token.b !== token.b
        || committed.token.seed !== token.seed) {
        throw new Error('Could not establish durable ranked settlement authority.');
    }
    return committed;
}

async function cleanupRankedMatchAuthority(
    matchToken: string,
    token: RankedPetMatchToken,
): Promise<void> {
    try {
        await withKvLock(PET_RANKED_QUEUE_KEY, async () => {
            const registry = pruneRankedPetActiveRegistry(
                await kv.get(PET_RANKED_ACTIVE_REGISTRY_KEY),
            );
            for (const [name, pointer] of Object.entries(registry)) {
                if (pointer.matchToken === matchToken) delete registry[name];
            }
            if (Object.keys(registry).length > 0) {
                await kv.set(PET_RANKED_ACTIVE_REGISTRY_KEY, registry, { ex: 24 * 60 * 60 });
            } else {
                await kv.del(PET_RANKED_ACTIVE_REGISTRY_KEY);
            }
        }, { failClosed: true });
    } catch (error) {
        // Active pointers carry their own expiry and are a start-time guard only;
        // result/save receipts remain the settlement authority if cleanup stalls.
        console.warn('[pet/battle-result] ranked active-pointer cleanup failed', error);
    }
    await Promise.allSettled([
        kv.del(petRankedSettlementIntentKey(matchToken)),
        kv.del(petRankedStartClaimKey(token.pairId)),
    ]);
}

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function petArenaRyoReward(opponentLevel: number): number {
    // Ryo economy rebalance: tuned down from `level * 5` to `level * 2` so the
    // pet arena — a low-effort, 100/day faucet — stops out-earning the active
    // mission loop and inflating ryo. Floor of 20 keeps low-level wins worth it.
    return Math.max(20, opponentLevel * 2);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Before auth, only the network identity is trustworthy. Keep a generous
    // IP-only shield here; player-scoped settlement budgets are charged only
    // after authentication below.
    if (!enforceRateLimit(req, res, 'pet-battle-result-preauth', PREAUTH_RESULT_RATE_LIMIT, 60_000)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        let outcome = (body.outcome === 'win' || body.outcome === 'loss' || body.outcome === 'draw') ? body.outcome as PetBattleOutcome : null;
        // Ranked-pet-ladder marker (audit #7 / Stage 3). LIVE — the client sends
        // this from the pet-ranked queue (shinobij.client/src/screens/PetArena.tsx
        // posts { ranked: true, matchToken } here). When true the SERVER owns the
        // petRankedRating swing (computed from the caller's + opponent's ratings as
        // sealed by the match token) instead of the client self-applying
        // rankedDelta. When absent the casual path below runs unchanged.
        const ranked = body.ranked === true;
        let opponentLevelRaw = Math.max(1, Math.min(100, Math.floor(Number(body.opponentLevel ?? 1))));
        // Optional opponent name — used to verify the claimed opponentLevel
        // against the opponent's actual saved level. Stops a level-5 player
        // from claiming wins against level-100 opponents to maximize the
        // `level * 2` ryo formula (200 ryo × 100/day = 20k ryo/day cheat).
        const opponentNameRaw = typeof body.opponentName === 'string' ? safeName(body.opponentName) : '';
        // Optional reportKey for refresh-replay dedup. Clients pass
        // `${battleSeed}:1v1` or `${battleSeed}:match:${i}`; same key from
        // the same player within REPORT_KEY_TTL_SECONDS is treated as a
        // duplicate (the refresh-replay scenario for pet PvP). Sanitized
        // to alphanumerics + : / - so it can't pollute the keyspace.
        const reportKeyRaw = typeof body.reportKey === 'string' ? body.reportKey.slice(0, 64) : '';
        const reportKey = /^[A-Za-z0-9:_-]+$/.test(reportKeyRaw) ? reportKeyRaw : '';
        const battleTokenRaw = typeof body.battleToken === 'string' ? body.battleToken.trim() : '';
        const battleToken = /^[A-Za-z0-9]+$/.test(battleTokenRaw) ? battleTokenRaw : '';
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!outcome) return res.status(400).json({ error: 'Invalid outcome.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own battles.' });
        }
        const rateLimitIdentity = identity.admin ? null : identity.name;
        if (!enforceRateLimit(req, res, 'pet-battle-result', 12, 60_000, rateLimitIdentity)) return;
        if (!enforceRateLimit(req, res, 'pet-battle-result-burst', 1, ARENA_WIN_RATE_LIMIT, rateLimitIdentity)) return;

        // reportKey is REQUIRED for wins. Previously optional, which let a
        // botted client omit it (or randomize per call) and farm the daily
        // cap with zero real battles. Admins and 'loss' outcomes are exempt
        // because losses don't pay out so duplicates are harmless.
        if (!identity.admin && !reportKey) {
            return res.status(400).json({ error: 'Missing or invalid reportKey.' });
        }

        let casualBattleTokenKey: string | null = null;
        let casualBattleActiveKey: string | null = null;
        let casualBattleReceipt = '';
        let casualPetIds: string[] = [];
        let casualPvePlayerPets: Pet[] | null = null;
        let hollowGatePetResult: HollowGatePetResultReceipt | null = null;
        let dungeonPetBinding: DungeonPetBattleBinding | null = null;
        // Only a pre-cutover receipt (no policy field) or the separately-owned
        // Warfront kickoff can reach this legacy payout path. Every new ordinary
        // battle-start token is explicitly social/no-progression; Showdown owns
        // the paid Coliseum loop from this cutover forward.
        let paidProgressionEligible = identity.admin;
        const saveKey = `save:${playerName}`;
        const sendDungeonPetReceiptReplay = async (
            receipt: DungeonPetResultReceipt,
            cleanup?: { tokenKey: string; activeKey: string },
        ) => {
            const replaySave = await kv.get<Record<string, unknown>>(saveKey);
            const replayCharacter = characterFromSave(replaySave);
            if (!replayCharacter) {
                return res.status(503).json({ error: 'Your Dungeon pet result is recorded, but your save is temporarily unavailable.' });
            }
            if (cleanup) {
                await kv.del(cleanup.tokenKey).catch(() => undefined);
                await kv.delIfEqual(cleanup.activeKey, battleToken).catch(() => undefined);
            }
            return res.status(200).json({
                ok: true,
                dungeon: true,
                replayed: true,
                outcome: receipt.outcome,
                reward: 0,
                chronicleCards: [],
                witnessedPets: [],
                livingWitnessProgress: [],
                character: replayCharacter,
                _saveVersion: Number(replaySave?._saveVersion ?? 0),
            });
        };
        const sendHollowGatePetReceiptReplay = async (receipt: HollowGatePetResultReceipt) => {
            try {
                await retireHollowGatePetChildLease(playerName, battleToken);
            } catch (error) {
                console.error('[pet/battle-result] Hollow Gate child cleanup failed', error);
                return res.status(503).json({ error: 'Your Hollow Gate pet result is recorded, but its battle lease could not be retired — please retry.' });
            }
            return res.status(200).json({
                ok: true,
                hollowGate: true,
                replayed: true,
                outcome: receipt.outcome,
                reward: 0,
                petReceipt: battleToken,
            });
        };
        // The reward level SEALED at battle-start (opponent actually fought). When
        // set, it — not the body-named opponent — decides the payout.
        let sealedOpponentLevel: number | null = null;
        let sealedRewardRyo: number | null = null;
        if (!ranked && !identity.admin) {
            if (!battleToken) return res.status(400).json({ error: 'A valid pet battle start token is required.' });
            const tokenKey = `pet:battle-token:${playerName}:${battleToken}`;
            const tokenData = await kv.get<{
                playerName?: string;
                reportKey?: string;
                opponentLevel?: number;
                rewardRyo?: number;
                playerPetIds?: string[];
                opponentPetIds?: string[];
                sealedOpponentPets?: Pet[];
                sealedParams?: SealedDuelParams | null;
                casualPveSeal?: CasualPveBattleSeal;
                bluePets?: Pet[];
                redPets?: Pet[];
                seed?: number;
                theme?: WfTheme;
                buyPolicy?: WfBuyPolicy;
                opponentBuyPolicy?: WfBuyPolicy;
                stance?: WfStance;
                opponentStance?: WfStance;
                doctrine?: WfDoctrine;
                opponentDoctrine?: WfDoctrine;
                authoritativeOutcome?: PetBattleOutcome;
                mode?: string;
                settleAfter?: number;
                playbackStartedAt?: number;
                matchDurationMs?: number;
                hollowGate?: { runId?: string };
                dungeon?: unknown;
                settlementPolicy?: unknown;
                wanderer?: { id?: unknown; sector?: unknown; verb?: unknown };
                wandererParticipatingPets?: Pet[];
                pvpChallengeId?: string;
                pvpParticipatingPets?: Pet[];
            }>(tokenKey);
            if (!tokenData || (tokenData.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
                const priorDungeonResult = parseDungeonPetResultReceipt(
                    await kv.get(dungeonPetResultKey(playerName, battleToken)),
                );
                if (priorDungeonResult?.playerName.toLowerCase() === playerName.toLowerCase()
                    && priorDungeonResult.battleToken === battleToken) {
                    return sendDungeonPetReceiptReplay(priorDungeonResult, {
                        tokenKey,
                        activeKey: `pet:battle-active:${playerName}`,
                    });
                }
                const priorHollowGateResult = parseHollowGatePetResultReceipt(
                    await kv.get(hollowGatePetResultKey(playerName, battleToken)),
                );
                const priorHollowGateBinding = priorHollowGateResult
                    ? await kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(priorHollowGateResult.runId))
                    : null;
                if (priorHollowGateResult
                    && priorHollowGateResult.proofId === battleToken
                    && hollowGatePetReceiptMatchesBinding(priorHollowGateBinding, priorHollowGateResult, playerName)) {
                    return sendHollowGatePetReceiptReplay(priorHollowGateResult);
                }
                // A successful casual settlement deletes its short-lived battle
                // token before replying. If that reply is lost, the retry must
                // still reach the receipt committed atomically with the reward;
                // otherwise an earned Living Witness ceremony disappears and
                // the UI can only report a misleading "invalid token" result.
                const priorSave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const priorCharacter = (priorSave?.character ?? null) as Record<string, unknown> | null;
                const redeemed = Array.isArray(priorCharacter?.redeemedPetBattleTokens)
                    ? (priorCharacter.redeemedPetBattleTokens as unknown[])
                        .filter((entry): entry is string => typeof entry === 'string')
                    : [];
                if (priorCharacter && redeemed.includes(battleToken)) {
                    // The save receipt proves settlement committed even when a
                    // process died after deleting the token but before clearing
                    // its exact active pointer. Heal that second half before
                    // acknowledging the replay, or this spent battle can block
                    // every Pet mode until the refreshed lease expires.
                    try {
                        const activeKey = `pet:battle-active:${playerName}`;
                        const retired = await kv.delIfEqual(activeKey, battleToken);
                        if (!retired && await kv.get<string>(activeKey) === battleToken) {
                            return res.status(503).json({ error: 'Your pet result is recorded, but its active battle lease could not be retired — please retry.' });
                        }
                    } catch (error) {
                        console.error('[pet/battle-result] casual replay pointer cleanup failed', error);
                        return res.status(503).json({ error: 'Your pet result is recorded, but its active battle lease could not be retired — please retry.' });
                    }
                    const paidMarker = await kv.get<{ at?: number; legacyApplied?: boolean }>(
                        paidReceiptKey(playerName, battleToken),
                    );
                    if (paidMarker && paidMarker.legacyApplied !== true) {
                        const legacyDelivered = await bumpLegacyStats(
                            playerName,
                            { petDuelWins: 1 },
                            {
                                receiptId: `pet-casual:${battleToken}`,
                                characterForBootstrap: legacyBootstrapBeforeCounterIncrement(
                                    priorCharacter,
                                    'totalPetWins',
                                ),
                            },
                        );
                        if (!legacyDelivered) {
                            return res.status(503).json({ error: 'The pet win is safe, but its Legacy record is still being sealed. Please retry.' });
                        }
                        await kv.set(
                            paidReceiptKey(playerName, battleToken),
                            { ...paidMarker, at: Number(paidMarker.at) || Date.now(), legacyApplied: true },
                            { ex: PAID_RECEIPT_TTL_SECONDS },
                        ).catch(() => undefined);
                    }
                    const replayReceipt = petWitnessReceiptForSettlement(priorCharacter, `pet-casual:${battleToken}`);
                    return res.status(200).json({
                        ok: true,
                        replayed: true,
                        reward: 0,
                        reason: 'already-recorded',
                        totalPetWins: Number(priorCharacter.totalPetWins ?? 0),
                        dailyPetWins: Number(priorCharacter.dailyPetWins ?? 0),
                        balances: { ryo: Number(priorCharacter.ryo ?? 0) },
                        chronicleCards: replayReceipt.granted,
                        witnessedPets: replayReceipt.witnessed,
                        livingWitnessProgress: replayReceipt.livingWitnessProgress,
                        character: priorCharacter,
                        _saveVersion: Number(priorSave?._saveVersion ?? 0),
                    });
                }
                return res.status(200).json({ ok: true, reward: 0, reason: 'invalid-or-spent-pet-battle-token' });
            }
            if (tokenData.reportKey !== reportKey) {
                return res.status(403).json({ error: 'Pet battle token does not match this battle report.' });
            }
            const settlementPolicy = tokenData.settlementPolicy;
            if (settlementPolicy !== undefined
                && settlementPolicy !== 'casual-no-progression'
                && settlementPolicy !== 'parent-mode'
                && settlementPolicy !== 'warfront-reward') {
                return res.status(409).json({ error: 'Pet battle token carries an unknown settlement policy.' });
            }
            if (settlementPolicy === 'warfront-reward' && tokenData.mode !== 'warfront') {
                return res.status(409).json({ error: 'Pet battle token carries a mismatched reward authority.' });
            }
            if (tokenData.hollowGate?.runId) {
                const priorHollowGateResult = parseHollowGatePetResultReceipt(
                    await kv.get(hollowGatePetResultKey(playerName, battleToken)),
                );
                if (priorHollowGateResult) {
                    const priorHollowGateBinding = await kv.get<HollowGateCombatBinding>(
                        hollowGateCombatBindingKey(priorHollowGateResult.runId),
                    );
                    const tokenPetIds = Array.isArray(tokenData.playerPetIds) ? tokenData.playerPetIds : [];
                    if (priorHollowGateResult.proofId !== battleToken
                        || priorHollowGateResult.runId !== String(tokenData.hollowGate.runId)
                        || JSON.stringify(priorHollowGateResult.playerPetIds) !== JSON.stringify(tokenPetIds)
                        || !hollowGatePetReceiptMatchesBinding(priorHollowGateBinding, priorHollowGateResult, playerName)) {
                        return res.status(409).json({ error: 'The retained Hollow Gate result conflicts with its exact battle proof.' });
                    }
                    return sendHollowGatePetReceiptReplay(priorHollowGateResult);
                }
            }
            paidProgressionEligible = settlementPolicy === undefined || settlementPolicy === 'warfront-reward';
            const hasDungeonBinding = tokenData.dungeon !== undefined;
            dungeonPetBinding = parseDungeonPetBattleBinding(tokenData.dungeon);
            if (hasDungeonBinding && !dungeonPetBinding) {
                return res.status(409).json({ error: 'Pet battle token carries an invalid Dungeon binding.' });
            }
            if (tokenData.authoritativeOutcome !== 'win' && tokenData.authoritativeOutcome !== 'loss' && tokenData.authoritativeOutcome !== 'draw') {
                return res.status(409).json({ error: 'Pet battle token lacks an authoritative outcome.' });
            }
            // ── The outcome is the SERVER's, never the client's ───────────────
            // Baseline: the value sealed at battle-start. When the token carries
            // sealed sim params (a PvE fight — the only kind the player can
            // command) and the report includes the input log, the server REPLAYS
            // the seeded cinematic sim with those inputs and uses what IT derives.
            // Either way `body.outcome` is discarded: the client is trusted to say
            // which buttons it pressed, never what pressing them accomplished.
            //
            // This is what closes plan §9.6 — before it, the reward came from an
            // AI-vs-AI simulation on a DIFFERENT engine than the one the player
            // watched, so outplaying the AI could still be scored a loss.
            outcome = tokenData.authoritativeOutcome;
            const hasVersionedPveSeal = tokenData.casualPveSeal !== undefined;
            const casualPveSeal = hasVersionedPveSeal
                ? parseCasualPveBattleSeal(tokenData.casualPveSeal)
                : null;
            if (hasVersionedPveSeal && !casualPveSeal) {
                return res.status(409).json({ error: 'Pet battle token carries an invalid authoritative combat snapshot.' });
            }
            casualPvePlayerPets = casualPveSeal?.playerPets ?? null;
            const tokenPlayerPetIds = Array.isArray(tokenData.playerPetIds) ? tokenData.playerPetIds : [];
            if (tokenData.wanderer !== undefined) {
                if (tokenData.settlementPolicy !== 'casual-no-progression'
                    || tokenData.mode !== '1v1'
                    || typeof tokenData.wanderer.id !== 'string'
                    || !/^w-\d+-\d+-[01]$/.test(tokenData.wanderer.id)
                    || !Number.isSafeInteger(Number(tokenData.wanderer.sector))
                    || tokenData.wanderer.verb !== 'petDuel'
                    || tokenData.casualPveSeal !== undefined
                    || tokenData.hollowGate !== undefined
                    || tokenData.dungeon !== undefined) {
                    return res.status(409).json({ error: 'Natural wanderer token carries conflicting battle authority.' });
                }
                // Showdown resolves with consumables stripped. Preserve that
                // immutable no-item snapshot so settlement cannot clear whatever
                // happens to be equipped by the time the replay finishes.
                casualPvePlayerPets = parseSealedPetSnapshots(tokenData.wandererParticipatingPets, tokenPlayerPetIds);
                if (!casualPvePlayerPets
                    || casualPvePlayerPets.some((pet) => Boolean(pet.loadout?.consumable))) {
                    return res.status(409).json({ error: 'Natural wanderer token carries an invalid participating-pet snapshot.' });
                }
            }
            if (tokenData.mode === 'warfront') {
                const baselineSettleAfter = Number(tokenData.settleAfter);
                const baselineDurationMs = Number(tokenData.matchDurationMs);
                const sealedPlaybackStartedAt = Number(tokenData.playbackStartedAt);
                const playbackStartedAt = Number.isSafeInteger(sealedPlaybackStartedAt) && sealedPlaybackStartedAt > 0
                    ? sealedPlaybackStartedAt
                    : baselineSettleAfter - Math.max(
                        WARFRONT_MIN_SETTLE_MS,
                        baselineDurationMs - WARFRONT_SETTLE_CLOCK_SKEW_MS,
                    );
                if (!Number.isSafeInteger(baselineSettleAfter) || baselineSettleAfter <= 0
                    || !Number.isSafeInteger(baselineDurationMs) || baselineDurationMs <= 0
                    || !Number.isSafeInteger(playbackStartedAt) || playbackStartedAt <= 0
                    || playbackStartedAt >= baselineSettleAfter) {
                    return res.status(409).json({ error: 'Warfront token lacks its authoritative settlement clock.' });
                }
                casualPvePlayerPets = parseSealedPetSnapshots(tokenData.bluePets, tokenPlayerPetIds);
                if (!casualPvePlayerPets) {
                    return res.status(409).json({ error: 'Warfront token carries an invalid participating-pet snapshot.' });
                }
                const rivalIds = Array.isArray(tokenData.redPets)
                    ? tokenData.redPets.map((pet) => String(pet?.id ?? ''))
                    : [];
                const rivalPets = parseSealedPetSnapshots(tokenData.redPets, rivalIds);
                const rawPlan = (body as Record<string, unknown>).warfrontPlan;
                const plan = parseWarfrontRitePlan(rawPlan);
                if (rawPlan !== undefined && !plan) {
                    return res.status(400).json({ error: 'The Warfront formation transcript is invalid.' });
                }
                const seed = Number(tokenData.seed);
                let commandedSettleAfter = baselineSettleAfter;
                if (plan && rivalPets?.length === RITE_BAND_SIZE && casualPvePlayerPets.length === RITE_BAND_SIZE
                    && Number.isSafeInteger(seed) && seed > 0) {
                    try {
                        // Re-run the ENTIRE duel chain from the sealed bands, the
                        // sealed seed and the order the player committed. The
                        // outcome below is the server's own, never the client's.
                        const replay = runWarfrontRite(casualPvePlayerPets, rivalPets, seed, plan);
                        outcome = replay.winner === 'blue' ? 'win' : replay.winner === 'red' ? 'loss' : 'draw';
                        const commandedDurationMs = Math.ceil(replay.totalSeconds * 1_000);
                        commandedSettleAfter = playbackStartedAt + Math.max(
                            WARFRONT_MIN_SETTLE_MS,
                            commandedDurationMs - WARFRONT_SETTLE_CLOCK_SKEW_MS,
                        );
                    } catch (replayError) {
                        // A damaged plan never becomes client outcome authority.
                        // Preserve the sealed automatic baseline and permit an exact retry.
                        console.error('[pet/battle-result] Warfront Rite replay failed', replayError);
                    }
                }
                if (Date.now() < commandedSettleAfter) {
                    return res.status(425).json({
                        error: 'Beastbound Warfront is still in progress.',
                        retryAfterMs: commandedSettleAfter - Date.now(),
                    });
                }
            }
            if (tokenData.pvpChallengeId) {
                // A sealed player duel fights WITHOUT consumables — it is decided
                // when the responder accepts, so a consumable burned in it could
                // never be honestly charged. The snapshot sealed at start carries
                // empty consumable slots, which makes the spend below a no-op
                // instead of quietly eating whatever is equipped now.
                casualPvePlayerPets = parseSealedPetSnapshots(tokenData.pvpParticipatingPets, tokenPlayerPetIds);
                if (!casualPvePlayerPets) {
                    return res.status(409).json({ error: 'Player duel token carries an invalid participating-pet snapshot.' });
                }
            }
            if (casualPveSeal) {
                const inputLog = parseDuelInputLog((body as Record<string, unknown>).inputLog);
                // A malformed log is NOT a payout: fall back to the sealed
                // baseline, which is the uncommanded fight. Never better than the
                // behaviour this replaced.
                if (inputLog) {
                    const replayPlayerPets = casualPveSeal.playerPets;
                    const replayOpponentPets = casualPveSeal.opponentPets;
                    // Re-resolved from the save and the server's own AI roster —
                    // the token carries ids, never combat stats.
                    if (replayPlayerPets.length && replayOpponentPets.length) {
                        try {
                            outcome = replayCasualPetDuel(replayPlayerPets, replayOpponentPets, casualPveSeal.params, inputLog).outcome;
                        } catch (replayErr) {
                            // Keep the sealed baseline rather than paying blind.
                            console.error('[pet/battle-result] input-log replay failed', replayErr);
                        }
                    }
                }
            } else if (tokenData.sealedParams) {
                // Pre-v1 commanded-PvE receipts did not retain kickoff pet
                // snapshots. Preserve them from their immutable baseline outcome
                // and never replay them against mutable current-save pets.
            }
            opponentLevelRaw = Math.max(1, Math.min(100, Math.floor(Number(tokenData.opponentLevel ?? opponentLevelRaw))));
            sealedOpponentLevel = opponentLevelRaw;
            const tokenReward = Number(tokenData.rewardRyo);
            if (dungeonPetBinding) {
                const fixedOpponent = casualPvePetSnapshot(buildDungeonRareBeast());
                if (!casualPveSeal
                    || casualPveSeal.params.mode !== '1v1'
                    || casualPveSeal.playerPets.length !== 1
                    || casualPveSeal.opponentPets.length !== 1
                    || casualPveSeal.opponentPets[0]?.id !== DUNGEON_RARE_BEAST_ID
                    || JSON.stringify(casualPveSeal.opponentPets[0]) !== JSON.stringify(fixedOpponent)) {
                    return res.status(409).json({ error: 'Dungeon pet token lacks its fixed authoritative combat snapshot.' });
                }
            } else if (!Number.isSafeInteger(tokenReward) || tokenReward < 20 || tokenReward > 250) {
                return res.status(409).json({ error: 'Pet battle token lacks a valid sealed reward.' });
            }
            if (dungeonPetBinding) {
                // A durable result wins over the now-cleared parent run, but only
                // after this live token has independently reproduced the exact
                // server outcome and sealed participant set.
                const priorDungeonResult = parseDungeonPetResultReceipt(
                    await kv.get(dungeonPetResultKey(playerName, battleToken)),
                );
                if (priorDungeonResult) {
                    if (priorDungeonResult.playerName.toLowerCase() !== playerName.toLowerCase()
                        || priorDungeonResult.battleToken !== battleToken
                        || priorDungeonResult.runToken !== dungeonPetBinding.runToken
                        || priorDungeonResult.outcome !== outcome
                        || JSON.stringify(priorDungeonResult.playerPetIds) !== JSON.stringify(tokenPlayerPetIds)) {
                        return res.status(409).json({ error: 'Dungeon pet result receipt conflicts with its live battle token.' });
                    }
                    return sendDungeonPetReceiptReplay(priorDungeonResult, {
                        tokenKey,
                        activeKey: `pet:battle-active:${playerName}`,
                    });
                }
            }
            sealedRewardRyo = dungeonPetBinding ? 0 : tokenReward;
            casualBattleTokenKey = tokenKey;
            casualBattleActiveKey = `pet:battle-active:${playerName}`;
            casualBattleReceipt = battleToken;
            casualPetIds = tokenPlayerPetIds;
            if (tokenData.hollowGate?.runId) {
                const hollowGateRunId = String(tokenData.hollowGate.runId);
                const hollowGateBinding = await kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(hollowGateRunId));
                if (!hollowGatePetAuthorityMatches(hollowGateBinding, 'cinematic', battleToken)
                    || hollowGateBinding?.playerName !== playerName
                    || hollowGateBinding.status !== 'active'
                    || hollowGateBinding.settledAt) {
                    return res.status(409).json({ error: 'This Hollow Gate encounter is bound to a different pet battle proof.' });
                }
                hollowGatePetResult = {
                    version: HOLLOW_GATE_PET_AUTHORITY_VERSION,
                    engine: 'cinematic',
                    proofId: battleToken,
                    playerName,
                    runId: hollowGateRunId,
                    outcome,
                    playerPetIds: casualPetIds,
                    settledAt: Date.now(),
                };
            }
        }

        const releaseCasualBattle = async (): Promise<void> => {
            if (casualBattleTokenKey) await kv.del(casualBattleTokenKey).catch(() => undefined);
            if (casualBattleActiveKey) await kv.delIfEqual(casualBattleActiveKey, battleToken).catch(() => undefined);
        };

        // The Dungeon Rare Beast is a run terminal, never a Coliseum faucet.
        // Commit the terminal stamp and its sealed consumable spend in one save
        // write. A separate 24-hour result receipt must be readable before the
        // short battle token is retired, so a lost response can replay safely.
        if (dungeonPetBinding && casualBattleTokenKey) {
            try {
                const dungeonResult = await withKvLock(saveKey, async () => {
                    const record = await kv.get<Record<string, unknown>>(saveKey);
                    if (!record) return { ok: false as const, status: 404, error: 'Your save is unavailable.' };
                    const character = characterFromSave(record);
                    if (!character) return { ok: false as const, status: 404, error: 'Your character is unavailable.' };
                    const terminal = applyDungeonPetTerminal({
                        character,
                        dungeonRunToken: dungeonPetBinding!.runToken,
                        proofId: battleToken,
                        outcome: outcome!,
                        petIds: casualPetIds,
                    });
                    if (!terminal.ok) return { ok: false as const, status: 409, error: terminal.error };

                    let finalRecord = record;
                    let finalCharacter = terminal.character;
                    if (!terminal.alreadyApplied) {
                        finalCharacter = spendSealedCasualConsumables(
                            terminal.character,
                            casualPetIds,
                            casualPvePlayerPets,
                        );
                        finalRecord = bumpSaveVersion({ ...record, character: finalCharacter });
                        await writeSaveProjected(saveKey, finalRecord, record);
                    }

                    const receipt: DungeonPetResultReceipt = {
                        ...dungeonPetBinding!,
                        playerName,
                        battleToken,
                        outcome: outcome!,
                        playerPetIds: casualPetIds,
                        settledAt: Date.now(),
                    };
                    const receiptKey = dungeonPetResultKey(playerName, battleToken);
                    let durable = parseDungeonPetResultReceipt(await kv.get(receiptKey));
                    if (!durable) {
                        await kv.set(receiptKey, receipt, { nx: true, ex: DUNGEON_PET_RESULT_TTL_SECONDS });
                        durable = parseDungeonPetResultReceipt(await kv.get(receiptKey));
                    }
                    if (!durable
                        || durable.playerName.toLowerCase() !== playerName.toLowerCase()
                        || durable.battleToken !== battleToken
                        || durable.runToken !== dungeonPetBinding!.runToken
                        || durable.outcome !== outcome
                        || JSON.stringify(durable.playerPetIds) !== JSON.stringify(casualPetIds)) {
                        throw new Error('Dungeon pet result receipt did not become durable.');
                    }
                    return {
                        ok: true as const,
                        character: finalCharacter,
                        _saveVersion: Number(finalRecord._saveVersion ?? record._saveVersion ?? 0),
                    };
                }, { failClosed: true });
                if (!dungeonResult.ok) {
                    return res.status(dungeonResult.status).json({ error: dungeonResult.error });
                }
                await releaseCasualBattle();
                return res.status(200).json({
                    ok: true,
                    dungeon: true,
                    outcome,
                    reward: 0,
                    chronicleCards: [],
                    witnessedPets: [],
                    livingWitnessProgress: [],
                    character: dungeonResult.character,
                    _saveVersion: dungeonResult._saveVersion,
                });
            } catch (error) {
                console.error('[pet/battle-result] Dungeon pet settlement failed', error);
                return res.status(503).json({ error: 'Could not record Dungeon pet result — please retry.' });
            }
        }

        // Hollow Gate pet duels do not pay the ordinary Coliseum faucet. Their
        // server-replayed outcome becomes a one-use receipt consumed by the
        // run-bound Hollow Gate settlement endpoint.
        if (hollowGatePetResult && casualBattleTokenKey) {
            if (!await writeHollowGatePetResult(hollowGatePetResult)) {
                return res.status(503).json({ error: 'Could not seal the exact Hollow Gate pet result — please retry.' });
            }
            try {
                await retireHollowGatePetChildLease(playerName, battleToken);
            } catch (error) {
                console.error('[pet/battle-result] Hollow Gate child cleanup failed', error);
                return res.status(503).json({ error: 'Your Hollow Gate pet result is recorded, but its battle lease could not be retired — please retry.' });
            }
            return res.status(200).json({
                ok: true,
                hollowGate: true,
                outcome: hollowGatePetResult.outcome,
                reward: 0,
                petReceipt: battleToken,
            });
        }

        // ── opponentLevel cross-check ─────────────────────────────────
        // When the client tells us who the opponent was, verify the
        // claimed level matches that opponent's actual save. Players who
        // omit opponentName (legacy clients, AI duels with no named foe)
        // fall back to the level-cap rule below.
        // The opponent's level is trusted ONLY when we can AUTHENTICATE it
        // against their real save. In every other case — no opponent named, OR a
        // named opponent whose save doesn't exist — the claimed level is clamped
        // to myLevel + 10. This closes the hole (audit #5) where supplying a
        // non-existent opponentName took the `if` branch but found no oppChar, so
        // BOTH the actual-level correction and the myLevel+10 clamp were skipped,
        // letting a level-1 player claim opponentLevel 100 for the full
        // 200-ryo-per-win formula (× the 100/day cap = 20k ryo/day for no battles).
        let opponentLevel = opponentLevelRaw;
        if (sealedOpponentLevel != null) {
            // Casual path: pay out from the level SEALED at battle-start (the
            // opponent actually fought). The body-named opponent is IGNORED here —
            // otherwise a player could beat a trivial level-8 AI, then report a
            // real level-100 name to be paid `level*2` ryo (200 vs ~20) for a
            // fight that never happened (× the 100/day cap ≈ 20k ryo/day).
            opponentLevel = sealedOpponentLevel;
        } else {
            // No sealed token (admin path). Authenticate the claimed level against
            // the named opponent's real save; otherwise clamp to myLevel + 10.
            let verifiedLevel: number | null = null;
            if (opponentNameRaw && opponentNameRaw !== playerName) {
                const oppSave = await kv.get<Record<string, unknown>>(`save:${opponentNameRaw}`);
                const oppChar = (oppSave?.character ?? null) as Record<string, unknown> | null;
                if (oppChar) {
                    verifiedLevel = Math.max(1, Math.min(100, Math.floor(Number(oppChar.level ?? 1))));
                }
            }
            if (verifiedLevel != null) {
                opponentLevel = verifiedLevel;
            } else if (!identity.admin) {
                const meSave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const meChar = (meSave?.character ?? null) as Record<string, unknown> | null;
                const myLevel = Math.max(1, Math.min(100, Math.floor(Number(meChar?.level ?? 1))));
                opponentLevel = Math.min(opponentLevelRaw, myLevel + 10);
            }
        }

        // ── Ranked pet ladder credit (audit #7 / Stage 3 — LIVE) ────────────
        // Reached when the client sends `ranked:true` — the pet-ranked queue does:
        // PetArena.tsx posts { ranked: true, matchToken } here after a match
        // accepted via /api/pet/ranked-start (Arena.tsx mints that token). When the
        // flag is absent the casual path below runs unchanged. The SERVER owns the
        // petRankedRating swing: it computes the Elo change from the caller's +
        // opponent's ratings as SEALED by the match token (read below) and the
        // reported outcome, then credits the caller's save. This mirrors the
        // client's pet-ranked appliers exactly (creditRankedOutcome), so it is a
        // zero-balance change.
        //
        // Differences from the casual path, by design (matching the client's
        // ranked-pet branch in App.tsx, which grants NO ryo and bypasses the
        // daily arena cap): no ryo, no totalPetWins/dailyPetWins touch — only
        // petRankedRating + petRankedWins/petRankedLosses move here. The general
        // pet-win counters stay client-owned during the convergence window, like
        // the non-rating PvP counters do in claim-rewards.
        //
        // Exactly-once: the receipt is placed INSIDE the save lock together with
        // the rating write (failClosed), so a contention abort (→503) leaves
        // NOTHING placed and a retry credits cleanly without ever double-applying
        // the swing. reportKey is REQUIRED (for losses too, since a ranked loss
        // also moves the rating) so the receipt is stable across refresh-replays.
        if (ranked) {
            // #9: a ranked pet result REQUIRES a server-minted match token (from
            // /api/pet/ranked-start) that consumed reciprocal queue proofs and
            // sealed BOTH fighters' pre-match
            // petRankedRating. Without it a client could move the ladder by
            // asserting ranked:true against an arbitrary opponent. The token also
            // lets the server settle BOTH accounts from the SAME sealed snapshot,
            // exactly once each — so the loser can't dodge their drop by never
            // reporting. Direct player-list challenges remain server-disabled;
            // only the ranked queue can authorize this token.)
            const matchTokenRaw = typeof body.matchToken === 'string' ? body.matchToken.trim() : '';
            const matchToken = /^[0-9a-f-]{36}$/i.test(matchTokenRaw) ? matchTokenRaw : '';
            if (!matchToken) {
                return res.status(400).json({ error: 'A valid pet ranked match token is required (start via /api/pet/ranked-start).' });
            }
            const rankedTokenKey = `pet:ranked-token:${matchToken}`;
            try {
                // Serialize on the proof itself before reading it. This closes the
                // read-before-delete race where many concurrent reports could all
                // retain a live copy of the same proof while waiting on save locks.
                return await withKvLock(`pet-ranked-proof:${matchToken}`, async () => {
            const [rawTokenValue, settlementReceipt, intentValue] = await Promise.all([
                kv.get<unknown>(rankedTokenKey),
                kv.get<RankedPetSettlementReceipt>(rankedPetResultKey(matchToken)),
                kv.get<unknown>(petRankedSettlementIntentKey(matchToken)),
            ]);
            const rawToken = isRankedPetMatchToken(rawTokenValue) ? rawTokenValue : null;
            if (intentValue && (!isRankedPetSettlementIntent(intentValue) || intentValue.matchToken !== matchToken)) {
                return res.status(409).json({ error: 'Ranked settlement authority is malformed.' });
            }
            let settlementIntent = isRankedPetSettlementIntent(intentValue) ? intentValue : null;
            // A committed result receipt outranks a lingering proof. This matters
            // if tombstone/delete cleanup failed after both player saves settled.
            if (!settlementReceipt && !settlementIntent && rawToken && !rawToken.settledAt) {
                // This durable intent is the write-ahead authority for the pair.
                // It MUST exist before either participant save can be changed.
                settlementIntent = await establishRankedSettlementIntent(matchToken, rawToken);
            }
            const tok = !settlementReceipt ? settlementIntent?.token ?? null : null;
            if (!tok) {
                if (settlementReceipt) {
                    if (settlementReceipt.a !== playerName && settlementReceipt.b !== playerName) {
                        return res.status(403).json({ error: 'Ranked settlement does not name you.' });
                    }
                    if (rawToken && !rawToken.settledAt) {
                        await retireRankedMatchProof(rankedTokenKey, rawToken);
                    }
                    if (settlementIntent) {
                        await cleanupRankedMatchAuthority(matchToken, settlementIntent.token);
                    }
                    const replaySave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const replayCharacter = characterFromSave(replaySave);
                    if (!replayCharacter) {
                        return res.status(503).json({ error: 'Your ranked settlement is recorded, but your save is temporarily unavailable.' });
                    }
                    const won = settlementReceipt.winnerName === playerName;
                    if (settlementReceipt.winnerName) {
                        const legacyDelivered = await bumpLegacyStats(
                            settlementReceipt.winnerName,
                            { petDuelWins: 1 },
                            { receiptId: `pet-ranked:${matchToken}` },
                        );
                        if (!legacyDelivered) {
                            return res.status(503).json({ error: 'The ranked result is safe, but its Legacy record is still being sealed. Please retry.' });
                        }
                    }
                    const replayReceipt = won
                        ? petWitnessReceiptForSettlement(replayCharacter, `pet-ranked:${matchToken}`)
                        : { granted: [] as string[], witnessed: [], livingWitnessProgress: [] };
                    const currentRating = Number(replayCharacter.petRankedRating ?? 1000);
                    return res.status(200).json({
                        ok: true,
                        ranked: true,
                        replayed: true,
                        outcome: settlementReceipt.winnerName === null ? 'draw' : won ? 'win' : 'loss',
                        reward: 0,
                        rating: {
                            field: 'petRankedRating',
                            value: Number.isFinite(currentRating) ? currentRating : 1000,
                            delta: 0,
                            replayed: true,
                        },
                        chronicleCards: replayReceipt.granted,
                        witnessedPets: replayReceipt.witnessed,
                        livingWitnessProgress: replayReceipt.livingWitnessProgress,
                        character: replayCharacter,
                        _saveVersion: Number(replaySave?._saveVersion ?? 0),
                    });
                }
                // Recover from the protected rolling in-save ledger. New entries
                // retain full outcome evidence, so a prolonged shared-receipt
                // outage plus proof expiry cannot strand winner-only side effects.
                // Legacy string entries still replay their historical response,
                // but intentionally cannot assert a winner they never recorded.
                const priorSave = matchToken
                    ? await kv.get<Record<string, unknown>>(`save:${playerName}`)
                    : null;
                const priorCharacter = characterFromSave(priorSave);
                const saveReceipt = priorCharacter
                    ? findRankedPetSaveReceipt(priorCharacter, matchToken, playerName)
                    : null;
                if (priorCharacter && saveReceipt) {
                    const structured = saveReceipt.legacy ? null : saveReceipt.receipt;
                    const replayOutcome = structured?.outcome;
                    const won = replayOutcome === 'win';
                    if (structured?.winnerName) {
                        const legacyDelivered = await bumpLegacyStats(
                            structured.winnerName,
                            { petDuelWins: 1 },
                            { receiptId: `pet-ranked:${matchToken}` },
                        );
                        if (!legacyDelivered) {
                            return res.status(503).json({ error: 'The ranked result is safe, but its Legacy record is still being sealed. Please retry.' });
                        }
                    }
                    // A lone historical save receipt proves only this side. Do
                    // not promote it to a shared final receipt: that would make a
                    // missing peer permanently unrecoverable. New settlements
                    // always have the durable pair intent handled above.
                    const replayReceipt = saveReceipt.legacy || won
                        ? petWitnessReceiptForSettlement(priorCharacter, `pet-ranked:${matchToken}`)
                        : { granted: [] as string[], witnessed: [], livingWitnessProgress: [] };
                    const currentRating = Number(priorCharacter.petRankedRating ?? 1000);
                    return res.status(200).json({
                        ok: true,
                        ranked: true,
                        replayed: true,
                        ...(replayOutcome ? { outcome: replayOutcome } : {}),
                        reward: 0,
                        rating: {
                            field: 'petRankedRating',
                            value: Number.isFinite(currentRating) ? currentRating : 1000,
                            delta: 0,
                            replayed: true,
                        },
                        chronicleCards: replayReceipt.granted,
                        witnessedPets: replayReceipt.witnessed,
                        livingWitnessProgress: replayReceipt.livingWitnessProgress,
                        character: priorCharacter,
                        _saveVersion: Number(priorSave?._saveVersion ?? 0),
                    });
                }
                return res.status(400).json({ error: 'A valid pet ranked match token is required (start via /api/pet/ranked-start).' });
            }
            if (tok.a !== playerName && tok.b !== playerName) {
                return res.status(403).json({ error: 'Match token does not name you.' });
            }
            const callerIsA = tok.a === playerName;
            if (!tok.aPet || !tok.bPet || !Number.isSafeInteger(tok.seed)) {
                return res.status(409).json({ error: 'Ranked token lacks a sealed combat snapshot.' });
            }
            // Determinism cross-check: re-derive the verdict and refuse to
            // settle if it disagrees with the intent recorded when the pair was
            // first claimed. Both derivations go through resolveRankedPetDuel,
            // so this is a real guard against an engine change landing between
            // intent and settlement — not two engines being compared.
            const simulatedWinner = resolveRankedPetDuel(tok).winnerName;
            if (settlementIntent?.winnerName !== simulatedWinner) {
                return res.status(409).json({ error: 'Ranked settlement intent does not match the sealed server replay.' });
            }
            // Showdown's judge always decides, so this branch is unreachable for
            // any token resolved by the current engine. It stays because a draw
            // is still representable in the receipt shape.
            if (simulatedWinner === null) {
                const settleDrawPet = async (
                    slug: string,
                    petSnapshot: Record<string, unknown>,
                    record: Record<string, unknown>,
                ) => {
                    const sk = `save:${slug}`;
                    const char = characterFromSave(record);
                    if (!char) throw new Error(`Ranked participant save is missing a character: ${slug}`);
                    const receipts = readRankedPetSaveReceipts(char)
                        .slice(-(RANKED_SAVE_RECEIPT_CAP - 1));
                    if (receipts.some((entry) => rankedPetSaveReceiptToken(entry) === matchToken)) return;
                    const combatPetId = String(petSnapshot.id ?? '');
                    const pets = Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : [];
                    const nextPets = pets.map((pet) => String(pet?.id ?? '') === combatPetId && pet.loadout && typeof pet.loadout === 'object'
                        ? { ...pet, loadout: { ...(pet.loadout as Record<string, unknown>), consumable: undefined } }
                        : pet);
                    const updated = bumpSaveVersion({
                        ...record,
                        character: {
                            ...char,
                            pets: nextPets,
                            redeemedPetRankedMatchTokens: [
                                ...receipts,
                                makeRankedPetSaveReceipt(matchToken, tok, null, slug),
                            ],
                        },
                    });
                    await kv.set(sk, mergePreservingImages(updated, record));
                };
                try {
                    const [k1, k2] = [`save:${tok.a}`, `save:${tok.b}`].sort();
                     await withKvLock(k1, () => withKvLock(k2, async () => {
                         const [aRecord, bRecord] = await Promise.all([
                             kv.get<Record<string, unknown>>(`save:${tok.a}`),
                             kv.get<Record<string, unknown>>(`save:${tok.b}`),
                         ]);
                         if (!characterFromSave(aRecord) || !characterFromSave(bRecord)) {
                             throw new Error('Both ranked participant saves must exist before settlement.');
                         }
                         await settleDrawPet(tok.a, tok.aPet!, aRecord!);
                         await settleDrawPet(tok.b, tok.bPet!, bRecord!);
                     }, { failClosed: true }), { failClosed: true });
                     await writeRankedSettlementReceipt(matchToken, tok, null);
                     const finalSave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                     if (!characterFromSave(finalSave)) throw new Error('Ranked draw settled, but the authoritative save could not be reloaded.');
                     await retireRankedMatchProof(rankedTokenKey, tok);
                     await cleanupRankedMatchAuthority(matchToken, tok);
                    return res.status(200).json({ ok: true, ranked: true, outcome: 'draw', reward: 0, character: finalSave?.character ?? null, _saveVersion: Number(finalSave?._saveVersion ?? 0) });
                } catch (rankedErr) {
                    console.error('[pet/battle-result] ranked draw settlement failed', rankedErr);
                    return res.status(503).json({ error: 'Could not finish recording the ranked draw — please retry.' });
                }
            }
            outcome = (simulatedWinner === playerName) ? 'win' : 'loss';
            const opponentName = callerIsA ? tok.b : tok.a;
            const myRating = Number(callerIsA ? tok.aRating : tok.bRating);
            const oppRating = Number(callerIsA ? tok.bRating : tok.aRating);
            const winnerName = outcome === 'win' ? playerName : opponentName;
            const loserName = outcome === 'win' ? opponentName : playerName;
            const winnerRating = outcome === 'win' ? myRating : oppRating;
            const loserRating = outcome === 'win' ? oppRating : myRating;

            // Settle one side once. The receipt lives in the same save write as
            // rating + consumable + witness progress, so a failed write cannot
            // strand an external NX marker and a failed response can be replayed.
            const settlePet = async (
                slug: string,
                role: 'winner' | 'loser',
                record: Record<string, unknown>,
            ) => {
                const sk = `save:${slug}`;
                const char = characterFromSave(record);
                if (!char) throw new Error(`Ranked participant save is missing a character: ${slug}`);
                const r = creditRankedOutcome(char, { role, winnerRating, loserRating, kind: 'pet' });
                const receipts = readRankedPetSaveReceipts(char)
                    .slice(-(RANKED_SAVE_RECEIPT_CAP - 1));
                if (receipts.some((entry) => rankedPetSaveReceiptToken(entry) === matchToken)) {
                    const currentRating = Number(char.petRankedRating);
                    const replayReceipt = role === 'winner'
                        ? petWitnessReceiptForSettlement(char, `pet-ranked:${matchToken}`)
                        : { granted: [] as string[], witnessed: [], livingWitnessProgress: [] };
                    return {
                        field: 'petRankedRating',
                        value: Number.isFinite(currentRating) ? currentRating : r.newRating,
                        delta: 0,
                        replayed: true,
                        chronicleCards: replayReceipt.granted,
                        witnessedPets: replayReceipt.witnessed,
                        livingWitnessProgress: replayReceipt.livingWitnessProgress,
                    };
                }
                const combatPetId = String((slug === tok.a ? tok.aPet : tok.bPet)?.id ?? '');
                const pets = Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : [];
                const nextPets = pets.map((pet) => String(pet?.id ?? '') === combatPetId && pet.loadout && typeof pet.loadout === 'object'
                    ? { ...pet, loadout: { ...(pet.loadout as Record<string, unknown>), consumable: undefined } }
                    : pet);
                const rankedCharacter = {
                    ...char,
                    ...r.patch,
                    pets: nextPets,
                    redeemedPetRankedMatchTokens: [
                        ...receipts,
                        makeRankedPetSaveReceipt(matchToken, tok, winnerName, slug),
                    ],
                };
                const witness = role === 'winner'
                    ? recordPetArenaVictory(rankedCharacter, [combatPetId], Date.now(), `pet-ranked:${matchToken}`)
                    : { character: rankedCharacter, granted: [] as string[], witnessed: [], livingWitnessProgress: [] };
                const updated = bumpSaveVersion({ ...record, character: witness.character });
                await kv.set(sk, mergePreservingImages(updated, record));
                return {
                    field: 'petRankedRating',
                    value: r.newRating,
                    delta: r.delta,
                    chronicleCards: witness.granted,
                    witnessedPets: witness.witnessed,
                    livingWitnessProgress: witness.livingWitnessProgress,
                };
            };

            try {
                // Lock both saves in deterministic key order (deadlock-free).
                const [k1, k2] = [`save:${winnerName}`, `save:${loserName}`].sort();
                const out = await withKvLock(k1, () => withKvLock(k2, async () => {
                    const [winnerRecord, loserRecord] = await Promise.all([
                        kv.get<Record<string, unknown>>(`save:${winnerName}`),
                        kv.get<Record<string, unknown>>(`save:${loserName}`),
                    ]);
                    if (!characterFromSave(winnerRecord) || !characterFromSave(loserRecord)) {
                        throw new Error('Both ranked participant saves must exist before settlement.');
                    }
                    const w = await settlePet(winnerName, 'winner', winnerRecord!);
                    const l = await settlePet(loserName, 'loser', loserRecord!);
                     return { rating: playerName === winnerName ? w : l };
                 }, { failClosed: true }), { failClosed: true });
                 // Resume the winner-only Legacy side effect as soon as both
                 // authoritative saves are durable. Its stable receipt makes this
                 // safe on every retry; the structured save ledger can retry it if
                 // Legacy storage is down at the same time.
                 const legacyDelivered = await bumpLegacyStats(
                     winnerName,
                     { petDuelWins: 1 },
                     { receiptId: `pet-ranked:${matchToken}` },
                 );
                 let resultReceiptWritten = false;
                 try {
                     await writeRankedSettlementReceipt(matchToken, tok, winnerName);
                     resultReceiptWritten = true;
                 } catch (error) {
                     console.error('[pet/battle-result] ranked result receipt write failed', error);
                 }
                 // Both side effects are independently retryable from the
                 // pair intent plus the structured save receipts. Attempt both
                 // before returning, and retain that authority until both land.
                 if (!legacyDelivered || !resultReceiptWritten) {
                     return res.status(503).json({ error: 'The ranked result is safe, but its settlement records are still being sealed. Please retry.' });
                 }
                 const finalSave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                 const finalChar = characterFromSave(finalSave);
                 if (!finalChar) throw new Error('Ranked result settled, but the authoritative save could not be reloaded.');
                 await retireRankedMatchProof(rankedTokenKey, tok);
                 await cleanupRankedMatchAuthority(matchToken, tok);
                 return res.status(200).json({
                    ok: true,
                    ranked: true,
                    ...(out.rating?.replayed === true ? { replayed: true } : {}),
                    outcome,
                    reward: 0,
                    rating: out.rating,
                    chronicleCards: out.rating?.chronicleCards ?? [],
                    witnessedPets: out.rating?.witnessedPets ?? [],
                    livingWitnessProgress: out.rating?.livingWitnessProgress ?? [],
                    character: finalChar,
                    _saveVersion: Number(finalSave?._saveVersion ?? 0),
                });
            } catch (rankedErr) {
                // A failure can occur before either write, between the two save
                // writes, or while sealing the durable replay receipt. The live
                // proof is not retired on any of those paths, and every save write
                // carries its own exact-once receipt, so retry safely completes the
                // missing portion without applying rating twice.
                 console.error('[pet/battle-result] ranked credit failed', rankedErr);
                 return res.status(503).json({ error: 'Could not record ranked result — please retry.' });
             }
                }, { failClosed: true });
            } catch (rankedProofErr) {
                console.error('[pet/battle-result] ranked proof lock failed', rankedProofErr);
                return res.status(503).json({ error: 'Could not verify ranked result — please retry.' });
            }
         }

        // Apply under a per-player lock so simultaneous result POSTs (e.g.
        // double-clicked Confirm) can't both award ryo + increment counters.
        const result = await withKvLock(saveKey, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            if (!record) return { error: 'no-save' as const };
            const char = record.character as Record<string, unknown> | undefined;
            if (!char) return { error: 'no-character' as const };
            if (casualBattleTokenKey) {
                const receipts = Array.isArray(char.redeemedPetBattleTokens)
                    ? (char.redeemedPetBattleTokens as unknown[]).filter((entry): entry is string => typeof entry === 'string').slice(-(RECEIPT_HISTORY - 1))
                    : [];
                // Two records of the same fact, because neither is sufficient
                // alone. The in-save array is exact — it lands in the same write
                // as the ryo — but it is a rolling window shared with Showdown,
                // and later battles evict it faster than a battle token expires.
                // The durable key does not move when other battles are reported,
                // so a paid battle cannot be cashed again by flushing the array
                // out from under its receipt.
                const paidMarker = await kv.get<{ at?: number; legacyApplied?: boolean }>(
                    paidReceiptKey(playerName, casualBattleReceipt),
                );
                if (receipts.includes(casualBattleReceipt) || paidMarker) {
                    await releaseCasualBattle();
                    const replayReceipt = petWitnessReceiptForSettlement(char, `pet-casual:${casualBattleReceipt}`);
                    return {
                        ok: true,
                        reward: 0,
                        reason: 'invalid-or-spent-pet-battle-token',
                        totalPetWins: Number(char.totalPetWins ?? 0),
                        dailyPetWins: Number(char.dailyPetWins ?? 0),
                        balances: { ryo: Number(char.ryo ?? 0) },
                        chronicleCards: replayReceipt.granted,
                        witnessedPets: replayReceipt.witnessed,
                        livingWitnessProgress: replayReceipt.livingWitnessProgress,
                        progressionEligible: paidMarker?.legacyApplied !== true && Boolean(paidMarker),
                        _saveVersion: Number(record._saveVersion ?? 0),
                        character: char,
                    };
                }
                char.redeemedPetBattleTokens = [...receipts, casualBattleReceipt];
            }
            const spentChar = spendSealedCasualConsumables(char, casualPetIds, casualPvePlayerPets);

            const today = utcDateKey();
            const lastReset = String(char.lastDailyReset ?? '');
            // Reset daily counters when the UTC day rolls over.
            const dailyPetWins = lastReset === today ? Number(char.dailyPetWins ?? 0) : 0;

            // Loss: no reward, but still track win streak metadata. We don't
            // currently store losses anywhere — return ok so the client UI
            // can show "recorded" instead of silently no-op'ing.
            if (outcome === 'loss' || outcome === 'draw') {
                const spentRecord = bumpSaveVersion({ ...record, character: spentChar });
                await writeSaveProjected(saveKey, spentRecord, record);
                await releaseCasualBattle();
                return {
                    ok: true,
                    outcome,
                    reward: 0,
                    totalPetWins: Number(char.totalPetWins ?? 0),
                    dailyPetWins,
                    balances: { ryo: Number(char.ryo ?? 0) },
                    _saveVersion: Number((spentRecord as Record<string, unknown>)._saveVersion ?? 0),
                    character: spentChar,
                };
            }

            // New ordinary player challenges are social sparring. They still
            // spend the exact kickoff consumables and retire their one-use proof,
            // but cannot touch ryo, the daily/lifetime counters, Living Witness,
            // achievements/quests, or Legacy pet-duel progression.
            if (!paidProgressionEligible) {
                const spentRecord = bumpSaveVersion({ ...record, character: spentChar });
                await writeSaveProjected(saveKey, spentRecord, record);
                await releaseCasualBattle();
                return {
                    ok: true,
                    outcome: 'win' as const,
                    reward: 0,
                    reason: 'casual-sparring',
                    totalPetWins: Number(char.totalPetWins ?? 0),
                    dailyPetWins: Number(char.dailyPetWins ?? 0),
                    balances: { ryo: Number(char.ryo ?? 0) },
                    chronicleCards: [],
                    witnessedPets: [],
                    livingWitnessProgress: [],
                    _saveVersion: Number((spentRecord as Record<string, unknown>)._saveVersion ?? 0),
                    character: spentChar,
                };
            }

            // Daily cap: stop the whole paid progression fact, not only its
            // currency. A capped win cannot farm leaderboard/achievement/quest
            // counters, Living Witness, Chronicle cards, or Legacy receipts.
            if (dailyPetWins >= DAILY_ARENA_WIN_CAP) {
                const spentRecord = bumpSaveVersion({ ...record, character: spentChar });
                await writeSaveProjected(saveKey, spentRecord, record);
                await releaseCasualBattle();
                return {
                    ok: true,
                    outcome: 'win' as const,
                    reward: 0,
                    capped: true,
                    totalPetWins: Number(char.totalPetWins ?? 0),
                    dailyPetWins,
                    balances: { ryo: Number(char.ryo ?? 0) },
                    chronicleCards: [],
                    witnessedPets: [],
                    livingWitnessProgress: [],
                    _saveVersion: Number((spentRecord as Record<string, unknown>)._saveVersion ?? 0),
                    character: spentChar,
                };
            }

            // Casual rewards come from the opponent PET SNAPSHOT sealed at
            // battle-start. Account level is retained only for the trusted
            // admin compatibility path, never for ordinary player receipts.
            const reward = sealedRewardRyo ?? petArenaRyoReward(opponentLevel);
            const winCharacter = {
                ...spentChar,
                ryo: Number(char.ryo ?? 0) + reward,
                totalPetWins: Number(char.totalPetWins ?? 0) + 1,
                dailyPetWins: dailyPetWins + 1,
                lastDailyReset: today,
            };
            const witness = recordPetArenaVictory(
                winCharacter,
                casualPetIds,
                Date.now(),
                `pet-casual:${casualBattleReceipt || reportKey}`,
                casualPvePlayerPets ?? undefined,
            );
            const updatedChar = witness.character;
            const updated = bumpSaveVersion({ ...record, character: updatedChar });
            await writeSaveProjected(saveKey, updated, record);
            if (casualBattleTokenKey) {
                // AFTER the paying write, never before: a failed key write must
                // not be able to swallow a reward the player earned. Until it
                // lands the array receipt is still covering, and it is covering
                // for a full day of wins. Only the paying branch needs it — the
                // loss/draw and capped branches move no currency.
                //
                // It is also written BEFORE the token is released: while the
                // token still exists a re-report is possible, and the durable
                // receipt is what refuses it.
                await kv.set(
                    paidReceiptKey(playerName, casualBattleReceipt),
                    { at: Date.now(), legacyApplied: false },
                    { nx: true, ex: PAID_RECEIPT_TTL_SECONDS },
                )
                    .catch(() => undefined);
            }
            await releaseCasualBattle();
            return {
                ok: true,
                outcome: 'win' as const,
                reward,
                progressionEligible: true,
                totalPetWins: updatedChar.totalPetWins,
                dailyPetWins: updatedChar.dailyPetWins,
                balances: { ryo: Number(updatedChar.ryo) },
                chronicleCards: witness.granted,
                witnessedPets: witness.witnessed,
                livingWitnessProgress: witness.livingWitnessProgress,
                _saveVersion: Number((updated as Record<string, unknown>)._saveVersion ?? 0),
                character: updatedChar,
            };
        }, { failClosed: true });

        if ('error' in result) {
            const code = result.error === 'no-save' || result.error === 'no-character' ? 404 : 500;
            return res.status(code).json({ error: result.error });
        }
        if (outcome === 'win' && battleToken && result.progressionEligible === true) {
            const legacyDelivered = await bumpLegacyStats(
                playerName,
                { petDuelWins: 1 },
                {
                    receiptId: `pet-casual:${battleToken}`,
                    characterForBootstrap: legacyBootstrapBeforeCounterIncrement(
                        result.character as Record<string, unknown>,
                        'totalPetWins',
                    ),
                },
            );
            if (!legacyDelivered) {
                return res.status(503).json({
                    error: 'The pet win is safe, but its Legacy record is still being sealed. Please retry.',
                    code: 'legacy-delivery-pending',
                    retryable: true,
                });
            }
            await kv.set(
                paidReceiptKey(playerName, battleToken),
                { at: Date.now(), legacyApplied: true },
                { ex: PAID_RECEIPT_TTL_SECONDS },
            ).catch(() => undefined);
        }
        return res.status(200).json(result);
    } catch (err) {
        console.error('[pet/battle-result]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
