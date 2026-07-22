import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { completeEconomyTx, failEconomyTx, makeEconomyTxId, markEconomyTx, reserveEconomyTx } from '../_economy-tx.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, mergePreservingImages, safeName } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';

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

        const out = await withKvLock(stateKey, async () => withKvLock(saveKey, async () => {
            const save = await kv.get<Record<string, unknown>>(saveKey);
            const character = save?.character as Record<string, unknown> | undefined;
            const state = await kv.get<Record<string, unknown>>(stateKey) ?? {};
            if (!save || !character) return { ok: false as const, status: 404, error: 'Player save not found.' };
            if (!identity.admin && safeName(String(state.seatedKage ?? '')) !== playerName) {
                return { ok: false as const, status: 403, error: 'Only the seated Kage can open the Hollow Gate.' };
            }
            const seals = Math.max(0, Math.floor(Number(character.honorSeals) || 0));
            if (seals < COST) return { ok: false as const, status: 409, error: 'Insufficient Honor Seals.' };

            const until = Math.max(Date.now(), Math.max(0, Number(state.hollowGateUnlockedUntil) || 0)) + WINDOW_MS;
            const txId = makeEconomyTxId('hollow-gate-unlock');
            await reserveEconomyTx({
                id: txId, kind: 'hollow-gate-unlock', debitKey: saveKey, creditKey: stateKey,
                resource: 'honorSeals', amount: COST, meta: { playerName, until },
            });
            const nextSave = bumpSaveVersion<Record<string, unknown>>({ ...save, character: { ...character, honorSeals: seals - COST } });
            await kv.set(saveKey, mergePreservingImages(nextSave, save));
            await markEconomyTx(txId, 'debit-applied').catch(() => undefined);
            try {
                await kv.set(stateKey, { ...state, hollowGateUnlockedUntil: until });
            } catch (creditError) {
                try {
                    const refund = bumpSaveVersion<Record<string, unknown>>({ ...nextSave, character: { ...(nextSave.character as Record<string, unknown>), honorSeals: seals } });
                    await kv.set(saveKey, mergePreservingImages(refund, nextSave));
                    await completeEconomyTx(txId, { note: 'Village-state write failed; Honor Seals refunded.' }).catch(() => undefined);
                    return { ok: false as const, status: 503, error: 'The gate could not be opened, so your Honor Seals were refunded. Please retry.' };
                } catch (refundError) {
                    await failEconomyTx(txId, refundError, { note: 'Village-state write and automatic Honor Seal refund both failed.', meta: { playerName, until, creditError: String(creditError) } }).catch(() => undefined);
                    return { ok: false as const, status: 503, error: 'The gate could not be opened and the refund needs administrator reconciliation. Please do not retry.' };
                }
            }
            await completeEconomyTx(txId).catch(() => undefined);
            return { ok: true as const, character: nextSave.character as Record<string, unknown>, _saveVersion: Number(nextSave._saveVersion ?? 0), until };
        }, { failClosed: true }), { failClosed: true });

        if (!out.ok) return res.status(out.status).json({ error: out.error });
        return res.status(200).json({ ok: true, character: out.character, _saveVersion: out._saveVersion, hollowGateUnlockedUntil: out.until, cost: COST });
    } catch (error) {
        console.error('[village/hollow-gate-unlock]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
