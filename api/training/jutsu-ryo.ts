import { safeLogValue } from '../_safe-log.js';
import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { advanceQueuedJutsuRyoTraining, cancelQueuedJutsuRyoTraining, queueJutsuRyoTraining, settleJutsuRyoTraining, startJutsuRyoTraining, type ServerJutsuTraining } from './_jutsu-ryo.js';
import { JUTSU_CATALOG } from '../pvp/_jutsu-catalog.js';
import { loadAdminJutsuObjects, type AdminJutsu } from '../_admin-jutsu-catalog.js';
import { characterMayUseJutsu } from '../pvp/_bloodline-gate.js';
import { moraleForCharacter } from '../_war-morale.js';
import { LockContendedError } from '../_lock.js';

const JUTSU_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const REQUEST_ID = /^[A-Za-z0-9-]{12,80}$/;
type Receipt = { requestId: string; action: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? '')); const action = String(body.action ?? ''); const requestId = String(body.requestId ?? '');
        if (!playerName || !['start', 'complete', 'cancel', 'finish', 'queue', 'cancel-queue', 'advance'].includes(action) || !REQUEST_ID.test(requestId)) return res.status(400).json({ error: 'Invalid jutsu training request.' });
        const identity = await authedPlayerOrAdmin(req, playerName); if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your training.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'jutsu-ryo', 20, 60_000, identity.name))) return;
        // Admin-authored jutsu are shared content stored on save:admin1/admin2 — a
        // player's own record never holds a copy (creatorJutsus is server-owned),
        // so the ownership check below has to consult those slots or every custom
        // jutsu the client lists is rejected as unknown. Loaded outside the save
        // lock (and memoized) so it costs nothing on the built-in path.
        // Ids come back exactly as authored, so key a lowercase map to match the
        // normalized jutsuId the checks below compare against. The full objects
        // (not just ids) are needed so the bloodline gate can read the element.
        const adminJutsuById = new Map<string, AdminJutsu>();
        if (action === 'start' || action === 'queue') {
            for (const [id, jutsu] of await loadAdminJutsuObjects()) adminJutsuById.set(id.toLowerCase(), jutsu);
        }
        const adminJutsuIds = new Set(adminJutsuById.keys());
        const result = await mutatePlayerSave<Record<string, unknown>>(playerName, async ({ record, character }) => {
            const receipts = Array.isArray(character.redeemedJutsuTrainingActions) ? (character.redeemedJutsuTrainingActions as Receipt[]).slice(-127) : [];
            if (receipts.some((entry) => entry?.requestId === requestId)) return { ok: true as const, character, recordPatch: { activeJutsuTraining: record.activeJutsuTraining ?? null }, value: { activeJutsuTraining: record.activeJutsuTraining ?? null, replayed: true, cost: 0, refund: 0 } };
            let changed;
            const jutsuIsKnown = (jutsuId: string) => {
                const learned = Array.isArray(character.jutsuMastery) && (character.jutsuMastery as Array<{ jutsuId?: unknown }>).some((row) => row?.jutsuId === jutsuId);
                const customJutsus = [
                    ...(Array.isArray(record.creatorJutsus) ? record.creatorJutsus as unknown[] : []),
                    ...(Array.isArray(record.savedBloodlines) ? (record.savedBloodlines as Array<{ jutsus?: unknown[] }>).flatMap((bloodline) => Array.isArray(bloodline?.jutsus) ? bloodline.jutsus : []) : []),
                ];
                const customKnown = customJutsus.some((entry) => entry && typeof entry === 'object' && String((entry as Record<string, unknown>).id ?? '').toLowerCase() === jutsuId);
                return Boolean(JUTSU_CATALOG[jutsuId] || customKnown || learned || adminJutsuIds.has(jutsuId));
            };
            // Bloodline access gate (api/pvp/_bloodline-gate.ts): an id EXISTING is
            // not enough — a bloodline-only jutsu can be trained only when the save
            // carries the granting bloodline. Combat resolution now drops ungated
            // jutsu too (resolveEquippedLoadout); rejecting here as well keeps the
            // player from sinking ryo into a jutsu that will never seal into a fight.
            const jutsuBloodlineBlocked = (jutsuId: string) => {
                const fromSave = [
                    ...(Array.isArray(record.creatorJutsus) ? record.creatorJutsus as unknown[] : []),
                    ...(Array.isArray(record.savedBloodlines) ? (record.savedBloodlines as Array<{ jutsus?: unknown[] }>).flatMap((bloodline) => Array.isArray(bloodline?.jutsus) ? bloodline.jutsus : []) : []),
                ].find((entry) => entry && typeof entry === 'object' && String((entry as Record<string, unknown>).id ?? '').toLowerCase() === jutsuId) as Record<string, unknown> | undefined;
                const def = JUTSU_CATALOG[jutsuId] ?? adminJutsuById.get(jutsuId) ?? fromSave;
                if (!def || typeof def !== 'object') return false;
                return !characterMayUseJutsu(character, record, { id: jutsuId, element: (def as Record<string, unknown>).element });
            };
            // Village war MORALE, resolved SERVER-SIDE from village-state: a
            // rallying village trains faster while legacy winner morale is neutral,
            // independently of the client-reported bonus (which is separately clamped).
            const jutsuMorale = await moraleForCharacter(character, Date.now());
            if (action === 'start') {
                if (record.activeJutsuTraining) return { ok: false as const, status: 409, error: 'jutsu-training-already-active' };
                const jutsuId = String(body.jutsuId ?? '').trim().toLowerCase(); if (!JUTSU_ID.test(jutsuId)) return { ok: false as const, status: 400, error: 'invalid-jutsu-id' };
                if (!jutsuIsKnown(jutsuId)) return { ok: false as const, status: 409, error: 'unknown-or-unowned-jutsu' };
                if (jutsuBloodlineBlocked(jutsuId)) return { ok: false as const, status: 409, error: 'bloodline-required' };
                changed = startJutsuRyoTraining(character, jutsuId, String(body.label ?? jutsuId), randomUUID().replace(/-/g, ''), Date.now(), body.trainingBonusPct, jutsuMorale.jutsuTimeMult);
            } else {
                const active = record.activeJutsuTraining && typeof record.activeJutsuTraining === 'object' ? record.activeJutsuTraining as ServerJutsuTraining : null;
                // A pre-modern lease carries no serverToken at all, so token matching
                // can never admit it — which refused `complete` AND `cancel` alike and
                // left the player unable to start anything new, with the ryo already
                // spent. Settlement reads only the record's own sealed fields
                // (jutsuId/toLevel/ryoCost/endsAt) and clears the lease, and the
                // requestId receipt above plus the cleared lease block any replay, so
                // admitting these two actions cannot inflate or repeat a payout.
                // queue/advance/finish still require a real token.
                const legacySettle = !!active
                    && !String(active.serverToken ?? '').trim()
                    && (action === 'complete' || action === 'cancel');
                if (!active || (!legacySettle && active.serverToken !== String(body.serverToken ?? ''))) return { ok: false as const, status: 409, error: 'invalid-or-legacy-jutsu-training' };
                if (action === 'queue') {
                    const jutsuId = String(body.jutsuId ?? '').trim().toLowerCase();
                    if (!JUTSU_ID.test(jutsuId) || !jutsuIsKnown(jutsuId)) return { ok: false as const, status: 409, error: 'unknown-or-unowned-jutsu' };
                    if (jutsuBloodlineBlocked(jutsuId)) return { ok: false as const, status: 409, error: 'bloodline-required' };
                    changed = queueJutsuRyoTraining(character, active, jutsuId, String(body.label ?? jutsuId), randomUUID().replace(/-/g, ''), body.trainingBonusPct, jutsuMorale.jutsuTimeMult);
                } else if (action === 'cancel-queue') {
                    changed = cancelQueuedJutsuRyoTraining(character, active);
                } else if (action === 'advance') {
                    changed = advanceQueuedJutsuRyoTraining(character, active, Date.now());
                } else {
                    changed = settleJutsuRyoTraining(character, active, action as 'complete' | 'cancel' | 'finish', Date.now());
                    if (changed.ok && (action === 'complete' || action === 'finish') && active.next) {
                        const startedAt = Date.now();
                        changed = {
                            ...changed,
                            active: {
                                serverToken: active.next.serverToken,
                                jutsuId: active.next.jutsuId,
                                label: active.next.label,
                                fromLevel: active.next.fromLevel,
                                toLevel: active.next.toLevel,
                                ryoCost: active.next.ryoCost,
                                startedAt,
                                endsAt: startedAt + active.next.durationMs,
                                next: null,
                                autoClaim: true,
                            },
                        };
                    }
                }
            }
            if (!changed.ok) return { ok: false as const, status: 409, error: changed.reason };
            const nextCharacter = { ...(changed.character as Record<string, unknown>), redeemedJutsuTrainingActions: [...receipts, { requestId, action }].slice(-128) };
            return { ok: true as const, character: nextCharacter, recordPatch: { activeJutsuTraining: changed.active }, value: { activeJutsuTraining: changed.active, replayed: false, cost: changed.cost, refund: 'refund' in changed ? changed.refund : 0 } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        if (error instanceof LockContendedError) {
            res.setHeader('Retry-After', '1');
            return res.status(503).json({ error: 'Your save is being updated. Retrying is safe.' });
        }
        console.error('[training/jutsu-ryo]', safeLogValue(error));
        return res.status(500).json({ error: 'Jutsu training could not be saved. Please retry.' });
    }
}
