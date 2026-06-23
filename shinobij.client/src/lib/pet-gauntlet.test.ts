/*
 * Pet Gauntlet run engine — coverage for the deterministic state machine.
 * Invariants: a run is reproducible from its seed, the economy gates buys, and
 * round results advance / cost hearts / end the run correctly.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    startGauntletRun, buyOffer, rerollShop, releasePet, setField, fieldedPets,
    enemySquadForRound, beginFight, applyRoundResult,
    GAUNTLET_START_HEARTS, GAUNTLET_START_GOLD, GAUNTLET_FIELD_CAP, GAUNTLET_ROSTER_CAP, GAUNTLET_MAX_ROUNDS,
} from "./pet-gauntlet";
import { petStripVariant } from "./pet-battle-anim";

describe("startGauntletRun", () => {
    it("is deterministic from the seed", () => {
        const a = startGauntletRun(1234);
        const b = startGauntletRun(1234);
        assert.deepEqual(a.shop.map((o) => o.pet.id), b.shop.map((o) => o.pet.id));
        assert.equal(a.hearts, GAUNTLET_START_HEARTS);
        assert.equal(a.gold, GAUNTLET_START_GOLD);
        assert.equal(a.round, 1);
        assert.equal(a.status, "drafting");
        assert.ok(a.shop.length > 0);
    });

    it("different seeds give different shops (usually)", () => {
        const a = startGauntletRun(1);
        const b = startGauntletRun(99999);
        assert.notDeepEqual(a.shop.map((o) => o.pet.id), b.shop.map((o) => o.pet.id));
    });
});

describe("buyOffer", () => {
    it("deducts gold, adds a unique run-pet, auto-fields, and consumes the offer", () => {
        const run = startGauntletRun(42);
        const cost = run.shop[0].cost;
        const after = buyOffer(run, 0);
        assert.equal(after.gold, GAUNTLET_START_GOLD - cost);
        assert.equal(after.roster.length, 1);
        assert.equal(after.shop.length, run.shop.length - 1);
        assert.equal(petStripVariant(after.roster[0].id), run.shop[0].pet.id, "run-pet id strips back to the canonical template id (so the 2.5D art resolves)");
        assert.deepEqual(after.fieldIds, [after.roster[0].id], "first buy auto-fields");
        assert.equal(run.roster.length, 0, "original run is not mutated");
    });

    it("blocks a buy with insufficient gold", () => {
        const run = { ...startGauntletRun(42), gold: 0 };
        assert.equal(buyOffer(run, 0).roster.length, 0);
    });

    it("blocks a buy when the roster is full", () => {
        let run = { ...startGauntletRun(42), gold: 999 };
        // Fill the roster (reroll between buys to keep offers available).
        for (let i = 0; run.roster.length < GAUNTLET_ROSTER_CAP && i < 40; i++) {
            run = run.shop.length ? buyOffer(run, 0) : rerollShop(run);
        }
        assert.equal(run.roster.length, GAUNTLET_ROSTER_CAP);
        const full = run.shop.length ? run : rerollShop(run);
        assert.equal(buyOffer(full, 0).roster.length, GAUNTLET_ROSTER_CAP, "no buy past the cap");
    });

    it("only auto-fields up to FIELD_CAP", () => {
        let run = { ...startGauntletRun(7), gold: 999 };
        for (let i = 0; i < GAUNTLET_FIELD_CAP + 1; i++) run = run.shop.length ? buyOffer(run, 0) : buyOffer(rerollShop(run), 0);
        assert.equal(run.fieldIds.length, GAUNTLET_FIELD_CAP);
    });
});

describe("rerollShop", () => {
    it("costs gold and produces a fresh, deterministic shop", () => {
        const run = startGauntletRun(5);
        const r1 = rerollShop(run);
        assert.equal(r1.gold, run.gold - 1);
        const r1again = rerollShop(startGauntletRun(5));
        assert.deepEqual(r1.shop.map((o) => o.pet.id), r1again.shop.map((o) => o.pet.id), "reroll is reproducible");
    });
});

describe("setField / releasePet / fieldedPets", () => {
    it("fields chosen roster pets (lead first) and release pulls them from field", () => {
        let run = { ...startGauntletRun(11), gold: 999 };
        run = buyOffer(run, 0);
        run = buyOffer(rerollShop(run), 0);
        const [a, b] = run.roster;
        run = setField(run, [b.id, a.id]);
        assert.deepEqual(fieldedPets(run).map((p) => p.id), [b.id, a.id], "field order respected");
        run = releasePet(run, b.id);
        assert.equal(run.roster.find((p) => p.id === b.id), undefined);
        assert.equal(run.fieldIds.includes(b.id), false, "released pet leaves the field");
    });
});

describe("enemySquadForRound", () => {
    it("is deterministic and scales size with the round", () => {
        const run = startGauntletRun(3);
        assert.equal(enemySquadForRound(run).length, 1, "round 1-2 = 1 enemy");
        assert.equal(enemySquadForRound({ ...run, round: 5 }).length, 2, "round 3+ = 2 enemies");
        assert.deepEqual(
            enemySquadForRound(run).map((p) => p.id),
            enemySquadForRound(startGauntletRun(3)).map((p) => p.id),
            "same seed+round → same enemies",
        );
    });
});

describe("applyRoundResult", () => {
    it("a win advances the round and pays gold", () => {
        let run = beginFight({ ...startGauntletRun(8), fieldIds: ["x"], roster: [{ id: "x" } as never] });
        const before = run.gold;
        run = applyRoundResult(run, true);
        assert.equal(run.round, 2);
        assert.equal(run.status, "drafting");
        assert.ok(run.gold > before, "won round pays gold");
    });

    it("a loss costs a heart; 0 hearts ends the run", () => {
        let run = beginFight({ ...startGauntletRun(8), hearts: 1, fieldIds: ["x"], roster: [{ id: "x" } as never] });
        run = applyRoundResult(run, false);
        assert.equal(run.hearts, 0);
        assert.equal(run.status, "lost");
    });

    it("clearing the final round wins the run", () => {
        let run = beginFight({ ...startGauntletRun(8), round: GAUNTLET_MAX_ROUNDS, fieldIds: ["x"], roster: [{ id: "x" } as never] });
        run = applyRoundResult(run, true);
        assert.equal(run.status, "won");
    });
});
