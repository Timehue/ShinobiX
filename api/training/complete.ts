import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { writeVersionedPlayerSave } from '../save/_mutate-player-save.js';
import { applyTrainingGrant } from './_grant.js';
import { parseLegacyTraining } from './_legacy.js';
import { MAX_TRAINING_RECEIPTS, activeTrainingMatches, storedTrainingGrant } from './_session.js';

const MAX_SAVE_CAS_ATTEMPTS = 4;

function isPlayerSaveVersionConflict(error: unknown): boolean {
    return error instanceof Error && error.message === 'player-save-version-conflict';
}

async function retireActiveTrainingCache(playerName: string, token: string): Promise<void> {
    if (!token) return;
    const key = `training-active:${playerName}`;
    const cached = await kv.get<Record<string, unknown>>(key);
    if (!activeTrainingMatches(cached, token)) return;
    // Never delete a successor lease. Exact CAS replaces only the old cache row
    // with a short tombstone; a concurrently published successor is untouched.
    await kv.compareSet(key, cached, { spentToken: token }, { ex: 1 });
}

interface TrainingToken {
    playerName: string;
    stat: string;
    tierId: string;
    startedAt: number;
    endsAt: number;
    sealedGain: number;
    sealedXp: number;
}

interface TrainingRedemption {
    token: string;
    stat: string;
    gain: number;
    xp: number; // retired (character XP removed) — always 0, kept for old-client shape
    applied: number;
    overflow: number; // cap-truncated points rolled into the unspent pool
    cap: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'training-complete', 8, 30_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const tokenRaw = typeof body.token === 'string' ? body.token.trim() : '';
        const token = /^[A-Za-z0-9]+$/.test(tokenRaw) ? tokenRaw : '';
        const legacy = body.legacy === true;
        const cancel = body.cancel === true;
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!token && !legacy) return res.status(400).json({ error: 'Missing training token.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only complete your own training.' });

        const tokenKey = token ? `training-token:${playerName}:${token}` : '';
        const saveKey = `save:${playerName}`;
        const now = Date.now();
        const result = await withKvLock(saveKey, async () => {
            for (let attempt = 0; attempt < MAX_SAVE_CAS_ATTEMPTS; attempt += 1) {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const character = record?.character as Record<string, unknown> | undefined;
                if (!record || !character) return { ok: false as const, status: 404, error: 'Player save not found.' };
                const receipts = Array.isArray(record._trainingReceipts)
                    ? record._trainingReceipts.filter((v): v is string => typeof v === 'string')
                    : [];
                const legacyData = legacy ? parseLegacyTraining(record.activeTraining) : null;
                if (legacy && !legacyData) {
                    // A legacy client has no token to echo after its one-time
                    // migration lease is cleared. The server-owned latest
                    // redemption marker plus the top-level receipt identify an
                    // exact completed migration, so a lost response can replay
                    // without granting again or manufacturing a version bump.
                    const legacyReplayToken = (Array.isArray(character.redeemedTrainingTokens)
                        ? character.redeemedTrainingTokens
                        : [])
                        .map((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
                            ? String((entry as Record<string, unknown>).token ?? '')
                            : '')
                        .find((entry) => /^legacy[A-Za-z0-9]+$/.test(entry) && receipts.includes(entry));
                    if (legacyReplayToken) {
                        return {
                            ok: true as const,
                            character,
                            activeTraining: record.activeTraining ?? null,
                            _saveVersion: Number(record._saveVersion ?? 0),
                            value: { granted: true, alreadyGranted: true, token: legacyReplayToken },
                        };
                    }
                    return { ok: false as const, status: 409, error: 'No eligible legacy training session was found.' };
                }
                const redemptionToken = legacyData?.token ?? token;
                if (receipts.includes(redemptionToken)) {
                    return {
                        ok: true as const,
                        character,
                        activeTraining: record.activeTraining ?? null,
                        _saveVersion: Number(record._saveVersion ?? 0),
                        value: { granted: true, alreadyGranted: true, token: redemptionToken },
                    };
                }

                // A delayed completion from an older tab must never clear a newer
                // session that the player started after collecting. Receipts make a
                // genuine retry idempotent above; every first-time redemption must
                // still own the active lease stored on the save.
                if (!legacyData && !activeTrainingMatches(record.activeTraining, token)) {
                    return { ok: false as const, status: 409, error: 'This training session is no longer active. Refresh to load the current session.' };
                }

                // The cache token speeds up redemption, but the protected save lease
                // is durable claim authority. This keeps legitimately earned training
                // collectible after the cache TTL without weakening token matching.
                const data = legacyData ?? await kv.get<TrainingToken>(tokenKey) ?? storedTrainingGrant(record.activeTraining, token);
                if (!data) return { ok: false as const, status: 409, error: 'Training token is invalid or already spent.' };
                const sealedPlayerName = 'playerName' in data && typeof data.playerName === 'string' ? data.playerName : '';
                if (sealedPlayerName && sealedPlayerName.toLowerCase() !== playerName.toLowerCase()) {
                    return { ok: false as const, status: 403, error: 'Training token does not belong to this player.' };
                }
                if (!cancel && now < data.endsAt) {
                    return { ok: false as const, status: 409, error: `Training is not finished. ${data.endsAt - now}ms remaining.` };
                }

                let gain = Math.max(0, Math.floor(data.sealedGain));
                if (cancel) {
                    const totalMs = data.endsAt - data.startedAt;
                    const fraction = totalMs > 0 ? Math.max(0, Math.min(1, (now - data.startedAt) / totalMs)) : 1;
                    gain = Math.floor(gain * fraction);
                }
                // Character XP is retired — the sealed stat gain (with any overflow
                // rolled into the pool) IS the level progress; applyTrainingGrant
                // ends with the derived-level recompute.
                const grant = applyTrainingGrant(character, data.stat, gain, 0);
                const redemption: TrainingRedemption = { token: redemptionToken, stat: data.stat, gain, xp: 0, applied: grant.applied, overflow: grant.overflow, cap: grant.cap };
                const nextReceipts = [...receipts.filter((entry) => entry !== redemptionToken), redemptionToken].slice(-MAX_TRAINING_RECEIPTS);
                const nextCharacter = { ...grant.character, redeemedTrainingTokens: [redemption] };
                try {
                    // `record` is the exact predecessor. The receipt and cleared
                    // lease are fields of the next record, not expected CAS state.
                    const written = await writeVersionedPlayerSave(saveKey, record, nextCharacter, {
                        _trainingReceipts: nextReceipts,
                        activeTraining: null,
                    });
                    return { ok: true as const, character: nextCharacter, activeTraining: null, _saveVersion: written._saveVersion, value: { granted: true, alreadyGranted: false, ...redemption } };
                } catch (error) {
                    // A durable exact-token receipt proves the payout committed,
                    // including when acknowledgement/projection work failed. It also
                    // makes a concurrent completer's win an idempotent replay.
                    const readback = await kv.get<Record<string, unknown>>(saveKey).catch(() => null);
                    const readbackReceipts = Array.isArray(readback?._trainingReceipts)
                        ? readback._trainingReceipts.filter((entry): entry is string => typeof entry === 'string')
                        : [];
                    const readbackCharacter = readback?.character as Record<string, unknown> | undefined;
                    if (readbackCharacter && readbackReceipts.includes(redemptionToken)) {
                        return {
                            ok: true as const,
                            character: readbackCharacter,
                            activeTraining: readback?.activeTraining ?? null,
                            _saveVersion: Number(readback?._saveVersion ?? 0),
                            value: { granted: true, alreadyGranted: true, token: redemptionToken },
                        };
                    }
                    if (isPlayerSaveVersionConflict(error)) {
                        // Recompute against a racing autosave's successor. The loop
                        // checks the same active token again before applying gain.
                        if (attempt + 1 < MAX_SAVE_CAS_ATTEMPTS) continue;
                        return { ok: false as const, status: 503, error: 'Your save changed while training was completing. Please retry.' };
                    }
                    throw error;
                }
            }
            return { ok: false as const, status: 503, error: 'Your save changed while training was completing. Please retry.' };
        }, { failClosed: true });

        if (!result.ok) return res.status(result.status).json({ error: result.error });
        if (tokenKey) await kv.del(tokenKey).catch(() => console.error('active-session cleanup failed after durable receipt'));
        if (!result.activeTraining) {
            await retireActiveTrainingCache(playerName, String(result.value.token ?? ''))
                .catch(() => console.error('active-session cleanup failed after durable receipt'));
        }
        return res.status(200).json({ ok: true, ...result.value, character: result.character, activeTraining: result.activeTraining, _saveVersion: result._saveVersion });
    } catch (err) {
        console.error('[training/complete]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
