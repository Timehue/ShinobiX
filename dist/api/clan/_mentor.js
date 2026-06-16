"use strict";
/*
 * Pure decision logic for the clan Sensei -> Student mentorship
 * (api/clan/mentor.ts) — split out so the eligibility gates + milestone
 * detection can be unit-tested without KV / auth / locks (same pattern as
 * _kick-core.ts / _kage-challenge.ts).
 *
 * Model: a clan veteran takes on a GENUINELY-NEW clan member as a student.
 * When the student hits milestones that already exist in the game, the sensei
 * earns Honor Seals + clan contribution and the student gets a small ryo boost.
 * The sensei's reward IS the newcomer's real progress, so it pays veterans to
 * recruit and grow new players — the small-population retention hook, in shinobi
 * flavor. Anti-alt: students must be new (level + account-age gated) and the
 * endpoint additionally voids same-IP/device pairings.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MENTOR_MILESTONE_LABEL = exports.MENTOR_MILESTONES = exports.MENTOR_STUDENT_RYO = exports.MENTOR_REWARD_CONTRIB = exports.MENTOR_REWARD_SEALS = exports.MENTOR_STUDENT_MAX_ACCOUNT_AGE_MS = exports.MENTOR_STUDENT_MAX_LEVEL = exports.MENTOR_STUDENT_MAX = void 0;
exports.reachedMilestones = reachedMilestones;
exports.claimableMilestones = claimableMilestones;
exports.canAssignStudent = canAssignStudent;
exports.mentorPayout = mentorPayout;
exports.MENTOR_STUDENT_MAX = 3; // students per sensei
exports.MENTOR_STUDENT_MAX_LEVEL = 15; // must be <= this when taken on
exports.MENTOR_STUDENT_MAX_ACCOUNT_AGE_MS = 14 * 24 * 60 * 60 * 1000;
exports.MENTOR_REWARD_SEALS = 50; // sensei, per milestone
exports.MENTOR_REWARD_CONTRIB = 5; // sensei clanEventContrib, per milestone
exports.MENTOR_STUDENT_RYO = 1_000; // student boost, per milestone
exports.MENTOR_MILESTONES = ["academy", "level20", "level40", "rankedWin"];
exports.MENTOR_MILESTONE_LABEL = {
    academy: "Graduated the Academy",
    level20: "Reached level 20",
    level40: "Reached level 40",
    rankedWin: "Won a ranked battle",
};
/** Which milestones the student's save currently satisfies. */
function reachedMilestones(student) {
    const set = new Set();
    if (student.onboardingStep === "done")
        set.add("academy");
    const lvl = Number(student.level ?? 0);
    if (lvl >= 20)
        set.add("level20");
    if (lvl >= 40)
        set.add("level40");
    if (Number(student.rankedWins ?? 0) >= 1)
        set.add("rankedWin");
    return set;
}
/** Milestones reached but not yet paid out for this pairing. */
function claimableMilestones(student, claimed) {
    const reached = reachedMilestones(student);
    const done = claimed ?? {};
    return exports.MENTOR_MILESTONES.filter((m) => reached.has(m) && !done[m]);
}
function canAssignStudent(i) {
    if (!i.senseiSlug || !i.studentSlug)
        return { ok: false, reason: "Missing sensei or student." };
    if (i.senseiSlug === i.studentSlug)
        return { ok: false, reason: "You can't mentor yourself." };
    if (!i.sameClan)
        return { ok: false, reason: "The student must be a member of your clan." };
    if (i.studentLevel > exports.MENTOR_STUDENT_MAX_LEVEL)
        return { ok: false, reason: `Students must be level ${exports.MENTOR_STUDENT_MAX_LEVEL} or below when taken on.` };
    if (i.studentAccountAgeMs > exports.MENTOR_STUDENT_MAX_ACCOUNT_AGE_MS)
        return { ok: false, reason: "That player is no longer a newcomer." };
    if (i.studentAlreadyMentored)
        return { ok: false, reason: "That player already has a sensei." };
    if (i.senseiStudentCount >= exports.MENTOR_STUDENT_MAX)
        return { ok: false, reason: `You can mentor at most ${exports.MENTOR_STUDENT_MAX} students at once.` };
    return { ok: true };
}
/** Total sensei + student payout for `count` newly-claimed milestones. */
function mentorPayout(count) {
    const n = Math.max(0, Math.floor(count));
    return { seals: n * exports.MENTOR_REWARD_SEALS, contrib: n * exports.MENTOR_REWARD_CONTRIB, studentRyo: n * exports.MENTOR_STUDENT_RYO };
}
