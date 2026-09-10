import { test } from "node:test";
import assert from "node:assert/strict";
import { PET_CATALOG } from "../../../api/pet/_catalog";
import { createShowdownSession, resolveShowdownRound, showdownStateView, type ShowdownSession } from "../../../api/_pet-showdown/engine";
import type { Pet } from "../../../api/_pet-sim/pet-types";
import type { ShowdownCommand, ShowdownEvent, ShowdownFormat } from "../../../shared/pet-showdown-contract";
import { buildMovePresentations, movePresentationKey, resolveMovePresentation, showdownTechniqueHitIds, techniquePhase } from "./showdown-move-presentation";
import { showdownActionTargetId, showdownContactEffectKind, showdownContactOutcome } from "./showdown-contact-vfx";
import { showdownDodgeCues, showdownPresentationEvent } from "./showdown-playback";

type Action = Extract<ShowdownEvent, { t: "action" }>;
type Side = "player" | "enemy";
const pet = (templateId: string, id: string): Pet => ({ ...PET_CATALOG[templateId], templateId, id, level: 30 }) as Pet;

function fixture(templateId: string, format: ShowdownFormat = "1v1", reserves = false) {
    const count = Number(format[0]) + (reserves ? 2 : 0);
    const session = createShowdownSession({ sessionId: "vfx-integration", playerName: "QA", enemyTeamName: "QA", format, tier: "warrior", seed: 12345,
        playerPets: Array.from({ length: count }, (_, i) => pet(templateId, `player-${i}`)),
        enemyPets: Array.from({ length: count }, (_, i) => pet(templateId, `enemy-${i}`)), rewardEligible: false });
    for (const fighter of [...session.player, ...session.enemy]) {
        fighter.readiness = 10;
        fighter.meter = 100;
        fighter.hp = Math.round(fighter.maxHp * .8); // Healing must actually land too.
    }
    return session;
}

function cast(session: ShowdownSession, side: Side, command: ShowdownCommand, response?: ShowdownCommand) {
    const commands = (which: Side): ShowdownCommand[] => session[which].filter(p => !p.benched && !p.ko).map(p =>
        which === side && p.id === command.petId ? command : p.id === response?.petId ? response : { kind: "rest", petId: p.id });
    const events = resolveShowdownRound(session, commands("player"), commands("enemy"));
    const action = events.find((e): e is Action => e.t === "action" && e.actorId === command.petId);
    assert.ok(action, `${session[side][0].name}: requested move must execute`);
    return action;
}

test("all 945 real move slots reach their assigned effects through live commands on both sides in all formats", () => {
    let actions = 0;
    const deliveries = new Set<string>();
    for (const template of Object.values(PET_CATALOG)) for (const format of ["1v1", "2v2", "3v3"] as const) for (const side of ["player", "enemy"] as const) {
        const base = fixture(template.id, format);
        const view = showdownStateView(base)[side][0];
        const presentations = buildMovePresentations(view.moves);
        for (const move of view.moves) {
            const session = structuredClone(base), actor = session[side][0];
            const foe = session[side === "player" ? "enemy" : "player"][0];
            const command: ShowdownCommand = move.signature ? { kind: "super", petId: actor.id, targetId: foe.id }
                : { kind: "move", petId: actor.id, moveIndex: actor.moves.findIndex(m => m.name === move.name), targetId: move.kind === "heal" ? actor.id : foe.id };
            const action = cast(session, side, command);
            assert.equal(action.moveName, move.name);
            assert.equal(action.moveKind, move.kind);
            assert.equal(action.element, move.element);
            assert.equal(action.super, move.signature);
            const assigned = presentations.get(movePresentationKey(action.moveName, action.super));
            assert.ok(assigned, `${template.name}: live event must find its loadout, not replay fallback`);
            assert.strictEqual(resolveMovePresentation(presentations, action), assigned);
            if (move.signature && move.element !== "None") {
                assert.equal(action.delivery, "ranged", `${move.name}: formation attacks cast from home, including in 1v1`);
                assert.equal(assigned.area, true, `${move.name}: elemental signatures cover their actual formation hits`);
                assert.deepEqual(showdownTechniqueHitIds(assigned, action), action.targets.filter(t => t.damage > 0).map(t => t.id));
            }
            const targetId = showdownActionTargetId(action);
            assert.ok(targetId);
            assert.ok(action.targets.some(t => t.id === targetId && !t.splash), `${move.name}: normal contact must resolve to its aim`);
            if (assigned.hero) {
                assert.notEqual(action.delivery, "self", `${move.name}: damage geometry needs an attack lane`);
                assert.ok(!(assigned.hero === "comet" && action.delivery === "melee"), `${move.name}: comet requires a travel window`);
            }
            deliveries.add(action.delivery);
            actions++;
        }
    }
    assert.equal(actions, 945 * 6);
    assert.deepEqual([...deliveries].sort(), ["melee", "ranged", "self"]);
});

