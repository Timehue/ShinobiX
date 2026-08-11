import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { replayCasualPetDuel, parseDuelInputLog } from './_duel-replay.js';
import type { SealedDuelParams } from './_duel-replay.js';
import { SERVER_ARENA_PETS } from './_arena-ai.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { writeSaveProjected } from '../save/_projected-write.js';
import {
    derivePetRankedSettlement,
    PET_RANKED_DISABLED_REASON,
    petRankedStartsEnabled,
    settlePetRankedMatchDurably,
} from './_ranked-settlement.js';
import {
    isPetRankedMatchId,
    releasePetRankedActivePair,
} from './_ranked-engine.js';
import { loadPetRankedAuthorityToken } from './_ranked-journal.js';

// Pet Arena reward recorder. Non-ranked wins require a short-lived start token
// minted by /api/pet/battle-start for the same reportKey. The battle is still
// client-resolved, but bare result-only reward posts no longer pay out.

const ARENA_WIN_RATE_LIMIT = 5_000;   // ms — one win per 5s per player
const DAILY_ARENA_WIN_CAP = 100;       // max server-validated wins per UTC day
const HOLLOW_GATE_PET_RECEIPT_TTL_SECONDS = 24 * 60 * 60;

type PetBattleOutcome = 'win' | 'loss' | 'draw';
type HollowGatePetResultReceipt = {
    playerName: string;
    runId: string;
    outcome: PetBattleOutcome;
    playerPetIds: string[];
    settledAt: number;
};

