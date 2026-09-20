/*
 * Sector-war SETTLEMENT — the IO half of the 72-hour scored war.
 *
 * The pure verdict lives in api/_sector-war.ts settleSectorWar: when the window
 * closes, attacker strictly ahead → the sector flips; defender ahead or tied →
 * the defence held. This module applies that verdict durably:
 *
 *   · flip  → captureSectorForVillage (the world:territory owner change the WR
 *             faucet and tax tier key off) + sector.capture telemetry. The
 *             settled record is an inert audit row that ages out with its
 *             own battle receipts (SECTOR_CAPTURED_RECORD_TTL_SEC); it used
 *             to be written with no ttl at all and never left the keyspace.
 *   · hold  → the record is stamped 'defended' and saved WITH the re-siege
 *             cooldown TTL, so the lingering record IS the attacker's cooldown.
 *
 * Called LAZILY from the endpoint's hot paths (the war-map status poll, declare)
 * so a finished war settles within seconds of a player looking at it, and from
 * the daily village-war pass as the backstop for wars nobody is watching. Both
 * paths converge on the same per-war lock, so double-settlement is impossible.
 *
 * Lives in its own module because of an import cycle: world-state.ts imports the
 * sector-war STORE (activeSectorWarsForVillage, for the village-war mutual
 * exclusion), so the store cannot import captureSectorForVillage back. This file
 * sits above both. Underscore-prefixed → a helper, not a route.
 */

import { withKvLock } from './_lock.js';
import { kv } from './_storage.js';
import {
    settleSectorWar,
    sectorWarKey,
    sectorWarLedgerOf,
    sectorWarInstanceTag,
    SECTOR_CAPTURED_RECORD_TTL_SEC,
    SECTOR_RESIEGE_COOLDOWN_SEC,
    type SectorWarSession,
} from './_sector-war.js';
import {
    loadSectorWar,
    saveSectorWar,
    listUnsettledDueSectorWars,
    drainSectorWarLedger,
    externalizeSectorWarLedger,
} from './_sector-war-store.js';
import { captureSectorForVillage } from './world-state.js';
import { recordWarEcoEvent } from './_war-telemetry.js';
import { legacyEnabled, bumpLegacyStats } from './_legacy-track.js';
import { announce } from './_announce.js';
import { zeroSectorIntel } from './_village-intel.js';

/** World Herald copy for a settled war. Exported for the test. */
export function sectorWarResolutionAnnouncement(
    war: Pick<SectorWarSession, 'id' | 'sector' | 'attackerVillage' | 'defenderVillage'>,
    outcome: { attackerWon: boolean; attackerPoints: number; defenderPoints: number },
): { type: string; title: string; message: string; village: string; receiptId: string } {
    const score = `${outcome.attackerPoints}–${outcome.defenderPoints}`;
    return outcome.attackerWon
        ? {
            type: 'sector_war_resolved',
            title: `Sector ${war.sector} Falls`,
            message: `${war.attackerVillage} has taken Sector ${war.sector} from ${war.defenderVillage} after a 72-hour war (${score}).`,
            village: war.attackerVillage,
            receiptId: `sector-war-resolved:${war.id}`,
        }
        : {
            type: 'sector_war_resolved',
            title: `Sector ${war.sector} Holds`,
            message: `${war.defenderVillage} held Sector ${war.sector} against ${war.attackerVillage}'s 72-hour siege (${score}).`,
            village: war.defenderVillage,
            receiptId: `sector-war-resolved:${war.id}`,
        };
}

/** Every distinct player who won an attacker-side battle in this war, from the
 *  durable receipts. Under the count-down model `sectorCaptures` credited only
 *  whoever landed the final blow; the 72h scored war has no final blow, so a
 *  capture now credits EVERYONE who put points on the board for it — which is
 *  what the mythic Founder's Shadow legacy (25 captures) actually honors.
 *  Receipts store display-cased names; dedupe case-insensitively. Covers every
 *  receipt of the war, including those past the in-row mirror (the ledger
 *  keeps the distinct names as each battle lands). Exported for the test. */
export function captureContributors(session: Pick<SectorWarSession, 'appliedBattles' | 'battleLedger'>): string[] {
    return [...sectorWarLedgerOf(session).contributors];
}

export interface SectorWarSettlement {
    id: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    attackerWon: boolean;
    attackerPoints: number;
    defenderPoints: number;
}

/** Settle every war whose 72 hours are up. Returns what was settled. Never
 *  throws — a settlement hiccup must not break the caller's own path; an
 *  unsettled war is simply retried by the next poll or the daily pass. */
