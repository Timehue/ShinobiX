import { SHOWDOWN_DAILY_WIN_CAP } from '../../shared/pet-showdown-contract.js';
import { randomInt, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { writeSaveProjected } from '../save/_projected-write.js';
import { activeBreedingParentIds } from './_pet-busy.js';
import { activeCarriedPets } from '../_entitlements.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import {
    SHOWDOWN_FORMAT_SIZE,
    showdownTeamSize,
    SHOWDOWN_PVP_TURN_SECONDS,
    type ShowdownCommand,
    type ShowdownFormat,
    type ShowdownTier,
} from '../../shared/pet-showdown-contract.js';
import {
    createShowdownSession,
    resolveShowdownRound,
    showdownStateView,
    type ShowdownSession,
} from '../_pet-showdown/engine.js';
import { buildShowdownAiTeam, chooseShowdownAiCommands } from '../_pet-showdown/ai.js';
import {
    bumpLegacyStats,
    hasLegacyActivityReceipt,
    legacyBootstrapBeforeCounterIncrement,
    legacyEnabled,
    legacyStatsKey,
    type LegacyStats,
} from '../_legacy-track.js';
import { petWitnessReceiptForSettlement, recordPetArenaVictory } from '../card-clash/_pet-witness.js';
import { buildServerHollowHound } from './battle-start.js';
import { loadAdminEventObjects } from '../_admin-event-catalog.js';
import {
    buildAuthoredEventBeast,
    buildDungeonSealBeast,
    dungeonSealRunIssue,
    findAuthoredPetBattle,
} from './_authored-encounter.js';
import { hollowGateRunKey, type HollowGateRunToken } from '../hollow-gate/_run-token.js';
import {
    HOLLOW_GATE_PET_AUTHORITY_VERSION,
    hollowGateCombatBindingKey,
    hollowGatePetAuthorityMatches,
    validateHollowGatePetClaim,
    type HollowGateCombatBinding,
    type HollowGatePetResultReceipt,
} from '../hollow-gate/_combat-session.js';
import {
    writeHollowGatePetResult,
} from '../hollow-gate/_pet-authority.js';
import { isHollowHoundEncounterId, type HollowGateHoundKind } from '../../shared/hollow-gate-contract.js';
import {
    WORLD_CRISIS_80_ID,
    type WorldCrisis80Village,
} from '../../shared/world-crisis-80.js';
import {
    activeWorldCrisis80Encounter,
    recordWorldCrisis80Defense,
} from '../world-crisis-80/_state.js';

/*
 * /api/pet/showdown — POST only. The flagship turn-based pet battle mode.
 *
 * actions:
 *   arena   — enter the paid Pet Coliseum. The server selects and seals the AI
 *             team; this is the sole new paid Coliseum admission.
 *   start   — seal the player's chosen pets from the save, build an AI team
 *             from the catalog, and mint an unpaid practice KV session. The
 *             ENGINE RUNS ONLY HERE on the server; the client is presentation.
 *   turn    — submit one round of commands; the server resolves the round and
 *             returns the turn script + updated public state. The finishing
 *             turn also pays out (win only) under the save lock with an
 *             exactly-once receipt.
 *   forfeit — concede; ends the session as a loss, no payout.
 *   state   — resume view after a refresh.
 *   world-crisis-80 — seal exactly three ready carried pets against the
 *             current village pursuit pack; unpaid, server-built, and bound
 *             to the global crisis ledger by the terminal session proof.
 *
 * Rewards: `start` is practice and pays nothing. `arena` is the paid Coliseum
 * entry and seals reward eligibility before any turns. Parent-bound modes such
 * as Hollow Gate are detected before ordinary settlement and cannot enter this
 * faucet. Eligibility is sealed into the session (`rewardEligible`); the client
 * cannot nominate a reward-bearing opponent or promote a practice session.
 *
 * Reward integrity, for when a caller IS eligible: the payout magnitude
 * (opponent level) is SEALED at start from the AI team actually generated; the
 * outcome is engine-computed on the server; the paired receipt (`sd:<sessionId>`
 * in redeemedPetBattleTokens plus a TTL'd `pet:battle-paid:` key) makes the
 * credit idempotent for longer than the session stays redeemable; the shared
 * dailyPetWins cap bounds the faucet, floored server-side in api/save/[name].ts
 * so a stale save cannot re-open it. The client never reports an outcome, a
 * reward, or combat numbers.
 *
 * Kill switch: DISABLE_PET_SHOWDOWN=1 (ships ON by default).
 */

const SESSION_TTL_SECONDS = 45 * 60;
// The faucet ceiling lives in the shared contract so the server, the arena
// entry and the lobby copy all read one number.
const DAILY_ARENA_WIN_CAP = SHOWDOWN_DAILY_WIN_CAP;
// In-save receipt window. Derived from the cap so it is never narrower than the
// faucet it records: a hardcoded width silently becomes too small the day
// someone raises DAILY_ARENA_WIN_CAP. (Twin constant in pet/battle-result.ts —
// the two share the array.)
const RECEIPT_HISTORY = Math.max(64, DAILY_ARENA_WIN_CAP);
// Durable receipt lifetime. Must outlast anything that can still be presented
// for payment — a Showdown session leases 45 minutes, a coliseum battle token
// 15 — with room to spare on both.
const PAID_RECEIPT_TTL_SECONDS = 24 * 60 * 60;
// The pools a SPARRING bout rolls between. All three, deliberately: the point
// of the drill is meeting opposition you did not pick, and a scrapper draw is
// as instructive as a champion one when both stand at your own pets' levels.
const SPARRING_TIERS: readonly ShowdownTier[] = ['scrapper', 'warrior', 'champion'];