function hollowGatePetResultKey(playerName: string, battleToken: string): string {
    return `hg-pet-result:${playerName}:${battleToken}`;
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

    // Rate limit BEFORE auth so unauthenticated spam at unknown names also
    // gets throttled. 5s window matches the realistic minimum battle length.
    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'pet-battle-result', 12, 60_000, peekName)) return;
    if (!enforceRateLimit(req, res, 'pet-battle-result-burst', 1, ARENA_WIN_RATE_LIMIT, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        let outcome = (body.outcome === 'win' || body.outcome === 'loss' || body.outcome === 'draw') ? body.outcome as PetBattleOutcome : null;
        // Ranked-pet-ladder marker. The private token — never this body — owns
        // the server-engine winner, both rating snapshots, and zero-ryo policy.
        const ranked = body.ranked === true;
        // The direct ranked result path must share the same fail-closed contract
        // as ranked-start and queue creation. This check happens before any
        // token/save read so legacy ratings-only or client-seeded tokens cannot
        // reach settlement unless the private server-engine rollout is enabled.
        // Casual/admin reports are unaffected.
        if (ranked && !petRankedStartsEnabled()) {
            return res.status(503).json({ error: PET_RANKED_DISABLED_REASON });
        }
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
        if (!outcome && !ranked) return res.status(400).json({ error: 'Invalid outcome.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own battles.' });
        }

        // reportKey is REQUIRED for wins. Previously optional, which let a
        // botted client omit it (or randomize per call) and farm the daily
        // cap with zero real battles. Admins and 'loss' outcomes are exempt
        // because losses don't pay out so duplicates are harmless.
        if (!identity.admin && !ranked && !reportKey) {
            return res.status(400).json({ error: 'Missing or invalid reportKey.' });
        }

        let casualBattleTokenKey: string | null = null;
        let casualBattleActiveKey: string | null = null;
        let casualBattleReceipt = '';
        let casualPetIds: string[] = [];
        let hollowGatePetResult: HollowGatePetResultReceipt | null = null;
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
                authoritativeOutcome?: PetBattleOutcome;
                hollowGate?: { runId?: string };
            }>(tokenKey);
            if (!tokenData || (tokenData.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
                const priorHollowGateResult = await kv.get<HollowGatePetResultReceipt>(hollowGatePetResultKey(playerName, battleToken));
                if (priorHollowGateResult?.playerName === playerName) {
                    return res.status(200).json({
                        ok: true,
                        hollowGate: true,
                        outcome: priorHollowGateResult.outcome,
                        reward: 0,
                        petReceipt: battleToken,
                    });
                }
                return res.status(200).json({ ok: true, reward: 0, reason: 'invalid-or-spent-pet-battle-token' });
            }
            if (tokenData.reportKey !== reportKey) {
                return res.status(403).json({ error: 'Pet battle token does not match this battle report.' });
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
            const sealedParams = tokenData.sealedParams ?? null;
            if (sealedParams) {
                const inputLog = parseDuelInputLog((body as Record<string, unknown>).inputLog);
                // A malformed log is NOT a payout: fall back to the sealed
                // baseline, which is the uncommanded fight. Never better than the
                // behaviour this replaced.
                if (inputLog) {
                    const meSave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const meChar = meSave?.character as Record<string, unknown> | undefined;
                    const storedPets = Array.isArray(meChar?.pets) ? meChar.pets as Array<Record<string, unknown>> : [];
                    // Re-resolved from the save and the server's own AI roster —
                    // the token carries ids, never combat stats.
                    const replayPlayerPets = (Array.isArray(tokenData.playerPetIds) ? tokenData.playerPetIds : [])
                        .map((id) => storedPets.find((pet) => String(pet?.id ?? '') === id))
                        .filter(Boolean) as unknown as Pet[];
                    const replayOpponentPets = Array.isArray(tokenData.sealedOpponentPets) && tokenData.sealedOpponentPets.length
                        ? tokenData.sealedOpponentPets
                        : (Array.isArray(tokenData.opponentPetIds) ? tokenData.opponentPetIds : [])
                            .map((id) => SERVER_ARENA_PETS[id])
                            .filter(Boolean) as Pet[];
                    if (replayPlayerPets.length && replayOpponentPets.length) {
                        try {
                            outcome = replayCasualPetDuel(replayPlayerPets, replayOpponentPets, sealedParams, inputLog).outcome;
                        } catch (replayErr) {
                            // Keep the sealed baseline rather than paying blind.
                            console.error('[pet/battle-result] input-log replay failed', replayErr);
                        }
                    }
                }
            }
            opponentLevelRaw = Math.max(1, Math.min(100, Math.floor(Number(tokenData.opponentLevel ?? opponentLevelRaw))));
            sealedOpponentLevel = opponentLevelRaw;
            const tokenReward = Number(tokenData.rewardRyo);
            if (!Number.isSafeInteger(tokenReward) || tokenReward < 20 || tokenReward > 250) {
                return res.status(409).json({ error: 'Pet battle token lacks a valid sealed reward.' });
            }
            sealedRewardRyo = tokenReward;
            casualBattleTokenKey = tokenKey;
            casualBattleActiveKey = `pet:battle-active:${playerName}`;
            casualBattleReceipt = battleToken;
            casualPetIds = Array.isArray(tokenData.playerPetIds) ? tokenData.playerPetIds : [];
            if (tokenData.hollowGate?.runId) {
                hollowGatePetResult = {
                    playerName,
                    runId: String(tokenData.hollowGate.runId),
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

        // Hollow Gate pet duels do not pay the ordinary Coliseum faucet. Their
        // server-replayed outcome becomes a one-use receipt consumed by the
        // run-bound Hollow Gate settlement endpoint.
        if (hollowGatePetResult && casualBattleTokenKey) {
            await kv.set(
                hollowGatePetResultKey(playerName, battleToken),
                hollowGatePetResult,
                { nx: true, ex: HOLLOW_GATE_PET_RECEIPT_TTL_SECONDS },
            );
            await releaseCasualBattle();
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

        const saveKey = `save:${playerName}`;

        // ── Ranked pet ladder credit (private server resolution only) ─────────
        // Only a private queue-bound token carrying a server-engine resolution
        // may select a winner.
        // A client outcome is consistency evidence, never winner authority.
        // Each side's Elo patch and idempotency receipt commit in one save write;
        // no separate receipt key can survive while its rating write is lost.
        if (ranked) {
            const matchToken = typeof body.matchToken === 'string' ? body.matchToken.trim() : '';
            if (!isPetRankedMatchId(matchToken)) {
                return res.status(400).json({ error: 'A valid pet ranked match token is required.' });
            }
            const tok = await loadPetRankedAuthorityToken(kv, matchToken);
            if (!tok) {
                return res.status(400).json({ error: 'A valid pet ranked match token is required (start via /api/pet/ranked-start).' });
            }
            if (tok.matchId !== matchToken) {
                return res.status(409).json({ error: 'Ranked token key does not match its server receipt.' });
            }
            // body.outcome is deliberately not passed. It is neither a winner
            // selector nor a required consistency input; forged and stale client
            // banners cannot change or suppress the already server-owned result.
            const decision = derivePetRankedSettlement(tok, playerName);
            if (!decision.ok) {
                if (decision.reason === 'caller-not-in-match') {
                    return res.status(403).json({ error: 'Match token does not name you.' });
                }
                return res.status(409).json({ error: 'Ranked token lacks a valid server-engine resolution.' });
            }
            outcome = decision.settlement.authoritativeOutcome;

            try {
                const out = await settlePetRankedMatchDurably(kv, {
                    matchToken,
                    token: tok,
                    lock: (key, action) => withKvLock(key, action, { failClosed: true }),
                });
                const rating = playerName === safeName(tok.a) ? out.a.rating : out.b.rating;
                await releasePetRankedActivePair(kv, [tok.a, tok.b], matchToken);
                const finalSave = await kv.get<Record<string, unknown>>(`save:${playerName}`).catch(() => null);
                const finalChar = (finalSave?.character ?? null) as Record<string, unknown> | null;
                return res.status(200).json({
                    ok: true,
                    ranked: true,
                    outcome,
                    reward: 0,
                    rating,
                    character: finalChar,
                    _saveVersion: Number(finalSave?._saveVersion ?? 0),
                });
            } catch (rankedErr) {
                // Lock contention/outage (failClosed) or a partial two-save
                // failure. Any committed side has its receipt in that same save;
                // any uncommitted side has no receipt, so retry safely finishes it.
                console.error('[pet/battle-result] ranked credit failed', rankedErr);
                return res.status(503).json({ error: 'Could not record ranked result — please retry.' });
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
                    ? (char.redeemedPetBattleTokens as unknown[]).filter((entry): entry is string => typeof entry === 'string').slice(-63)
                    : [];
                if (receipts.includes(casualBattleReceipt)) {
                    await releaseCasualBattle();
                    return {
                        ok: true,
                        reward: 0,
                        reason: 'invalid-or-spent-pet-battle-token',
                        totalPetWins: Number(char.totalPetWins ?? 0),
                        dailyPetWins: Number(char.dailyPetWins ?? 0),
                        balances: { ryo: Number(char.ryo ?? 0) },
                        _saveVersion: Number(record._saveVersion ?? 0),
                        character: char,
                    };
                }
                char.redeemedPetBattleTokens = [...receipts, casualBattleReceipt];
            }
            const pets = Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : [];
            const spentPets = pets.map((pet) => casualPetIds.includes(String(pet?.id ?? '')) && pet.loadout && typeof pet.loadout === 'object'
                ? { ...pet, loadout: { ...(pet.loadout as Record<string, unknown>), consumable: undefined } }
                : pet);
            const spentChar = { ...char, pets: spentPets };

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

            // Daily cap: stop further reward grants once the cap is hit, but
            // still acknowledge the call (so a streamer grinding all day
            // doesn't see error spam — they just stop earning).
            if (dailyPetWins >= DAILY_ARENA_WIN_CAP) {
                const spentRecord = bumpSaveVersion({ ...record, character: spentChar });
                await writeSaveProjected(saveKey, spentRecord, record);
                await releaseCasualBattle();
                return {
                    ok: true,
                    reward: 0,
                    capped: true,
                    totalPetWins: Number(char.totalPetWins ?? 0),
                    dailyPetWins,
                    balances: { ryo: Number(char.ryo ?? 0) },
                    _saveVersion: Number(record._saveVersion ?? 0),
                    character: spentChar,
                };
            }

            // Casual rewards come from the opponent PET SNAPSHOT sealed at
            // battle-start. Account level is retained only for the trusted
            // admin compatibility path, never for ordinary player receipts.
            const reward = sealedRewardRyo ?? petArenaRyoReward(opponentLevel);
            const updatedChar = {
                ...spentChar,
                ryo: Number(char.ryo ?? 0) + reward,
                totalPetWins: Number(char.totalPetWins ?? 0) + 1,
                dailyPetWins: dailyPetWins + 1,
                lastDailyReset: today,
            };
            const updated = bumpSaveVersion({ ...record, character: updatedChar });
            await writeSaveProjected(saveKey, updated, record);
            await releaseCasualBattle();
            return {
                ok: true,
                reward,
                totalPetWins: updatedChar.totalPetWins,
                dailyPetWins: updatedChar.dailyPetWins,
                balances: { ryo: Number(updatedChar.ryo) },
                _saveVersion: Number((updated as Record<string, unknown>)._saveVersion ?? 0),
                character: updatedChar,
            };
        }, { failClosed: true });

        if ('error' in result) {
            const code = result.error === 'no-save' || result.error === 'no-character' ? 404 : 500;
            return res.status(code).json({ error: result.error });
        }
        return res.status(200).json(result);
    } catch (err) {
        console.error('[pet/battle-result]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
