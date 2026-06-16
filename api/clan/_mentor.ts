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

export const MENTOR_STUDENT_MAX = 3;                              // students per sensei
export const MENTOR_STUDENT_MAX_LEVEL = 15;                       // must be <= this when taken on
export const MENTOR_STUDENT_MAX_ACCOUNT_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const MENTOR_REWARD_SEALS = 50;                            // sensei, per milestone
export const MENTOR_REWARD_CONTRIB = 5;                           // sensei clanEventContrib, per milestone
export const MENTOR_STUDENT_RYO = 1_000;                          // student boost, per milestone

export type MentorMilestone = "academy" | "level20" | "level40" | "rankedWin";
export const MENTOR_MILESTONES: MentorMilestone[] = ["academy", "level20", "level40", "rankedWin"];
export const MENTOR_MILESTONE_LABEL: Record<MentorMilestone, string> = {
    academy: "Graduated the Academy",
    level20: "Reached level 20",
    level40: "Reached level 40",
    rankedWin: "Won a ranked battle",
};

export type StudentProgress = { onboardingStep?: string; level?: number; rankedWins?: number };

/** Which milestones the student's save currently satisfies. */
export function reachedMilestones(student: StudentProgress): Set<MentorMilestone> {
    const set = new Set<MentorMilestone>();
    if (student.onboardingStep === "done") set.add("academy");
    const lvl = Number(student.level ?? 0);
    if (lvl >= 20) set.add("level20");
    if (lvl >= 40) set.add("level40");
    if (Number(student.rankedWins ?? 0) >= 1) set.add("rankedWin");
    return set;
}

/** Milestones reached but not yet paid out for this pairing. */
export function claimableMilestones(student: StudentProgress, claimed: Record<string, number> | undefined): MentorMilestone[] {
    const reached = reachedMilestones(student);
    const done = claimed ?? {};
    return MENTOR_MILESTONES.filter((m) => reached.has(m) && !done[m]);
}

export type AssignInput = {
    senseiSlug: string;
    studentSlug: string;
    sameClan: boolean;
    studentLevel: number;
    studentAccountAgeMs: number;
    studentAlreadyMentored: boolean;
    senseiStudentCount: number;
};
export type AssignResult = { ok: true } | { ok: false; reason: string };

export function canAssignStudent(i: AssignInput): AssignResult {
    if (!i.senseiSlug || !i.studentSlug) return { ok: false, reason: "Missing sensei or student." };
    if (i.senseiSlug === i.studentSlug) return { ok: false, reason: "You can't mentor yourself." };
    if (!i.sameClan) return { ok: false, reason: "The student must be a member of your clan." };
    if (i.studentLevel > MENTOR_STUDENT_MAX_LEVEL) return { ok: false, reason: `Students must be level ${MENTOR_STUDENT_MAX_LEVEL} or below when taken on.` };
    if (i.studentAccountAgeMs > MENTOR_STUDENT_MAX_ACCOUNT_AGE_MS) return { ok: false, reason: "That player is no longer a newcomer." };
    if (i.studentAlreadyMentored) return { ok: false, reason: "That player already has a sensei." };
    if (i.senseiStudentCount >= MENTOR_STUDENT_MAX) return { ok: false, reason: `You can mentor at most ${MENTOR_STUDENT_MAX} students at once.` };
    return { ok: true };
}

/** Total sensei + student payout for `count` newly-claimed milestones. */
export function mentorPayout(count: number): { seals: number; contrib: number; studentRyo: number } {
    const n = Math.max(0, Math.floor(count));
    return { seals: n * MENTOR_REWARD_SEALS, contrib: n * MENTOR_REWARD_CONTRIB, studentRyo: n * MENTOR_STUDENT_RYO };
}
