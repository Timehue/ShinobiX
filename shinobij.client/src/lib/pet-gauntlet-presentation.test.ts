import assert from "node:assert/strict";
import test from "node:test";
import { resolveCombatBodyYaw } from "./pet-combat-performance";
import { gauntletPetPresentationKey, gauntletTeamFacing, resolveGauntletBoardQuality } from "./pet-gauntlet-presentation";
import { PET_VISUAL_QUALITY_PRESETS } from "./pet-visual-quality";

test("both Gauntlet teams face through the centre line", () => {
    assert.deepEqual(gauntletTeamFacing("player"), [0, -1]);
    assert.deepEqual(gauntletTeamFacing("enemy"), [0, 1]);

    for (const yawOffset of [0, Math.PI, -Math.PI / 2]) {
        const player = gauntletTeamFacing("player");
        const enemy = gauntletTeamFacing("enemy");
        const playerYaw = resolveCombatBodyYaw(player[0], player[1], yawOffset);
        const enemyYaw = resolveCombatBodyYaw(enemy[0], enemy[1], yawOffset);
        const separation = Math.abs(Math.atan2(Math.sin(playerYaw - enemyYaw), Math.cos(playerYaw - enemyYaw)));
        assert.ok(Math.abs(separation - Math.PI) < 1e-9, `yaw correction ${yawOffset} must preserve opposite team facing`);
    }
});

test("presentation identity survives malformed legacy pet records", () => {
    assert.equal(gauntletPetPresentationKey({ id: "standard-41", name: "Bolt Mouse" }), "standard-41");
    assert.equal(gauntletPetPresentationKey({ id: null, templateId: "rare-9", name: "Bristle Boar" }), "rare-9");
    assert.equal(gauntletPetPresentationKey({ id: undefined, name: " Dopey Companion " }), "Dopey Companion");
    assert.equal(gauntletPetPresentationKey({ id: null, name: null }), "unknown-pet");
});

test("model-heavy mobile Gauntlet rounds use the crash-resistant preset", () => {
    assert.equal(resolveGauntletBoardQuality(PET_VISUAL_QUALITY_PRESETS.high, 6, 430, 8).id, "low");
    assert.equal(resolveGauntletBoardQuality(PET_VISUAL_QUALITY_PRESETS.medium, 8, 1280, 4).id, "low");
    assert.equal(resolveGauntletBoardQuality(PET_VISUAL_QUALITY_PRESETS.high, 5, 430, 4).id, "high");
    assert.equal(resolveGauntletBoardQuality(PET_VISUAL_QUALITY_PRESETS.medium, 8, 1280, 8).id, "medium");
});