// (No HOLLOW_GATE_PET_RECEIPT_TTL_SECONDS twin here, unlike pet/battle-result.ts:
// mintHollowGatePetReceipt below writes the versioned receipt through
// writeHollowGatePetResult, which owns that lifetime itself. The raw `ex:` write
// it replaced was the constant's only reader.)

const sessionKey = (playerName: string, sessionId: string) => `pet:showdown:${playerName}:${sessionId}`;
const paidReceiptKey = (playerName: string, receipt: string) => `pet:battle-paid:${playerName}:${receipt}`;

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function petArenaRyoReward(opponentLevel: number): number {
    // Same formula as /api/pet/battle-result — Showdown replaces that mode's
    // player-facing entry, so it inherits the identical economy faucet.
    return Math.max(20, opponentLevel * 2);
}

/** PvP command clock. The engine never reads a wall clock, so the deadline is
 *  ENDPOINT bookkeeping: stamped onto the session at start and re-armed by
 *  every resolved round, surfaced to the client via `turnDeadline` on the
 *  state view. Dormant today — paid Coliseum and practice entries are both AI
 *  fights (`pvp: false`), so `armTurnDeadline` is a no-op and no view carries a
 *  deadline. When live PvP lands on this engine its start path seals
 *  `pvp: true` and this arms itself; the turn handler must then ALSO resolve a
 *  lapsed round with defaults for the absent side, so a walked-away opponent
 *  cannot hold the fight hostage (the engine already defaults any missing
 *  command to guard — the enforcement is one deadline check, not new combat
 *  rules). */
function armTurnDeadline(session: ShowdownSession): void {
    if (!session.pvp || session.finished) return;
    session.turnDeadlineAt = Date.now() + SHOWDOWN_PVP_TURN_SECONDS * 1000;
}

/** The public view plus the endpoint-owned deadline (PvP only). */
function viewOf(session: ShowdownSession): Record<string, unknown> {
    return {
        ...showdownStateView(session),
        ...(session.pvp && session.turnDeadlineAt && !session.finished
            ? { turnDeadline: session.turnDeadlineAt }
            : {}),
    };
}

/** Busy gating, shared by every entry that fields pets from a save. Deliberately
 *  ONE-directional (see the note at the practice entry): a pet that is breeding,
 *  training or away cannot ENTER a Showdown, but an in-flight session does not
 *  stamp the pet busy for other systems. */
function showdownBusyIssue(char: Record<string, unknown>, pets: Pet[]): string | null {
    const breedingParents = activeBreedingParentIds(char);
    const now = Date.now();
    for (const pet of pets) {
        if (breedingParents.has(String(pet.id))) return `${pet.name} is in the breeding barn.`;
        if (pet.expedition && Number(pet.expedition.endsAt ?? 0) > now) return `${pet.name} is away on an expedition.`;
        if (pet.training && Number(pet.training.endsAt ?? 0) > now) return `${pet.name} is mid-training.`;
    }
    return null;
}

function parseCommands(raw: unknown, maxCount: number): ShowdownCommand[] {
    if (!Array.isArray(raw)) return [];
    const out: ShowdownCommand[] = [];
    for (const entry of raw.slice(0, maxCount)) {
        if (!entry || typeof entry !== 'object') continue;
        const c = entry as Record<string, unknown>;
        const petId = String(c.petId ?? '').slice(0, 96);
        if (!petId) continue;
        const kind = String(c.kind ?? '');
        if (kind === 'guard' || kind === 'rest') {
            out.push({ kind, petId });
        } else if (kind === 'switch') {
            const benchPetId = String(c.benchPetId ?? '').slice(0, 96);
            if (benchPetId) out.push({ kind, petId, benchPetId });
        } else if (kind === 'super') {
            out.push({ kind, petId, targetId: String(c.targetId ?? '').slice(0, 96) });
        } else if (kind === 'move') {
            const moveIndex = Math.max(0, Math.min(7, Math.floor(Number(c.moveIndex) || 0)));
            out.push({ kind, petId, moveIndex, targetId: String(c.targetId ?? '').slice(0, 96) });
        }
    }
    return out;
}

/** A Showdown session bound to a Hollow Gate encounter, stored BESIDE the
 *  session rather than inside it: the session type is the shared client
 *  contract, and a run binding is server-only bookkeeping the client must never
 *  see. Keyed by session id, so the session IS the receipt handle. */
interface ShowdownHollowGateBinding { runId: string; petIds: string[] }
const showdownHollowGateKey = (playerName: string, sessionId: string) => `sd-hg:${playerName}:${sessionId}`;

interface ShowdownWorldCrisis80Binding {
    crisisId: typeof WORLD_CRISIS_80_ID;
    village: WorldCrisis80Village;
    sourceId: string;
    petIds: string[];
}
const showdownWorldCrisis80Key = (playerName: string, sessionId: string) => `sd-wcr80:${playerName}:${sessionId}`;

/** Mint the exact versioned receipt Hollow Gate's settlement endpoint consumes.
 *  The writer accepts it only when the parent had already selected this
 *  Showdown session id; an unbound legacy parent cannot adopt a terminal
 *  session after its outcome is known. */
async function mintHollowGatePetReceipt(
    playerName: string,
    sessionId: string,
    binding: ShowdownHollowGateBinding,
    outcome: 'win' | 'loss',
): Promise<boolean> {
    const receipt: HollowGatePetResultReceipt = {
        version: HOLLOW_GATE_PET_AUTHORITY_VERSION,
        engine: 'showdown',
        proofId: sessionId,
        playerName,
        runId: binding.runId,
        outcome,
        playerPetIds: binding.petIds,
        settledAt: Date.now(),
    };
    return writeHollowGatePetResult(receipt);
}

