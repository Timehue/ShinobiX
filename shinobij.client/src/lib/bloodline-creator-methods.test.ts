import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    bloodlineCreatorMethodAllowsTag,
    bloodlineCreatorRangeForTarget,
    bloodlineCreatorTargetForMethod,
    normalizeBloodlineCreatorMethodTags,
} from "./bloodline-creator-methods";

describe("player bloodline method/tag reachability", () => {
    it("disallows and strips Move from opponent-centred AOE_BURST", () => {
        const tags = [{ name: "Move", percent: 0 }, { name: "Poison", percent: 30 }];

        assert.equal(bloodlineCreatorMethodAllowsTag("Move", "AOE_BURST", tags.map((tag) => tag.name)), false);
        assert.deepEqual(normalizeBloodlineCreatorMethodTags(tags, "AOE_BURST"), [{ name: "Poison", percent: 30 }]);
        assert.equal(bloodlineCreatorTargetForMethod("AOE_BURST", "EMPTY_GROUND"), "OPPONENT");
    });

    it("retains the existing SINGLE Move damage-required reachability rule", () => {
        const tags = [
            { name: "Move", percent: 0 },
            { name: "Wound", percent: 30 },
            { name: "Siphon", percent: 30 },
            { name: "Reflect", percent: 30 },
        ];

        assert.deepEqual(normalizeBloodlineCreatorMethodTags(tags, "SINGLE"), [
            { name: "Move", percent: 0 },
            { name: "Reflect", percent: 30 },
        ]);
    });

    it("locks legal direct Copy and Mirror drafts to an opponent at creator range", () => {
        const impossibleTargets = ["SELF", "EMPTY_GROUND", "OTHER_USER", "CHARACTER"] as const;
        for (const name of ["Copy", "Mirror"] as const) {
            for (const target of impossibleTargets) {
                const derived = bloodlineCreatorTargetForMethod("SINGLE", target, {
                    ap: 60,
                    tags: [{ name }],
                });
                assert.equal(derived, "OPPONENT", `${name} must not retain ${target}`);
                assert.equal(bloodlineCreatorRangeForTarget(derived, 0), 4);
            }
        }
    });

    it("keeps movement-method precedence over Copy and Mirror direct targeting", () => {
        assert.equal(bloodlineCreatorTargetForMethod("AOE_CIRCLE", "SELF", {
            ap: 60,
            tags: [{ name: "Move" }, { name: "Copy" }],
        }), "EMPTY_GROUND");
        assert.equal(bloodlineCreatorTargetForMethod("SINGLE", "SELF", {
            ap: 60,
            tags: [{ name: "Move" }, { name: "Mirror" }],
        }), "EMPTY_GROUND");
        assert.equal(bloodlineCreatorTargetForMethod("AOE_BURST", "EMPTY_GROUND", {
            ap: 60,
            tags: [{ name: "Copy" }],
        }), "OPPONENT");
    });

    it("does not legitimize a 40 AP Copy or Mirror while the tag stripper owns that rule", () => {
        assert.equal(bloodlineCreatorTargetForMethod("SINGLE", "SELF", {
            ap: 40,
            tags: [{ name: "Copy" }],
        }), "SELF");
        assert.equal(bloodlineCreatorTargetForMethod("SINGLE", "SELF", {
            ap: 40,
            tags: [{ name: "Mirror" }],
        }), "SELF");
    });
});
