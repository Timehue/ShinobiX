"use strict";
/*
 * Server-side mirror of the daily village-agenda task SEEDING + the
 * verifiable-subset completion gate used by api/village/claim-daily-agenda.ts.
 *
 * The agenda's 3 tasks are seeded deterministically per village + UTC date on
 * the client (shinobij.client/src/lib/village-state.ts makeVillageDailyAgenda /
 * seededAgendaIndex). To check completion server-side we must re-derive the SAME
 * 3 tasks here — so this is a VERBATIM port. KEEP IN SYNC with that file (pool
 * order, seed string, and the splice algorithm all matter for parity).
 *
 * Which tasks can be verified server-authoritatively?
 *   - control (hold controlled sectors) → YES. Sector ownership lives in the
 *     canonical world:territory:* records, written ONLY by server endpoints, so
 *     the count can't be faked. (Same source as api/village/claim-map-control.ts.)
 *   - missions / explore / ai / pet → NO (yet). Their progress lives in
 *     client-incremented save counters (dailyMissionsCompleted, dailyTilesExplored,
 *     dailyAiKills, dailyPetWins) — character-progress.ts bumps them client-side
 *     and the save sanitizer only rate-limits growth, so they remain client-
 *     trusted. Making them authoritative needs server-side daily ledgers (a
 *     larger Stage-3 item). Until then they are trusted; see verifyAgendaCompletion.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENDA_CONTROL_TARGET = exports.VILLAGE_AGENDA_POOL = void 0;
exports.seededVillageAgenda = seededVillageAgenda;
exports.verifyAgendaCompletion = verifyAgendaCompletion;
// VERBATIM mirror of villageAgendaTaskPool — same ORDER (the splice seeding
// depends on it). KEEP IN SYNC with shinobij.client/src/lib/village-state.ts.
exports.VILLAGE_AGENDA_POOL = [
    { kind: 'missions', target: 3 },
    { kind: 'explore', target: 20 },
    { kind: 'ai', target: 3 },
    { kind: 'pet', target: 1 },
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
 * Re-derive the 3 seeded agenda task kinds for `village` on `date` (UTC
 * YYYY-MM-DD). Mirrors makeVillageDailyAgenda — same seed (`${village}:${date}`)
 * and the same splice-without-replacement selection, so the server sees exactly
 * the tasks the client was asked to complete.
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
 * Verify the SERVER-AUTHORITATIVE subset of today's seeded agenda. Currently
 * that's only the "control" task: if it's in today's set, the village must hold
 * at least AGENDA_CONTROL_TARGET sectors (authoritative count from
 * world:territory:*). All other task kinds are trusted (client-incremented
 * counters — see the module header) and never block the claim here.
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
