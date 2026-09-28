import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import type { Jutsu, SavedBloodline } from "../types/combat";
import { deletedJutsuEntry } from "../../../shared/admin-content-tombstone";
import { starterJutsus, starterSavedBloodlines } from "../data/jutsu";
import { getAllJutsus, getPvpJutsuLoadout, liveEquippedJutsuIds } from "./jutsu-loadout";
import { canEquipElementJutsu } from "./bloodline";

/*
 * Characterization tests for jutsu loadout resolution.
 *
 * These pin current behaviour, not preferred behaviour. getAllJutsus decides
 * what a fighter is allowed to bring, so it is an entitlement surface: an
 * accidental widening hands players jutsu they never unlocked, and an accidental
 * narrowing silently strips a bloodline kit mid-fight.
 *
 * Untestable while it lived in App.tsx — App imports a .webp, so node:test could
 * never load it. This is the coverage that move bought.
 */

const character = (over: Partial<Character> = {}): Character =>
    ({ name: "tester", equippedJutsuIds: [], ...over }) as unknown as Character;

const jutsu = (id: string, over: Partial<Jutsu> = {}): Jutsu =>
    ({ id, name: id, ...over }) as unknown as Jutsu;

describe("getAllJutsus", () => {
    it("always includes the starter kit", () => {
        const ids = new Set(getAllJutsus([], [], character()).map((j) => j.id));
        for (const starter of starterJutsus) assert.ok(ids.has(starter.id), `missing starter ${starter.id}`);
    });

    it("returns one entry per id", () => {
        const all = getAllJutsus([], [jutsu("dupe"), jutsu("dupe")], character());
        assert.equal(all.filter((j) => j.id === "dupe").length, 1);
        assert.equal(new Set(all.map((j) => j.id)).size, all.length, "ids must be unique across the merged set");
    });

    it("excludes tombstoned creator entries so a delete survives publish", () => {
        const live = jutsu("authored-live");
        const tombstoned = deletedJutsuEntry("authored-gone", 1) as unknown as Jutsu;
        const ids = new Set(getAllJutsus([], [live, tombstoned], character()).map((j) => j.id));
        assert.ok(ids.has("authored-live"));
        assert.ok(!ids.has("authored-gone"), "a tombstoned jutsu must never be fieldable");
    });

    it("an admin character follows the same single-bloodline combat rule", () => {
        const plain = getAllJutsus([], [], character({ name: "tester" }));
        const admin = getAllJutsus([], [], character({ name: "Admin 1" }));
        assert.deepEqual(admin.map((entry) => entry.id), plain.map((entry) => entry.id));
    });

    it("gives a character with no bloodline no bloodline kit", () => {
        const none = getAllJutsus([], [], character({ bloodline: undefined }));
        const withBloodline = getAllJutsus([], [], character({ bloodline: "Ashen Eyes" }));
        assert.ok(none.length < withBloodline.length);
    });

    it("treats the renamed Blue Blade Eyes as Ashen Eyes", () => {
        const renamed = getAllJutsus([], [], character({ bloodline: "Blue Blade Eyes" }));
        const canonical = getAllJutsus([], [], character({ bloodline: "Ashen Eyes" }));
        assert.deepEqual(renamed.map((j) => j.id), canonical.map((j) => j.id),
            "the legacy bloodline name must resolve to the same kit, not to none");
    });

    it("merges an equipped bloodline's kit", () => {
        const bl = { id: "bl-1", name: "Custom", rank: "A Rank", jutsus: [jutsu("bloodline-only")] } as unknown as SavedBloodline;
        const without = getAllJutsus([bl], [], character());
        const with_ = getAllJutsus([bl], [], character({ equippedBloodlineId: "bl-1" }));
        assert.ok(!without.some((j) => j.id === "bloodline-only"), "an unequipped bloodline grants nothing");
        assert.ok(with_.some((j) => j.id === "bloodline-only"), "the equipped bloodline's kit is fieldable");
    });

    it("shows the restored fourth ring for a shortened active bloodline field", () => {
        const field = jutsu("field", {
            method: "INSTANT_EFFECT", target: "EMPTY_GROUND", range: 3,
            groundRangeVersion: 2, tags: [{ name: "Poison", percent: 30 }],
        });
        const bloodline = { id: "bl-field", name: "Field", rank: "A Rank", jutsus: [field] } as SavedBloodline;
        const catalog = getAllJutsus([bloodline], [], character({ equippedBloodlineId: bloodline.id }));
        assert.equal(catalog.find((entry) => entry.id === field.id)?.range, 4);
        assert.equal(field.range, 3, "the stored definition is not mutated");
    });

    it("fields only the active bloodline even when shared jutsu copies include the inactive kits", () => {
        const first = { id: "bl-first", name: "First", rank: "A Rank", jutsus: [jutsu("first-tech", { element: "Fire" })] } as SavedBloodline;
        const second = { id: "bl-second", name: "Second", rank: "A Rank", jutsus: [jutsu("second-tech", { element: "None" })] } as SavedBloodline;
        const starterTechnique = starterSavedBloodlines.find((bloodline) => bloodline.name === "Ashen Eyes")!.jutsus[0]!;
        const fighter = character({
            bloodline: "Ashen Eyes", equippedBloodlineId: first.id,
            equippedJutsuIds: [starterTechnique.id, first.jutsus[0]!.id, second.jutsus[0]!.id],
        });
        const sharedCopies = [starterTechnique, second.jutsus[0]!];
        const catalog = getAllJutsus([first, second], sharedCopies, fighter);
        assert.ok(catalog.some((entry) => entry.id === "first-tech"));
        assert.ok(!catalog.some((entry) => entry.id === "second-tech"));
        assert.ok(!catalog.some((entry) => entry.id === starterTechnique.id));
        assert.deepEqual(getPvpJutsuLoadout([first, second], sharedCopies, fighter).map((entry) => entry.id), ["first-tech"]);
        assert.equal(canEquipElementJutsu(fighter, second.jutsus[0]!, [first, second]), false);
        assert.equal(canEquipElementJutsu(fighter, starterTechnique, [first, second]), false);

        const returnedToStarter = character({
            ...fighter,
            equippedBloodlineId: starterSavedBloodlines.find((bloodline) => bloodline.name === "Ashen Eyes")!.id,
        });
        assert.deepEqual(getPvpJutsuLoadout([first, second], sharedCopies, returnedToStarter).map((entry) => entry.id),
            [starterTechnique.id]);
    });
});

