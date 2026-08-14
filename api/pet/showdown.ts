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

/*
 * /api/pet/showdown — POST only. The flagship turn-based pet battle mode.
 *
 * actions:
 *   start   — seal the player's chosen pets from the save, build an AI team
 *             from the catalog, mint a KV session. The ENGINE RUNS ONLY HERE
 *             on the server; the client is a pure presentation layer.
 *   turn    — submit one round of commands; the server resolves the round and
 *             returns the turn script + updated public state. The finishing
 *             turn also pays out (win only) under the save lock with an
 *             exactly-once receipt.
 *   forfeit — concede; ends the session as a loss, no payout.
 *   state   — resume view after a refresh.
 *
 * Rewards: this entry is PRACTICE and pays nothing — see settleShowdownWin.
 * Choosing your own AI opponent on demand is a sparring match; the ryo loop
 * belongs to the fights the world starts (Hollow Gate, sector ambush,
 * clan/sector war). Eligibility is a flag sealed into the session at start
 * (`rewardEligible`), not a hardcoded zero, so the live modes can migrate onto
 * this engine later and pay without the settle path being rewritten.
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
const DAILY_ARENA_WIN_CAP = 100;   // shared faucet with the legacy coliseum cap
// In-save receipt window. Derived from the cap so it is never narrower than the
// faucet it records: a hardcoded width silently becomes too small the day
// someone raises DAILY_ARENA_WIN_CAP. (Twin constant in pet/battle-result.ts —
// the two share the array.)
const RECEIPT_HISTORY = Math.max(64, DAILY_ARENA_WIN_CAP);
// Durable receipt lifetime. Must outlast anything that can still be presented
// for payment — a Showdown session leases 45 minutes, a coliseum battle token
// 15 — with room to spare on both.
const PAID_RECEIPT_TTL_SECONDS = 24 * 60 * 60;

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
 *  state view. Dormant today — every live entry point is an AI practice fight
 *  (`pvp: false`), so `armTurnDeadline` is a no-op and no view carries a
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

/** Win payout under the save lock. Exactly-once via the paired receipts. */
async function settleShowdownWin(playerName: string, session: ShowdownSession): Promise<Record<string, unknown>> {
    // PRACTICE FIGHTS PAY NOTHING, and pay it cheaply: no lock, no save write,
    // no receipt. Picking your own AI opponent is a sparring match — the reward
    // loop lives in the fights the world starts (Hollow Gate, sector ambush,
    // clan/sector war), not in one the player can queue at will.
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
        if (receipts.includes(receipt) || await kv.get(paidKey)) {
            return {
                reward: 0,
                totalPetWins: Number(char.totalPetWins ?? 0),
                dailyPetWins: Number(char.dailyPetWins ?? 0),
                balances: { ryo: Number(char.ryo ?? 0) },
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
        const updatedChar = {
            ...char,
            redeemedPetBattleTokens: [...receipts, receipt],
            ryo: Number(char.ryo ?? 0) + reward,
            totalPetWins: Number(char.totalPetWins ?? 0) + 1,
            dailyPetWins: dailyPetWins + 1,
            lastDailyReset: today,
        };
        const updated = bumpSaveVersion({ ...record, character: updatedChar });
        await writeSaveProjected(saveKey, updated, record);
        // AFTER the paying write, never before: a failed key write must not be
        // able to swallow a reward the player earned. Until it lands the array
        // receipt is still covering, and it is covering for a full day of wins.
        await kv.set(paidKey, { sessionId: session.sessionId, at: Date.now() }, { nx: true, ex: PAID_RECEIPT_TTL_SECONDS })
            .catch(() => undefined);
        return {
            reward,
            totalPetWins: updatedChar.totalPetWins,
            dailyPetWins: updatedChar.dailyPetWins,
            balances: { ryo: Number(updatedChar.ryo) },
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

        if (action === 'start') {
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-showdown-start', 20, 60_000, identity.name))) return;
            const format: ShowdownFormat = body.format === '2v2' ? '2v2' : body.format === '3v3' ? '3v3' : '1v1';
            const tier: ShowdownTier = body.tier === 'champion' ? 'champion' : body.tier === 'warrior' ? 'warrior' : 'scrapper';
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
            const myPets = Array.isArray(myChar?.pets) ? myChar.pets as Array<Record<string, unknown>> : [];
            const chosen = petIds
                .map((id) => myPets.find((pet) => String(pet?.id ?? '') === id))
                .filter(Boolean) as unknown as Pet[];
            if (chosen.length !== petIds.length) return res.status(409).json({ error: 'A chosen pet is not in your roster.' });
            // Busy gating is deliberately ONE-directional for v1: a pet that is
            // breeding/training/on expedition cannot ENTER a Showdown, but an
            // in-flight Showdown session does not stamp the pet as busy for
            // other systems — the sealed snapshot is independent, the session
            // pays a flat level-based reward, and a 45-min KV lease is not a
            // durable assignment worth save-field + manifest churn. Revisit if
            // Showdown ever grants per-pet progression.
            const breedingParents = activeBreedingParentIds(myChar ?? {});
            const now = Date.now();
            for (const pet of chosen) {
                if (breedingParents.has(String(pet.id))) {
                    return res.status(409).json({ error: `${pet.name} is in the breeding barn.` });
                }
                if (pet.expedition && Number(pet.expedition.endsAt ?? 0) > now) {
                    return res.status(409).json({ error: `${pet.name} is away on an expedition.` });
                }
                if (pet.training && Number(pet.training.endsAt ?? 0) > now) {
                    return res.status(409).json({ error: `${pet.name} is mid-training.` });
                }
            }

            const seed = randomInt(1, 0x7fffffff);
            // The AI fields a team the same SIZE as the player's (bench parity).
            const { pets: enemyPets, teamName } = buildShowdownAiTeam(chosen, chosen.length, tier, seed);
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
            const myPets = Array.isArray(myChar.pets) ? myChar.pets as Array<Record<string, unknown>> : [];
            const chosen = petIds
                .map((id) => myPets.find((pet) => String(pet?.id ?? '') === id))
                .filter(Boolean) as unknown as Pet[];
            if (chosen.length !== petIds.length) return res.status(409).json({ error: 'A chosen pet is not in your roster.' });

            // Same busy gating as the practice entry: a pet that is breeding,
            // training or away cannot be fielded.
            const breedingParents = activeBreedingParentIds(myChar);
            const now = Date.now();
            for (const pet of chosen) {
                if (breedingParents.has(String(pet.id))) return res.status(409).json({ error: `${pet.name} is in the breeding barn.` });
                if (pet.expedition && Number(pet.expedition.endsAt ?? 0) > now) return res.status(409).json({ error: `${pet.name} is away on an expedition.` });
                if (pet.training && Number(pet.training.endsAt ?? 0) > now) return res.status(409).json({ error: `${pet.name} is mid-training.` });
            }

            // The cap is checked BEFORE the fight, not only at settlement. A
            // capped player would otherwise fight a full bout and be told at
            // the end that it was never going to pay.
            const today = utcDateKey();
            const dailyPetWins = String(myChar.lastDailyReset ?? '') === today ? Number(myChar.dailyPetWins ?? 0) : 0;
            if (dailyPetWins >= DAILY_ARENA_WIN_CAP) {
                return res.status(409).json({ error: 'You have hit the daily arena win limit. Come back tomorrow.', capped: true });
            }

            // The ARENA picks the opposition, scaled to the team you brought —
            // never a tier from the body, which would let a player dial the
            // faucet's difficulty down and farm it.
            const avgLevel = Math.round(chosen.reduce((sum, p) => sum + (Number(p.level) || 1), 0) / Math.max(1, chosen.length));
            const tier: ShowdownTier = avgLevel >= 60 ? 'champion' : avgLevel >= 30 ? 'warrior' : 'scrapper';
            const seed = randomInt(1, 0x7fffffff);
            const { pets: enemyPets, teamName } = buildShowdownAiTeam(chosen, chosen.length, tier, seed);
            if (enemyPets.length !== chosen.length) return res.status(500).json({ error: 'Could not assemble an opponent team.' });

            const sessionId = randomUUID().replace(/-/g, '');
            const session = createShowdownSession({
                sessionId, playerName, format, tier, seed,
                playerPets: chosen, enemyPets, enemyTeamName: teamName,
                // SEALED: this bout pays. The reward magnitude rides on
                // sealedOpponentLevel, which createShowdownSession derives from
                // the enemy team the server just built.
                rewardEligible: true,
            });
            armTurnDeadline(session);
            await kv.set(sessionKey(playerName, sessionId), session, { ex: SESSION_TTL_SECONDS });
            return res.status(200).json({ ok: true, state: viewOf(session), dailyPetWins, dailyCap: DAILY_ARENA_WIN_CAP });
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
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-showdown-forfeit', 20, 60_000, identity.name))) return;
            const session = await kv.get<ShowdownSession>(key);
            if (session && session.playerName === playerName) await kv.del(key).catch(() => undefined);
            return res.status(200).json({ ok: true });
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
            let settlement: Record<string, unknown> = { reward: 0 };
            if (session.outcome === 'win') {
                settlement = await settleShowdownWin(playerName, session);
            }
            if (!replayed) await kv.set(key, session, { ex: SESSION_TTL_SECONDS }).catch(() => undefined);
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
