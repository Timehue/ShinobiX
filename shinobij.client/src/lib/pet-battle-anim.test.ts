import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet } from "../types/pet";
import {
    buildPetAnimationEvents,
    petPoseForAvatar,
    petAvatarStateClass,
    extractPetMoveName,
    petBattleSprite,
    petCardImage,
    petBattleLayers,
    petBattleSheet,
    petStripVariant,
    elementVfxKey,
    type PetFrameLike,
} from "./pet-battle-anim";

// Minimal Pet stub — petBattleSprite only reads id / image / bodyImage.
function mkPet(over: Partial<Pet>): Pet {
    return { id: "standard-1", name: "Test", rarity: "standard", level: 1, xp: 0, maxLevel: 50, hp: 100, attack: 10, defense: 10, speed: 10, jutsus: [], unlockedForPve: false, ...over } as Pet;
}

const types = (evts: ReturnType<typeof buildPetAnimationEvents>) => evts.map((e) => e.type);

// ── Sprite mode ─────────────────────────────────────────────────────────────

test("petBattleSprite: full-body sprite wins via inline bodyImage", () => {
    const { mode, src } = petBattleSprite(mkPet({ image: "circ.png", bodyImage: "body.png" }));
    assert.equal(mode, "fullBodySprite");
    assert.equal(src, "body.png");
});

test("petBattleSprite: full-body sprite wins via petbody shared image (base id)", () => {
    const pet = mkPet({ id: "standard-1-1700000000000", image: "circ.png" });
    const { mode, src } = petBattleSprite(pet, { "petbody:standard-1": "shared-body.png" });
    assert.equal(mode, "fullBodySprite");
    assert.equal(src, "shared-body.png");
});

test("petBattleSprite: an evolved starter prefers its stage art, else falls back to base", () => {
    const evolved = mkPet({ id: "starter-fire", rarity: "rare", evolutionStage: 1 });
    // Stage art (visualId starter-fire-r) wins when published.
    assert.equal(
        petBattleSprite(evolved, { "petbody:starter-fire-r": "rare-body.png", "petbody:starter-fire": "base-body.png" }).src,
        "rare-body.png",
    );
    // Missing stage art → falls back to the base starter art (no regression).
    assert.equal(
        petBattleSprite(evolved, { "petbody:starter-fire": "base-body.png" }).src,
        "base-body.png",
    );
});

// ── Static card image (non-battle UI: yard, pickers, starter select) ─────────

test("petCardImage: a starter falls back to its idle pose (no inline image)", () => {
    // Starters ship NO inline image but DO have a baked idle pose — this is the
    // pet-yard bug fix: without the pose fallback the card shows name initials.
    assert.equal(petCardImage(mkPet({ id: "starter-fire", rarity: "standard" })), "/pet-poses/starter-fire-idle.webp");
});

test("petCardImage: an inline image (e.g. evolved art) wins over the pose", () => {
    assert.equal(petCardImage(mkPet({ id: "starter-fire", image: "/pet-evos/starter-fire-r.webp" })), "/pet-evos/starter-fire-r.webp");
});

test("petCardImage: a published shared image wins over everything", () => {
    assert.equal(petCardImage(mkPet({ id: "starter-fire" }), { "pet:starter-fire": "shared.png" }), "shared.png");
});

test("petCardImage: an evolved starter prefers its stage pose", () => {
    // visualId starter-fire-r has an idle pose in the manifest.
    assert.equal(petCardImage(mkPet({ id: "starter-fire", rarity: "rare", evolutionStage: 1 })), "/pet-poses/starter-fire-r-idle.webp");
});

test("petCardImage: an encounter clone resolves the pose by variant-stripped base id", () => {
    assert.equal(petCardImage(mkPet({ id: "standard-1-1700000000000" })), "/pet-poses/standard-1-idle.webp");
});

test("petCardImage: an id with no pose and no image → empty string (caller shows initials)", () => {
    assert.equal(petCardImage(mkPet({ id: "no-such-pet-id" })), "");
});

test("petBattleLayers: all three bands present → returns the layer set", () => {
    const layers = petBattleLayers(mkPet({}), {
        "petlayers:standard-1:far": "f.png",
        "petlayers:standard-1:mid": "m.png",
        "petlayers:standard-1:near": "n.png",
    });
    assert.deepEqual(layers, { far: "f.png", mid: "m.png", near: "n.png" });
});

test("petBattleLayers: a missing band → null (renderer falls back)", () => {
    const layers = petBattleLayers(mkPet({}), {
        "petlayers:standard-1:far": "f.png",
        "petlayers:standard-1:near": "n.png",
    });
    assert.equal(layers, null);
});

