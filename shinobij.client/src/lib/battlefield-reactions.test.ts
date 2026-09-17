import { strict as assert } from "node:assert";
import test from "node:test";
import { battlefieldReactionSpec, findBattlefieldActor, playBattlefieldReaction } from "./battlefield-reactions";
import type { CombatActorReactionKind } from "./combat-presentation";

const KINDS: CombatActorReactionKind[] = ["hit", "heavy", "guard", "heal", "cast", "lunge", "ko"];

test("every reaction animates only transform and opacity, returns to rest, and stays sub-second", () => {
    for (const kind of KINDS) {
        const { keyframes, options } = battlefieldReactionSpec(kind, { x: -1, y: 0 });
        assert.ok(keyframes.length >= 2, `${kind} has frames`);
        for (const frame of keyframes) {
            for (const prop of Object.keys(frame)) {
                assert.ok(["transform", "opacity", "offset"].includes(prop), `${kind} frame touches only compositor properties (${prop})`);
            }
        }
        assert.equal(keyframes[0]!.transform, "translate(0px, 0px) rotate(0deg) scale(1)", `${kind} starts at rest`);
        const duration = Number(options.duration);
        assert.ok(duration > 0 && duration <= 600, `${kind} lasts ${duration}ms`);
        if (kind === "ko") {
            assert.equal(options.fill, "forwards", "the KO frame holds until unmount");
        } else {
            assert.equal(keyframes[keyframes.length - 1]!.transform, keyframes[0]!.transform, `${kind} returns to rest`);
            assert.notEqual(options.fill, "forwards");
        }
    }
});

test("hits push away along the blow, lunges move toward the target, and the rotation follows the side", () => {
    const hitRight = battlefieldReactionSpec("hit", { x: 1, y: 0 }).keyframes[1]!.transform as string;
    const hitLeft = battlefieldReactionSpec("hit", { x: -1, y: 0 }).keyframes[1]!.transform as string;
    assert.match(hitRight, /translate\(5px, 0px\) rotate\(-3deg\)/);
    assert.match(hitLeft, /translate\(-5px, 0px\) rotate\(3deg\)/);
    const lunge = battlefieldReactionSpec("lunge", { x: 0, y: 1 }).keyframes[1]!.transform as string;
    assert.match(lunge, /translate\(0px, 10px\)/);
});

test("playBattlefieldReaction is a no-op without an element or the Web Animations API", () => {
    assert.equal(playBattlefieldReaction(null, "hit"), null);
    assert.equal(playBattlefieldReaction({ getAttribute: () => null } as unknown as Element, "hit"), null);
});

test("playBattlefieldReaction never re-animates a fighter that is already down", () => {
    let animated = 0;
    const el = {
        getAttribute: (name: string) => (name === "data-battlefield-down" ? "true" : null),
        setAttribute: () => {},
        animate: () => { animated++; return { cancel() {}, addEventListener() {} } as unknown as Animation; },
    } as unknown as Element;
    assert.equal(playBattlefieldReaction(el, "hit"), null);
    assert.equal(animated, 0);
});

test("a KO stamps the anchor as down and a plain hit replaces the previous reaction", () => {
    const attrs: Record<string, string> = {};
    let cancelled = 0;
    const el = {
        getAttribute: (name: string) => attrs[name] ?? null,
        setAttribute: (name: string, value: string) => { attrs[name] = value; },
        animate: () => ({ cancel() { cancelled++; }, addEventListener() {} } as unknown as Animation),
    } as unknown as Element;
    assert.ok(playBattlefieldReaction(el, "hit"));
    assert.ok(playBattlefieldReaction(el, "heavy"));
    assert.equal(cancelled, 1, "the second reaction cancels the first instead of stacking");
    assert.ok(playBattlefieldReaction(el, "ko"));
    assert.equal(attrs["data-battlefield-down"], "true");
    assert.equal(playBattlefieldReaction(el, "hit"), null);
});

test("findBattlefieldActor queries by the stamped id and refuses to build a broken selector", () => {
    const seen: string[] = [];
    const root = { querySelector: (q: string) => { seen.push(q); return null; } } as unknown as ParentNode;
    findBattlefieldActor(root, 'enemy"]');
    assert.deepEqual(seen, ['[data-battlefield-actor-id="enemy]"]']);
    assert.equal(findBattlefieldActor(null, "enemy"), null);
});
