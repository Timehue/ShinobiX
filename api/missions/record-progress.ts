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
    interactionMissionProgressEvidenceDecision,
    missionProgressReceiptKey,
    missionProgressTypeForKind,
    savedAcceptedMissionIds,
    savedCurrentSector,
    type MissionProgressReceipt,
} from './_mission-progress-receipt.js';
import { serverFieldMissionRun } from './_field-trail.js';
import { fieldExploreEvidenceId } from './_field-explore-progress.js';
import { cleanWorldExploreAuthorityReceipt, worldExploreAuthorityKey } from '../world/_explore-authority.js';

const PROGRESS_RECEIPT_TTL_SECONDS = 14 * 24 * 60 * 60;

/*
 * /api/missions/record-progress — POST { playerName, missionId, kind }
 *
 * SERVER-AUTHORITATIVE producer for built-in FIELD/HUNT mission progress — the
 * mint half of the progress-receipt system that claim-mission validates.
 *
 *   • TRAVEL kinds (field-explore, hunt-track) are authorized HERE from the
 *     player's own server state: the mission must be accepted and not already
 *     complete, and — for field-explore — the player's current sector must be the
 *     mission's target sector (interactionMissionProgressEvidenceDecision; hunt
 *     trails roam, so hunt-track accepts any valid sector). Each authorized event
 *     mints a single-use server evidence id and folds it into the durable receipt
 *     (capped at the target) under the receipt lock.
 *
 *   • COMBAT kinds (field-raid, hunt-kill) are NOT recorded here — a progress ping
 *     is no proof of a kill/raid. They are stamped onto the receipt by the
 *     authoritative combat handlers: report-ai-fight (hunt-kill — gated on the
 *     ai-fight token's sealed opponentId matching the accepted hunt's AI) and
 *     report-raid (field-raid — from a validated PvP/AI raid win). record-progress
 *     returns a benign no-op for them.
 *
 * The client (App.tsx recordBuiltInMissionProgress) fires this optimistically and
 * ignores the response; the receipt is the source of truth at claim time.
 */

type RecordResult =
    | { ok: true; receipt: MissionProgressReceipt; replayed?: boolean }
    | { ok: false; status: number; body: Record<string, unknown> };

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
        const worldExploreRequestId = typeof body.worldExploreRequestId === 'string'
            && /^[A-Za-z0-9_-]{8,96}$/.test(body.worldExploreRequestId.trim())
            ? body.worldExploreRequestId.trim()
            : '';
        const runId = typeof body.runId === 'string' && /^[A-Za-z0-9_-]{16,96}$/.test(body.runId.trim())
            ? body.runId.trim()
            : '';
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

        // Combat kinds are proven by the authoritative combat handlers, not a ping.
        if (kind === 'field-raid' || kind === 'hunt-kill' || kind === 'hunt-track') {
            return res.status(200).json({ ok: true, recorded: false, reason: 'combat-proof-required' });
        }

        const saveKey = `save:${playerName}`;
        const key = missionProgressReceiptKey(playerName, missionId);
        const result = await withKvLock<RecordResult>(key, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            const char = record?.character as Record<string, unknown> | undefined;
            if (!char) return { ok: false, status: 200, body: { ok: true, recorded: false, reason: 'no-save' } };
            const eligibility = canPlayerReceiveMission(char, mission);
            if (!eligibility.ok) return { ok: false, status: 403, body: { ok: false, recorded: false, ...missionEligibilityFailureBody(eligibility) } };

            // Accepted ids and the sector live on the RECORD, not the character —
            // reading them off `char` made `accepted` permanently false, so this
            // producer refused every ping and no receipt was ever minted.
            const accepted = savedAcceptedMissionIds(record).includes(missionId);
            const existing = cleanMissionProgressReceipt(await kv.get(key));
            const activeRun = missionType === 'field' ? serverFieldMissionRun(char, missionId) : null;
            if (missionType === 'field' && (!activeRun || !runId || activeRun.runId !== runId)) {
                return { ok: false, status: 200, body: { ok: true, recorded: false, reason: 'field-run-required' } };
            }
            const evidenceId = fieldExploreEvidenceId(worldExploreRequestId);
            // Lost final ACK: exact evidence replay succeeds before the
            // progress-complete guard, so the client outbox can drain.
            if (kind === 'field-explore'
                && existing
                && existing.runId === activeRun?.runId
                && existing.evidenceIds.includes(evidenceId)) {
                return { ok: true, receipt: existing, replayed: true };
            }
            const targetSector = Math.floor(Number((mission as { targetSector?: unknown }).targetSector ?? 0));
            const exploreReceipts = Array.isArray(char.redeemedSectorExplorations)
                ? char.redeemedSectorExplorations as Array<Record<string, unknown>>
                : [];
            const saveProof = kind === 'field-explore' ? exploreReceipts.find((entry) => entry?.id === worldExploreRequestId
                && Number(entry.sector) === targetSector
                && Number(entry.at) >= Number(activeRun?.acceptedAt ?? Number.POSITIVE_INFINITY)) : undefined;
            const durableProof = kind === 'field-explore' && worldExploreRequestId
                ? cleanWorldExploreAuthorityReceipt(await kv.get(worldExploreAuthorityKey(playerName, worldExploreRequestId)))
                : null;
            const exactDurableProof = durableProof
                && durableProof.playerName.toLowerCase() === playerName.toLowerCase()
                && durableProof.sector === targetSector
                && durableProof.at >= Number(activeRun?.acceptedAt ?? Number.POSITIVE_INFINITY)
                ? durableProof
                : null;
            const decision = interactionMissionProgressEvidenceDecision({
                accepted,
                kind,
                missionType,
                sector: saveProof || exactDurableProof ? targetSector : savedCurrentSector(record),
                targetSector,
                currentProgress: existing && existing.runId === activeRun?.runId ? existing.exploreCount : 0,
                progressTarget: Math.floor(Number(mission.exploreCount ?? 0)),
            });
            if (!decision.ok) return { ok: false, status: 200, body: { ok: true, recorded: false, reason: decision.reason } };

            if (kind === 'field-explore') {
                if (!worldExploreRequestId) {
                    return { ok: false, status: 200, body: { ok: true, recorded: false, reason: 'explore-proof-required' } };
                }
                if (!saveProof && !exactDurableProof) {
                    return { ok: false, status: 200, body: { ok: true, recorded: false, reason: 'explore-proof-mismatch' } };
                }
            }

            // Self-authorized server-travel evidence: mint a single-use id and fold it
            // into the receipt (applyMissionProgressEvent caps hunt-track at target-1;
            // the kill/final track is stamped by the combat handler).
            const next = applyMissionProgressEvent(existing, {
                playerName, missionId, missionType, kind,
                exploreTarget: Math.floor(Number(mission.exploreCount ?? 0)),
                raidTarget: Math.floor(Number(mission.raidCount ?? 0)),
                evidenceId,
                runId: activeRun?.runId,
            });
            await kv.set(key, next, { ex: PROGRESS_RECEIPT_TTL_SECONDS });
            return { ok: true, receipt: next };
        }, { failClosed: true });

        if (!result.ok) return res.status(result.status).json(result.body);
        return res.status(200).json({
            ok: true,
            recorded: true,
            replayed: result.replayed === true,
            ...(kind === 'field-explore' ? { evidenceId: fieldExploreEvidenceId(worldExploreRequestId) } : {}),
            progress: {
                exploreCount: result.receipt.exploreCount,
                raidCount: result.receipt.raidCount,
                huntKill: result.receipt.huntKill,
            },
        });
    } catch (err) {
        console.error('[missions/record-progress]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