test("petBattleLayers: resolves by variant-stripped base id for encounter clones", () => {
    const pet = mkPet({ id: "standard-1-1700000000000" });
    const layers = petBattleLayers(pet, {
        "petlayers:standard-1:far": "f.png",
        "petlayers:standard-1:mid": "m.png",
        "petlayers:standard-1:near": "n.png",
    });
    assert.deepEqual(layers, { far: "f.png", mid: "m.png", near: "n.png" });
});

test("petBattleLayers: none present → null", () => {
    assert.equal(petBattleLayers(mkPet({}), {}), null);
});

test("petBattleSheet: strip + frames meta → {src, frames}", () => {
    const sheet = petBattleSheet(mkPet({}), { "petsheet:standard-1": "s.png", "petsheet:standard-1:frames": "12" });
    assert.deepEqual(sheet, { src: "s.png", frames: 12 });
});

test("petBattleSheet: strip without frames meta → default 8", () => {
    const sheet = petBattleSheet(mkPet({}), { "petsheet:standard-1": "s.png" });
    assert.deepEqual(sheet, { src: "s.png", frames: 8 });
});

test("petBattleSheet: frames clamped to 1..24, base-id fallback for clones", () => {
    const pet = mkPet({ id: "standard-1-1700000000000" });
    assert.equal(petBattleSheet(pet, { "petsheet:standard-1": "s.png", "petsheet:standard-1:frames": "999" })?.frames, 24);
    assert.equal(petBattleSheet(pet, { "petsheet:standard-1": "s.png", "petsheet:standard-1:frames": "0" })?.frames, 8);
});

test("petBattleSheet: no strip → null", () => {
    assert.equal(petBattleSheet(mkPet({}), { "petsheet:standard-1:frames": "8" }), null);
    assert.equal(petBattleSheet(mkPet({}), {}), null);
});

test("petBattleSprite: falls back to circle when only a portrait exists", () => {
    const { mode, src } = petBattleSprite(mkPet({ image: "circ.png" }), { "pet:standard-1": "shared-circ.png" });
    assert.equal(mode, "circleFallback");
    assert.equal(src, "shared-circ.png");
});

test("petStripVariant strips the encounter timestamp", () => {
    assert.equal(petStripVariant("rare-7-1700000000000"), "rare-7");
    assert.equal(petStripVariant("rare-7"), "rare-7");
});

test("elementVfxKey maps known elements and defaults to none", () => {
    assert.equal(elementVfxKey("Fire"), "fire");
    assert.equal(elementVfxKey("Lightning"), "lightning");
    assert.equal(elementVfxKey("None"), "none");
    assert.equal(elementVfxKey(undefined), "none");
});

// ── Event builder ─────────────────────────────────────────────────────────

const base = (over: Partial<PetFrameLike>): PetFrameLike => ({ actor: "player", message: "", ...over });

test("melee strike (non-elemental): callout → windup → lunge → 3-hit flurry → recoil; numbers sum to damage", () => {
    // A NON-elemental ("none") damage move lunges to melee. (An elemental move
    // now fires a projectile even up close — see the next test.)
    const evts = buildPetAnimationEvents({
        frame: base({ actionKind: "damage", damage: 24, message: "Round 1: Foo uses Slash for 24 damage." }),
        dist: 1, actorId: "p", targetId: "e", vfxKey: "none",
    });
    // A 3-hit flurry: each impact is paired with a damageNumber, then recoil.
    assert.deepEqual(types(evts), ["moveCallout", "windup", "lunge", "impact", "damageNumber", "impact", "damageNumber", "impact", "damageNumber", "recoil"]);
    assert.equal(evts[0].text, "Slash");
    // The split sub-hits sum EXACTLY to the engine's single damage value.
    const total = evts.filter((e) => e.type === "damageNumber").reduce((s, e) => s + (e.amount ?? 0), 0);
    assert.equal(total, 24);
    // Offense events are authored by the attacker against the target.
    assert.equal(evts[1].actorId, "p");
    assert.equal(evts[1].targetId, "e");
});

test("elemental strike at close range fires a projectile, not a melee lunge", () => {
    // The "no range, they just bonk" fix: an elemental pet HURLS its element as a
    // projectile even at dist≤2 (the small grid put most fights this close).
    const evts = buildPetAnimationEvents({
        frame: base({ actionKind: "damage", damage: 24, message: "Round 1: Foo uses Fireball for 24 damage." }),
        dist: 1, actorId: "p", targetId: "e", vfxKey: "fire",
    });
    assert.ok(types(evts).includes("rangedCast"), "elemental move casts");
    assert.ok(types(evts).includes("projectile"), "elemental move fires a projectile");
    assert.ok(!types(evts).includes("lunge"), "elemental move does not melee-lunge");
    // Still resolves damage — the sub-hits sum to the engine's value.
    assert.equal(evts.filter((e) => e.type === "damageNumber").reduce((s, e) => s + (e.amount ?? 0), 0), 24);
});

