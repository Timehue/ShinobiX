import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { onlineStore } from '../_realtime/online-store.js';
import { shrineById, shrineTier, SHRINE_MIN_OFFERING, SHRINE_MAX_OFFERING } from '../../shared/shrines.js';
import { applyOffering, parseShrineState, shrineKey, TOP_OFFERERS_SHOWN } from './_traces.js';

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
 * Body: { playerName, shrineId, amount }
 * → { ok:true, shrine:{…}, ryo } | { ok:false, reason } | { error }
 */

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

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'shrine-offer', 10, 60_000, identity.name, { strict: true }))) return;

        // Validate co-presence at action time (never trust the client's roster).
        const now = Date.now();
        if (!identity.admin) {
            const actor = onlineStore.get(playerName);
            if (!actor) return res.status(409).json({ error: 'World presence is not ready. Please try again.' });
            if (actor.sector !== def.sector) return res.status(409).json({ error: `Travel to ${def.name} in sector ${def.sector} to make an offering.` });
            if (actor.travelingUntil && actor.travelingUntil > now) return res.status(409).json({ error: 'You cannot make an offering while traveling.' });
            if (actor.inBattle) return res.status(409).json({ error: 'You cannot make an offering mid-battle.' });
        }

        // Shrine lock wraps the save debit (the settleTravelLease nesting precedent:
        // shared-resource lock outside, per-save lock inside via mutatePlayerSave).
        const out = await withKvLock<{ status: number; body: unknown }>(shrineKey(def.id), async () => {
            const debit = await mutatePlayerSave<number>(playerName, ({ character }) => {
                const ryo = Math.floor(Number((character as Record<string, unknown>).ryo ?? 0)) || 0;
                if (ryo < amount) {
                    return { ok: false, status: 400, error: `Not enough ryo — you have ${ryo.toLocaleString()}.` };
                }
                return { ok: true, character: { ...character, ryo: ryo - amount }, value: ryo - amount };
            });
            if (!debit.ok) return { status: debit.status, body: { error: debit.error } };

            const state = applyOffering(parseShrineState(await kv.get(shrineKey(def.id))), playerName, amount, now);
            await kv.set(shrineKey(def.id), state);
            const tier = shrineTier(state.total);
            return {
                status: 200,
                body: {
                    ok: true,
                    ryo: debit.value,
                    shrine: {
                        id: def.id,
                        name: def.name,
                        theme: def.theme,
                        ...(def.village ? { village: def.village } : {}),
                        region: def.region,
                        lore: def.lore,
                        blessing: def.blessing,
                        tier,
                        total: state.total,
                        weekTotal: state.weekTotal,
                        topWeek: state.topWeek.slice(0, TOP_OFFERERS_SHOWN),
                        lastWeek: state.lastWeek
                            ? { week: state.lastWeek.week, topWeek: state.lastWeek.topWeek.slice(0, TOP_OFFERERS_SHOWN) }
                            : null,
                    },
                },
            };
        }, { failClosed: true });
        return res.status(out.status).json(out.body);
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'The shrine is busy — please retry.' });
        }
        console.error('[sector/shrine-offer]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
