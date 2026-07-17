import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { cors, mergePreservingImages, safeName } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { HG_CLAWBACK_KEYS, hollowGateRunKey, HOLLOW_GATE_RUN_EXPIRED_MESSAGES, type HollowGateRunToken, type HgCurrencyKey } from './_run-token.js';
import { HOLLOW_GATE_COMBAT_TTL_SECONDS } from './_combat-session.js';

type Action = 'sanctify' | 'arm-second-wind' | 'consume-second-wind';
const COSTS = { sanctify: 14, 'arm-second-wind': 30 } as const;
const num = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

function isAction(value: unknown): value is Action {
    return value === 'sanctify' || value === 'arm-second-wind' || value === 'consume-second-wind';
}

/** Authoritative settlement-affecting Hollow Shard consumables. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const action = body.action;
        if (!playerName || !token || !isAction(action)) return res.status(400).json({ error: 'Invalid Hollow Gate consumable.' });
        if (!enforceRateLimit(req, res, 'hollow-gate-consumable', 30, 60_000, playerName)) return;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });

        const runKey = hollowGateRunKey(playerName, token);
        const result = await withKvLock(runKey, async () => {
            const run = await kv.get<HollowGateRunToken>(runKey);
            if (!run || run.playerName !== playerName) return { status: 409, body: { error: HOLLOW_GATE_RUN_EXPIRED_MESSAGES.consumable } };
            if (run.activeEncounter) return { status: 409, body: { error: 'Finish the active encounter first.' } };
            if (action === 'arm-second-wind' && run.secondWindArmed) return { status: 409, body: { error: 'Second Wind is already armed.' } };
            if (action === 'consume-second-wind' && !run.secondWindArmed) return { status: 200, body: { ok: true, alreadyReported: true } };

            const saveKey = `save:${playerName}`;
            const saved = await withKvLock(saveKey, async () => {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = record?.character as Record<string, unknown> | undefined;
                if (!record || !char) return null;
                const savedRun = char.hollowGateRun && typeof char.hollowGateRun === 'object'
                    ? char.hollowGateRun as Record<string, unknown>
                    : null;
                if (savedRun?.runToken && savedRun.runToken !== token) return { error: 'The saved run does not match the sealed run.' };

                const cost = action === 'consume-second-wind' ? 0 : COSTS[action];
                if (num(char.hollowShards) < cost) return { error: 'Not enough Hollow Shards.' };
                const nextChar: Record<string, unknown> = { ...char, hollowShards: Math.max(0, Math.floor(num(char.hollowShards) - cost)) };
                let nextRun: HollowGateRunToken = { ...run };
                let nextSavedRun: Record<string, unknown> | null = savedRun ? { ...savedRun } : null;
                if (action === 'sanctify') {
                    const entry = {} as Partial<Record<HgCurrencyKey, number>>;
                    for (const key of HG_CLAWBACK_KEYS) entry[key] = Math.max(0, Math.floor(num(nextChar[key])));
                    nextRun = { ...nextRun, entryCurrencies: entry, serverCreditedCurrencies: {} };
                    if (nextSavedRun) nextSavedRun = { ...nextSavedRun, entryCurrencies: entry };
                } else {
                    const armed = action === 'arm-second-wind';
                    nextRun = { ...nextRun, secondWindArmed: armed };
                    if (nextSavedRun) nextSavedRun = { ...nextSavedRun, secondWindArmed: armed };
                }
                if (nextSavedRun) nextChar.hollowGateRun = nextSavedRun;
                const updated = bumpSaveVersion({ ...record, character: nextChar }) as Record<string, unknown>;
                await kv.set(runKey, nextRun, { ex: HOLLOW_GATE_COMBAT_TTL_SECONDS });
                try {
                    await kv.set(saveKey, mergePreservingImages(updated, record));
                } catch (error) {
                    await kv.set(runKey, run, { ex: HOLLOW_GATE_COMBAT_TTL_SECONDS }).catch(() => undefined);
                    throw error;
                }
                return {
                    character: nextChar,
                    saveVersion: Number(updated._saveVersion ?? 0),
                    entryCurrencies: nextRun.entryCurrencies,
                    secondWindArmed: nextRun.secondWindArmed === true,
                };
            }, { failClosed: true, ttlSec: 10 });
            if (!saved) return { status: 404, body: { error: 'Player save not found.' } };
            if ('error' in saved) return { status: 409, body: { error: saved.error } };
            return { status: 200, body: {
                ok: true,
                action,
                character: saved.character,
                entryCurrencies: saved.entryCurrencies,
                secondWindArmed: saved.secondWindArmed,
                _saveVersion: saved.saveVersion,
            } };
        }, { failClosed: true, ttlSec: 10 });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[hollow-gate/use-consumable]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
