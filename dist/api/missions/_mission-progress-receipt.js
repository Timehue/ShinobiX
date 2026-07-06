"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.missionProgressReceiptKey = missionProgressReceiptKey;
exports.missionProgressTypeForKind = missionProgressTypeForKind;
exports.cleanMissionProgressEventKind = cleanMissionProgressEventKind;
exports.cleanMissionProgressReceipt = cleanMissionProgressReceipt;
exports.applyMissionProgressEvent = applyMissionProgressEvent;
exports.validateMissionProgressReceipt = validateMissionProgressReceipt;
function missionProgressReceiptKey(playerName, missionId) {
    return `missions:progress:${playerName}:${missionId}`;
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
        updatedAt: Math.max(0, Math.floor(Number(rec.updatedAt ?? 0))),
    };
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
            updatedAt: 0,
        };
    next.playerName = opts.playerName;
    next.missionId = opts.missionId;
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
    return { ok: true };
}