test("basic attack has no move callout (no 'uses' in the log line)", () => {
    const evts = buildPetAnimationEvents({
        frame: base({ actionKind: "basic", damage: 9, message: "Round 1: Foo basic attacks for 9 damage." }),
        dist: 1, actorId: "p", targetId: "e",
    });
    assert.ok(!types(evts).includes("moveCallout"));
    assert.deepEqual(types(evts), ["windup", "lunge", "impact", "damageNumber", "impact", "damageNumber", "impact", "damageNumber", "recoil"]);
    assert.equal(evts.filter((e) => e.type === "damageNumber").reduce((s, e) => s + (e.amount ?? 0), 0), 9);
});

test("signature move prepends a long charge wind-up (no small callout)", () => {
    const evts = buildPetAnimationEvents({
        frame: base({ actionKind: "lifesteal", damage: 80, message: "Round 5: Foo uses Cinder Devour for 80 damage.", signatureMove: { name: "Cinder Devour", petName: "Foo", side: "player" } }),
        dist: 1, actorId: "p", targetId: "e", vfxKey: "fire",
    });
    assert.ok(!types(evts).includes("moveCallout"), "cut-in covers the signature name");
    assert.equal(types(evts)[0], "charge");
    const charge = evts[0];
    assert.ok(charge.durationMs >= 600, "signature charge is a longer wind-up");
});

test("ranged strike (dist > 2): rangedCast + projectile, no lunge", () => {
    const evts = buildPetAnimationEvents({
        frame: base({ actionKind: "damage", damage: 30, message: "Round 1: uses Bolt for 30 damage." }),
        dist: 5, actorId: "p", targetId: "e", vfxKey: "lightning",
    });
    assert.ok(types(evts).includes("rangedCast"));
    assert.ok(types(evts).includes("projectile"));
    assert.ok(!types(evts).includes("lunge"));
});

test("crit appends a screenShake beat", () => {
    const evts = buildPetAnimationEvents({
        frame: base({ actionKind: "damage", damage: 50, crit: true, message: "CRITICAL HIT!" }),
        dist: 1, actorId: "p", targetId: "e",
    });
    assert.ok(types(evts).includes("screenShake"));
});

test("dodge: defender slips, attacker whiffs (actor/target swapped)", () => {
    // The sim logs evades from the defender's side, so frame.actor is the dodger.
    const evts = buildPetAnimationEvents({
        frame: base({ actor: "player", actionKind: "damage", message: "Round 2: Foo blurs out of reach — evades Bar's attack!" }),
        dist: 1, actorId: "p", targetId: "e",
    });
    const dodge = evts.find((e) => e.type === "dodge")!;
    assert.ok(dodge, "expected a dodge event");
    assert.equal(dodge.actorId, "p"); // the dodger
    const lunge = evts.find((e) => e.type === "lunge");
    assert.ok(lunge, "attacker should still whiff a lunge");
    assert.equal(lunge!.actorId, "e"); // the attacker
});

test("heal casts a charge + healNumber", () => {
    const evts = buildPetAnimationEvents({
        frame: base({ actionKind: "heal", message: "Round 1: uses Mend, restoring 30 HP." }),
        dist: 0, actorId: "p", targetId: "e",
    });
    assert.deepEqual(types(evts), ["charge", "healNumber"]);
});

test("shield/barrier braces into a guard + shieldNumber", () => {
    const evts = buildPetAnimationEvents({
        frame: base({ actionKind: "barrier", message: "Round 1: raises a barrier." }),
        dist: 0, actorId: "p", targetId: "e",
    });
    assert.deepEqual(types(evts), ["guard", "shieldNumber"]);
});

test("poison tick reacts on the sufferer", () => {
    const evts = buildPetAnimationEvents({
        frame: base({ actor: "enemy", actionKind: "dot", damage: 8, message: "Round 3: Bar writhes in poison — 8 damage." }),
        dist: 3, actorId: "e", targetId: "p",
    });
    assert.deepEqual(types(evts), ["statusApply", "damageNumber"]);
    assert.equal(evts[0].vfxKey, "poison");
});

test("result frame: only the winner celebrates", () => {
    const evts = buildPetAnimationEvents({
        frame: base({ actor: "system", actionKind: "result", message: "Foo wins the Pet Arena match." }),
        dist: 4, actorId: "p", targetId: "e", isResultFrame: true, winnerId: "p",
    });
    assert.deepEqual(types(evts), ["victory"]);
    assert.equal(evts[0].actorId, "p");
});