test("Guard chip keeps the elemental impact; Protect, absorption and dodge do not", () => {
    for (const defense of ["guard", "protect", "shield", "dodge"] as const) {
        const session = fixture("standard-0");
        const actor = session.player[0], target = session.enemy[0];
        if (defense === "shield") target.statuses.push({ kind: defense, rounds: 3, magnitude: 100000, bornRound: session.round });
        if (defense === "dodge") target.consumable = { id: "smoke", name: "Smoke", dodge: 1, mitigate: 0, thorns: 0, endure: 0, lifeline: 0, cleanse: 0 };
        const response: ShowdownCommand = defense === "protect"
            ? { kind: "move", petId: target.id, moveIndex: target.moves.findIndex(move => move.kind === "protect"), targetId: target.id }
            : { kind: defense === "guard" ? "guard" : "rest", petId: target.id };
        const action = cast(session, "player", { kind: "super", petId: actor.id, targetId: target.id }, response);
        assert.equal(showdownActionTargetId(action), target.id, "even a dodge keeps the original aim");
        const contact = action.targets.find(t => t.id === action.targetId && !t.splash);
        const kind = showdownContactEffectKind(action.moveKind, contact);
        const outcome = kind === null ? "miss" : kind === "protect" ? "block" : "hit";
        const phase = techniquePhase(.7, .2, .5, .85, outcome);
        if (defense === "guard") {
            assert.ok(contact && contact.damage > 0 && contact.guarded);
            assert.equal(showdownContactOutcome(contact), "block", "dash contact still shows the guard reaction");
            assert.equal(phase?.hit, true, "damage must retain the elemental effect that replaces generic hit paint");
        } else {
            assert.equal(phase, null, `${defense}: no successful victim storm`);
            assert.equal(techniquePhase(.3, .2, .5, .85, outcome)?.hit, false, "the aimed approach remains visible");
        }
    }
});

test("a dodged signature never promotes its remaining splash victim into the main target", () => {
    for (const templateId of ["standard-2", "mythic-8"]) for (const side of ["player", "enemy"] as const) {
        const session = fixture(templateId, "3v3");
        const actor = session[side][0], opponents = session[side === "player" ? "enemy" : "player"];
        opponents[0].consumable = { id: "smoke", name: "Smoke", dodge: 1, mitigate: 0, thorns: 0, endure: 0, lifeline: 0, cleanse: 0 };
        const action = cast(session, side, { kind: "super", petId: actor.id, targetId: opponents[0].id });
        assert.equal(action.targets.length, 2);
        assert.ok(action.targets.every(t => t.splash && t.damage > 0));
        assert.equal(showdownActionTargetId(action), opponents[0].id);
        assert.equal(showdownContactEffectKind(action.moveKind, action.targets.find(t => t.id === showdownActionTargetId(action))), null);
        const historical = { ...action, targetId: undefined };
        assert.equal(showdownActionTargetId(historical), undefined, "old logs without aim cannot invent it from splash");
        const replay = JSON.parse(JSON.stringify(action)) as Action;
        assert.equal(showdownActionTargetId(replay), opponents[0].id, "aim survives the replay wire");
    }
});

test("retargets, allied healing, reserves, Guard and Rest use the actual resolved target and loadout", () => {
    const session = fixture("standard-3", "2v2", true);
    const before = showdownStateView(session);
    const allKits = new Map([...before.player, ...before.enemy].map(p => [p.id, buildMovePresentations(p.moves)]));
    const reserve = session.player[2];
    resolveShowdownRound(session, [{ kind: "switch", petId: session.player[0].id, benchPetId: reserve.id }], [{ kind: "rest", petId: session.enemy[0].id }]);
    assert.equal(reserve.benched, false);
    const heal = cast(session, "player", { kind: "move", petId: reserve.id, moveIndex: reserve.moves.findIndex(m => m.kind === "heal"), targetId: session.player[1].id });
    assert.equal(heal.delivery, "self");
    assert.equal(showdownActionTargetId(heal), session.player[1].id);
    assert.strictEqual(resolveMovePresentation(allKits.get(reserve.id), heal), allKits.get(reserve.id)?.get(movePresentationKey(heal.moveName, false)));
    const attack = cast(session, "player", { kind: "move", petId: reserve.id, moveIndex: 0, targetId: "stale-target" });
    assert.notEqual(showdownActionTargetId(attack), "stale-target");
    assert.equal(showdownActionTargetId(attack), attack.targets[0].id);
    for (const kind of ["guard", "rest"] as const) {
        const action = cast(session, "player", { kind, petId: reserve.id });
        assert.equal(showdownActionTargetId(action), reserve.id);
        assert.equal(resolveMovePresentation(allKits.get(reserve.id), action).hero, null);
    }
});

