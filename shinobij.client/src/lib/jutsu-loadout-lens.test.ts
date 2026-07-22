import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { Stats } from "../types/combat";
import type { JutsuType } from "../types/core";
import { resolveLoadoutLensDiscipline } from "./jutsu-loadout-lens";

const stats = (overrides: Partial<Stats> = {}): Stats => ({
    strength: 0,
    speed: 0,
    intelligence: 0,
    willpower: 0,
    bukijutsuOffense: 0,
    bukijutsuDefense: 0,
    taijutsuOffense: 0,
    taijutsuDefense: 0,
    genjutsuOffense: 0,
    genjutsuDefense: 0,
    ninjutsuOffense: 0,
    ninjutsuDefense: 0,
    ...overrides,
});

const character = (
    equippedJutsuIds: string[],
    statOverrides: Partial<Stats> = {},
    specialty: JutsuType = "Ninjutsu",
    bloodline = "Custom Bloodline",
) => ({ bloodline, specialty, stats: stats(statOverrides), equippedJutsuIds });

const jutsu = (id: string, type: JutsuType, ap = 60) => ({ id, type, ap });

describe("resolveLoadoutLensDiscipline", () => {
    it("uses the dominant discipline among equipped 60 AP jutsu", () => {
        const result = resolveLoadoutLensDiscipline(
            character(["gen-a", "gen-b", "nin"]),
            [jutsu("gen-a", "Genjutsu"), jutsu("gen-b", "Genjutsu"), jutsu("nin", "Ninjutsu")],
        );
        assert.equal(result, "Genjutsu");
    });

    it("breaks a mixed 60 AP loadout tie with the highest offense stat", () => {
        const result = resolveLoadoutLensDiscipline(
            character(["gen", "tai"], { taijutsuOffense: 80, genjutsuOffense: 50 }),
            [jutsu("gen", "Genjutsu"), jutsu("tai", "Taijutsu")],
        );
        assert.equal(result, "Taijutsu");
    });

    it("uses the highest offense when no equipped 60 AP jutsu provides a signal", () => {
        const result = resolveLoadoutLensDiscipline(
            character(["utility"], { bukijutsuOffense: 95, ninjutsuOffense: 40 }),
            [jutsu("utility", "Genjutsu", 40)],
        );
        assert.equal(result, "Bukijutsu");
    });

    it("uses bloodline identity when all offense stats are tied", () => {
        const result = resolveLoadoutLensDiscipline(
            character([], {}, "Ninjutsu", "Ashen Eyes"),
            [],
        );
        assert.equal(result, "Genjutsu");
    });
});