test("KO frame: the downed pet (not the killer) plays ko", () => {
    const evts = buildPetAnimationEvents({
        frame: base({ actor: "player", actionKind: "result", isKO: true, message: "K.O.!" }),
        dist: 1, actorId: "p", targetId: "e", loserId: "e",
    });
    assert.deepEqual(types(evts), ["ko"]);
    assert.equal(evts[0].actorId, "e");
});

test("control SKIP frames hold idle (no phantom cast)", () => {
    for (const message of [
        "Round 4: Red Fox is stunned — turn skipped.",
        "Round 4: Red Fox is frozen solid — turn skipped.",
        "Round 4: Red Fox is movement-locked and cannot advance!",
    ]) {
        const evts = buildPetAnimationEvents({ frame: base({ actionKind: "movelock", message }), dist: 4, actorId: "p", targetId: "e" });
        assert.equal(evts.length, 0, message);
    }
});

test("root APPLICATION still animates as a cast", () => {
    const evts = buildPetAnimationEvents({
        frame: base({ actionKind: "movelock", message: "Round 2: uses Snare — Bar is movement-locked for 2 rounds!" }),
        dist: 4, actorId: "p", targetId: "e",
    });
    assert.ok(types(evts).includes("rangedCast"));
    assert.ok(types(evts).includes("statusApply"));
});

test("confusion self-hit reacts in place, never lunges out", () => {
    const evts = buildPetAnimationEvents({
        frame: base({ actionKind: "damage", damage: 6, message: "Round 3: Red Fox is confused and hits itself for 6!" }),
        dist: 1, actorId: "p", targetId: "e",
    });
    assert.deepEqual(types(evts), ["statusApply", "damageNumber"]);
    assert.ok(!types(evts).includes("lunge"));
});

test("relocation / system frames produce no choreography", () => {
    assert.equal(buildPetAnimationEvents({ frame: base({ actionKind: "move", message: "advances." }), dist: 6, actorId: "p", targetId: "e" }).length, 0);
    assert.equal(buildPetAnimationEvents({ frame: base({ actor: "system", message: "Round summary." }), dist: 6, actorId: "p", targetId: "e" }).length, 0);
});

// ── Pose resolution ─────────────────────────────────────────────────────────

test("petPoseForAvatar maps the active event onto the right sprite", () => {
    const lunge = { id: "x", actorId: "p", targetId: "e", type: "lunge" as const, durationMs: 100 };
    assert.equal(petPoseForAvatar(lunge, "p", false, false), "lunge");
    assert.equal(petPoseForAvatar(lunge, "e", false, false), "idle");

    const impact = { id: "y", actorId: "p", targetId: "e", type: "impact" as const, durationMs: 100 };
    assert.equal(petPoseForAvatar(impact, "e", false, false), "recoil");

    // A fainted pet always reads ko, regardless of the active event.
    assert.equal(petPoseForAvatar(lunge, "e", false, true), "ko");
    // No active event → winner idles in a victory pose.
    assert.equal(petPoseForAvatar(undefined, "p", true, false), "victory");
    assert.equal(petPoseForAvatar(undefined, "e", false, false), "idle");
});

test("petAvatarStateClass maps pose + side to directional class names", () => {
    assert.equal(petAvatarStateClass("idle", "player"), "pet-idle");
    assert.equal(petAvatarStateClass("windup", "player"), "pet-windup");
    // Player faces right; enemy is mirrored.
    assert.equal(petAvatarStateClass("lunge", "player"), "pet-lunge-right");
    assert.equal(petAvatarStateClass("lunge", "enemy"), "pet-lunge-left");
    // Recoil shoves the target away from the foe.
    assert.equal(petAvatarStateClass("recoil", "player"), "pet-recoil-left");
    assert.equal(petAvatarStateClass("recoil", "enemy"), "pet-recoil-right");
    // Ranged cast + projectile share the charge/glow pose.
    assert.equal(petAvatarStateClass("rangedCast", "player"), "pet-charge");
    assert.equal(petAvatarStateClass("projectileFire", "enemy"), "pet-charge");
    assert.equal(petAvatarStateClass("guard", "player"), "pet-guard");
    assert.equal(petAvatarStateClass("dodge", "enemy"), "pet-dodge");
    assert.equal(petAvatarStateClass("ko", "player"), "pet-ko");
    assert.equal(petAvatarStateClass("victory", "player"), "pet-victory");
});

test("extractPetMoveName pulls the move name from a log line", () => {
    assert.equal(extractPetMoveName("Round 1: Foo uses Ember Lash for 40 damage."), "Ember Lash");
    assert.equal(extractPetMoveName("Round 2: Foo uses Mend, restoring 30 HP."), "Mend");
    assert.equal(extractPetMoveName("Round 1: Foo basic attacks for 9 damage."), undefined);
    assert.equal(extractPetMoveName(undefined), undefined);
});
