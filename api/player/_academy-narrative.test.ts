import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { academyNarrativeRecordPatch, applyAcademyNarrativeAction } from "./_academy-narrative.js";

describe("Academy narrative milestones", () => {
    it("records the post-spar incident without replacing concurrent vitals", () => {
        const current = { onboardingStep: "cafeteria", academySparClaimed: true, hp: 486, ryo: 2_130 };
        const result = applyAcademyNarrativeAction(current, {}, "incident");
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.deepEqual(result.character, { ...current, academyIncidentSeen: true });
    });

    it("rejects an incident acknowledgement before the sealed spar reward", () => {
        const result = applyAcademyNarrativeAction({ onboardingStep: "cafeteria" }, {}, "incident");
        assert.deepEqual(result, {
            ok: false,
            status: 409,
            error: "Finish the Academy spar before acknowledging its aftermath.",
        });
    });

    it("records only the sector currently stored on the authoritative save", () => {
        const current = { onboardingStep: "sectorReturn" };
        const accepted = applyAcademyNarrativeAction(current, { currentSector: 7 }, "trace", 7);
        assert.equal(accepted.ok, true);
        if (accepted.ok) assert.deepEqual(accepted.character, {
            ...current,
            academySectorVisited: true,
            academyTraceSector: 7,
        });
        assert.equal(applyAcademyNarrativeAction(current, { currentSector: 8 }, "trace", 7).ok, false);
        assert.equal(applyAcademyNarrativeAction(current, { currentSector: 0 }, "trace", 0).ok, false);
    });

    it("acknowledges an arrived field trace while the Logbook autosave is still pending", () => {
        const current = { onboardingStep: "logbook", academyTrialClaimed: true, hp: 83, ryo: 700 };
        const accepted = applyAcademyNarrativeAction(current, { currentSector: 1 }, "trace", 1);
        assert.equal(accepted.ok, true);
        if (!accepted.ok) return;
        assert.deepEqual(accepted.character, { ...current, onboardingStep: "sectorReturn", academySectorVisited: true, academyTraceSector: 1 });
        const replay = applyAcademyNarrativeAction(accepted.character, { currentSector: 1 }, "trace", 1);
        assert.equal(replay.ok && replay.changed, false);
        for (const invalid of [
            { ...current, academyTrialClaimed: false },
            { ...current, onboardingStep: "firstMission" },
            { ...current, onboardingStep: "done" },
        ]) assert.equal(applyAcademyNarrativeAction(invalid, { currentSector: 1 }, "trace", 1).ok, false);
        assert.equal(applyAcademyNarrativeAction(current, { currentSector: 0 }, "trace", 1).ok, false);
        assert.equal(applyAcademyNarrativeAction(current, { currentSector: 2 }, "trace", 1).ok, false);
    });

    it('persists the Logbook handoff only after the Academy Trial claim', () => {
        const claimed = { onboardingStep: 'logbook', academyTrialClaimed: true, hp: 83 };
        const advanced = applyAcademyNarrativeAction(claimed, {}, 'logbook');
        assert.equal(advanced.ok, true);
        if (!advanced.ok) return;
        assert.deepEqual(advanced.character, { ...claimed, onboardingStep: 'sectorReturn' });
        const replay = applyAcademyNarrativeAction(advanced.character, {}, 'logbook');
        assert.equal(replay.ok && replay.changed, false);
        assert.equal(applyAcademyNarrativeAction({ ...claimed, academyTrialClaimed: false }, {}, 'logbook').ok, false);
        const veteran = applyAcademyNarrativeAction({ ...claimed, onboardingStep: 'done' }, {}, 'logbook');
        assert.equal(veteran.ok && veteran.changed, false);
    });

    it("requires the trace before the seal and the seal before completion", () => {
        const step = { onboardingStep: "sectorReturn" };
        assert.equal(applyAcademyNarrativeAction(step, {}, "seal").ok, false);
        assert.equal(applyAcademyNarrativeAction({ ...step, academySectorVisited: true }, {}, "complete").ok, false);
        const sealed = applyAcademyNarrativeAction({ ...step, academySectorVisited: true }, {}, "seal");
        assert.equal(sealed.ok, true);
        if (!sealed.ok) return;
        const complete = applyAcademyNarrativeAction(sealed.character, {}, "complete");
        assert.equal(complete.ok, true);
        if (complete.ok) assert.equal(complete.character.onboardingStep, "done");
    });

    it("replays completed actions without manufacturing another write", () => {
        const result = applyAcademyNarrativeAction({
            onboardingStep: "done",
            academyFieldSeal: true,
        }, {}, "complete");
        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.changed, false);
    });

    it("returns a completed player to the authoritative village sector", () => {
        assert.deepEqual(
            academyNarrativeRecordPatch({ currentSector: 7, pendingTravel: { destinationSector: 8 } }, "complete"),
            { currentSector: 0, pendingTravel: null },
        );
        assert.equal(academyNarrativeRecordPatch({ currentSector: 0, pendingTravel: null }, "complete"), undefined);
        assert.equal(academyNarrativeRecordPatch({ currentSector: 7 }, "seal"), undefined);
    });

    it("lets a player explicitly skip from any active Academy step", () => {
        const result = applyAcademyNarrativeAction({ onboardingStep: "inventory", hp: 12 }, {}, "skip");
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.character.onboardingStep, 'done');
            assert.equal(result.character.hp, 12);
            assert.equal((result.character.firstContract as { source: string }).source, 'skip');
        }
    });
});
