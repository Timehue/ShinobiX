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
 * Reward integrity: the payout magnitude (opponent level) is SEALED at start
 * from the AI team actually generated; the outcome is engine-computed on the
 * server; the receipt (`sd:<sessionId>` in redeemedPetBattleTokens) makes the
 * credit idempotent; the shared dailyPetWins cap bounds the faucet. The client
 * never reports an outcome, a reward, or combat numbers.
 *
 * Kill switch: DISABLE_PET_SHOWDOWN=1 (ships ON by default).
 */

const SESSION_TTL_SECONDS = 45 * 60;
const DAILY_ARENA_WIN_CAP = 100;   // shared faucet with the legacy coliseum cap

const sessionKey = (playerName: string, sessionId: string) => `pet:showdown:${playerName}:${sessionId}`;

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function petArenaRyoReward(opponentLevel: number): number {
    // Same formula as /api/pet/battle-result — Showdown replaces that mode's
    // player-facing entry, so it inherits the identical economy faucet.
    return Math.max(20, opponentLevel * 2);
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
        const timing = Math.max(0, Math.min(2, Math.floor(Number(c.timing) || 0)));
        if (kind === 'guard' || kind === 'rest') {
            out.push({ kind, petId });
        } else if (kind === 'super') {
            out.push({ kind, petId, targetId: String(c.targetId ?? '').slice(0, 96), timing });
        } else if (kind === 'move') {
            const moveIndex = Math.max(0, Math.min(7, Math.floor(Number(c.moveIndex) || 0)));
            out.push({ kind, petId, moveIndex, targetId: String(c.targetId ?? '').slice(0, 96), timing });
        }
    }
    return out;
}

/** Win payout under the save lock. Exactly-once via the receipt array. */
async function settleShowdownWin(playerName: string, session: ShowdownSession): Promise<Record<string, unknown>> {
    const saveKey = `save:${playerName}`;
    const receipt = `sd:${session.sessionId}`;
    return withKvLock(saveKey, async () => {
        const record = await kv.get<Record<string, unknown>>(saveKey);
        const char = record?.character as Record<string, unknown> | undefined;
        if (!record || !char) return { reward: 0 };
        const receipts = Array.isArray(char.redeemedPetBattleTokens)
            ? (char.redeemedPetBattleTokens as unknown[]).filter((e): e is string => typeof e === 'string').slice(-63)
            : [];
        if (receipts.includes(receipt)) {
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
            const petIds: string[] = Array.isArray(body.petIds)
                ? body.petIds.map((v: unknown) => String(v)).slice(0, size)
                : [];
            if (petIds.length !== size || new Set(petIds).size !== size) {
                return res.status(400).json({ error: `Pick ${size} distinct pets for ${format}.` });
            }

            const mySave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const myChar = mySave?.character as Record<string, unknown> | undefined;
            const myPets = Array.isArray(myChar?.pets) ? myChar.pets as Array<Record<string, unknown>> : [];
            const chosen = petIds
                .map((id) => myPets.find((pet) => String(pet?.id ?? '') === id))
                .filter(Boolean) as unknown as Pet[];
            if (chosen.length !== size) return res.status(409).json({ error: 'A chosen pet is not in your roster.' });
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
            const { pets: enemyPets, teamName } = buildShowdownAiTeam(chosen, size, tier, seed);
            if (enemyPets.length !== size) return res.status(500).json({ error: 'Could not assemble an opponent team.' });
            const sessionId = randomUUID().replace(/-/g, '');
            const session = createShowdownSession({
                sessionId, playerName, format, tier, seed,
                playerPets: chosen, enemyPets, enemyTeamName: teamName,
            });
            await kv.set(sessionKey(playerName, sessionId), session, { ex: SESSION_TTL_SECONDS });
            return res.status(200).json({ ok: true, state: showdownStateView(session) });
        }

        const sessionIdRaw = String(body.sessionId ?? '').trim();
        if (!/^[A-Za-z0-9]{8,64}$/.test(sessionIdRaw)) {
            return res.status(400).json({ error: 'Invalid session id.' });
        }
        const key = sessionKey(playerName, sessionIdRaw);

        if (action === 'state') {
            const session = await kv.get<ShowdownSession>(key);
            if (!session || session.playerName !== playerName) return res.status(404).json({ error: 'No active showdown.' });
            return res.status(200).json({ ok: true, state: showdownStateView(session) });
        }

        if (action === 'forfeit') {
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
                    // events; fall through to settlement below.
                    return { session, events: [] };
                }
                const playerIds = new Set(session.player.map((p) => p.id));
                const commands = parseCommands(body.commands, session.player.length)
                    .filter((c) => playerIds.has(c.petId));
                const aiCommands = chooseShowdownAiCommands(session);
                const events = resolveShowdownRound(session, commands, aiCommands);
                await kv.set(key, session, { ex: SESSION_TTL_SECONDS });
                return { session, events };
            }, { failClosed: true });

            if ('error' in turnResult) return res.status(404).json({ error: 'No active showdown.' });
            const { session, events } = turnResult;

            if (!session.finished) {
                return res.status(200).json({ ok: true, events, state: showdownStateView(session) });
            }

            // Finishing turn: settle, then drop the session.
            let settlement: Record<string, unknown> = { reward: 0 };
            if (session.outcome === 'win') {
                settlement = await settleShowdownWin(playerName, session);
            }
            await kv.del(key).catch(() => undefined);
            return res.status(200).json({ ok: true, events, state: showdownStateView(session), ...settlement });
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
