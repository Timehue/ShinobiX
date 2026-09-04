import assert from "node:assert/strict";
import test from "node:test";
import type { DuelEvent } from "./pet-duel-sim";
import {
    BODY_KO_EXIT_TICKS,
    BODY_LUNGE_LEAD_TICKS,
    BODY_LUNGE_RELEASE_TICKS,
    BODY_RECOIL_RECOVERY_TICKS,
    ATTACK_CONTACT_FLASH_TICKS,
    ATTACK_CONTACT_HOLD_TICKS,
    ATTACK_STREAK_LEAD_TICKS,
    ATTACK_STREAK_TRAIL_TICKS,
    ATTACK_STREAK_DURATION_MS,
    authoritativeGroundingActorAt,
    warfrontAttackCuePhase,
    warfrontAttackCues,
    warfrontBodyContactBeats,
    warfrontBodyReactionPhase,
    warfrontContactDirection,
    type WarfrontBodyContactBeat,
} from "./pet-warfront-attack-causality";

const event = (value: Partial<DuelEvent> & Pick<DuelEvent, "t" | "type" | "actorId">): DuelEvent => ({
    side: "player",
    ...value,
});

test("every authoritative hit keeps its actor/target tell, while duplicate records merge", () => {
    const cues = warfrontAttackCues([
        event({ t: 10, type: "windup", actorId: "player-0", targetId: "enemy-0" }),
        event({ t: 18, type: "hit", actorId: "player-0", targetId: "enemy-0", dmg: 20 }),
        event({ t: 18, type: "hit", actorId: "player-0", targetId: "enemy-0", dmg: 5 }),
        event({ t: 18, type: "hit", actorId: "player-0", targetId: "enemy-1", dmg: 9 }),
        event({ t: 20, type: "whiff", actorId: "enemy-2", targetId: "player-2" }),
    ]);
    assert.deepEqual(cues, [
        { actorId: "player-0", targetId: "enemy-0", side: "player", element: null, tellTick: 10, contactTick: 18, hits: 2, lethal: false, koTick: null },
        { actorId: "player-0", targetId: "enemy-1", side: "player", element: null, tellTick: 10, contactTick: 18, hits: 1, lethal: false, koTick: null },
    ]);
});

test("the streak stays inside 250-400ms and owns a two-frame contact hold plus recovery", () => {
    const cue = warfrontAttackCues([
        event({ t: 10, type: "windup", actorId: "player-0", targetId: "enemy-0" }),
        event({ t: 18, type: "hit", actorId: "player-0", targetId: "enemy-0", dmg: 20 }),
    ])[0];
    assert.ok(ATTACK_STREAK_DURATION_MS >= 250 && ATTACK_STREAK_DURATION_MS <= 400);
    assert.ok(warfrontAttackCuePhase(cue, 12).origin > 0);
    assert.equal(warfrontAttackCuePhase(cue, 18 - ATTACK_STREAK_LEAD_TICKS).streak, 0);
    assert.equal(warfrontAttackCuePhase(cue, 18 - ATTACK_STREAK_LEAD_TICKS / 2).streak, 0.5);
    assert.equal(warfrontAttackCuePhase(cue, 18).streak, 1);
    assert.equal(warfrontAttackCuePhase(cue, 18).contactHold, true);
    assert.equal(warfrontAttackCuePhase(cue, 18 + ATTACK_CONTACT_HOLD_TICKS - 0.001).contactHold, true);
    assert.equal(warfrontAttackCuePhase(cue, 18 + ATTACK_CONTACT_HOLD_TICKS).contactHold, false);
    assert.equal(warfrontAttackCuePhase(cue, 18).contact, 1);
    assert.ok(warfrontAttackCuePhase(cue, 19).contact > 0);
    assert.equal(warfrontAttackCuePhase(cue, 18 + ATTACK_CONTACT_FLASH_TICKS).contact, 0);
    assert.ok(warfrontAttackCuePhase(cue, 21).recovery > 0);
    assert.equal(warfrontAttackCuePhase(cue, 18 + ATTACK_STREAK_TRAIL_TICKS).streak, 0);
});

test("concurrent combat sentences submit one authoritative ground-rune owner", () => {
    const cues = warfrontAttackCues([
        event({ t: 10, type: "windup", actorId: "player-0", targetId: "enemy-0" }),
        event({ t: 11, type: "windup", actorId: "enemy-1", targetId: "player-1", side: "enemy" }),
        event({ t: 17, type: "hit", actorId: "enemy-1", targetId: "player-1", side: "enemy", dmg: 15 }),
        event({ t: 18, type: "hit", actorId: "player-0", targetId: "enemy-0", dmg: 20 }),
    ]);
    assert.equal(authoritativeGroundingActorAt(cues, 15), "enemy-1",
        "the nearest upcoming contact owns the one allowed rune");
    assert.equal(authoritativeGroundingActorAt(cues, 17), "enemy-1");
    assert.equal(authoritativeGroundingActorAt(cues, 18), "player-0",
        "a current contact outranks another actor's recovery ring");
    assert.equal(authoritativeGroundingActorAt(cues, 20), "player-0");
    assert.equal(authoritativeGroundingActorAt(cues, 22), null,
        "the rune reaches exact zero after its short body-led release");
});

