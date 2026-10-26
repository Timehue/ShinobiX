import type { FieldMissionDef } from './_mission-catalog.js';

export type MissionProgressEventKind = 'field-explore' | 'field-raid' | 'hunt-track' | 'hunt-kill';
export type MissionProgressType = 'field' | 'hunt';

export type MissionProgressReceipt = {
    playerName: string;
    missionId: string;
    missionType: MissionProgressType;
    /** Server-owned acceptance nonce. Required for field missions. */
    runId?: string;
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

/*
 * Where the save actually keeps accepted missions and the player's sector.
 *
 * `acceptedMissionIds`, `missionProgress` and `currentSector` are TOP-LEVEL
 * fields on the save RECORD — App.tsx persists them beside `character`, not
 * inside it (see api/save/_public-save-dto.ts, which lists all three among the
 * top-level owner-only fields, and claim-mission's applyClaimedMissionState,
 * which correctly clears them off the record).
 *
 * Every progress PRODUCER used to read them off `record.character`, where they
 * are always undefined. The result was silent and total: record-progress saw
 * `accepted === false` and refused every explore ping, the raid and hunt-kill
 * producers found no accepted missions to credit, and so no progress receipt
 * was ever written for anyone. claim-mission then rejected every built-in field
 * mission and Hunter contract with `missing-progress-receipt`, which the client
 * renders as "Finish this mission's required field progress first" — on a card
 * whose local counters were already full.
 *
 * These readers accept EITHER shape (record or bare character) so a caller that
 * only has the character still works, and so a future save-shape change can't
 * silently re-break the producers.
 */
export function savedAcceptedMissionIds(source: Record<string, unknown> | null | undefined): string[] {
    if (!source) return [];
    const direct = source.acceptedMissionIds;
    if (Array.isArray(direct)) return direct.map(String);
    const character = source.character;
    if (character && typeof character === 'object' && !Array.isArray(character)) {
        const nested = (character as Record<string, unknown>).acceptedMissionIds;
        if (Array.isArray(nested)) return nested.map(String);
    }
    return [];
}

export function savedMissionProgress(source: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!source) return {};
    const read = (value: unknown): Record<string, unknown> | null => (
        value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : null
    );
    const direct = 'missionProgress' in source ? read(source.missionProgress) : null;
    if (direct) return direct;
    const character = source.character;
    if (character && typeof character === 'object' && !Array.isArray(character)) {
        return read((character as Record<string, unknown>).missionProgress) ?? {};
    }
    return {};
}

export function savedCurrentSector(source: Record<string, unknown> | null | undefined): number {
    if (!source) return 0;
    const read = (value: unknown): number | null => {
        const sector = Math.floor(Number(value));
        return Number.isFinite(sector) ? sector : null;
    };
    const direct = 'currentSector' in source ? read(source.currentSector) : null;
    if (direct !== null) return direct;
    const character = source.character;
    if (character && typeof character === 'object' && !Array.isArray(character)) {
        const nested = read((character as Record<string, unknown>).currentSector);
        if (nested !== null) return nested;
    }
    return 0;
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
        ...(cleanMissionProgressEvidenceToken(rec.runId) ? { runId: cleanMissionProgressEvidenceToken(rec.runId) } : {}),
        exploreCount: Math.max(0, Math.floor(Number(rec.exploreCount ?? 0))),
        raidCount: Math.max(0, Math.floor(Number(rec.raidCount ?? 0))),
        huntKill: rec.huntKill === true,
        evidenceIds: Array.isArray(rec.evidenceIds)
            ? [...new Set(rec.evidenceIds.map(cleanMissionProgressEvidenceToken).filter(Boolean))].slice(0, 32)
            : [],
        updatedAt: Math.max(0, Math.floor(Number(rec.updatedAt ?? 0))),
    };
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
        runId?: string;
        now?: number;
    },
): MissionProgressReceipt {
    const runId = cleanMissionProgressEvidenceToken(opts.runId);
    const next: MissionProgressReceipt = current
        && current.missionType === opts.missionType
        && (!runId || current.runId === runId)
        ? { ...current }
        : {
            playerName: opts.playerName,
            missionId: opts.missionId,
            missionType: opts.missionType,
            ...(runId ? { runId } : {}),
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
    if (runId) next.runId = runId;
    next.evidenceIds = [...next.evidenceIds, evidenceId].slice(-32);
    next.updatedAt = opts.now ?? Date.now();

    if (opts.kind === 'field-explore') {
        next.exploreCount = Math.min(opts.exploreTarget, next.exploreCount + 1);
    } else if (opts.kind === 'field-raid') {
        next.raidCount = Math.min(opts.raidTarget, next.raidCount + 1);
    } else if (opts.kind === 'hunt-track') {
        next.exploreCount = Math.min(Math.max(0, opts.exploreTarget - 1), next.exploreCount + 1);
    } else if (opts.kind === 'hunt-kill') {
        // A server-verified kill (report-ai-fight, sealed opponentId) is the whole
        // proof of a hunt. It completes the receipt on its own rather than waiting
        // on the optimistic hunt-track pings to have all landed — those pings are
        // fire-and-forget, so a single dropped one used to leave the contract
        // permanently unclaimable. The kill is only ever recorded against an
        // ACCEPTED hunt whose beast matches the sealed fight token, so this stays
        // cheat-proof: no kill, no payout.
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
        runId?: string;
    },
): { ok: true } | { ok: false; reason: string } {
    if (!receipt) return { ok: false, reason: 'missing-progress-receipt' };
    if (receipt.playerName.toLowerCase() !== expected.playerName.toLowerCase()) return { ok: false, reason: 'wrong-progress-receipt-player' };
    if (receipt.missionId !== expected.missionId || receipt.missionType !== expected.missionType) return { ok: false, reason: 'wrong-progress-receipt-mission' };
    if (expected.runId && receipt.runId !== expected.runId) return { ok: false, reason: 'wrong-progress-receipt-run' };
    // Hunt: the server-verified kill is the entire proof. Tracking pings are
    // optimistic UI now and no longer gate the claim — a single dropped
    // fire-and-forget ping used to brick the contract with no recovery. The kill
    // receipt is only ever written by report-ai-fight for an ACCEPTED hunt whose
    // beast matches the sealed fight token, so requiring it keeps the reward gated
    // on a real, server-witnessed kill.
    if (expected.missionType === 'hunt') {
        return receipt.huntKill ? { ok: true } : { ok: false, reason: 'missing-hunt-kill-receipt' };
    }
    // Field: still requires explore + raid evidence, each self-authorized (travel)
    // or combat-validated (raid) server-side — a forged local counter carries no
    // matching evidence ids and fails the evidence-count floor below.
    const exploreTarget = Math.max(0, Math.floor(Number(expected.mission.exploreCount ?? 0)));
    const raidTarget = Math.max(0, Math.floor(Number(expected.mission.raidCount ?? 0)));
    if (receipt.exploreCount < exploreTarget) return { ok: false, reason: 'incomplete-progress-receipt' };
    if (receipt.raidCount < raidTarget) return { ok: false, reason: 'incomplete-progress-receipt' };
    if (receipt.evidenceIds.length < exploreTarget + raidTarget) return { ok: false, reason: 'missing-server-evidence' };
    return { ok: true };
}
