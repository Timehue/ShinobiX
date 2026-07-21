import { createHash } from 'node:crypto';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { fieldMissionById, HUNT_MISSION_IDS, type FieldMissionDef } from './_mission-catalog.js';
import { canPlayerReceiveMission } from './_eligibility.js';
import {
    applyMissionProgressEvent,
    cleanMissionProgressReceipt,
    missionProgressReceiptKey,
} from './_mission-progress-receipt.js';

const FIELD_RECEIPT_TTL_SECONDS = 14 * 24 * 60 * 60;

/*
 * field-raid producer — the raid half of the built-in FETCH mission receipt.
 *
 * Every builtin fetch-* mission requires raidCount raids on top of its explore
 * tiles (validateMissionProgressReceipt), but nothing ever stamped that half, so
 * all five were permanently unclaimable. record-progress deliberately refuses
 * combat kinds ("a progress ping is no proof of a raid"), so the credit has to
 * come from the authoritative raid reporter — report-raid, which already proves
 * the raid happened via a consumed raid-start token (AI raids) or a validated
 * PvpSession win (PvP raids).
 *
 * Crediting inside report-raid's single invocation is what keeps this safe: the
 * proof is consumed exactly once, and the same request stamps both the Vanguard
 * profession progress and the fetch-mission raidCount. No second endpoint
 * competes for the proof, so no single-use token is consumed twice.
 */

/**
 * Stable per-proof evidence id.
 *
 * A raidToken is hex but a PvP battleId is unconstrained, and the receipt only
 * accepts /^[A-Za-z0-9_-]{16,96}$/ — so hash the proof into the charset. Stable
 * means a replayed report re-derives the same id, and applyMissionProgressEvent
 * drops it as a duplicate instead of double-counting the raid.
 */
export function fieldRaidEvidenceId(proofId: string): string {
    return `fieldraid_${createHash('sha256').update(proofId).digest('hex').slice(0, 40)}`;
}

/**
 * The accepted built-in fetch missions a raid win should credit.
 *
 * Mirrors the client's matching filter (App.tsx recordMissionRaid): accepted,
 * fetch-flavored, and actually asking for raids. Hunt ids share FIELD_MISSIONS
 * but claim on the 'hunt' path and carry no raidCount, so they're excluded.
 * Eligibility is re-checked because claim-mission re-checks it too — crediting a
 * mission the player can no longer claim would just build a dead receipt.
 */
export function acceptedRaidFetchMissions(
    character: Record<string, unknown> | null | undefined,
): FieldMissionDef[] {
    const accepted = Array.isArray(character?.acceptedMissionIds)
        ? (character!.acceptedMissionIds as unknown[]).map(String)
        : [];
    const out: FieldMissionDef[] = [];
    const seen = new Set<string>();
    for (const id of accepted) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (HUNT_MISSION_IDS.has(id)) continue;
        const mission = fieldMissionById(id);
        if (!mission || Math.floor(Number(mission.raidCount ?? 0)) <= 0) continue;
        if (!canPlayerReceiveMission(character, mission).ok) continue;
        out.push(mission);
    }
    return out;
}

/**
 * Stamp one proven raid onto every accepted fetch mission's progress receipt.
 *
 * Best-effort and idempotent, mirroring the hunt-kill producer in
 * report-ai-fight: each mission's receipt is its own key under its own
 * fail-closed lock, and a failure on one mission never fails the raid report
 * whose reward/token side effects have already landed.
 *
 * Returns the mission ids that were credited.
 */
export async function creditFieldRaidProgress(opts: {
    playerName: string;
    character: Record<string, unknown> | null | undefined;
    proofId: string;
    now?: number;
}): Promise<string[]> {
    const proofId = typeof opts.proofId === 'string' ? opts.proofId.trim() : '';
    if (!opts.playerName || !proofId) return [];

    const evidenceId = fieldRaidEvidenceId(proofId);
    const credited: string[] = [];
    for (const mission of acceptedRaidFetchMissions(opts.character)) {
        const receiptKey = missionProgressReceiptKey(opts.playerName, mission.id);
        try {
            await withKvLock(receiptKey, async () => {
                const existing = cleanMissionProgressReceipt(await kv.get(receiptKey));
                const next = applyMissionProgressEvent(existing, {
                    playerName: opts.playerName,
                    missionId: mission.id,
                    missionType: 'field',
                    kind: 'field-raid',
                    exploreTarget: Math.floor(Number(mission.exploreCount ?? 0)),
                    raidTarget: Math.floor(Number(mission.raidCount ?? 0)),
                    evidenceId,
                    now: opts.now,
                });
                await kv.set(receiptKey, next, { ex: FIELD_RECEIPT_TTL_SECONDS });
            }, { failClosed: true });
            credited.push(mission.id);
        } catch (err) {
            console.error('[missions/field-raid]', mission.id, err);
        }
    }
    return credited;
}