test("authoritative KO marks only the final attacking cue as lethal", () => {
    const cues = warfrontAttackCues([
        event({ t: 12, type: "windup", actorId: "player-0", targetId: "enemy-0" }),
        event({ t: 13, type: "windup", actorId: "player-1", targetId: "enemy-0" }),
        event({ t: 18, type: "hit", actorId: "player-0", targetId: "enemy-0", dmg: 20 }),
        event({ t: 18, type: "hit", actorId: "player-1", targetId: "enemy-0", dmg: 80 }),
        event({ t: 19, type: "ko", actorId: "enemy-0", side: "enemy" }),
    ]);
    assert.equal(cues[0].lethal, false);
    assert.equal(cues[0].koTick, null);
    assert.equal(cues[1].lethal, true);
    assert.equal(cues[1].koTick, 19);
    const targetBeat = warfrontBodyContactBeats(cues).get("enemy-0")?.[0];
    assert.ok(targetBeat);
    assert.equal(targetBeat.lethal, true);
    assert.equal(targetBeat.koTick, 19);
    assert.equal(targetBeat.hits, 2);
});

test("body contact direction points from attacker to target with a normalized fallback", () => {
    assert.deepEqual(warfrontContactDirection(0, 0, 3, 4), { x: 0.6, z: 0.8 });
    assert.deepEqual(warfrontContactDirection(2, 2, 2, 2, 0, -4), { x: 0, z: -1 });
    assert.deepEqual(warfrontContactDirection(2, 2, 2, 2, 0, 0), { x: 1, z: 0 });
});

const beat = (value: Partial<WarfrontBodyContactBeat> = {}): WarfrontBodyContactBeat => ({
    actorId: "player-0",
    tick: 18,
    role: "attacker",
    cues: [],
    hits: 1,
    lethal: false,
    koTick: null,
    ...value,
});

test("body lunge leads contact, holds it, and releases to the unchanged root", () => {
    const attack = beat();
    assert.equal(warfrontBodyReactionPhase(attack, attack.tick - BODY_LUNGE_LEAD_TICKS).lunge, 0);
    assert.ok(warfrontBodyReactionPhase(attack, attack.tick - 1).lunge > 0);
    assert.equal(warfrontBodyReactionPhase(attack, attack.tick).lunge, 1);
    assert.equal(warfrontBodyReactionPhase(attack, attack.tick + ATTACK_CONTACT_HOLD_TICKS).lunge, 1);
    assert.ok(warfrontBodyReactionPhase(attack, attack.tick + 2).lunge > 0);
    assert.equal(warfrontBodyReactionPhase(attack, attack.tick + BODY_LUNGE_RELEASE_TICKS).lunge, 0);
});

test("nonlethal recoil starts on contact and returns cleanly", () => {
    const target = beat({ actorId: "enemy-0", role: "target" });
    assert.equal(warfrontBodyReactionPhase(target, target.tick - 0.001).active, false);
    assert.equal(warfrontBodyReactionPhase(target, target.tick).recoil, 1);
    const recovering = warfrontBodyReactionPhase(target, target.tick + 4);
    assert.ok(recovering.recoil > 0 && recovering.recoil < 1);
    assert.ok(recovering.recovery > 0 && recovering.recovery < 1);
    const recovered = warfrontBodyReactionPhase(target, target.tick + BODY_RECOIL_RECOVERY_TICKS);
    assert.deepEqual(recovered, { active: false, lunge: 0, recoil: 0, recovery: 1, koExit: 0 });
});

test("lethal recoil continues without a gap into a visible KO exit", () => {
    const target = beat({ actorId: "enemy-0", role: "target", lethal: true, koTick: 19 });
    assert.deepEqual(warfrontBodyReactionPhase(target, 18), { active: true, lunge: 0, recoil: 1, recovery: 0, koExit: 0 });
    assert.equal(warfrontBodyReactionPhase(target, 19).recoil, 1);
    const exiting = warfrontBodyReactionPhase(target, 19 + BODY_KO_EXIT_TICKS / 2);
    assert.equal(exiting.active, true);
    assert.equal(exiting.recoil, 0.5);
    assert.equal(exiting.koExit, 0.5);
    const exited = warfrontBodyReactionPhase(target, 19 + BODY_KO_EXIT_TICKS);
    assert.equal(exited.active, true);
    assert.equal(exited.recoil, 0);
    assert.equal(exited.koExit, 1);
});

test("same-tick AOE and duplicates collapse per role while target reaction wins without deleting the lunge", () => {
    const cues = warfrontAttackCues([
        event({ t: 10, type: "windup", actorId: "player-0", targetId: "enemy-0" }),
        event({ t: 10, type: "windup", actorId: "enemy-0", targetId: "player-0", side: "enemy" }),
        event({ t: 18, type: "hit", actorId: "player-0", targetId: "enemy-0", dmg: 10 }),
        event({ t: 18, type: "hit", actorId: "player-0", targetId: "enemy-0", dmg: 10 }),
        event({ t: 18, type: "hit", actorId: "player-0", targetId: "enemy-1", dmg: 10 }),
        event({ t: 18, type: "hit", actorId: "enemy-0", targetId: "player-0", side: "enemy", dmg: 10 }),
    ]);
    const beats = warfrontBodyContactBeats(cues);
    assert.equal(beats.get("player-0")?.length, 2);
    assert.deepEqual(beats.get("player-0")?.map((entry) => entry.role), ["attacker", "target"]);
    assert.equal(beats.get("player-0")?.find((entry) => entry.role === "target")?.hits, 1);
    assert.equal(beats.get("enemy-0")?.length, 2);
    assert.deepEqual(beats.get("enemy-0")?.map((entry) => entry.role), ["attacker", "target"]);
    assert.equal(beats.get("enemy-0")?.find((entry) => entry.role === "target")?.hits, 2);
    assert.equal(beats.get("enemy-1")?.length, 1);
    assert.equal(beats.get("enemy-1")?.[0].hits, 1);
    const keys = [...beats.values()].flat().map((entry) => `${entry.actorId}:${entry.tick}:${entry.role}`);
    assert.equal(new Set(keys).size, keys.length);
});
