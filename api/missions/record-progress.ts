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
    cleanMissionProgressEventKind,
    cleanMissionProgressReceipt,
    missionProgressReceiptKey,
    missionProgressTypeForKind,
} from './_mission-progress-receipt.js';

const PROGRESS_RECEIPT_TTL_SECONDS = 14 * 24 * 60 * 60;

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
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!missionId || !kind) return res.status(400).json({ error: 'Invalid mission progress event.' });

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
        const receipt = await withKvLock(key, async () => {
            const existing = cleanMissionProgressReceipt(await kv.get(key));
            const next = applyMissionProgressEvent(existing, {
                playerName,
                missionId,
                missionType,
                kind,
                exploreTarget: mission.exploreCount,
                raidTarget: mission.raidCount ?? 0,
            });
            await kv.set(key, next, { ex: PROGRESS_RECEIPT_TTL_SECONDS });
            return next;
        }, { failClosed: true });

        return res.status(200).json({
            ok: true,
            recorded: true,
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
