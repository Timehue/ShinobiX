"use strict";
/*
 * Server-side mirror of the daily village-agenda task seeding and completion
 * gate used by api/village/claim-daily-agenda.ts.
 *
 * The rewardable agenda pool is intentionally limited to server-verifiable work:
 * control (hold controlled sectors). Sector ownership lives in canonical
 * world:territory:* records written by server endpoints, so the count cannot be
 * faked by a crafted save. Keep this pool in sync with
 * shinobij.client/src/lib/village-state.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENDA_CONTROL_TARGET = exports.VILLAGE_AGENDA_POOL = void 0;
exports.seededVillageAgenda = seededVillageAgenda;
exports.verifyAgendaCompletion = verifyAgendaCompletion;
// VERBATIM mirror of villageAgendaTaskPool — same ORDER (the splice seeding
// depends on it). KEEP IN SYNC with shinobij.client/src/lib/village-state.ts.
exports.VILLAGE_AGENDA_POOL = [
    { kind: 'control', target: 1 },
];
// Target sectors for the "control" task. Mirrors the pool entry above.
exports.AGENDA_CONTROL_TARGET = 1;
// VERBATIM port of seededAgendaIndex (village-state.ts).
function seededAgendaIndex(seed, index, size) {
    let hash = 0;
    for (const ch of `${seed}:${index}`)
        hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return hash % size;
}
/**
 * Re-derive the seeded agenda tasks for `village` on `date` (UTC YYYY-MM-DD).
 * Mirrors makeVillageDailyAgenda: same seed (`${village}:${date}`) and same
 * splice-without-replacement selection.
 */
function seededVillageAgenda(village, date) {
    const pool = [...exports.VILLAGE_AGENDA_POOL];
    const tasks = [];
    for (let i = 0; i < 3 && pool.length; i += 1) {
        const choice = pool.splice(seededAgendaIndex(`${village}:${date}`, i, pool.length), 1)[0];
        tasks.push({ kind: choice.kind, target: choice.target });
    }
    return tasks;
}
/**
 * Verify today's server-authoritative agenda. Currently that's only "control":
 * if it is in today's set, the village must hold at least
 * AGENDA_CONTROL_TARGET sectors (authoritative count from world:territory:*).
 * Unknown legacy kinds do not count as proof and do not block here.
 *
 * Returns ok:false (with a player-facing message) ONLY when a verifiable task is
 * provably unmet, so the caller can reject the claim BEFORE placing any
 * once-per-day marker and the player can re-claim once they genuinely meet it.
 */
function verifyAgendaCompletion(seededKinds, heldSectors) {
    if (seededKinds.includes('control') && heldSectors < exports.AGENDA_CONTROL_TARGET) {
        return {
            ok: false,
            error: "Today's agenda requires your village to hold a controlled sector, and it doesn't yet.",
        };
    }
    return { ok: true };
}
