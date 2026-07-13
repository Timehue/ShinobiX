"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.missionProgressReceiptKey = missionProgressReceiptKey;
exports.cleanMissionProgressEvidenceToken = cleanMissionProgressEvidenceToken;
exports.missionProgressEvidenceKey = missionProgressEvidenceKey;
exports.missionProgressEvidencePendingKey = missionProgressEvidencePendingKey;
exports.createMissionProgressEvidence = createMissionProgressEvidence;
exports.interactionMissionProgressEvidenceDecision = interactionMissionProgressEvidenceDecision;
exports.missionProgressEvidenceBundleKey = missionProgressEvidenceBundleKey;
exports.missionProgressTypeForKind = missionProgressTypeForKind;
exports.cleanMissionProgressEventKind = cleanMissionProgressEventKind;
exports.cleanMissionProgressReceipt = cleanMissionProgressReceipt;
exports.cleanMissionProgressEvidence = cleanMissionProgressEvidence;
exports.validateMissionProgressEvidence = validateMissionProgressEvidence;
exports.applyMissionProgressEvent = applyMissionProgressEvent;
exports.validateMissionProgressReceipt = validateMissionProgressReceipt;
const node_crypto_1 = require("node:crypto");
function missionProgressReceiptKey(playerName, missionId) {
    return `missions:progress:${playerName}:${missionId}`;
}
function cleanMissionProgressEvidenceToken(raw) {
    const token = typeof raw === 'string' ? raw.trim() : '';
    return /^[A-Za-z0-9_-]{16,96}$/.test(token) ? token : '';
}
function missionProgressEvidenceKey(playerName, token) {
    return `missions:progress-evidence:${playerName}:${token}`;
}
function missionProgressEvidencePendingKey(playerName, missionId, kind) {
    return `missions:progress-evidence-pending:${playerName}:${missionId}:${kind}`;
}
function createMissionProgressEvidence(opts) {
    const issuedAt = opts.now ?? Date.now();
    const ttlMs = Math.max(1_000, Math.min(EVIDENCE_MAX_LIFETIME_MS, Math.floor(opts.ttlMs ?? 5 * 60 * 1000)));
    const evidenceId = cleanMissionProgressEvidenceToken(opts.evidenceId)
        || (0, node_crypto_1.randomUUID)().replace(/-/g, '');
    return {
        version: 1,
        evidenceId,
        playerName: opts.playerName,
        missionId: opts.missionId,
        kind: opts.kind,
        source: opts.source,
        issuedAt,
        expiresAt: issuedAt + ttlMs,
    };
}
function interactionMissionProgressEvidenceDecision(opts) {
    if (!opts.accepted)
        return { ok: false, reason: 'mission-not-accepted' };
    if (opts.kind === 'field-raid' || opts.kind === 'hunt-kill') {
        return { ok: false, reason: 'combat-proof-required' };
    }
    if ((opts.kind === 'field-explore' && opts.missionType !== 'field')
        || (opts.kind === 'hunt-track' && opts.missionType !== 'hunt')) {
        return { ok: false, reason: 'wrong-mission-type' };
    }
    if (!Number.isInteger(opts.sector) || opts.sector < 1 || opts.sector > 60) {
        return { ok: false, reason: 'invalid-sector' };
    }
    if (opts.kind === 'field-explore' && opts.sector !== opts.targetSector) {
        return { ok: false, reason: 'wrong-mission-sector' };
    }
    if (opts.currentProgress >= opts.progressTarget) {
        return { ok: false, reason: 'progress-already-complete' };
    }
    return { ok: true };
}
function missionProgressEvidenceBundleKey(playerName, receipt) {
    const digest = (0, node_crypto_1.createHash)('sha256')
        .update(`${playerName.toLowerCase()}\n${receipt.missionId}\n${[...receipt.evidenceIds].sort().join('\n')}`)
        .digest('hex');
    return `missions:progress-consumed:${playerName}:${digest}`;
}
function missionProgressTypeForKind(kind) {
    return kind.startsWith('hunt-') ? 'hunt' : 'field';
}
function cleanMissionProgressEventKind(raw) {
    const kind = typeof raw === 'string' ? raw : '';
    return kind === 'field-explore' || kind === 'field-raid' || kind === 'hunt-track' || kind === 'hunt-kill'
        ? kind
        : '';
}
function cleanMissionProgressReceipt(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const rec = raw;
    const playerName = typeof rec.playerName === 'string' ? rec.playerName : '';
    const missionId = typeof rec.missionId === 'string' ? rec.missionId : '';
    const missionType = rec.missionType === 'field' || rec.missionType === 'hunt' ? rec.missionType : null;
    if (!playerName || !missionId || !missionType)
        return null;
    return {
        playerName,
        missionId,
        missionType,
        exploreCount: Math.max(0, Math.floor(Number(rec.exploreCount ?? 0))),
        raidCount: Math.max(0, Math.floor(Number(rec.raidCount ?? 0))),
        huntKill: rec.huntKill === true,
        evidenceIds: Array.isArray(rec.evidenceIds)
            ? [...new Set(rec.evidenceIds.map(cleanMissionProgressEvidenceToken).filter(Boolean))].slice(0, 32)
            : [],
        updatedAt: Math.max(0, Math.floor(Number(rec.updatedAt ?? 0))),
    };
}
function cleanMissionProgressEvidence(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const value = raw;
    const evidenceId = cleanMissionProgressEvidenceToken(value.evidenceId);
    const playerName = typeof value.playerName === 'string' ? value.playerName : '';
    const missionId = typeof value.missionId === 'string' ? value.missionId : '';
    const kind = cleanMissionProgressEventKind(value.kind);
    const source = value.source === 'server-travel'
        || value.source === 'server-pvp'
        || value.source === 'server-ai-combat'
        || value.source === 'server-raid'
        ? value.source
        : '';
    const issuedAt = Number(value.issuedAt);
    const expiresAt = Number(value.expiresAt);
    if (value.version !== 1 || !evidenceId || !playerName || !missionId || !kind || !source
        || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt))
        return null;
    return { version: 1, evidenceId, playerName, missionId, kind, source, issuedAt, expiresAt };
}
const EVIDENCE_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;
const EVIDENCE_CLOCK_SKEW_MS = 5 * 60 * 1000;
function validateMissionProgressEvidence(evidence, expected) {
    if (!evidence)
        return { ok: false, reason: 'invalid-server-evidence' };
    if (evidence.evidenceId !== expected.evidenceId)
        return { ok: false, reason: 'wrong-server-evidence-id' };
    if (evidence.playerName.toLowerCase() !== expected.playerName.toLowerCase())
        return { ok: false, reason: 'wrong-server-evidence-player' };
    if (evidence.missionId !== expected.missionId || evidence.kind !== expected.kind)
        return { ok: false, reason: 'wrong-server-evidence-event' };
    const allowedSources = {
        'field-explore': ['server-travel', 'server-ai-combat'],
        'field-raid': ['server-pvp', 'server-raid'],
        'hunt-track': ['server-travel'],
        'hunt-kill': ['server-ai-combat'],
    };
    if (!allowedSources[expected.kind].includes(evidence.source))
        return { ok: false, reason: 'wrong-server-evidence-source' };
    const now = expected.now ?? Date.now();
    if (evidence.issuedAt > now + EVIDENCE_CLOCK_SKEW_MS
        || evidence.expiresAt <= evidence.issuedAt
        || evidence.expiresAt - evidence.issuedAt > EVIDENCE_MAX_LIFETIME_MS
        || now > evidence.expiresAt)
        return { ok: false, reason: 'expired-server-evidence' };
    return { ok: true };
}
function applyMissionProgressEvent(current, opts) {
    const next = current && current.missionType === opts.missionType
        ? { ...current }
        : {
            playerName: opts.playerName,
            missionId: opts.missionId,
            missionType: opts.missionType,
            exploreCount: 0,
            raidCount: 0,
            huntKill: false,
            evidenceIds: [],
            updatedAt: 0,
        };
    const evidenceId = cleanMissionProgressEvidenceToken(opts.evidenceId);
    if (!evidenceId)
        throw new TypeError('A valid server evidence id is required.');
    if (next.evidenceIds.includes(evidenceId))
        return next;
    next.playerName = opts.playerName;
    next.missionId = opts.missionId;
    next.evidenceIds = [...next.evidenceIds, evidenceId].slice(-32);
    next.updatedAt = opts.now ?? Date.now();
    if (opts.kind === 'field-explore') {
        next.exploreCount = Math.min(opts.exploreTarget, next.exploreCount + 1);
    }
    else if (opts.kind === 'field-raid') {
        next.raidCount = Math.min(opts.raidTarget, next.raidCount + 1);
    }
    else if (opts.kind === 'hunt-track') {
        next.exploreCount = Math.min(Math.max(0, opts.exploreTarget - 1), next.exploreCount + 1);
    }
    else if (opts.kind === 'hunt-kill' && next.exploreCount >= Math.max(0, opts.exploreTarget - 1)) {
        next.exploreCount = opts.exploreTarget;
        next.huntKill = true;
    }
    return next;
}
function validateMissionProgressReceipt(receipt, expected) {
    if (!receipt)
        return { ok: false, reason: 'missing-progress-receipt' };
    if (receipt.playerName.toLowerCase() !== expected.playerName.toLowerCase())
        return { ok: false, reason: 'wrong-progress-receipt-player' };
    if (receipt.missionId !== expected.missionId || receipt.missionType !== expected.missionType)
        return { ok: false, reason: 'wrong-progress-receipt-mission' };
    const exploreTarget = Math.max(0, Math.floor(Number(expected.mission.exploreCount ?? 0)));
    const raidTarget = Math.max(0, Math.floor(Number(expected.mission.raidCount ?? 0)));
    if (receipt.exploreCount < exploreTarget)
        return { ok: false, reason: 'incomplete-progress-receipt' };
    if (expected.missionType === 'field' && receipt.raidCount < raidTarget)
        return { ok: false, reason: 'incomplete-progress-receipt' };
    if (expected.missionType === 'hunt' && !receipt.huntKill)
        return { ok: false, reason: 'missing-hunt-kill-receipt' };
    const evidenceTarget = expected.missionType === 'field' ? exploreTarget + raidTarget : exploreTarget;
    if (receipt.evidenceIds.length < evidenceTarget)
        return { ok: false, reason: 'missing-server-evidence' };
    return { ok: true };
}
