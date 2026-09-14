import { test } from "node:test";
import assert from "node:assert/strict";
import { PET_CATALOG } from "../../../api/pet/_catalog";
import { createShowdownSession, showdownStateView } from "../../../api/_pet-showdown/engine";
import { buildMovePresentations, movePresentationKey, resolveMovePresentation, techniqueEnvelope, techniquePhase } from "./showdown-move-presentation";
import { showdownAttackRhythm, showdownCastRelease } from "./pet-showdown-choreography";

test("every actual sealed pet loadout has distinct primary geometry, including signatures", () => {
    let count = 0;
    for (const pet of Object.values(PET_CATALOG)) {
        for (const level of [1, 30, 100]) {
            const session = createShowdownSession({ sessionId: "vfx-test", playerName: "QA", format: "1v1", tier: "warrior", seed: 7,
                playerPets: [{ ...pet, templateId: pet.id, level }], enemyPets: [{ ...pet, templateId: pet.id, id: "enemy", level }], enemyTeamName: "QA" });
            const kit = showdownStateView(session).player[0].moves;
            const presentations = buildMovePresentations(kit);
            assert.equal(presentations.size, kit.length, `${pet.name}: all moves resolve`);
            assert.equal(new Set([...presentations.values()].map(p => p.grammar)).size, kit.length, `${pet.name} level ${level}`);
            assert.deepEqual([...buildMovePresentations([...kit].reverse())], [...presentations], `${pet.name}: order cannot reshuffle artwork`);
            for (const move of kit) {
                assert.deepEqual(resolveMovePresentation(presentations, { moveName: move.name, moveKind: move.kind, element: move.element, super: move.signature }), presentations.get(movePresentationKey(move.name, move.signature)));
            }
        }
        count++;
    }
    assert.equal(count, 160, "wild pets, breeding exclusives and starter forms are all included");
});

test("a four-damage kit reserves the signature and gives the two elemental attacks different shapes", () => {
    const kit = [
        { name: "Swift Strike", kind: "damage", element: "None", signature: false },
        { name: "Wind Slash", kind: "damage", element: "Wind", signature: false },
        { name: "Skydance Blades", kind: "damage", element: "Wind", signature: false },
        { name: "Gale Requiem", kind: "damage", element: "Wind", signature: true },
    ];
    const styles = [...buildMovePresentations(kit).values()];
    assert.equal(styles[0].hero, "storm");
    assert.equal(new Set(styles.map(p => p.grammar)).size, 4);
});

test("signature identity and unknown historical moves resolve without generic explosions", () => {
    assert.notEqual(movePresentationKey("Gale Slash", true), movePresentationKey("Gale Slash", false));
    const replay = resolveMovePresentation(undefined, { moveName: "Old Fire Breath", moveKind: "damage", element: "Fire", super: false });
    assert.equal(replay.hero, "jet");
    const meleeReplay = resolveMovePresentation(undefined, { moveName: "Old Stone Strike", moveKind: "damage", element: "Earth", super: false, delivery: "melee" });
    assert.equal(meleeReplay.hero, "blade", "old melee moves cannot select a comet with no flight window");
    const guard = resolveMovePresentation(undefined, { moveName: "Guard", moveKind: "guard", element: "Fire", super: false });
    assert.equal(guard.hero, null);
});

test("technique envelopes disappear at both ends without oscillating flashes", () => {
    for (const t of [-1, 0, 1, 2]) assert.equal(techniqueEnvelope(t), 0);
    assert.equal(techniqueEnvelope(.4), 1);
    for (let i = 1; i <= 100; i++) assert.ok(techniqueEnvelope(.68 + i * .0032) <= techniqueEnvelope(.68 + (i - 1) * .0032));
});

test("misses and blocks retain the approach but never spawn victim storms", () => {
    for (const outcome of ["miss", "block"] as const) {
        assert.equal(techniquePhase(.25, .2, .5, .85, outcome)?.hit, false);
        assert.equal(techniquePhase(.5, .2, .5, .85, outcome), null);
        assert.equal(techniquePhase(.7, .2, .5, .85, outcome), null);
    }
    assert.equal(techniquePhase(.7, .2, .5, .85, "hit")?.hit, true);
    assert.equal(techniquePhase(.9, .2, .5, .85, "hit"), null);
});

test("all technique weights arrive at contact and finish within their beat at normal and fast playback", () => {
    for (const weight of ["light", "normal", "heavy"] as const) for (const superMove of [false, true]) for (const delivery of ["melee", "ranged"] as const) {
        const rhythm = showdownAttackRhythm({ weight, superMove, delivery, moveKind: "damage" });
        const release = delivery === "melee" ? rhythm.contact : showdownCastRelease(rhythm);
        const end = Math.min(.96, rhythm.contact + (superMove ? .32 : .27));
        for (const speed of [1, 2.1]) {
            const duration = 6400 / speed, elapsed = rhythm.contact * duration;
            const phase = techniquePhase(elapsed / duration + 1e-10, release, rhythm.contact, end, "hit");
            assert.equal(phase?.hit, true);
            if (delivery === "ranged") assert.equal(phase?.travel, 1);
            assert.equal(techniquePhase(1, release, rhythm.contact, end, "hit"), null);
        }
    }
});
