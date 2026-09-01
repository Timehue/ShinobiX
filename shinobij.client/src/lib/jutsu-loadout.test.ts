import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import type { Jutsu, SavedBloodline } from "../types/combat";
import { deletedJutsuEntry } from "../../../shared/admin-content-tombstone";
import { starterJutsus } from "../data/jutsu";
import { getAllJutsus, getPvpJutsuLoadout } from "./jutsu-loadout";

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

    it("grants an admin account every starter bloodline kit", () => {
        const plain = getAllJutsus([], [], character({ name: "tester" }));
        const admin = getAllJutsus([], [], character({ name: "Admin 1" }));
        assert.ok(admin.length > plain.length,
            "an admin sees all starter bloodline jutsu; a plain character sees only their own");
    });

    it("gives a character with no bloodline no bloodline kit", () => {
        const none = getAllJutsus([], [], character({ bloodline: undefined }));
        const admin = getAllJutsus([], [], character({ name: "Admin 1" }));
        assert.ok(none.length < admin.length);
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
