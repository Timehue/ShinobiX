import { strict as assert } from "node:assert";
import test from "node:test";
import { createCanonicalGroundEffect, resolveJutsuActionPlan } from "../../../api/combat-core/resolve-jutsu-action";
import { MAX_COMBAT_VFX_TILES } from "../../../api/combat-core/jutsu-vfx";
import { applyGroundEffectToFighter } from "../../../api/pvp/move";
import type { PvpFighter } from "../../../api/pvp/session";
import { groundZoneTilesForDisplay } from "./ground-zone-display";

const width = 12;
const height = 10;
const tileCount = width * height;

for (const [method, expectedCount] of [["INSTANT_EFFECT", 61], ["AOE_SPIRAL", 19]] as const) {
    test(`${method} displays every authoritative zone tile after casting`, () => {
        const plan = resolveJutsuActionPlan({
            jutsu: {
                id: "venom-field", name: "Venom Field", type: "Ninjutsu",
                target: "EMPTY_GROUND", method, range: 4, ap: 60,
                tags: [{ name: "Poison", percent: 20 }],
            },
            casterPos: 65,
            opponentPos: 67,
            casterChakra: 100,
            casterStamina: 100,
            casterStatuses: [],
            round: 1,
            availableAp: 100,
            actionsThisTurn: 0,
            cooldownRemaining: 0,
            tile: 66,
            board: { width, height, unavailableTiles: new Set<number>() },
        });
        assert.ok(plan.accepted);
        const zone = createCanonicalGroundEffect({ id: "zone", owner: "p1", name: "Venom Field", plan });
        assert.equal(zone.tiles.length, expectedCount);
        assert.ok(MAX_COMBAT_VFX_TILES >= zone.tiles.length, "the cast VFX must carry every affected tile");
        if (method === "INSTANT_EFFECT") {
            const otherTarget = resolveJutsuActionPlan({
                jutsu: { id: "venom-field", name: "Venom Field", type: "Ninjutsu", target: "EMPTY_GROUND", method, range: 4, ap: 60, tags: [{ name: "Poison", percent: 20 }] },
                casterPos: 65, opponentPos: 67, casterChakra: 100, casterStamina: 100,
                casterStatuses: [], round: 1, availableAp: 100, actionsThisTurn: 0,
                cooldownRemaining: 0, tile: 77,
                board: { width, height, unavailableTiles: new Set<number>() },
            });
            assert.ok(otherTarget.accepted);
            assert.deepEqual(otherTarget.footprint, zone.tiles, "the click confirms the cast without moving the field");
        }

        const visible = groundZoneTilesForDisplay([zone], tileCount);
        assert.equal(visible.size, zone.tiles.length);
        for (const tile of zone.tiles) {
            assert.deepEqual(visible.get(tile), { label: "Venom Field, 2 rounds remaining. Cannot be cleared or cleansed", tone: "poison" });
            const fighter: PvpFighter = {
                name: "Target", hp: 100, maxHp: 100, chakra: 100, maxChakra: 100,
                stamina: 100, maxStamina: 100, shield: 0, statuses: [], character: {}, pos: tile,
            };
            assert.ok(
                applyGroundEffectToFighter(fighter, zone, 1).fighter.statuses.some(status => status.name === "Poison"),
                `tile ${tile} must apply the zone effect as well as display it`,
            );
        }
    });
}

test("overlapping and expired ground effects retain accurate tile labels", () => {
    const zones = [
        { id: "a", owner: "p1", name: "Ash", tiles: [2, 3], rounds: 1, tags: [{ name: "Recoil" }] },
        { id: "b", owner: "p2", name: "Haze", tiles: [3, 4, -1, 120], rounds: 2, tags: [{ name: "Decrease Damage Given" }] },
        { id: "c", owner: "p1", name: "Spent", tiles: [5], rounds: 0, tags: [{ name: "Poison" }] },
    ];
    const visible = groundZoneTilesForDisplay(zones, tileCount);
    assert.deepEqual([...visible.keys()], [2, 3, 4]);
    assert.deepEqual(visible.get(2), { label: "Ash, 1 round remaining. Cannot be cleared or cleansed", tone: "recoil" });
    assert.deepEqual(visible.get(3), { label: "Ash, 1 round remaining. Cannot be cleared or cleansed; Haze, 2 rounds remaining. Cannot be cleared or cleansed", tone: "debuff" });
});

test("a buff tile shows gold on its one hex, even where an enemy field overlaps", () => {
    const tiles = groundZoneTilesForDisplay([
        { id: "field", owner: "p2", name: "Venom Field", tiles: [5, 6], rounds: 2, tags: [{ name: "Poison", percent: 20 }] },
        { id: "tile", owner: "p1", name: "Golden Ground", kind: "occupant", tiles: [5], rounds: 2, tags: [{ name: "Absorb", percent: 30 }] },
    ], tileCount);
    assert.equal(tiles.get(5)?.tone, "sanctuary");
    assert.equal(tiles.get(6)?.tone, "poison");
    assert.match(tiles.get(5)?.label ?? "", /Buff tile: Absorb 30%, 2 rounds remaining\. Anyone standing here gains it/);
    assert.match(tiles.get(5)?.label ?? "", /Cannot be cleared or cleansed/);
});