test("real primary and splash dodge reactions attach to attack contact exactly once", () => {
    const session = fixture("standard-1", "3v3");
    for (const target of session.enemy.slice(0, 2)) target.consumable = { id: "smoke", name: "Smoke", dodge: 1, mitigate: 0, thorns: 0, endure: 0, lifeline: 0, cleanse: 0 };
    const events = resolveShowdownRound(session,
        session.player.map((p, i) => i ? { kind: "rest", petId: p.id } : { kind: "super", petId: p.id, targetId: session.enemy[0].id }),
        session.enemy.map(p => ({ kind: "rest", petId: p.id })));
    const index = events.findIndex(e => e.t === "action" && e.actorId === session.player[0].id);
    const cues = showdownDodgeCues(events);
    assert.deepEqual(cues.byAction.get(index), session.enemy.slice(0, 2).map(p => p.id));
    assert.equal(cues.byAction.size, 1);
    assert.equal(cues.attachedReactions.size, 2, "later item beats must not replay the body dodge");
    const reactions = [...cues.attachedReactions].map(i => events[i]);
    for (const reaction of reactions) assert.ok(reaction.t === "consumable" && reaction.effect === "dodge");
    const standalone = showdownDodgeCues([{ t: "roundStart", round: 2 }, ...reactions]);
    assert.equal(standalone.attachedReactions.size, 0, "an orphan reaction keeps its own body cue");
});

test("every Frost Shatter is a ranged blizzard with its existing combat class", () => {
    let count = 0;
    for (const template of Object.values(PET_CATALOG)) {
        const session = fixture(template.id, "3v3");
        const actor = session.player[0];
        if (actor.signatureMove.name !== "Frost Shatter") continue;
        assert.equal(actor.signatureMove.cls, "physical", "presentation must not change damage scaling");
        const presentation = buildMovePresentations(showdownStateView(session).player[0].moves);
        const action = cast(session, "player", { kind: "super", petId: actor.id, targetId: session.enemy[0].id });
        assert.equal(action.delivery, "ranged");
        const recipe = resolveMovePresentation(presentation, action);
        assert.equal(recipe.hero, "storm");
        assert.equal(recipe.area, true);
        assert.deepEqual(showdownTechniqueHitIds(recipe, action), session.enemy.map(p => p.id));
        count++;
    }
    assert.equal(count, 10);
});

test("all five elemental storms cover landed splash hits while excluding dodged and fully blocked victims", () => {
    for (const templateId of ["standard-0", "standard-1", "standard-2", "standard-3", "mythic-8"]) {
        const session = fixture(templateId, "3v3");
        const actor = session.player[0];
        session.enemy[0].consumable = { id: "smoke", name: "Smoke", dodge: 1, mitigate: 0, thorns: 0, endure: 0, lifeline: 0, cleanse: 0 };
        session.enemy[1].statuses.push({ kind: "shield", rounds: 3, magnitude: 100000, bornRound: session.round });
        const presentations = buildMovePresentations(showdownStateView(session).player[0].moves);
        const action = cast(session, "player", { kind: "super", petId: actor.id, targetId: session.enemy[0].id });
        const recipe = resolveMovePresentation(presentations, action);
        assert.equal(recipe.area, true);
        assert.deepEqual(showdownTechniqueHitIds(recipe, action), [session.enemy[2].id]);
        assert.equal(showdownActionTargetId(action), session.enemy[0].id, "covering splash is intentional area staging, not retargeting");
    }
});

test("all elemental area effects retain guarded damage and suppress a completely absorbed formation", () => {
    for (const templateId of ["standard-0", "standard-1", "standard-2", "standard-3", "mythic-8"]) for (const absorb of [false, true]) {
        const session = fixture(templateId, "3v3"), actor = session.player[0];
        if (absorb) for (const target of session.enemy) target.statuses.push({ kind: "shield", rounds: 3, magnitude: 100000, bornRound: session.round });
        const presentation = buildMovePresentations(showdownStateView(session).player[0].moves);
        const action = cast(session, "player", { kind: "super", petId: actor.id, targetId: session.enemy[0].id }, { kind: "guard", petId: session.enemy[0].id });
        assert.deepEqual(showdownTechniqueHitIds(resolveMovePresentation(presentation, action), action), absorb ? [] : session.enemy.map(p => p.id));
    }
});

test("historical physical area attacks cast in place without rewriting damage or single-target dashes", () => {
    const session = fixture("standard-3", "3v3"), actor = session.player[0];
    const action = cast(session, "player", { kind: "super", petId: actor.id, targetId: session.enemy[0].id });
    const old = { ...action, delivery: "melee" as const };
    for (const replay of [old, { ...old, targets: [] }, { ...old, super: false }]) {
        assert.deepEqual(showdownPresentationEvent(replay), { ...replay, delivery: "ranged" });
        assert.equal(replay.delivery, "melee", "stored replay data remains immutable");
    }
    const jab = cast(fixture("standard-3"), "player", { kind: "move", petId: actor.id, moveIndex: 0, targetId: session.enemy[0].id });
    assert.equal(jab.delivery, "melee");
    assert.strictEqual(showdownPresentationEvent(jab), jab);
    const rest = cast(fixture("standard-3"), "player", { kind: "rest", petId: actor.id });
    assert.strictEqual(showdownPresentationEvent(rest), rest);
});
