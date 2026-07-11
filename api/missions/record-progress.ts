import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import {
    fieldMissionById,
    huntMissionById,
} from './_mission-catalog.js';
import { canPlayerReceiveMission, missionEligibilityFailureBody } from './_eligibility.js';
import {
    applyMissionProgressEvent,
    cleanMissionProgressEvidence,
    cleanMissionProgressEvidenceToken,
    cleanMissionProgressEventKind,
    cleanMissionProgressReceipt,
    missionProgressEvidenceKey,
    missionProgressReceiptKey,
    missionProgressTypeForKind,
    validateMissionProgressEvidence,
} from './_mission-progress-receipt.js';

const PROGRESS_RECEIPT_TTL_SECONDS = 14 * 24 * 60 * 60;

// Authentication proves the account, not the gameplay event. Each call must
// redeem a private, single-use evidence row issued by an authoritative travel,
// combat, or raid service for this exact player + mission + event kind.

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'mission-record-progress', 30, 10_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const missionId = String(body.missionId ?? '').slice(0, 80);
        const kind = cleanMissionProgressEventKind(body.kind);
        const evidenceToken = cleanMissionProgressEvidenceToken(body.evidenceToken);
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!missionId || !kind) return res.status(400).json({ error: 'Invalid mission progress event.' });
        if (!evidenceToken) {
            return res.status(403).json({
                ok: false,
                recorded: false,
                reason: 'server-evidence-required',
                error: 'A server-issued mission progress token is required.',
            });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only record your own mission progress.' });
        }

        const missionType = missionProgressTypeForKind(kind);
        const mission = missionType === 'hunt' ? huntMissionById(missionId) : fieldMissionById(missionId);
        if (!mission) {
            return res.status(200).json({ ok: true, recorded: false, reason: 'unknown-mission' });
        }
        if (missionType === 'field' && huntMissionById(missionId)) {
            return res.status(200).json({ ok: true, recorded: false, reason: 'wrong-mission-type' });
        }
        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = record?.character as Record<string, unknown> | undefined;
        const eligibility = canPlayerReceiveMission(char ?? {}, mission);
        if (!eligibility.ok) {
            return res.status(403).json({ ok: false, recorded: false, ...missionEligibilityFailureBody(eligibility) });
        }

        const key = missionProgressReceiptKey(playerName, missionId);
        const evidenceKey = missionProgressEvidenceKey(playerName, evidenceToken);
        const result = await withKvLock(key, () => withKvLock(evidenceKey, async () => {
            const evidence = cleanMissionProgressEvidence(await kv.get(evidenceKey));
            const evidenceCheck = validateMissionProgressEvidence(evidence, {
                evidenceId: evidenceToken,
                playerName,
                missionId,
                kind,
            });
            if (!evidenceCheck.ok) return { ok: false as const, reason: evidenceCheck.reason };

            const existing = cleanMissionProgressReceipt(await kv.get(key));
            const duplicate = existing?.evidenceIds.includes(evidenceToken) === true;
            const next = applyMissionProgressEvent(existing, {
                playerName,
                missionId,
                missionType,
                kind,
                exploreTarget: mission.exploreCount,
                raidTarget: mission.raidCount ?? 0,
                evidenceId: evidenceToken,
            });
            await kv.set(key, next, { ex: PROGRESS_RECEIPT_TTL_SECONDS });
            // Consume only after the idempotent receipt write. If deletion throws,
            // a retry sees the same evidence id in `next` and cannot increment it
            // twice; if the row disappeared unexpectedly, fail closed.
            const consumed = await kv.del(evidenceKey);
            if (consumed <= 0 && !duplicate) throw new Error('Mission progress evidence disappeared before consumption.');
            return { ok: true as const, receipt: next, duplicate };
        }, { failClosed: true }), { failClosed: true });

        if (!result.ok) {
            return res.status(403).json({ ok: false, recorded: false, reason: result.reason });
        }
        const { receipt } = result;

        return res.status(200).json({
            ok: true,
            recorded: !result.duplicate,
            duplicate: result.duplicate,
            progress: {
                exploreCount: receipt.exploreCount,
                raidCount: receipt.raidCount,
                huntKill: receipt.huntKill,
            },
        });
    } catch (err) {
        console.error('[missions/record-progress]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
