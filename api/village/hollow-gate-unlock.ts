import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { LockContendedError, withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { parseSettlementRequestId } from '../_settlement-receipts.js';
import { runSaveDebitSaga, SaveDebitRefusal } from '../_save-debit-saga.js';
import { HOLLOW_GATE_UNLOCK_SAGA, type HollowGateUnlockPlan } from '../_save-debit-kinds.js';

const COST = 10_000;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const slug = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your village action.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-unlock', 5, 60_000, identity.name))) return;

        const saveKey = `save:${playerName}`;
        const existing = await kv.get<Record<string, unknown>>(saveKey);
        const existingChar = existing?.character as Record<string, unknown> | undefined;
        if (!existing || !existingChar) return res.status(404).json({ error: 'Player save not found.' });
        const stateKey = `game:village-state:${slug(existingChar.village)}`;
        const kageKey = `village:kage:${String(existingChar.village ?? '').toLowerCase().replace(/\s+/g, '-')}`;

        // One retry-safe settlement (api/_save-debit-saga.ts): the Honor Seal
        // debit and its receipt are one save write, the window and its receipt
        // one village-row write. A request id from the client makes a retry
        // after a lost answer return the first result instead of buying a
        // second 30 days; an unknown outcome is finished by that retry, never
        // refunded. Lock order is unchanged: Kage row, village row, save.
        const outcome = await withKvLock(kageKey, () => runSaveDebitSaga<Record<string, unknown>, HollowGateUnlockPlan, { cost: number }>({
            definition: HOLLOW_GATE_UNLOCK_SAGA,
            playerName,
            requestId: parseSettlementRequestId(body.requestId),
            identity: { village: slug(existingChar.village) },
            sharedKey: stateKey,
            resource: 'honorSeals',
            amount: COST,
            meta: { village: String(existingChar.village ?? '') },
            decide: async ({ character }) => {
                if (slug(character.village) !== slug(existingChar.village)) return { ok: false, status: 409, error: 'Your village changed. Refresh Town Hall.' };
                const kage = await kv.get<{ seatedKage?: string }>(kageKey);
                if (!identity.admin && safeName(String(kage?.seatedKage ?? '')) !== playerName) {
                    return { ok: false, status: 403, error: 'Only the seated Kage can open the Hollow Gate.' };
                }
                const seals = Math.max(0, Math.floor(Number(character.honorSeals) || 0));
                if (seals < COST) return { ok: false, status: 409, error: 'Insufficient Honor Seals.' };
                return { ok: true, character: { ...character, honorSeals: seals - COST }, plan: { windowMs: WINDOW_MS, cost: COST }, result: { cost: COST } };
            },
            messages: {
                refunded: 'The gate could not be opened, so your Honor Seals were refunded. Please retry.',
                pending: 'Your Honor Seals were spent but the gate did not open yet. Press again to finish it; you will not be charged twice.',
            },
        }), { failClosed: true });

        return res.status(200).json({
            ok: true,
            character: outcome.character,
            _saveVersion: outcome._saveVersion,
            hollowGateUnlockedUntil: Number(outcome.shared.hollowGateUnlockedUntil) || 0,
            cost: COST,
            ...(outcome.replayed ? { replayed: true } : {}),
        });
    } catch (error) {
        if (error instanceof SaveDebitRefusal) return res.status(error.status).json({ ...error.details, error: error.message });
        if (error instanceof LockContendedError) return res.status(503).json({ error: 'Town Hall is busy. Nothing was spent; press again.', retryable: true });
        console.error('[village/hollow-gate-unlock]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
