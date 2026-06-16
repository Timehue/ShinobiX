/**
 * Decision-logic guard for clan mentorship (api/clan/mentor.ts).
 * Tests the pure eligibility gates + milestone detection in _mentor.ts.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    reachedMilestones, claimableMilestones, canAssignStudent, mentorPayout,
    MENTOR_STUDENT_MAX, MENTOR_STUDENT_MAX_LEVEL, MENTOR_STUDENT_MAX_ACCOUNT_AGE_MS,
    MENTOR_REWARD_SEALS, MENTOR_REWARD_CONTRIB, MENTOR_STUDENT_RYO,
    type AssignInput,
} from "./_mentor.js";

function assignInput(over: Partial<AssignInput> = {}): AssignInput {
    return {
        senseiSlug: "rill",
        studentSlug: "newbie",
        sameClan: true,
        studentLevel: 5,
        studentAccountAgeMs: 60 * 60 * 1000, // 1h old
        studentAlreadyMentored: false,
        senseiStudentCount: 0,
        ...over,
    };
}

describe("reachedMilestones", () => {
    it("detects each milestone from the student's save", () => {
        assert.deepEqual([...reachedMilestones({ onboardingStep: "done" })], ["academy"]);
        assert.deepEqual([...reachedMilestones({ level: 25 })].sort(), ["level20"]);
        assert.deepEqual([...reachedMilestones({ level: 45 })].sort(), ["level20", "level40"]);
        assert.deepEqual([...reachedMilestones({ rankedWins: 2 })], ["rankedWin"]);
        assert.equal(reachedMilestones({ onboardingStep: "training", level: 3, rankedWins: 0 }).size, 0);
    });
});

describe("claimableMilestones", () => {
    it("returns reached-but-unclaimed milestones", () => {
        const student = { onboardingStep: "done", level: 22, rankedWins: 0 };
        assert.deepEqual(claimableMilestones(student, {}).sort(), ["academy", "level20"]);
        assert.deepEqual(claimableMilestones(student, { academy: 1 }).sort(), ["level20"], "already-claimed dropped");
        assert.deepEqual(claimableMilestones(student, { academy: 1, level20: 1 }), [], "nothing left");
    });
});

describe("canAssignStudent", () => {
    it("allows a fresh same-clan newcomer", () => {
        assert.equal(canAssignStudent(assignInput()).ok, true);
    });
    it("rejects self-mentoring", () => {
        assert.equal(canAssignStudent(assignInput({ studentSlug: "rill" })).ok, false);
    });
    it("rejects a student in a different clan", () => {
        assert.equal(canAssignStudent(assignInput({ sameClan: false })).ok, false);
    });
    it(`rejects a student over level ${MENTOR_STUDENT_MAX_LEVEL}`, () => {
        assert.equal(canAssignStudent(assignInput({ studentLevel: MENTOR_STUDENT_MAX_LEVEL + 1 })).ok, false);
    });
    it("rejects a too-old account", () => {
        assert.equal(canAssignStudent(assignInput({ studentAccountAgeMs: MENTOR_STUDENT_MAX_ACCOUNT_AGE_MS + 1 })).ok, false);
    });
    it("rejects an already-mentored student", () => {
        assert.equal(canAssignStudent(assignInput({ studentAlreadyMentored: true })).ok, false);
    });
    it(`rejects past the ${MENTOR_STUDENT_MAX}-student cap`, () => {
        assert.equal(canAssignStudent(assignInput({ senseiStudentCount: MENTOR_STUDENT_MAX })).ok, false);
    });
});

describe("mentorPayout", () => {
    it("scales sensei + student reward by milestone count", () => {
        assert.deepEqual(mentorPayout(2), { seals: 2 * MENTOR_REWARD_SEALS, contrib: 2 * MENTOR_REWARD_CONTRIB, studentRyo: 2 * MENTOR_STUDENT_RYO });
        assert.deepEqual(mentorPayout(0), { seals: 0, contrib: 0, studentRyo: 0 });
    });
});
