"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Decision-logic guard for clan mentorship (api/clan/mentor.ts).
 * Tests the pure eligibility gates + milestone detection in _mentor.ts.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _mentor_js_1 = require("./_mentor.js");
function assignInput(over = {}) {
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
(0, node_test_1.describe)("reachedMilestones", () => {
    (0, node_test_1.it)("detects each milestone from the student's save", () => {
        node_assert_1.strict.deepEqual([...(0, _mentor_js_1.reachedMilestones)({ onboardingStep: "done" })], ["academy"]);
        node_assert_1.strict.deepEqual([...(0, _mentor_js_1.reachedMilestones)({ level: 25 })].sort(), ["level20"]);
        node_assert_1.strict.deepEqual([...(0, _mentor_js_1.reachedMilestones)({ level: 45 })].sort(), ["level20", "level40"]);
        node_assert_1.strict.deepEqual([...(0, _mentor_js_1.reachedMilestones)({ rankedWins: 2 })], ["rankedWin"]);
        node_assert_1.strict.equal((0, _mentor_js_1.reachedMilestones)({ onboardingStep: "training", level: 3, rankedWins: 0 }).size, 0);
    });
});
(0, node_test_1.describe)("claimableMilestones", () => {
    (0, node_test_1.it)("returns reached-but-unclaimed milestones", () => {
        const student = { onboardingStep: "done", level: 22, rankedWins: 0 };
        node_assert_1.strict.deepEqual((0, _mentor_js_1.claimableMilestones)(student, {}).sort(), ["academy", "level20"]);
        node_assert_1.strict.deepEqual((0, _mentor_js_1.claimableMilestones)(student, { academy: 1 }).sort(), ["level20"], "already-claimed dropped");
        node_assert_1.strict.deepEqual((0, _mentor_js_1.claimableMilestones)(student, { academy: 1, level20: 1 }), [], "nothing left");
    });
});
(0, node_test_1.describe)("canAssignStudent", () => {
    (0, node_test_1.it)("allows a fresh same-clan newcomer", () => {
        node_assert_1.strict.equal((0, _mentor_js_1.canAssignStudent)(assignInput()).ok, true);
    });
    (0, node_test_1.it)("rejects self-mentoring", () => {
        node_assert_1.strict.equal((0, _mentor_js_1.canAssignStudent)(assignInput({ studentSlug: "rill" })).ok, false);
    });
    (0, node_test_1.it)("rejects a student in a different clan", () => {
        node_assert_1.strict.equal((0, _mentor_js_1.canAssignStudent)(assignInput({ sameClan: false })).ok, false);
    });
    (0, node_test_1.it)(`rejects a student over level ${_mentor_js_1.MENTOR_STUDENT_MAX_LEVEL}`, () => {
        node_assert_1.strict.equal((0, _mentor_js_1.canAssignStudent)(assignInput({ studentLevel: _mentor_js_1.MENTOR_STUDENT_MAX_LEVEL + 1 })).ok, false);
    });
    (0, node_test_1.it)("rejects a too-old account", () => {
        node_assert_1.strict.equal((0, _mentor_js_1.canAssignStudent)(assignInput({ studentAccountAgeMs: _mentor_js_1.MENTOR_STUDENT_MAX_ACCOUNT_AGE_MS + 1 })).ok, false);
    });
    (0, node_test_1.it)("rejects an already-mentored student", () => {
        node_assert_1.strict.equal((0, _mentor_js_1.canAssignStudent)(assignInput({ studentAlreadyMentored: true })).ok, false);
    });
    (0, node_test_1.it)(`rejects past the ${_mentor_js_1.MENTOR_STUDENT_MAX}-student cap`, () => {
        node_assert_1.strict.equal((0, _mentor_js_1.canAssignStudent)(assignInput({ senseiStudentCount: _mentor_js_1.MENTOR_STUDENT_MAX })).ok, false);
    });
});
(0, node_test_1.describe)("mentorPayout", () => {
    (0, node_test_1.it)("scales sensei + student reward by milestone count", () => {
        node_assert_1.strict.deepEqual((0, _mentor_js_1.mentorPayout)(2), { seals: 2 * _mentor_js_1.MENTOR_REWARD_SEALS, contrib: 2 * _mentor_js_1.MENTOR_REWARD_CONTRIB, studentRyo: 2 * _mentor_js_1.MENTOR_STUDENT_RYO });
        node_assert_1.strict.deepEqual((0, _mentor_js_1.mentorPayout)(0), { seals: 0, contrib: 0, studentRyo: 0 });
    });
});
