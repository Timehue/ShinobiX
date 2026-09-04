import assert from "node:assert/strict";
import test from "node:test";
import type { DuelEvent } from "./pet-duel-sim";
import type { WarfrontAttackCue } from "./pet-warfront-attack-causality";
import {
    WARFRONT_ELEMENT_SIGNATURES,
    WARFRONT_AUDIO_MIN_GAP_TICKS,
    WARFRONT_HERO_BURST_HOLD_TICKS,
    WARFRONT_HERO_BURST_PX,
    WARFRONT_HERO_AXIS_TAIL_PX,
    WARFRONT_HERO_CONTACT_LAYER_COUNT,
    WARFRONT_HERO_CONTACT_MAX_TARGET_WIDTHS,
    WARFRONT_HERO_CONTACT_MIN_TARGET_WIDTHS,
    WARFRONT_HERO_CONTACT_TARGET_WIDTHS,
    WARFRONT_HERO_DAMAGE_HOLD_TICKS,
    WARFRONT_HERO_FIRE_CONTACT_LAYERS,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_Y,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_ASYMMETRY,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_LEFT_RIGHT_REACH_RATIO,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_SOURCE_PX,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL,
    WARFRONT_HERO_FIRE_RESIDUE_LAYERS,
    WARFRONT_HERO_FIRE_SHAPES,
    WARFRONT_HERO_FIRE_VFX_GRAMMAR,
    WARFRONT_HERO_FLARE_MIN_PX,
    WARFRONT_HERO_IMPACT_HOLD_TICKS,
    WARFRONT_HERO_IMPACT_MIN_PX,
    WARFRONT_HERO_RESIDUE_LAYER_COUNT,
    WARFRONT_HERO_TRAVEL_CORE_PX,
    WARFRONT_HERO_TRAVEL_PLUME_PX,
    WARFRONT_HERO_TRAVEL_MIN_SPAN_FRACTION,
    WARFRONT_SPECTACLE_OVERLAP_CAP,
    WARFRONT_SPECTACLE_PARTICLE_CAP_DESKTOP,
    WARFRONT_SPECTACLE_PARTICLE_CAP_MOBILE,
    WARFRONT_SPECTACLE_RESULT_TICKS,
    buildWarfrontAudioPlan,
    createWarfrontSpectaclePhase,
    warfrontHeroBurstHold,
    warfrontHeroContactWidthPx,
    warfrontHeroDamageHold,
    warfrontHeroFireShape,
    warfrontSpectacleParticleBudget,
    warfrontSpectaclePhaseInto,
    warfrontHeroAttackCue,
    warfrontHeroImpactHold,
    warfrontHeroStage,
    warfrontHeroAxisTailStrength,
    warfrontHeroTravelSpanFraction,
} from "./pet-warfront-spectacle";

const cue: WarfrontAttackCue = {
    actorId: "player-0", targetId: "enemy-0", side: "player", element: "Fire",
    tellTick: 10, contactTick: 18, hits: 1, lethal: false, koTick: null,
};

test("four core elements own distinct silhouette, palette, motion, and audio signatures", () => {
    const signatures = Object.values(WARFRONT_ELEMENT_SIGNATURES);
    assert.equal(signatures.length, 4);
    assert.equal(new Set(signatures.map((value) => value.shape)).size, 4);
    assert.equal(new Set(signatures.map((value) => value.primary)).size, 4);
    assert.equal(new Set(signatures.map((value) => `${value.audioContact}:${value.contactRate}`)).size, 4);
});

test("tell, contact, and result are discrete and result fully clears", () => {
    const phase = createWarfrontSpectaclePhase();
    assert.ok(warfrontSpectaclePhaseInto(cue, 12, phase).tell > 0);
    assert.equal(warfrontSpectaclePhaseInto(cue, 12, phase).contact, 0);
    assert.equal(warfrontSpectaclePhaseInto(cue, 18, phase).contact, 1);
    assert.ok(warfrontSpectaclePhaseInto(cue, 22, phase).result > 0);
    assert.deepEqual(warfrontSpectaclePhaseInto(cue, 28, phase), { visible: false, tell: 0, travel: 0, contact: 0, result: 0 });
    assert.equal(warfrontHeroStage(warfrontSpectaclePhaseInto(cue, 12, phase)), "windup");
    assert.equal(warfrontHeroStage(warfrontSpectaclePhaseInto(cue, 15, phase)), "travel");
    assert.equal(warfrontHeroStage(warfrontSpectaclePhaseInto(cue, 18, phase)), "contact");
    assert.equal(warfrontHeroStage(warfrontSpectaclePhaseInto(cue, 22, phase)), "result");
});

