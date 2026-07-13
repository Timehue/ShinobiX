"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.passRankExam = passRankExam;
const EXAMS = ['genin', 'chunin', 'jonin', 'specialJonin'];
const n = (value) => Math.max(0, Math.floor(Number(value) || 0));
const list = (value) => Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
function passRankExam(character, examRaw, leadership = {}) {
    const exam = typeof examRaw === 'string' && EXAMS.includes(examRaw) ? examRaw : null;
    if (!exam)
        return { ok: false, reason: 'unknown-rank-exam' };
    const passed = list(character.examsPassed);
    if (passed.includes(exam))
        return { ok: true, alreadyPassed: true, character };
    const index = EXAMS.indexOf(exam);
    if (index > 0 && !passed.includes(EXAMS[index - 1]))
        return { ok: false, reason: 'previous-rank-exam-required' };
    const elements = new Set([...list(character.elements), ...(typeof character.element === 'string' ? [character.element] : [])]);
    const defeated = new Set(list(character.defeatedAiIds));
    const mastery = Array.isArray(character.jutsuMastery) ? character.jutsuMastery : [];
    const highestMastery = mastery.reduce((max, row) => Math.max(max, n(row?.level)), 0);
    const missions = Math.max(n(character.totalMissionsCompleted), n(character.clanMissionContrib));
    let ready = false;
    if (exam === 'genin')
        ready = n(character.level) >= 20 && elements.size >= 1 && n(character.totalStatsTrained) >= 400 && missions >= 20 && n(character.totalAiKills) >= 20 && n(character.totalTilesExplored) >= 50 && highestMastery >= 3;
    if (exam === 'chunin')
        ready = n(character.level) >= 39 && elements.size >= 2 && missions >= 50 && n(character.totalTilesExplored) >= 100 && Boolean(String(character.clan ?? '').trim()) && defeated.has('builtin-ai-exam-proctor');
    if (exam === 'jonin')
        ready = n(character.level) >= 50 && n(character.totalPvpKills) >= 10 && n(character.totalVillageRaids) >= 20 && defeated.has('builtin-ai-rogue-ninja');
    if (exam === 'specialJonin')
        ready = n(character.level) >= 80 && n(character.totalPvpKills) >= 100 && Boolean(leadership.isKage || leadership.isElder);
    if (!ready)
        return { ok: false, reason: 'rank-exam-requirements-incomplete' };
    return { ok: true, alreadyPassed: false, character: { ...character, examsPassed: [...passed, exam] } };
}
