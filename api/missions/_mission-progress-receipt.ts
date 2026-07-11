import type { FieldMissionDef } from './_mission-catalog.js';
import { createHash, randomUUID } from 'node:crypto';

export type MissionProgressEventKind = 'field-explore' | 'field-raid' | 'hunt-track' | 'hunt-kill';
export type MissionProgressType = 'field' | 'hunt';
export type MissionProgressEvidenceSource = 'server-travel' | 'server-pvp' | 'server-ai-combat' | 'server-raid';

export type MissionProgressEvidence = {
    version: 1;
    evidenceId: string;
    playerName: string;
    missionId: string;
    kind: MissionProgressEventKind;
    source: MissionProgressEvidenceSource;
    issuedAt: number;
    expiresAt: number;
};

export type MissionProgressReceipt = {
    playerName: string;
    missionId: string;
    missionType: MissionProgressType;
    exploreCount: number;
    raidCount: number;
    huntKill: boolean;
    /** Single-use server evidence ids applied to this receipt. */
    evidenceIds: string[];
    updatedAt: number;
};

export function missionProgressReceiptKey(playerName: string, missionId: string): string {
    return `missions:progress:${playerName}:${missionId}`;
}

export function cleanMissionProgressEvidenceToken(raw: unknown): string {
    const token = typeof raw === 'string' ? raw.trim() : '';
    return /^[A-Za-z0-9_-]{16,96}$/.test(token) ? token : '';
}

export function missionProgressEvidenceKey(playerName: string, token: string): string {
    return `missions:progress-evidence:${playerName}:${token}`;
}

export function missionProgressEvidencePendingKey(
    playerName: string,
    missionId: string,
    kind: MissionProgressEventKind,
): string {
    return `missions:progress-evidence-pending:${playerName}:${missionId}:${kind}`;
}