export async function settleDueSectorWars(now: number = Date.now()): Promise<SectorWarSettlement[]> {
    let due;
    try {
        due = await listUnsettledDueSectorWars(now);
    } catch {
        return [];
    }
    const settled: SectorWarSettlement[] = [];
    for (const war of due) {
        try {
            // Every battle receipt must outlive this row: a defended war's
            // record expires a day after settlement, but PvP replays can still
            // ask to prove an applied battle for longer than that. Copying the
            // receipts out is idempotent, so the bulk of it runs before the
            // lock (a war written before the overflow ledger can hold up to 200
            // in-row receipts) and the locked drain only finishes what changed.
            const confirmed = await externalizeSectorWarLedger(war, now).catch(() => new Set<string>());
            const outcome = await withKvLock(sectorWarKey(war.id), async () => {
                // Re-load inside the lock: another caller may have settled it already.
                const fresh = await loadSectorWar(war.id);
                if (!fresh) return null;
                const stamped = settleSectorWar(fresh, now);
                if (!stamped.changed) return null;
                const verdict = { ...stamped, session: await drainSectorWarLedger(stamped.session, now, kv, confirmed) };
                if (verdict.attackerWon) {
                    // Flip BEFORE persisting the verdict, inside the war lock (the
                    // territory write takes its own nested lock; order war → territory,
                    // same as every other capture path).
                    await captureSectorForVillage(fresh.sector, fresh.attackerVillage, now);
                    // Capture credit is part of the settlement barrier, not a
                    // best-effort tail. Stable per-(war, contributor) receipts
                    // make retry safe if a later contributor or the final war
                    // write fails; the war remains due until every winner's
                    // Legacy counter is confirmed.
                    if (legacyEnabled()) {
                        // Scoped to the contest INSTANCE, not just the pairing: a
                        // contest id repeats on every re-siege of the same sector
                        // by the same attacker, so a bare `<id>:<name>` receipt
                        // made a player's SECOND capture of that sector look
                        // already-delivered and silently dropped the credit.
                        const instance = sectorWarInstanceTag(verdict.session);
                        for (const name of captureContributors(verdict.session)) {
                            const delivered = await bumpLegacyStats(name, { sectorCaptures: 1 }, {
                                receiptId: `sector-capture:${war.id}:${instance}:${name.toLowerCase()}`,
                            });
                            if (!delivered) throw new Error('sector-capture-legacy-delivery-pending');
                        }
                    }
                    // A captured record is evidence, not a cooldown, and used to
                    // be written with no expiry at all.
                    await saveSectorWar(verdict.session, SECTOR_CAPTURED_RECORD_TTL_SEC);
                } else {
                    // A defended hold carries the attacker's re-siege cooldown as its TTL.
                    await saveSectorWar(verdict.session, SECTOR_RESIEGE_COOLDOWN_SEC);
                }
                return verdict;
            }, { failClosed: true });
            if (!outcome) continue;
            // Village Stores — Intel: a resolved war (either outcome) burns BOTH
            // sides' intel on the sector. Idempotent delete, best-effort, after the
            // war lock (api/_village-intel.ts).
            await zeroSectorIntel(war.sector, [war.attackerVillage, war.defenderVillage], now);
            // World Herald, AFTER the verdict is durable and outside the war lock.
            // The receipt is the war id, so a cron re-run or a second poller that
            // loses the settle race can never post it twice.
            try {
                const copy = sectorWarResolutionAnnouncement(war, {
                    attackerWon: outcome.attackerWon,
                    attackerPoints: outcome.session.attackerPoints,
                    defenderPoints: outcome.session.defenderPoints,
                });
                await announce({
                    type: copy.type,
                    importance: 'high',
                    title: copy.title,
                    message: copy.message,
                    village: copy.village,
                    meta: { sector: war.sector, contestId: war.id, attackerVillage: war.attackerVillage, defenderVillage: war.defenderVillage, attackerWon: outcome.attackerWon },
                }, { receiptId: copy.receiptId });
            } catch { /* best-effort */ }
            if (outcome.attackerWon) {
                void recordWarEcoEvent({
                    eventId: `capture:${war.id}`,
                    village: war.attackerVillage,
                    kind: 'sector.capture',
                    amount: 1,
                    meta: `sector:${war.sector}`,
                });
            }
            settled.push({
                id: war.id,
                sector: war.sector,
                attackerVillage: war.attackerVillage,
                defenderVillage: war.defenderVillage,
                attackerWon: outcome.attackerWon,
                attackerPoints: outcome.session.attackerPoints,
                defenderPoints: outcome.session.defenderPoints,
            });
        } catch {
            // Contended or storage blip — the war stays due and settles on a later pass.
        }
    }
    return settled;
}
