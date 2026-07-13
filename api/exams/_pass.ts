const EXAMS = ['genin', 'chunin', 'jonin', 'specialJonin'] as const;
type ExamKey = typeof EXAMS[number];
const n = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
const list = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

export function passRankExam(character: Record<string, unknown>, examRaw: unknown, leadership: { isKage?: boolean; isElder?: boolean } = {}) {
    const exam = typeof examRaw === 'string' && EXAMS.includes(examRaw as ExamKey) ? examRaw as ExamKey : null;
    if (!exam) return { ok: false as const, reason: 'unknown-rank-exam' as const };
    const passed = list(character.examsPassed);
    if (passed.includes(exam)) return { ok: true as const, alreadyPassed: true, character };
    const index = EXAMS.indexOf(exam);
    if (index > 0 && !passed.includes(EXAMS[index - 1])) return { ok: false as const, reason: 'previous-rank-exam-required' as const };
    const elements = new Set([...list(character.elements), ...(typeof character.element === 'string' ? [character.element] : [])]);
    const defeated = new Set(list(character.defeatedAiIds));
    const mastery = Array.isArray(character.jutsuMastery) ? character.jutsuMastery as Array<Record<string, unknown>> : [];
    const highestMastery = mastery.reduce((max, row) => Math.max(max, n(row?.level)), 0);
    const missions = Math.max(n(character.totalMissionsCompleted), n(character.clanMissionContrib));
    let ready = false;
    if (exam === 'genin') ready = n(character.level) >= 20 && elements.size >= 1 && n(character.totalStatsTrained) >= 400 && missions >= 20 && n(character.totalAiKills) >= 20 && n(character.totalTilesExplored) >= 50 && highestMastery >= 3;
    if (exam === 'chunin') ready = n(character.level) >= 39 && elements.size >= 2 && missions >= 50 && n(character.totalTilesExplored) >= 100 && Boolean(String(character.clan ?? '').trim()) && defeated.has('builtin-ai-exam-proctor');
    if (exam === 'jonin') ready = n(character.level) >= 50 && n(character.totalPvpKills) >= 10 && n(character.totalVillageRaids) >= 20 && defeated.has('builtin-ai-rogue-ninja');
    if (exam === 'specialJonin') ready = n(character.level) >= 80 && n(character.totalPvpKills) >= 100 && Boolean(leadership.isKage || leadership.isElder);
    if (!ready) return { ok: false as const, reason: 'rank-exam-requirements-incomplete' as const };
    return { ok: true as const, alreadyPassed: false, character: { ...character, examsPassed: [...passed, exam] } };
}
