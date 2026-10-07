import { strict as assert } from "node:assert";
import test, { afterEach } from "node:test";
import { gearDropRewardLine } from "./items";
import { mutateDungeonRunServer } from "./dungeon-api";
import { starterItems } from "../data/starter-items";
import { parseStepItemId } from "../../../shared/gear-steps";

const realFetch = globalThis.fetch;
afterEach(() => { (globalThis as Record<string, unknown>).fetch = realFetch; });

function reply(payload: unknown) {
    (globalThis as Record<string, unknown>).fetch = async () => ({ ok: true, json: async () => payload }) as unknown as Response;
}

test("the line names the piece and says how much stronger it is", () => {
    const weapon = starterItems.find(item => item.id === "rustfang-kunai-s1")!;
    const line = gearDropRewardLine(weapon.id)!;
    assert.ok(line.startsWith("Upgrade gear found: "));
    assert.ok(line.includes(weapon.name));
    assert.match(line, /Damage 14\.5 EP, up from 14 on the /);
    const armor = starterItems.find(item => item.id === "reinforced-vest-s1")!;
    assert.match(gearDropRewardLine(armor.id)!, /% damage reduction, up from [\d.]+% on the /);
});

test("no hyphens in the wording this feature adds (existing base item names keep theirs)", () => {
    for (const item of starterItems.filter(candidate => parseStepItemId(candidate.id))) {
        const base = starterItems.find(candidate => candidate.id === parseStepItemId(item.id)!.baseId)!;
        const line = gearDropRewardLine(item.id)!;
        assert.ok(line, item.id);
        const wording = line.replaceAll(item.name, "").replaceAll(base.name, "");
        assert.equal(wording.includes("-"), false, line);
    }
});

test("an ordinary item, an unknown id and no id give no line", () => {
    assert.equal(gearDropRewardLine("rustfang-kunai"), null);
    assert.equal(gearDropRewardLine("not-an-item"), null);
    assert.equal(gearDropRewardLine(undefined), null);
    assert.equal(gearDropRewardLine(null), null);
});

test("the dungeon settle passes the granted piece through, and omits it when there is none", async () => {
    reply({ ok: true, token: "run1", character: { name: "Kiri" }, _saveVersion: 4, gearDrop: { itemId: "cloth-hood-s1" } });
    assert.equal((await mutateDungeonRunServer("Kiri", "settle", "run1")).gearDropItemId, "cloth-hood-s1");
    reply({ ok: true, token: "run1", character: { name: "Kiri" }, _saveVersion: 4 });
    assert.equal("gearDropItemId" in (await mutateDungeonRunServer("Kiri", "settle", "run1")), false);
    reply({ ok: true, token: "run1", character: { name: "Kiri" }, gearDrop: { itemId: 7 } });
    assert.equal("gearDropItemId" in (await mutateDungeonRunServer("Kiri", "settle", "run1")), false);
});
