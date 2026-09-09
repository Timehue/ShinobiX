import { PROGRESSION_EXAM_HOLDS } from '../../shared/progression-holds.js';
import { combatMissionByKey } from '../missions/_mission-catalog.js';

export function sanitizeExamProgress(
    char: Record<string, unknown>,
    exChar: Record<string, unknown>,
    isFirstSave: boolean,
) {
    // All item ownership is server-issued. Conserve the combined inventory +
    // counted-stack entitlement so load-time array→stack migration remains
    // lossless while arbitrary additions in either representation are dropped.
    // ─── examsPassed validation ───────────────────────────────────────────────
    // Genin and Chunin gate level progression. Jonin and Special Jonin are
    // optional prestige stamps, but all four keys remain server-owned. A forged save could POST
    // examsPassed:["genin","chunin","jonin","specialJonin"] to skip every
    // exam and falsify its record. Rules:
    //   - Only the 4 known exam keys are accepted
    //   - Cap length at 4 (one of each)
    //   - Dedupe
    //   - Level-gate: genin needs level ≥20, chunin needs level ≥39
    //   - Don't shrink an existing entry (legitimate veterans keep their list)
    const KNOWN_EXAMS = new Set(['genin', 'chunin', 'jonin', 'specialJonin']);
    const EXAM_LEVEL_GATES_SERVER = Object.fromEntries(
        PROGRESSION_EXAM_HOLDS.map(({ exam, level }) => [exam, level]),
    ) as Record<string, number>;
    // Server-side requirement FLOOR (gameplay-loop audit L-1). The full exam
    // checklist (elements, stat-training, jutsu mastery, clan, boss defeats) is
    // evaluated client-side; here we additionally enforce the subset backed by
    // the rate-limited lifetime counters clamped above, so a tampered client
    // can't just append an exam key at the level threshold and skip the grind.
    // We ONLY check counters the sanitizer itself bounds (expensive to forge)
    // and FAIL OPEN on every requirement we can't verify here — a legit player
    // who passed client-side always carries these counters (same character
    // state the client gated on), so this can never softlock a real player.
    // max(totalMissionsCompleted, clanMissionContrib) mirrors the client's
    // `?? clanMissionContrib` fallback so the server is never stricter.
    const examCounter = (field: string): number => Math.max(0, Number((char as Record<string, unknown>)[field] ?? 0));
    const examMissionsDone = Math.max(examCounter('totalMissionsCompleted'), examCounter('clanMissionContrib'));
    const EXAM_COUNTER_REQUIREMENTS_MET: Record<string, boolean> = {
        genin: examCounter('totalAiKills') >= 20 && examMissionsDone >= 20 && examCounter('totalTilesExplored') >= 50,
        chunin: examMissionsDone >= 50 && examCounter('totalTilesExplored') >= 100,
        jonin: examCounter('totalPvpKills') >= 10 && examCounter('totalVillageRaids') >= 20,
        specialJonin: examCounter('totalPvpKills') >= 100,
    };
    const exExams = Array.isArray(exChar.examsPassed) ? (exChar.examsPassed as unknown[]).map(String) : [];
    const inExams = Array.isArray(char.examsPassed) ? (char.examsPassed as unknown[]).map(String) : [];
    const charLevel = Number(char.level ?? exChar.level ?? 1);
    const validatedExams: string[] = [];
    const seenExams = new Set<string>();
    // Preserve every exam already on the existing save (don't penalize legit veterans).
    for (const e of exExams) {
        if (KNOWN_EXAMS.has(e) && !seenExams.has(e)) {
            validatedExams.push(e);
            seenExams.add(e);
        }
    }
    // Accept NEW exam additions only if they pass the level gate AND the
    // server-trackable requirement floor. Exams absent from the map fail open.
    for (const e of inExams) {
        if (!KNOWN_EXAMS.has(e) || seenExams.has(e)) continue;
        const required = EXAM_LEVEL_GATES_SERVER[e];
        if (required != null && charLevel < required) continue;
        if (e in EXAM_COUNTER_REQUIREMENTS_MET && !EXAM_COUNTER_REQUIREMENTS_MET[e]) continue;
        validatedExams.push(e);
        seenExams.add(e);
    }
    char.examsPassed = validatedExams.slice(0, 4);
    // Final authority boundary: the dedicated /api/exams/pass flow evaluates
    // the complete checklist (including mastery, clan, named AI defeats, and
    // live Kage/ANBU leadership). Generic saves only preserve its committed list.
    if (!isFirstSave) char.examsPassed = exExams.filter((exam, index) => KNOWN_EXAMS.has(exam) && exExams.indexOf(exam) === index).slice(0, 4);

    // ─── pendingCombatMissionClaims validation ────────────────────────────────
    // Combat-mission claims are server-owned by the queue and claim endpoints.
    // A player save may preserve an already-stored flag, but it may not mint a
    // new one or clear a server-queued one.
    // Without this, a tampered save could add a valid catalog key and claim combat
    // rewards without winning the fight.
    if (char.pendingCombatMissionClaims !== undefined) {
        const PENDING_COMBAT_CLAIMS_CAP = 50;
        const rawPending = Array.isArray(exChar.pendingCombatMissionClaims)
            ? (exChar.pendingCombatMissionClaims as unknown[])
            : [];
        const validatedPending: string[] = [];
        const seenPending = new Set<string>();
        for (const raw of rawPending) {
            const key = String(raw ?? '');
            if (!key || seenPending.has(key)) continue;
            const def = combatMissionByKey(key);
            if (!def) continue;                  // not a real catalog mission key
            if (charLevel < def.min) continue;   // below the mission's level gate
            validatedPending.push(key);
            seenPending.add(key);
            if (validatedPending.length >= PENDING_COMBAT_CLAIMS_CAP) break;
        }
        char.pendingCombatMissionClaims = validatedPending;
    }
}
