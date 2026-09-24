import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError } from '../_lock.js';
import { masteryBonus, masteryHasCapstone } from '../_profession-mastery.js';
import { kv } from '../_storage.js';
import { weekEndsAt, weekKey } from '../missions/_weekly-board.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { randomUUID } from 'node:crypto';

// Honor Seal training speedup. Each Seal reduces the active jutsu lesson's
// timer (ryo or Seal lesson alike) by 10 minutes, up to the blocks that remain.
// activeJutsuTraining is server-owned; the client mirrors the new endsAt and
// adopts the returned _saveVersion.
const MINUTES_PER_SEAL = 10;
const MAX_SEALS_PER_CALL = 20;

// Vanguard Rank 8+ pays 90% of the listed cost (10% discount).
const VANGUARD_RANK_FOR_DISCOUNT = 8;
const VANGUARD_DISCOUNT_MULT = 0.9;

/**
 * Seals actually charged for `seals` worth of time. Vanguard Rank 8+ pays 90%,
 * and the Quartermaster "Stockpile" mastery node (-5% per rank,
 * `sealSpeedupCostPct`) stacks multiplicatively, capped at 50% — the node was
 * advertised in the mastery tree but never read here, so it did nothing.
 */
export function effectiveSpeedupCost(seals: number, character: Record<string, unknown>): number {
    let cost = seals;
    if (character.profession === 'vanguard' && Number(character.professionRank ?? 0) >= VANGUARD_RANK_FOR_DISCOUNT) {
        cost *= VANGUARD_DISCOUNT_MULT;
    }
    const masteryPct = Math.min(50, masteryBonus(character.profession, character.masterySpec, 'sealSpeedupCostPct'));
    if (masteryPct > 0) cost *= 1 - masteryPct / 100;
    return Math.max(1, Math.ceil(cost));
}

type Reply = { status: number; body: Record<string, unknown> };

/*
 * Quartermaster capstone "Logistician": one free jutsu-lesson speedup per week.
 * Spent as a deliberate "Finish now — free" on the active lesson (a separate
 * button, so an ordinary −10 min click never burns it), for 0 Seals. The week
 * is the weekly mission board's (resets Monday 00:00 UTC). Usage is a dated key
 * outside the save — the same shape as the other per-period counters — so no
 * client autosave can reset it; it is claimed NX under the save lock.
 */
const LOGISTICIAN_ID = 'logistician';
const LOGISTICIAN_KEY_TTL_SEC = 8 * 24 * 60 * 60;
/** A lesson this close to done isn't worth the weekly free finish. */
export const LOGISTICIAN_MIN_REMAINING_MS = 60_000;
export const logisticianKey = (playerName: string, now: number) => `logistician-speedup:${playerName}:${weekKey(now)}`;

function ownsLogistician(character: Record<string, unknown>): boolean {
    return masteryHasCapstone(character.profession, character.masterySpec, LOGISTICIAN_ID);
}

/** Hand back a claim only while it is still ours (the token matches). */
async function releaseFreeClaim(claim: { key: string; token: string } | null): Promise<void> {
    if (!claim) return;
    try { await kv.delIfEqual(claim.key, claim.token); } catch { /* the week's key expires on its own */ }
}