describe("getPvpJutsuLoadout", () => {
    it("returns ONLY the equipped jutsu, in equipped order", () => {
        const a = starterJutsus[0].id;
        const b = starterJutsus[1].id;
        const loadout = getPvpJutsuLoadout([], [], character({ equippedJutsuIds: [b, a] }));
        assert.deepEqual(loadout.map((j) => j.id), [b, a]);
    });

    it("is empty when nothing is equipped", () => {
        assert.deepEqual(getPvpJutsuLoadout([], [], character({ equippedJutsuIds: [] })), []);
    });

    it("skips equipped ids the character cannot actually field", () => {
        const real = starterJutsus[0].id;
        const loadout = getPvpJutsuLoadout([], [], character({ equippedJutsuIds: ["ghost-id", real] }));
        assert.deepEqual(loadout.map((j) => j.id), [real],
            "a stale or forged equipped id must resolve to nothing, not to an error");
    });

    it("does not field the same jutsu twice for a duplicated equipped id", () => {
        const real = starterJutsus[0].id;
        const loadout = getPvpJutsuLoadout([], [], character({ equippedJutsuIds: [real, real] }));
        assert.equal(loadout.length, 1);
    });
});

/*
 * Regression: player "Rill" carried 15 equipped ids but could only ever see and
 * fight with 14. The 15th pointed at an admin-authored jutsu that had since been
 * DELETED from the content store, and the save keeps such an id alive because a
 * mastery row still backs it (api/save/[name].ts accepts any id with mastery).
 * The loadout UI counted the raw array, so the cap read "full" at 15 while the
 * grid — which resolves ids the way combat does — could only paint 14. The last
 * slot was unfillable and the dead one was invisible, so it could not even be
 * cleared: "You can only equip 15 jutsu" with an empty slot 15 on screen.
 */
describe("liveEquippedJutsuIds", () => {
    const catalog = [jutsu("alive-1"), jutsu("alive-2")];

    it("drops an id whose jutsu no longer exists in the catalog", () => {
        assert.deepEqual(
            liveEquippedJutsuIds(catalog, ["alive-1", "deleted-custom-jutsu", "alive-2"]),
            ["alive-1", "alive-2"],
        );
    });

    it("frees the slot a deleted jutsu was holding, so the cap stops lying", () => {
        // 15 stored ids, one of them dead: 14 usable, so a 15th is equippable.
        const fifteen = Array.from({ length: 15 }, (_, i) => jutsu(`j${i}`));
        const stored = fifteen.map((j) => j.id);
        const catalogMinusOne = fifteen.filter((j) => j.id !== "j7");
        assert.equal(stored.length, 15, "the save really does carry a full-looking loadout");
        assert.equal(liveEquippedJutsuIds(catalogMinusOne, stored).length, 14);
    });

    it("preserves slot order and de-duplicates, matching combat resolution", () => {
        assert.deepEqual(
            liveEquippedJutsuIds(catalog, ["alive-2", "alive-1", "alive-2"]),
            ["alive-2", "alive-1"],
        );
    });

    it("keeps an id that resolves but is currently element-locked", () => {
        // Element gating decides what may be EQUIPPED, not what still exists.
        // Such a jutsu must keep its slot: combat still resolves it, and silently
        // pruning it would delete a loadout the player never asked to change.
        const locked = jutsu("fire-only", { element: "Fire" });
        assert.deepEqual(liveEquippedJutsuIds([...catalog, locked], ["fire-only"]), ["fire-only"]);
    });
});