test("overlap and particle budgets are fixed and stricter on mobile", () => {
    assert.equal(WARFRONT_SPECTACLE_OVERLAP_CAP, 4);
    assert.equal(warfrontSpectacleParticleBudget(412, 4) * 4, WARFRONT_SPECTACLE_PARTICLE_CAP_MOBILE);
    assert.equal(warfrontSpectacleParticleBudget(720, 1), WARFRONT_SPECTACLE_PARTICLE_CAP_MOBILE);
    assert.equal(warfrontSpectacleParticleBudget(1280, 4) * 4, WARFRONT_SPECTACLE_PARTICLE_CAP_DESKTOP);
});

test("representative capture selects the isolated nonlethal player Fire sentence", () => {
    const cues: WarfrontAttackCue[] = [
        { ...cue, element: "Water", contactTick: 14 },
        { ...cue, actorId: "enemy-1", side: "enemy", contactTick: 30 },
        { ...cue, actorId: "player-1", contactTick: 31, lethal: true },
        { ...cue, actorId: "player-2", targetId: "enemy-2", contactTick: 58 },
    ];
    assert.equal(warfrontHeroAttackCue(cues)?.actorId, "player-2");
});

test("representative Fire sentence owns a continuous silhouette plus a two-tick authored contact hold", () => {
    assert.deepEqual({
        flare: WARFRONT_HERO_FLARE_MIN_PX,
        core: WARFRONT_HERO_TRAVEL_CORE_PX,
        plume: WARFRONT_HERO_TRAVEL_PLUME_PX,
        burst: WARFRONT_HERO_BURST_PX,
        burstHold: WARFRONT_HERO_BURST_HOLD_TICKS,
        impact: WARFRONT_HERO_IMPACT_MIN_PX,
        hold: WARFRONT_HERO_IMPACT_HOLD_TICKS,
        damageHold: WARFRONT_HERO_DAMAGE_HOLD_TICKS,
    }, { flare: 48, core: 12, plume: 24, burst: 68, burstHold: 2, impact: 44, hold: 2, damageHold: 3 });
    assert.equal(warfrontHeroBurstHold(cue, cue.contactTick - 0.01), 0);
    assert.equal(warfrontHeroBurstHold(cue, cue.contactTick), 1);
    assert.equal(warfrontHeroBurstHold(cue, cue.contactTick + 1.99), 1);
    assert.equal(warfrontHeroBurstHold(cue, cue.contactTick + 2), 0);
    assert.equal(warfrontHeroImpactHold(cue, cue.contactTick - 0.01), 0);
    assert.equal(warfrontHeroImpactHold(cue, cue.contactTick), 1);
    assert.equal(warfrontHeroImpactHold(cue, cue.contactTick + 1.99), 1);
    assert.equal(warfrontHeroImpactHold(cue, cue.contactTick + 2), 0);
    assert.equal(warfrontHeroDamageHold(cue, cue.contactTick + 2.99), 1);
    assert.equal(warfrontHeroDamageHold(cue, cue.contactTick + 3), 0);
});

test("representative Fire travel owns a minimum directed span and a decaying contact-axis tail", () => {
    assert.equal(WARFRONT_HERO_TRAVEL_MIN_SPAN_FRACTION, 1 / 3);
    assert.equal(WARFRONT_HERO_AXIS_TAIL_PX, 28);
    assert.equal(warfrontHeroTravelSpanFraction(0), 0);
    assert.equal(warfrontHeroTravelSpanFraction(0.2), 1 / 3);
    assert.equal(warfrontHeroTravelSpanFraction(0.7), 0.7);
    assert.equal(warfrontHeroTravelSpanFraction(2), 1);
    assert.equal(warfrontHeroAxisTailStrength(1, 0), 1);
    assert.equal(warfrontHeroAxisTailStrength(0, 5 / 9), 5 / 9);
    assert.equal(warfrontHeroAxisTailStrength(0, 0), 0);
});

