import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { cors, mergePreservingImages, safeName } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { HG_CLAWBACK_KEYS, hollowGateRunKey, HOLLOW_GATE_RUN_EXPIRED_MESSAGES, type HollowGateRunToken, type HgCurrencyKey } from './_run-token.js';
import { normalizeHollowGateLedger } from './_ledger.js';

type Action = 'reignite' | 'skeleton-key' | 'hollow-ward' | 'diviner-eye' | 'sanctify' | 'arm-second-wind';
const COSTS: Record<Action, number> = {
    reignite: 6,
    'skeleton-key': 8,
    'hollow-ward': 14,
    'diviner-eye': 16,
    sanctify: 14,
    'arm-second-wind': 30,
};
const num = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const publicRunState = (run: HollowGateRunToken) => ({
    keys: Math.max(0, Math.floor(num(run.keys))),
    torch: Math.max(0, Math.floor(num(run.torch))),
    threat: Math.max(0, Math.floor(num(run.threat))),
    wardSteps: Math.max(0, Math.floor(num(run.wardSteps))),
    divinerUsed: run.divinerUsed === true,
    secondWindArmed: run.secondWindArmed === true,
});

function isAction(value: unknown): value is Action {
    return value === 'reignite' || value === 'skeleton-key' || value === 'hollow-ward'
        || value === 'diviner-eye' || value === 'sanctify' || value === 'arm-second-wind';
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
        const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9:_-]{8,96}$/.test(body.requestId) ? body.requestId : '';
        if (!playerName || !token || !requestId || !isAction(action)) return res.status(400).json({ error: 'Invalid Hollow Gate consumable.' });
        if (!enforceRateLimit(req, res, 'hollow-gate-consumable', 30, 60_000, playerName)) return;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });

        const runKey = hollowGateRunKey(playerName, token);
        const result = await withKvLock(runKey, async () => {
            const run = await kv.get<HollowGateRunToken>(runKey);
            if (!run || run.playerName !== playerName) return { status: 409, body: { error: HOLLOW_GATE_RUN_EXPIRED_MESSAGES.consumable } };
            if (!run.chosenAugmentId) return { status: 409, body: { error: 'Choose the sealed augment before using relics.' } };
            const recent = Array.isArray(run.recentConsumableIds) ? run.recentConsumableIds : [];
            if (recent.includes(requestId)) {
                const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                return { status: 200, body: {
                    ok: true,
                    action,
                    alreadyReported: true,
                    character: record?.character ?? null,
                    entryCurrencies: run.entryCurrencies,
                    secondWindArmed: run.secondWindArmed === true,
                    runState: publicRunState(run),
                    _saveVersion: Number(record?._saveVersion ?? 0),
                } };
            }
            if (run.activeEncounter || run.pendingAmbush) return { status: 409, body: { error: 'Finish the active encounter first.' } };
            if (action === 'arm-second-wind' && run.secondWindArmed) return { status: 409, body: { error: 'Second Wind is already armed.' } };
            if (action === 'diviner-eye' && run.divinerUsed) return { status: 409, body: { error: "Diviner's Eye was already used this floor." } };
            if (action === 'reignite' && num(run.torch) >= 10) return { status: 409, body: { error: 'The Torch of Reiki is already full.' } };

            const saveKey = `save:${playerName}`;
            const saved = await withKvLock(saveKey, async () => {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = record?.character as Record<string, unknown> | undefined;
                if (!record || !char) return null;
                const savedRun = char.hollowGateRun && typeof char.hollowGateRun === 'object'
                    ? char.hollowGateRun as Record<string, unknown>
                    : null;
                if (savedRun?.runToken && savedRun.runToken !== token) return { error: 'The saved run does not match the sealed run.' };

                const cost = COSTS[action];
                if (num(char.hollowShards) < cost) return { error: 'Not enough Hollow Shards.' };
                const nextChar: Record<string, unknown> = { ...char, hollowShards: Math.max(0, Math.floor(num(char.hollowShards) - cost)) };
                let nextRun: HollowGateRunToken = { ...run };
                let nextSavedRun: Record<string, unknown> | null = savedRun ? { ...savedRun } : null;
                if (action === 'sanctify') {
                    const entry = {} as Partial<Record<HgCurrencyKey, number>>;
                    for (const key of HG_CLAWBACK_KEYS) entry[key] = Math.max(0, Math.floor(num(nextChar[key])));
                    const ledger = normalizeHollowGateLedger(nextRun);
                    nextRun = {
                        ...nextRun,
                        entryCurrencies: entry,
                        serverCreditedCurrencies: {},
                        rewardLedger: { ...ledger, currencies: {} },
                    };
                    if (nextSavedRun) nextSavedRun = { ...nextSavedRun, entryCurrencies: entry };
                } else if (action === 'arm-second-wind') {
                    nextRun = { ...nextRun, secondWindArmed: true };
                    if (nextSavedRun) nextSavedRun = { ...nextSavedRun, secondWindArmed: true };
                } else if (action === 'reignite') {
                    nextRun = { ...nextRun, torch: 10 };
                    if (nextSavedRun) nextSavedRun = { ...nextSavedRun, torch: 10 };
                } else if (action === 'skeleton-key') {
                    nextRun = { ...nextRun, keys: Math.max(0, Math.floor(num(nextRun.keys))) + 1 };
                    if (nextSavedRun) nextSavedRun = { ...nextSavedRun, keys: nextRun.keys };
                } else if (action === 'hollow-ward') {
                    nextRun = { ...nextRun, threat: 0, wardSteps: 6 };
                    if (nextSavedRun) nextSavedRun = { ...nextSavedRun, threat: 0, wardSteps: 6 };
                } else if (action === 'diviner-eye') {
                    nextRun = { ...nextRun, divinerUsed: true };
                    if (nextSavedRun) nextSavedRun = { ...nextSavedRun, diviner: true };
                }
                nextRun = { ...nextRun, recentConsumableIds: [...recent, requestId].slice(-64) };
                if (nextSavedRun) nextChar.hollowGateRun = nextSavedRun;
                const updated = bumpSaveVersion({ ...record, character: nextChar }) as Record<string, unknown>;
                await kv.set(runKey, nextRun);
                try {
                    await kv.set(saveKey, mergePreservingImages(updated, record));
                } catch (error) {
                    await kv.set(runKey, run).catch(() => undefined);
                    throw error;
                }
                return {
                    character: nextChar,
                    saveVersion: Number(updated._saveVersion ?? 0),
                    entryCurrencies: nextRun.entryCurrencies,
                    secondWindArmed: nextRun.secondWindArmed === true,
                    runState: publicRunState(nextRun),
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
                runState: saved.runState,
                _saveVersion: saved.saveVersion,
            } };
        }, { failClosed: true, ttlSec: 10 });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[hollow-gate/use-consumable]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