export function createMissionProgressEvidence(
    opts: {
        playerName: string;
        missionId: string;
        kind: MissionProgressEventKind;
        source: MissionProgressEvidenceSource;
        now?: number;
        ttlMs?: number;
        evidenceId?: string;
    },
): MissionProgressEvidence {
    const issuedAt = opts.now ?? Date.now();
    const ttlMs = Math.max(1_000, Math.min(EVIDENCE_MAX_LIFETIME_MS, Math.floor(opts.ttlMs ?? 5 * 60 * 1000)));
    const evidenceId = cleanMissionProgressEvidenceToken(opts.evidenceId)
        || randomUUID().replace(/-/g, '');
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

export function interactionMissionProgressEvidenceDecision(opts: {
    accepted: boolean;
    kind: MissionProgressEventKind;
    missionType: MissionProgressType;
    sector: number;
    targetSector: number;
    currentProgress: number;
    progressTarget: number;
}): { ok: true } | { ok: false; reason: string } {
    if (!opts.accepted) return { ok: false, reason: 'mission-not-accepted' };
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

export function missionProgressEvidenceBundleKey(playerName: string, receipt: MissionProgressReceipt): string {
    const digest = createHash('sha256')
        .update(`${playerName.toLowerCase()}\n${receipt.missionId}\n${[...receipt.evidenceIds].sort().join('\n')}`)
        .digest('hex');
    return `missions:progress-consumed:${playerName}:${digest}`;
}

export function missionProgressTypeForKind(kind: MissionProgressEventKind): MissionProgressType {
    return kind.startsWith('hunt-') ? 'hunt' : 'field';
}

export function cleanMissionProgressEventKind(raw: unknown): MissionProgressEventKind | '' {
    const kind = typeof raw === 'string' ? raw : '';
    return kind === 'field-explore' || kind === 'field-raid' || kind === 'hunt-track' || kind === 'hunt-kill'
        ? kind
        : '';
}

export function cleanMissionProgressReceipt(raw: unknown): MissionProgressReceipt | null {
    if (!raw || typeof raw !== 'object') return null;
    const rec = raw as Record<string, unknown>;
    const playerName = typeof rec.playerName === 'string' ? rec.playerName : '';
    const missionId = typeof rec.missionId === 'string' ? rec.missionId : '';
    const missionType = rec.missionType === 'field' || rec.missionType === 'hunt' ? rec.missionType : null;
    if (!playerName || !missionId || !missionType) return null;
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

export function cleanMissionProgressEvidence(raw: unknown): MissionProgressEvidence | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
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
        || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;
    return { version: 1, evidenceId, playerName, missionId, kind, source, issuedAt, expiresAt };
}

const EVIDENCE_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;
const EVIDENCE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function validateMissionProgressEvidence(
    evidence: MissionProgressEvidence | null,
    expected: { evidenceId: string; playerName: string; missionId: string; kind: MissionProgressEventKind; now?: number },
): { ok: true } | { ok: false; reason: string } {
    if (!evidence) return { ok: false, reason: 'invalid-server-evidence' };
    if (evidence.evidenceId !== expected.evidenceId) return { ok: false, reason: 'wrong-server-evidence-id' };
    if (evidence.playerName.toLowerCase() !== expected.playerName.toLowerCase()) return { ok: false, reason: 'wrong-server-evidence-player' };
    if (evidence.missionId !== expected.missionId || evidence.kind !== expected.kind) return { ok: false, reason: 'wrong-server-evidence-event' };

    const allowedSources: Record<MissionProgressEventKind, MissionProgressEvidenceSource[]> = {
        'field-explore': ['server-travel', 'server-ai-combat'],
        'field-raid': ['server-pvp', 'server-raid'],
        'hunt-track': ['server-travel'],
        'hunt-kill': ['server-ai-combat'],
    };
    if (!allowedSources[expected.kind].includes(evidence.source)) return { ok: false, reason: 'wrong-server-evidence-source' };

    const now = expected.now ?? Date.now();
    if (evidence.issuedAt > now + EVIDENCE_CLOCK_SKEW_MS
        || evidence.expiresAt <= evidence.issuedAt
        || evidence.expiresAt - evidence.issuedAt > EVIDENCE_MAX_LIFETIME_MS
        || now > evidence.expiresAt) return { ok: false, reason: 'expired-server-evidence' };
    return { ok: true };
}

export function applyMissionProgressEvent(
    current: MissionProgressReceipt | null,
    opts: {
        playerName: string;
        missionId: string;
        missionType: MissionProgressType;
        kind: MissionProgressEventKind;
        exploreTarget: number;
        raidTarget: number;
        evidenceId: string;
        now?: number;
    },
): MissionProgressReceipt {
    const next: MissionProgressReceipt = current && current.missionType === opts.missionType
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
    if (!evidenceId) throw new TypeError('A valid server evidence id is required.');
    if (next.evidenceIds.includes(evidenceId)) return next;
    next.playerName = opts.playerName;
    next.missionId = opts.missionId;
    next.evidenceIds = [...next.evidenceIds, evidenceId].slice(-32);
    next.updatedAt = opts.now ?? Date.now();

    if (opts.kind === 'field-explore') {
        next.exploreCount = Math.min(opts.exploreTarget, next.exploreCount + 1);
    } else if (opts.kind === 'field-raid') {
        next.raidCount = Math.min(opts.raidTarget, next.raidCount + 1);
    } else if (opts.kind === 'hunt-track') {
        next.exploreCount = Math.min(Math.max(0, opts.exploreTarget - 1), next.exploreCount + 1);
    } else if (opts.kind === 'hunt-kill' && next.exploreCount >= Math.max(0, opts.exploreTarget - 1)) {
        next.exploreCount = opts.exploreTarget;
        next.huntKill = true;
    }

    return next;
}

export function validateMissionProgressReceipt(
    receipt: MissionProgressReceipt | null,
    expected: {
        playerName: string;
        missionId: string;
        missionType: MissionProgressType;
        mission: Pick<FieldMissionDef, 'exploreCount' | 'raidCount'>;
    },
): { ok: true } | { ok: false; reason: string } {
    if (!receipt) return { ok: false, reason: 'missing-progress-receipt' };
    if (receipt.playerName.toLowerCase() !== expected.playerName.toLowerCase()) return { ok: false, reason: 'wrong-progress-receipt-player' };
    if (receipt.missionId !== expected.missionId || receipt.missionType !== expected.missionType) return { ok: false, reason: 'wrong-progress-receipt-mission' };
    const exploreTarget = Math.max(0, Math.floor(Number(expected.mission.exploreCount ?? 0)));
    const raidTarget = Math.max(0, Math.floor(Number(expected.mission.raidCount ?? 0)));
    if (receipt.exploreCount < exploreTarget) return { ok: false, reason: 'incomplete-progress-receipt' };
    if (expected.missionType === 'field' && receipt.raidCount < raidTarget) return { ok: false, reason: 'incomplete-progress-receipt' };
    if (expected.missionType === 'hunt' && !receipt.huntKill) return { ok: false, reason: 'missing-hunt-kill-receipt' };
    const evidenceTarget = expected.missionType === 'field' ? exploreTarget + raidTarget : exploreTarget;
    if (receipt.evidenceIds.length < evidenceTarget) return { ok: false, reason: 'missing-server-evidence' };
    return { ok: true };
}