/** Win payout under the save lock. Exactly-once via the paired receipts. */
export async function settleShowdownWin(playerName: string, session: ShowdownSession): Promise<Record<string, unknown>> {
    // PRACTICE AND PARENT-BOUND FIGHTS PAY NOTHING here, and pay it cheaply: no
    // lock, no save write, no receipt. Only the server-selected `arena` entry
    // seals reward eligibility for the paid Coliseum loop.
    //
    // This must ALSO leave the counters alone, which is the part that is easy
    // to get wrong: totalPetWins feeds the public 'pets' leaderboard
    // (api/player/_public-index.ts), the pet-100 achievement
    // (api/achievements/_catalog.ts) and a sector quest metric
    // (api/sector/_questbook.ts), and dailyPetWins is the shared 100/day faucet
    // counter. Incrementing either from a free, unlimited practice mode would
    // hand out leaderboard rank and achievement progress for nothing, and would
    // burn the player's real daily allowance on fights that never paid.
    if (!session.rewardEligible) {
        return { reward: 0, practice: true };
    }
    const saveKey = `save:${playerName}`;
    const receipt = `sd:${session.sessionId}`;
    const paidKey = paidReceiptKey(playerName, receipt);
    return withKvLock(saveKey, async () => {
        const record = await kv.get<Record<string, unknown>>(saveKey);
        const char = record?.character as Record<string, unknown> | undefined;
        if (!record || !char) return { reward: 0 };
        const receipts = Array.isArray(char.redeemedPetBattleTokens)
            ? (char.redeemedPetBattleTokens as unknown[]).filter((e): e is string => typeof e === 'string').slice(-(RECEIPT_HISTORY - 1))
            : [];
        // Two records of the same fact, because neither is sufficient alone. The
        // in-save array is exact — it lands in the same write as the ryo — but it
        // is a rolling window shared with the legacy coliseum, and later battles
        // evict it faster than a session expires. The durable key does not move
        // when other battles are reported, so a settled fight cannot be cashed
        // again by flushing the array out from under its receipt.
        const paidReceipt = await kv.get(paidKey) as { legacyApplied?: boolean } | null;
        if (receipts.includes(receipt) || paidReceipt) {
            const witness = petWitnessReceiptForSettlement(char, receipt);
            const legacyReceipt = `pet-showdown:${session.sessionId}`;
            const legacyStats = legacyEnabled()
                ? await kv.get<LegacyStats>(legacyStatsKey(playerName))
                : null;
            // A save/payment write can succeed just before the best-effort
            // Legacy side effect fails. Re-enter that exact-once hook only while
            // its stable receipt is genuinely missing; normal terminal replays
            // do not even attempt progression again.
            const progressionRecoveryNeeded = legacyEnabled()
                && paidReceipt?.legacyApplied !== true
                && (!legacyStats || !hasLegacyActivityReceipt(legacyStats, legacyReceipt));
            if (!progressionRecoveryNeeded && legacyEnabled() && paidReceipt?.legacyApplied !== true) {
                // Heal the TTL'd marker from the exact Legacy receipt. This
                // keeps the finite 45-minute session replay-safe even if later
                // activity rolls the bounded Legacy receipt window forward.
                await kv.set(paidKey, { sessionId: session.sessionId, at: Date.now(), legacyApplied: true }, { ex: PAID_RECEIPT_TTL_SECONDS })
                    .catch(() => undefined);
            }
            return {
                reward: 0,
                progressionEligible: progressionRecoveryNeeded,
                totalPetWins: Number(char.totalPetWins ?? 0),
                dailyPetWins: Number(char.dailyPetWins ?? 0),
                balances: { ryo: Number(char.ryo ?? 0) },
                chronicleCards: witness.granted,
                witnessedPets: witness.witnessed,
                livingWitnessProgress: witness.livingWitnessProgress,
                _saveVersion: Number(record._saveVersion ?? 0),
                character: char,
            };
        }
        const today = utcDateKey();
        const dailyPetWins = String(char.lastDailyReset ?? '') === today ? Number(char.dailyPetWins ?? 0) : 0;
        if (dailyPetWins >= DAILY_ARENA_WIN_CAP) {
            return {
                reward: 0,
                capped: true,
                totalPetWins: Number(char.totalPetWins ?? 0),
                dailyPetWins,
                balances: { ryo: Number(char.ryo ?? 0) },
                _saveVersion: Number(record._saveVersion ?? 0),
                character: char,
            };
        }
        const reward = petArenaRyoReward(session.sealedOpponentLevel);
        const paidCharacter = {
            ...char,
            redeemedPetBattleTokens: [...receipts, receipt],
            ryo: Number(char.ryo ?? 0) + reward,
            totalPetWins: Number(char.totalPetWins ?? 0) + 1,
            dailyPetWins: dailyPetWins + 1,
            lastDailyReset: today,
        };
        // The terminal session does not retain a full switch transcript. The
        // immutable opening field is the exact participation fact the server
        // can still prove; do not award Living Witness to merely selected bench
        // pets (or trust a client to claim which reserves entered later).
        const witnessedPlayerPets = session.player.slice(0, SHOWDOWN_FORMAT_SIZE[session.format]);
        const witness = recordPetArenaVictory(
            paidCharacter,
            witnessedPlayerPets.map((pet) => pet.id),
            Date.now(),
            receipt,
            witnessedPlayerPets as unknown as Pet[],
        );
        const updatedChar = witness.character;
        const updated = bumpSaveVersion({ ...record, character: updatedChar });
        await writeSaveProjected(saveKey, updated, record);
        // AFTER the paying write, never before: a failed key write must not be
        // able to swallow a reward the player earned. Until it lands the array
        // receipt is still covering, and it is covering for a full day of wins.
        await kv.set(paidKey, { sessionId: session.sessionId, at: Date.now(), legacyApplied: false }, { nx: true, ex: PAID_RECEIPT_TTL_SECONDS })
            .catch(() => undefined);
        return {
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
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (process.env.DISABLE_PET_SHOWDOWN === '1') {
        return res.status(503).json({ error: 'Pet Showdown is temporarily disabled.' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const action = String(body.action ?? '');
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only battle with your own pets.' });
        }

        // Hollow Gate is mounted on the cinematic Pet Coliseum. Older builds
        // could smuggle a run binding through the paid Showdown request and mint
        // a parallel child session. Retire only that unmounted admission shape;
        // ordinary arena matchmaking below is unchanged, while state/turn still
        // recover a Showdown session that an older server already issued.
        if (action === 'arena' && body.hollowGate != null) {
            return res.status(409).json({ error: 'Hollow Gate pet encounters use the sealed cinematic duel.' });
        }

        if (action === 'world-crisis-80') {
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-showdown-world-crisis-80', 20, 60_000, identity.name))) return;
            const sourceId = String(body.sourceId ?? '').trim().slice(0, 160);
            const petIds: string[] = Array.isArray(body.petIds)
                ? body.petIds.map((value: unknown) => String(value).slice(0, 96)).slice(0, 3)
                : [];
            if (!sourceId || petIds.length !== 3 || new Set(petIds).size !== 3) {
                return res.status(400).json({ error: 'Choose exactly three distinct carried companions for the pursuit-pack front.' });
            }
            const mySave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const myChar = mySave?.character as Record<string, unknown> | undefined;
            if (!myChar) return res.status(404).json({ error: 'No save found.' });
            const encounter = await activeWorldCrisis80Encounter({ character: myChar, sourceId, path: 'companion' });
            const myPets = activeCarriedPets<Record<string, unknown>>(myChar);
            const chosen = petIds
                .map((id) => myPets.find((pet) => String(pet?.id ?? '') === id))
                .filter(Boolean) as unknown as Pet[];
            if (chosen.length !== petIds.length) return res.status(409).json({ error: 'A chosen companion is not in your carried roster.' });
            const busyIssue = showdownBusyIssue(myChar, chosen);
            if (busyIssue) return res.status(409).json({ error: busyIssue });

            const seed = randomInt(1, 0x7fffffff);
            const built = buildShowdownAiTeam(chosen, 3, 'champion', seed, { mirrorLevels: true });
            if (built.pets.length !== 3) return res.status(500).json({ error: 'The Hollow Gate pursuit pack could not be assembled.' });
            const enemyPets = built.pets.map((pet, index) => ({ ...pet, name: encounter.petNames[index] ?? pet.name }));
            const sessionId = randomUUID().replace(/-/g, '');
            const session = createShowdownSession({
                sessionId,
                playerName,
                format: '3v3',
                tier: 'champion',
                seed,
                playerPets: chosen,
                enemyPets,
                enemyTeamName: encounter.petPackName,
                rewardEligible: false,
            });
            const binding: ShowdownWorldCrisis80Binding = {
                crisisId: WORLD_CRISIS_80_ID,
                village: encounter.village,
                sourceId: encounter.petSourceId,
                petIds: chosen.map((pet) => String(pet.id)),
            };
            armTurnDeadline(session);
            await kv.set(sessionKey(playerName, sessionId), session, { ex: SESSION_TTL_SECONDS });
            await kv.set(showdownWorldCrisis80Key(playerName, sessionId), binding, { ex: SESSION_TTL_SECONDS });
            return res.status(200).json({ ok: true, state: viewOf(session), worldCrisis80: { village: binding.village } });
        }

        if (action === 'start') {
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-showdown-start', 20, 60_000, identity.name))) return;
            const format: ShowdownFormat = body.format === '2v2' ? '2v2' : body.format === '3v3' ? '3v3' : '1v1';
            /*
             * SPARRING — the practice door's default, and the answer to "give me
             * a fight right now that is worth practising against".
             *
             * The player is not choosing an opponent, they are asking the arena
             * for one, so the two things a chosen tier decides are decided HERE
             * instead: the tier is ROLLED (the opposition varies bout to bout,
             * across all three rarity pools) and the AI is levelled slot-for-slot
             * against the team brought rather than to its average.
             *
             * Reading this flag off the body is safe in a way `body.tier` on the
             * arena entry is not: this entry seals rewardEligible FALSE
             * unconditionally below, so nothing a caller can say here reaches a
             * payout. All it can steer is its own practice.
             */
            const sparring = body.sparring === true;
            const tier: ShowdownTier = sparring
                ? SPARRING_TIERS[randomInt(0, SPARRING_TIERS.length)]
                : body.tier === 'champion' ? 'champion' : body.tier === 'warrior' ? 'warrior' : 'scrapper';
            const size = SHOWDOWN_FORMAT_SIZE[format];
            // Team = field + bench, and the bench is the same size in every
            // format (SHOWDOWN_BENCH_SIZE). The first `size` ids start on the
            // field; the rest wait as reserves.
            const teamSize = showdownTeamSize(format);
            const petIds: string[] = Array.isArray(body.petIds)
                ? body.petIds.map((v: unknown) => String(v)).slice(0, teamSize)
                : [];
            if (petIds.length < size || new Set(petIds).size !== petIds.length) {
                return res.status(400).json({ error: `Pick at least ${size} distinct pets for ${format} (up to ${teamSize} with a bench).` });
            }

            const mySave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const myChar = mySave?.character as Record<string, unknown> | undefined;
            const myPets = activeCarriedPets<Record<string, unknown>>(myChar ?? {});
            const chosen = petIds
                .map((id) => myPets.find((pet) => String(pet?.id ?? '') === id))
                .filter(Boolean) as unknown as Pet[];
            if (chosen.length !== petIds.length) return res.status(409).json({ error: 'A chosen pet is not in your carried roster.' });
            // Busy gating is deliberately ONE-directional for v1: a pet that is
            // breeding/training/on expedition cannot ENTER a Showdown, but an
            // in-flight Showdown session does not stamp the pet as busy for
            // other systems — the sealed snapshot is independent, the session
            // pays a flat level-based reward, and a 45-min KV lease is not a
            // durable assignment worth save-field + manifest churn. Revisit if
            // Showdown ever grants per-pet progression.
            const busyIssue = showdownBusyIssue(myChar ?? {}, chosen);
            if (busyIssue) return res.status(409).json({ error: busyIssue });

            const seed = randomInt(1, 0x7fffffff);
            // The AI fields a team the same SIZE as the player's (bench parity),
            // and in a sparring bout at the same LEVELS, pet for pet.
            const { pets: enemyPets, teamName } = buildShowdownAiTeam(chosen, chosen.length, tier, seed, { mirrorLevels: sparring });
            if (enemyPets.length !== chosen.length) return res.status(500).json({ error: 'Could not assemble an opponent team.' });
            const sessionId = randomUUID().replace(/-/g, '');
            const session = createShowdownSession({
                sessionId, playerName, format, tier, seed,
                playerPets: chosen, enemyPets, enemyTeamName: teamName,
                // This entry point is the player choosing a tier and an AI team
                // to fight, on demand and without limit — practice, so it pays
                // nothing. Sealed at start, never taken from the request body.
                rewardEligible: false,
            });
            armTurnDeadline(session);
            await kv.set(sessionKey(playerName, sessionId), session, { ex: SESSION_TTL_SECONDS });
            return res.status(200).json({ ok: true, state: viewOf(session) });
        }

        if (action === 'arena') {
            /*
             * THE PAID ARENA BOUT — the Coliseum's reward loop, on the Showdown
             * engine. This is deliberately a SEPARATE entry from 'start', and
             * the difference is the whole reason the split exists:
             *
             *   start  — you choose the tier and the fight, without limit. That
             *            is sparring: rewardEligible false, no counters, no cap
             *            consumed. (See settleShowdownWin.)
             *   arena  — the ARENA matches you. You do not pick the tier, the
             *            opponent is scaled to you, the daily cap is enforced,
             *            and a win pays. A player-chosen tier here would make
             *            the faucet a difficulty slider.
             *
             * Everything that decides the payout is SEALED into the session at
             * kickoff and never read from the request body afterwards — the
             * mint-token pattern this repo requires for client-reported
             * rewards. settleShowdownWin pays from session.sealedOpponentLevel
             * and nothing else.
             */
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-showdown-arena', 20, 60_000, identity.name))) return;
            const format: ShowdownFormat = body.format === '2v2' ? '2v2' : body.format === '3v3' ? '3v3' : '1v1';
            const size = SHOWDOWN_FORMAT_SIZE[format];
            const teamSize = showdownTeamSize(format);
            const petIds: string[] = Array.isArray(body.petIds)
                ? body.petIds.map((v: unknown) => String(v)).slice(0, teamSize)
                : [];
            if (petIds.length < size || new Set(petIds).size !== petIds.length) {
                return res.status(400).json({ error: `Pick at least ${size} distinct pets for ${format} (up to ${teamSize} with a bench).` });
            }

            const mySave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const myChar = mySave?.character as Record<string, unknown> | undefined;
            if (!myChar) return res.status(404).json({ error: 'No save found.' });
            const myPets = activeCarriedPets<Record<string, unknown>>(myChar);
            const chosen = petIds
                .map((id) => myPets.find((pet) => String(pet?.id ?? '') === id))
                .filter(Boolean) as unknown as Pet[];
            if (chosen.length !== petIds.length) return res.status(409).json({ error: 'A chosen pet is not in your carried roster.' });

            // Same busy gating as the practice entry: a pet that is breeding,
            // training or away cannot be fielded.
            const busyIssue = showdownBusyIssue(myChar, chosen);
            if (busyIssue) return res.status(409).json({ error: busyIssue });

            /*
             * HOLLOW GATE BINDING (optional). A Hollow Gate pet encounter is
             * still an arena bout — same engine, same bench, same cinematics —
             * but the world started it, the opponent is the run's own Hound,
             * and it pays HOLLOW GATE rewards, not the arena faucet. So it is
             * validated exactly as battle-start validated it (run token +
             * combat binding + claim check), fields the server-built Hound, and
             * seals itself reward-INELIGIBLE so a run cannot also farm ryo.
             */
            const hgBody = body.hollowGate && typeof body.hollowGate === 'object'
                ? body.hollowGate as Record<string, unknown>
                : null;
            let hollowGate: ShowdownHollowGateBinding | null = null;
            let hollowHound: Pet | null = null;
            if (hgBody) {
                const runId = String(hgBody.runId ?? '').slice(0, 96);
                const runToken = String(hgBody.token ?? '').slice(0, 64);
                const houndId = String(hgBody.houndId ?? '').slice(0, 96);
                if (!runId || !runToken || format !== '1v1' || !isHollowHoundEncounterId(houndId)) {
                    return res.status(400).json({ error: 'Invalid Hollow Gate pet encounter.' });
                }
                const [binding, run] = await Promise.all([
                    kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(runId)),
                    kv.get<HollowGateRunToken>(hollowGateRunKey(playerName, runToken)),
                ]);
                const validation = validateHollowGatePetClaim({
                    binding, activeEncounter: run?.activeEncounter, playerName, token: runToken,
                });
                if (!validation.ok) {
                    return res.status(409).json({ error: `Hollow Gate pet encounter rejected: ${validation.reason}.` });
                }
                if (binding?.runId !== runId) {
                    return res.status(409).json({ error: 'Hollow Gate pet encounter binding drifted.' });
                }
                hollowHound = buildServerHollowHound(chosen[0], binding.floor, houndId, binding.kind as HollowGateHoundKind);
                hollowGate = { runId, petIds: chosen.map((p) => String(p.id)) };
            }

            // The cap is checked BEFORE the fight, not only at settlement. A
            // capped player would otherwise fight a full bout and be told at
            // the end that it was never going to pay. A Hollow Gate bout skips
            // it: it never touches the arena faucet.
            if (!hollowGate) {
                const today = utcDateKey();
                const capped = String(myChar.lastDailyReset ?? '') === today ? Number(myChar.dailyPetWins ?? 0) : 0;
                if (capped >= DAILY_ARENA_WIN_CAP) {
                    return res.status(409).json({ error: 'You have hit the daily arena win limit. Come back tomorrow.', capped: true });
                }
            }

            // The ARENA picks the opposition, scaled to the team you brought —
            // never a tier from the body, which would let a player dial the
            // faucet's difficulty down and farm it.
            const avgLevel = Math.round(chosen.reduce((sum, p) => sum + (Number(p.level) || 1), 0) / Math.max(1, chosen.length));
            const tier: ShowdownTier = avgLevel >= 60 ? 'champion' : avgLevel >= 30 ? 'warrior' : 'scrapper';
            const seed = randomInt(1, 0x7fffffff);
            // A Hollow Gate encounter fields the run's own Hound; everything
            // else gets the arena's scaled AI team.
            const built = hollowHound
                ? { pets: [hollowHound], teamName: hollowHound.name }
                : buildShowdownAiTeam(chosen, chosen.length, tier, seed);
            const enemyPets = built.pets;
            const teamName = built.teamName;
            if (!enemyPets.length) return res.status(500).json({ error: 'Could not assemble an opponent team.' });

            const sessionId = randomUUID().replace(/-/g, '');
            const session = createShowdownSession({
                sessionId, playerName, format, tier, seed,
                playerPets: chosen, enemyPets, enemyTeamName: teamName,
                // SEALED at kickoff, never read from the body afterwards. An
                // arena bout pays (magnitude rides on sealedOpponentLevel, which
                // createShowdownSession derives from the team the server just
                // built); a Hollow Gate bout does NOT — its rewards come from
                // the run's own settlement, and paying twice would be a faucet.
                rewardEligible: !hollowGate,
            });
            armTurnDeadline(session);
            await kv.set(sessionKey(playerName, sessionId), session, { ex: SESSION_TTL_SECONDS });
            if (hollowGate) {
                // Server-only bookkeeping, stored beside the session and never
                // surfaced to the client.
                await kv.set(showdownHollowGateKey(playerName, sessionId), hollowGate, { ex: SESSION_TTL_SECONDS });
            }
            return res.status(200).json({ ok: true, state: viewOf(session), dailyCap: DAILY_ARENA_WIN_CAP });
        }

        if (action === 'encounter') {
            /*
             * THE AUTHORED ENCOUNTER — the last entry that fights an opponent
             * neither the arena nor a ladder picked: the relic-dungeon Rare Beast
             * Seal, and an admin-authored VN choice with a pet battle in it.
             *
             * These are why the legacy client sim survived. Showdown had no entry
             * that would fight a caller-specified opponent, and the obvious fix —
             * letting the client post the opponent's stats — is exactly the
             * surface this repo does not allow. So the request carries a SELECTOR
             * and nothing else: a dungeon run token, or an event id plus the
             * authored (petId, difficulty) pair naming which choice it is. The
             * server rebuilds the opponent from ITS OWN authored content
             * (_authored-encounter.ts) and never reads a stat, level, kit or name
             * off the wire.
             *
             * IT PAYS NOTHING — the seal below is a hard false. The dungeon's
             * rewards belong to its own run settlement and the event's to its
             * completion;
             * this endpoint decides an OUTCOME, not a purse. That also means the
             * daily arena cap is untouched, exactly as a Hollow Gate bout is.
             *
             * FORMAT IS 1v1 WITH NO BENCH, on purpose. Every other Showdown entry
             * carries reserves, but this one replaces a fight that was one pet
             * against one beast — handing the player three pets against a single
             * authored boss would move the difficulty far more than the engine
             * swap does, and the whole point of porting these is that the ENGINE
             * is the only thing that changes.
             */
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-showdown-encounter', 20, 60_000, identity.name))) return;
            const spec = body.encounter && typeof body.encounter === 'object' && !Array.isArray(body.encounter)
                ? body.encounter as Record<string, unknown>
                : null;
            const kind = String(spec?.kind ?? '');
            if (kind !== 'dungeon-seal' && kind !== 'story-event') {
                return res.status(400).json({ error: 'Unknown authored encounter.' });
            }
            const myPetId = Array.isArray(body.petIds) ? String(body.petIds[0] ?? '').slice(0, 96) : '';
            if (!myPetId) return res.status(400).json({ error: 'Pick one pet for this encounter.' });

            const mySave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const myChar = mySave?.character as Record<string, unknown> | undefined;
            if (!myChar) return res.status(404).json({ error: 'No save found.' });
            const myPets = activeCarriedPets<Record<string, unknown>>(myChar);
            const mine = myPets.find((pet) => String(pet?.id ?? '') === myPetId) as unknown as Pet | undefined;
            if (!mine) return res.status(409).json({ error: 'That pet is not in your carried roster.' });
            const encounterBusy = showdownBusyIssue(myChar, [mine]);
            if (encounterBusy) return res.status(409).json({ error: encounterBusy });

            let beast: Pet | null = null;
            let tier: ShowdownTier = 'champion';
            if (kind === 'dungeon-seal') {
                // Seal 3 sits behind seal 1 — the run must exist, be this
                // player's, and have its Warden already down. That ordering was
                // only ever enforced by the dungeon screen's own stage machine.
                const issue = dungeonSealRunIssue(myChar, spec?.runToken);
                if (issue) return res.status(409).json({ error: issue });
                beast = buildDungeonSealBeast(playerName, String(spec?.runToken ?? ''));
            } else {
                const eventId = String(spec?.eventId ?? '').trim().slice(0, 120);
                if (!eventId) return res.status(400).json({ error: 'An event id is required.' });
                const events = await loadAdminEventObjects();
                const authored = findAuthoredPetBattle(events.get(eventId), spec?.petId, spec?.difficulty);
                if (!authored) {
                    return res.status(409).json({ error: 'That event has no such authored pet encounter.' });
                }
                beast = buildAuthoredEventBeast(authored);
                // The authored difficulty is the only thing that may steer the
                // AI's sharpness, and it comes from the AUTHORED row, not the
                // request — the same reason the arena derives its own tier.
                tier = authored.difficulty === 'easy' ? 'scrapper'
                    : authored.difficulty === 'hard' || authored.difficulty === 'impossible' ? 'champion'
                        : 'warrior';
            }
            if (!beast) return res.status(409).json({ error: 'This encounter has no opponent to field.' });

            const seed = randomInt(1, 0x7fffffff);
            const sessionId = randomUUID().replace(/-/g, '');
            const session = createShowdownSession({
                sessionId, playerName, format: '1v1', tier, seed,
                playerPets: [mine], enemyPets: [beast], enemyTeamName: beast.name,
                rewardEligible: false,
            });
            armTurnDeadline(session);
            await kv.set(sessionKey(playerName, sessionId), session, { ex: SESSION_TTL_SECONDS });
            return res.status(200).json({ ok: true, state: viewOf(session) });
        }

        const sessionIdRaw = String(body.sessionId ?? '').trim();
        if (!/^[A-Za-z0-9]{8,64}$/.test(sessionIdRaw)) {
            return res.status(400).json({ error: 'Invalid session id.' });
        }
        const key = sessionKey(playerName, sessionIdRaw);

        if (action === 'state') {
            // A resume view is one read per screen entry, so this ceiling is far
            // above honest use; it is here so an unlimited KV read loop can't be
            // pointed at the session store, same as every sibling pet endpoint.
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-showdown-state', 30, 60_000, identity.name))) return;
            const session = await kv.get<ShowdownSession>(key);
            if (!session || session.playerName !== playerName) return res.status(404).json({ error: 'No active showdown.' });
            return res.status(200).json({ ok: true, state: viewOf(session) });
        }

        if (action === 'forfeit') {
            /*
             * A FORFEIT IS A CONCESSION, not an escape.
             *
             * This used to delete the session and answer ok. For a practice bout
             * that is harmless — a loss pays nothing either way — but the moment
             * a bout became BOUND to something (a Hollow Gate encounter), it
             * turned into a way to walk out of a fight the run is waiting on:
             * the receipt is minted by the finishing turn, so a deleted session
             * left the Gate with a sealed encounter and no outcome to settle,
             * and no path back to one.
             *
             * So a forfeit now DECIDES the session as a loss and runs the same
             * bound-encounter handshake the finishing turn runs. Conceding is
             * still free of reward consequences (a loss never pays), but it can
             * no longer strand the thing that was waiting for the answer.
             */
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-showdown-forfeit', 20, 60_000, identity.name))) return;
            const conceded = await withKvLock(key, async () => {
                const session = await kv.get<ShowdownSession>(key);
                if (!session || session.playerName !== playerName) return null;
                if (!session.finished) {
                    session.finished = true;
                    session.outcome = 'loss';
                    session.turnDeadlineAt = undefined;
                    await kv.set(key, session, { ex: SESSION_TTL_SECONDS });
                }
                return session;
            }, { failClosed: true });
            if (!conceded) return res.status(200).json({ ok: true });
            const hgBinding = await kv.get<ShowdownHollowGateBinding>(showdownHollowGateKey(playerName, conceded.sessionId));
            if (hgBinding) {
                // `nx`, so a concession cannot overwrite an outcome the fight
                // already reached — and a re-posted forfeit is a no-op.
                await mintHollowGatePetReceipt(playerName, conceded.sessionId, hgBinding, conceded.outcome ?? 'loss');
                return res.status(200).json({
                    ok: true,
                    conceded: true,
                    state: viewOf(conceded),
                    hollowGate: { runId: hgBinding.runId, petReceipt: conceded.sessionId },
                });
            }
            const crisisBinding = await kv.get<ShowdownWorldCrisis80Binding>(showdownWorldCrisis80Key(playerName, conceded.sessionId));
            if (crisisBinding?.crisisId === WORLD_CRISIS_80_ID) {
                const crisis = await recordWorldCrisis80Defense({
                    playerName,
                    village: crisisBinding.village,
                    sourceId: crisisBinding.sourceId,
                    proofId: `showdown:${conceded.sessionId}`,
                    path: 'companion',
                    outcome: 'loss',
                });
                return res.status(200).json({
                    ok: true,
                    conceded: true,
                    state: viewOf(conceded),
                    worldCrisis80: { crisis, contributed: false, village: crisisBinding.village },
                });
            }
            // Unbound bout: nothing is waiting on it, so the session goes away
            // as before rather than lingering for a full lease.
            await kv.del(key).catch(() => undefined);
            return res.status(200).json({ ok: true, conceded: true });
        }

        if (action === 'turn') {
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-showdown-turn', 60, 60_000, identity.name))) return;
            // Serialize turns on the session key so a double-tapped Fight button
            // can't resolve the same round twice.
            const turnResult = await withKvLock(key, async () => {
                const session = await kv.get<ShowdownSession>(key);
                if (!session || session.playerName !== playerName) return { error: 404 as const };
                if (session.finished) {
                    // Already resolved (e.g. payout retry after a 503): no new
                    // events; fall through to settlement below. Flagged so the
                    // settle path can tell a genuine finish from a re-post.
                    return { session, events: [], replayed: true };
                }
                const playerIds = new Set(session.player.map((p) => p.id));
                const commands = parseCommands(body.commands, session.player.length)
                    .filter((c) => playerIds.has(c.petId));
                const aiCommands = chooseShowdownAiCommands(session);
                const events = resolveShowdownRound(session, commands, aiCommands);
                armTurnDeadline(session);
                await kv.set(key, session, { ex: SESSION_TTL_SECONDS });
                return { session, events, replayed: false };
            }, { failClosed: true });

            if ('error' in turnResult) return res.status(404).json({ error: 'No active showdown.' });
            const { session, events, replayed } = turnResult;

            if (!session.finished) {
                return res.status(200).json({ ok: true, events, state: viewOf(session) });
            }

            // Finishing turn: settle, then KEEP the finished session for one
            // normal TTL instead of deleting it. Deleting made a dropped reply
            // unrecoverable — the ryo was already paid under the save lock, but
            // the retry found no session and the client told the winner "no
            // result was recorded". Retaining it lets the retry hit the
            // already-resolved branch above, which returns the terminal state
            // and no new events.
            //
            // Only the turn that FINISHES the fight stamps that lease. Stamping
            // it on every re-post kept a settled session warm for as long as
            // someone kept posting, with no expiry to run out.
            // Read the server-only parent sidecar BEFORE ordinary settlement.
            // A retained pre-cutover Hollow Gate win must never receive paid
            // arena ryo, counters, witness cards, or Legacy progress while its
            // (possibly ambiguous) parent proof is being rejected below.
            const hgBinding = await kv.get<ShowdownHollowGateBinding>(showdownHollowGateKey(playerName, session.sessionId));
            const crisisBinding = await kv.get<ShowdownWorldCrisis80Binding>(showdownWorldCrisis80Key(playerName, session.sessionId));
            let settlement: Record<string, unknown> = { reward: 0 };
            if (!hgBinding && !crisisBinding && session.outcome === 'win') {
                settlement = await settleShowdownWin(playerName, session);
                if (settlement.progressionEligible === true) {
                    const legacyApplied = await bumpLegacyStats(
                        playerName,
                        { petDuelWins: 1 },
                        {
                            receiptId: `pet-showdown:${session.sessionId}`,
                            characterForBootstrap: legacyBootstrapBeforeCounterIncrement(
                                settlement.character as Record<string, unknown> | undefined,
                                'totalPetWins',
                            ),
                        },
                    );
                    if (legacyApplied) {
                        await kv.set(
                            paidReceiptKey(playerName, `sd:${session.sessionId}`),
                            { sessionId: session.sessionId, at: Date.now(), legacyApplied: true },
                            { ex: PAID_RECEIPT_TTL_SECONDS },
                        ).catch(() => undefined);
                    } else {
                        return res.status(503).json({
                            error: 'The arena win is safe, but its Legacy record is still being sealed. Retry the finishing turn.',
                            code: 'legacy-delivery-pending',
                            retryable: true,
                        });
                    }
                }
            }
            if (!replayed) await kv.set(key, session, { ex: SESSION_TTL_SECONDS }).catch(() => undefined);
            /*
             * HOLLOW GATE HANDSHAKE. A bound bout mints the receipt the run's
             * settlement endpoint consumes — on a LOSS as well as a win, because
             * a defeat is a real Hollow Gate outcome (it ends the run) and
             * combat-settle.ts must be able to read it. The durable writer means
             * a re-posted finishing turn cannot rewrite a decided encounter, and the receipt
             * is keyed by session id, so the session the player fought IS the
             * handle they settle with — nothing client-supplied in between.
             *
             * Minted AFTER the finished session is persisted: the receipt
             * points at this session id, so the thing it points to has to be
             * durable first. Same discipline as the paid-receipt write.
             */
            if (hgBinding) {
                const parent = await kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(hgBinding.runId));
                if (!session.outcome
                    || !hollowGatePetAuthorityMatches(parent, 'showdown', session.sessionId)
                    || parent?.playerName !== playerName
                    || parent.status !== 'active'
                    || parent.settledAt) {
                    return res.status(409).json({ error: 'This Hollow Gate encounter is bound to a different pet battle proof.' });
                }
                if (!await mintHollowGatePetReceipt(playerName, session.sessionId, hgBinding, session.outcome)) {
                    return res.status(503).json({ error: 'Could not seal the exact Hollow Gate pet result — please retry.' });
                }
                settlement = { ...settlement, hollowGate: { runId: hgBinding.runId, petReceipt: session.sessionId } };
            }
            if (crisisBinding?.crisisId === WORLD_CRISIS_80_ID && session.outcome) {
                const crisis = await recordWorldCrisis80Defense({
                    playerName,
                    village: crisisBinding.village,
                    sourceId: crisisBinding.sourceId,
                    proofId: `showdown:${session.sessionId}`,
                    path: 'companion',
                    outcome: session.outcome,
                });
                settlement = {
                    ...settlement,
                    worldCrisis80: {
                        crisis,
                        contributed: session.outcome === 'win',
                        village: crisisBinding.village,
                    },
                };
            }
            return res.status(200).json({ ok: true, events, state: viewOf(session), ...settlement });
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Showdown is busy — please retry.' });
        }
        console.error('[pet/showdown]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