test("representative Fire sentence exposes the target-relative authored-sprite material-v4 grammar", () => {
    assert.equal(WARFRONT_HERO_FIRE_VFX_GRAMMAR, "fire-material-v4");
    assert.deepEqual(WARFRONT_HERO_FIRE_SHAPES, {
        windup: "licking-flame-cone",
        travel: "tapered-ember-bolt",
        contact: "authored-asymmetric-fire-impact-sprite",
        result: "smoke-ember-scorch",
    });
    assert.equal(WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL, "/assets/warfront/kage-fire-impact-burst-v1-512.png");
    assert.equal(WARFRONT_HERO_FIRE_IMPACT_SPRITE_SOURCE_PX, 512);
    assert.equal(WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X, 0.6);
    assert.equal(WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_Y, 0.5);
    assert.equal(WARFRONT_HERO_FIRE_IMPACT_SPRITE_ASYMMETRY, "incoming-tail-left");
    assert.equal(WARFRONT_HERO_FIRE_IMPACT_SPRITE_LEFT_RIGHT_REACH_RATIO, 1.5);
    assert.equal(WARFRONT_HERO_CONTACT_TARGET_WIDTHS, 1.65);
    assert.equal(WARFRONT_HERO_CONTACT_MIN_TARGET_WIDTHS, 1.5);
    assert.equal(WARFRONT_HERO_CONTACT_MAX_TARGET_WIDTHS, 1.8);
    assert.equal(warfrontHeroContactWidthPx(80), 132);
    assert.equal(warfrontHeroContactWidthPx(80, 1), 120);
    assert.equal(warfrontHeroContactWidthPx(80, 2), 144);
    assert.equal(WARFRONT_HERO_CONTACT_LAYER_COUNT, 3);
    assert.deepEqual(WARFRONT_HERO_FIRE_CONTACT_LAYERS, [
        "incoming-axis-tail",
        "authored-asymmetric-fire-impact-sprite",
        "ember-smoke-scorch-residue",
    ]);
    assert.equal(WARFRONT_HERO_RESIDUE_LAYER_COUNT, 3);
    assert.deepEqual(WARFRONT_HERO_FIRE_RESIDUE_LAYERS, ["scorch", "smoke", "embers"]);
    assert.equal(WARFRONT_SPECTACLE_RESULT_TICKS, 9);
    assert.equal(warfrontHeroFireShape("idle"), "");
    for (const stage of ["windup", "travel", "contact", "result"] as const) {
        assert.equal(warfrontHeroFireShape(stage), WARFRONT_HERO_FIRE_SHAPES[stage]);
    }
});

const event = (value: Partial<DuelEvent> & Pick<DuelEvent, "t" | "type" | "actorId">): DuelEvent => ({ side: "player", ...value });

test("audio plan collapses overlap behind terminal/contact hierarchy and spatializes teams", () => {
    const plan = buildWarfrontAudioPlan([
        event({ t: 10, type: "windup", actorId: "player-0", element: "Water" }),
        event({ t: 10, type: "hit", actorId: "enemy-0", targetId: "player-0", side: "enemy", element: "Earth" }),
        event({ t: 11, type: "hit", actorId: "player-1", targetId: "enemy-1", element: "Fire", crit: true }),
        event({ t: 11, type: "ko", actorId: "enemy-1", side: "enemy", element: "Fire" }),
        event({ t: 16, type: "ultimate", actorId: "player-2", targetId: "enemy-2", element: "Wind" }),
    ]);
    assert.equal(plan.length, 2);
    assert.deepEqual(plan.map((entry) => entry.phase), ["ko", "ultimate"]);
    assert.equal(plan[0].element, "Fire");
    assert.ok(plan[0].pan > 0);
    assert.equal(plan[0].sfx, "ko");
    assert.equal(plan[1].element, "Wind");
    assert.ok(plan[1].pan < 0);
    assert.ok(plan[1].tick - plan[0].tick >= WARFRONT_AUDIO_MIN_GAP_TICKS);
    assert.ok(plan.every((entry) => entry.gain <= 0.82));
});