/** GET ?playerName= — does this player have a free Logistician speedup this week? */
async function logisticianStatus(req: VercelRequest, res: VercelResponse) {
    try {
        const playerName = safeName(String(req.query.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your character.' });
        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = (record?.character ?? {}) as Record<string, unknown>;
        const now = Date.now();
        const owned = ownsLogistician(character);
        const used = owned ? Boolean(await kv.get(logisticianKey(playerName, now))) : false;
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ logistician: { owned, available: owned && !used, resetsAt: weekEndsAt(now) } });
    } catch (err) {
        console.error('[jutsu/speedup status]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method === 'GET') return logisticianStatus(req, res);
    if (req.method !== 'POST') return res.status(405).end();

    let freeClaim: { key: string; token: string } | null = null;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const useFree = body.free === true;
        const sealsRequested = Math.floor(Number(body.seals ?? 0));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!useFree && (!Number.isFinite(sealsRequested) || sealsRequested <= 0)) {
            return res.status(400).json({ error: 'seals must be a positive integer.' });
        }
        if (!useFree && sealsRequested > MAX_SEALS_PER_CALL) {
            return res.status(400).json({ error: `Max ${MAX_SEALS_PER_CALL} Seals per call.` });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only spend your own Seals.' });
        }

        // Per-player rate limit. Legit use is "click the speedup button a
        // handful of times to skip a training" — 10/min is generous. Without
        // this gate, a leaked password lets an attacker burst-spam the
        // endpoint and drain the victim's Honor Seals balance even though
        // the per-call lock + balance check prevents over-spending in any
        // single call. (Each call still costs Seals up to the call cap.)
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'jutsu-speedup', 10, 60_000, identity.name))) return;

        // mutatePlayerSave runs the read-modify-write under lock:save:<name> (so
        // two concurrent speedups can't both spend against one balance), bumps
        // _saveVersion, and projects the Seal debit into the currency ledger —
        // the old hand-rolled kv.set skipped the ledger, and echoed the version
        // from BEFORE its bump, so the client never adopted the new version and
        // its next autosave hit a 409.
        const refuse = (character: Record<string, unknown>, reply: Reply) =>
            ({ ok: true as const, character, value: reply, write: false });
        const result = await mutatePlayerSave<Reply>(playerName, async ({ record, character: char }) => {
            // Verify there's actually an active jutsu lesson that isn't already
            // finished — otherwise the player would lose Seals for nothing.
            const activeJutsuTraining = record.activeJutsuTraining as { endsAt?: number; jutsuId?: string } | undefined | null;
            if (!activeJutsuTraining || !activeJutsuTraining.endsAt) {
                return refuse(char, { status: 400, body: { error: 'No active jutsu training to speed up.' } });
            }
            const now = Date.now();
            const remainingMs = Number(activeJutsuTraining.endsAt) - now;
            if (remainingMs <= 0) {
                return refuse(char, { status: 400, body: { error: 'Your training is already complete — collect it instead.' } });
            }
            const remainingMinutes = Math.ceil(remainingMs / 60_000);
            const blocksLeft = Math.ceil(remainingMinutes / MINUTES_PER_SEAL);

            if (useFree) {
                // Logistician: finish the lesson for 0 Seals, once per week.
                if (!ownsLogistician(char)) {
                    return refuse(char, { status: 403, body: { error: 'The free weekly speedup needs the Logistician mastery capstone.' } });
                }
                if (remainingMs < LOGISTICIAN_MIN_REMAINING_MS) {
                    return refuse(char, { status: 400, body: { error: 'This lesson is nearly done — save your free weekly speedup for a longer one.' } });
                }
                // Claim with a unique token, recorded BEFORE the write: if the write
                // lands but its reply is lost (throws), the catch below can still
                // hand back exactly this claim — delete-if-still-ours never touches
                // another request's claim.
                const key = logisticianKey(playerName, now);
                const token = `${now}:${randomUUID()}`;
                freeClaim = { key, token };
                const claimed = await kv.set(key, token, { nx: true, ex: LOGISTICIAN_KEY_TTL_SEC });
                if (!claimed) {
                    freeClaim = null;
                    return refuse(char, { status: 409, body: { error: 'You already used this week\'s free speedup.', resetsAt: weekEndsAt(now) } });
                }
                return {
                    ok: true as const,
                    character: char,
                    recordPatch: { activeJutsuTraining: { ...activeJutsuTraining, endsAt: now } },
                    value: {
                        status: 200,
                        body: {
                            ok: true, free: true, sealsRequested: blocksLeft, sealsSpent: 0,
                            minutesReduced: remainingMinutes, honorSealsRemaining: Number(char.honorSeals ?? 0),
                            newEndsAt: now, freeResetsAt: weekEndsAt(now),
                        },
                    },
                };
            }

            const cost = effectiveSpeedupCost(sealsRequested, char);
            const balance = Number(char.honorSeals ?? 0);
            if (balance < cost) {
                return refuse(char, { status: 402, body: { error: 'Not enough Honor Seals.', cost, balance } });
            }

            const requestedMinutes = sealsRequested * MINUTES_PER_SEAL;
            // Don't sell more Seals than the time left needs. The last Seal may
            // cover a partial block: 25 minutes left takes 3 Seals. Rejecting any
            // request past the exact minutes refused the very `maxSeals` this
            // reply suggests, so "Finish now" could never finish a lesson whose
            // remainder wasn't a multiple of 10 minutes.
            if (sealsRequested > blocksLeft) {
                return refuse(char, {
                    status: 400,
                    body: {
                        error: `Only ${remainingMinutes} minute(s) of training left — buy fewer Seals.`,
                        remainingMinutes,
                        maxSeals: blocksLeft,
                    },
                });
            }

            // Report what was actually taken off: a partial last block buys the
            // remainder, not a full 10 minutes (endsAt is clamped to now anyway).
            const minutesReduced = Math.min(requestedMinutes, remainingMinutes);
            const newEndsAt = Math.max(now, Number(activeJutsuTraining.endsAt) - requestedMinutes * 60_000);
            return {
                ok: true as const,
                character: { ...char, honorSeals: balance - cost },
                recordPatch: { activeJutsuTraining: { ...activeJutsuTraining, endsAt: newEndsAt } },
                value: {
                    status: 200,
                    body: {
                        ok: true,
                        sealsRequested,
                        sealsSpent: cost,
                        minutesReduced,
                        honorSealsRemaining: balance - cost,
                        newEndsAt,
                    },
                },
            };
        });
        if (!result.ok) {
            await releaseFreeClaim(freeClaim);
            return res.status(result.status).json({ error: result.error });
        }
        // Committed: a claimed free speedup is spent for good from here on.
        freeClaim = null;
        const { status, body: reply } = result.value;
        return res.status(status).json(status === 200 ? { ...reply, _saveVersion: result._saveVersion } : reply);
    } catch (err) {
        // A claimed free speedup whose save write never landed is handed back.
        await releaseFreeClaim(freeClaim);
        if (err instanceof LockContendedError) {
            res.setHeader('Retry-After', '1');
            return res.status(503).json({ error: 'Your save is being updated. Retrying is safe.' });
        }
        console.error('[jutsu/speedup]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
