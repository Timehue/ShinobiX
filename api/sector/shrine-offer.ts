import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError } from '../_lock.js';
import { parseSettlementRequestId } from '../_settlement-receipts.js';
import { runSaveDebitSaga, SaveDebitRefusal } from '../_save-debit-saga.js';
import { SHRINE_OFFER_SAGA } from '../_save-debit-kinds.js';
import { onlineStore } from '../_realtime/online-store.js';
import { shrineById, shrineTier, SHRINE_MIN_OFFERING, SHRINE_MAX_OFFERING } from '../../shared/shrines.js';
import { shrineKey, TOP_OFFERERS_SHOWN, type ShrineState } from './_traces.js';

/*
 * /api/sector/shrine-offer — POST only
 *
 * Offer ryo at a sector shrine (shared/shrines.ts). This is a pure currency
 * SINK: the server debits the save under the usual failClosed save lock and
 * credits the shrine ledger (lifetime total → cosmetic tier, weekly top-offerer
 * board) — no payout path exists, so there is nothing to farm. Standing at the
 * shrine matters: the actor must be live in the shrine's sector, not traveling
 * and not mid-battle (the same authoritative co-presence gate world attacks
 * re-check at action time).
 *
 * Retry-safe (issue #179, api/_save-debit-saga.ts). `requestId` (optional,
 * 16–80 chars) is the offering's identity: the debit and its receipt land in
 * one save write, the ledger credit and its receipt in one ledger write, so
 * the same id never charges twice. A retry after a lost response returns the
 * original result. If the ledger write fails, the charge is given back in the
 * same request (503, `refunded`), so a failed board write never keeps the
 * debit; if the process stops between the two writes, the retry finishes the
 * offering instead. A body without an id still settles exactly once, it just
 * cannot be recognized when it is sent again (older clients).
 *
 * Body: { playerName, shrineId, amount, requestId? }
 * → { ok:true, shrine:{…}, ryo, _saveVersion, replayed? } | { error }
 */

function shrineView(def: NonNullable<ReturnType<typeof shrineById>>, state: ShrineState) {
    return {
        id: def.id,
        name: def.name,
        theme: def.theme,
        ...(def.village ? { village: def.village } : {}),
        region: def.region,
        lore: def.lore,
        blessing: def.blessing,
        tier: shrineTier(state.total),
        total: state.total,
        weekTotal: state.weekTotal,
        topWeek: state.topWeek.slice(0, TOP_OFFERERS_SHOWN),
        lastWeek: state.lastWeek
            ? { week: state.lastWeek.week, topWeek: state.lastWeek.topWeek.slice(0, TOP_OFFERERS_SHOWN) }
            : null,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        const def = shrineById(typeof body.shrineId === 'string' ? body.shrineId : '');
        if (!def) return res.status(400).json({ error: 'Unknown shrine.' });
        const amount = Math.floor(Number(body.amount ?? NaN));
        if (!Number.isFinite(amount) || amount < SHRINE_MIN_OFFERING || amount > SHRINE_MAX_OFFERING) {
            return res.status(400).json({ error: `Offerings are ${SHRINE_MIN_OFFERING.toLocaleString()}–${SHRINE_MAX_OFFERING.toLocaleString()} ryo.` });
        }
        const requestId = parseSettlementRequestId(body.requestId);
        if (body.requestId !== undefined && body.requestId !== null && !requestId) {
            return res.status(400).json({ error: 'Invalid requestId.' });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'shrine-offer', 10, 60_000, identity.name, { strict: true }))) return;

        // Shrine lock outside, save lock inside (the settleTravelLease nesting
        // precedent) — the saga keeps that order.
        const settled = await runSaveDebitSaga({
            definition: SHRINE_OFFER_SAGA,
            playerName,
            requestId,
            identity: { shrineId: def.id, amount },
            sharedKey: shrineKey(def.id),
            resource: 'ryo',
            amount,
            meta: { shrineId: def.id },
            decide: ({ character }) => {
                // Co-presence is judged when the offering is MADE. A retry of an
                // offering that already went through never re-runs it, so a
                // player who walked away is still answered with their result.
                if (!identity.admin) {
                    const now = Date.now();
                    const actor = onlineStore.get(playerName);
                    if (!actor) return { ok: false, status: 409, error: 'World presence is not ready. Please try again.' };
                    if (actor.sector !== def.sector) return { ok: false, status: 409, error: `Travel to ${def.name} in sector ${def.sector} to make an offering.` };
                    if (actor.travelingUntil && actor.travelingUntil > now) return { ok: false, status: 409, error: 'You cannot make an offering while traveling.' };
                    if (actor.inBattle) return { ok: false, status: 409, error: 'You cannot make an offering mid-battle.' };
                }
                const ryo = Math.floor(Number(character.ryo ?? 0)) || 0;
                if (ryo < amount) return { ok: false, status: 400, error: `Not enough ryo — you have ${ryo.toLocaleString()}.` };
                return {
                    ok: true,
                    character: { ...character, ryo: ryo - amount },
                    plan: { name: playerName, amount },
                    result: { ryo: ryo - amount },
                };
            },
            messages: {
                refunded: 'The shrine did not take your offering, so your ryo was returned. Please try again.',
                pending: 'Your offering was taken but not yet recorded. Offer again to finish it; you will not be charged twice.',
            },
        });
        return res.status(200).json({
            ok: true,
            // The CURRENT balance: on a replay the stored one may be stale.
            ryo: Math.floor(Number(settled.character.ryo ?? 0)) || 0,
            _saveVersion: settled._saveVersion,
            ...(settled.replayed ? { replayed: true } : {}),
            shrine: shrineView(def, settled.shared),
        });
    } catch (err) {
        if (err instanceof SaveDebitRefusal) {
            return res.status(err.status).json({ ...err.details, error: err.message });
        }
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'The shrine is busy — please retry.', retryable: true });
        }
        console.error('[sector/shrine-offer]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
