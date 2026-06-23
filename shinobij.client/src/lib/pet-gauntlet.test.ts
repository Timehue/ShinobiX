/*
 * Pet Gauntlet run engine — coverage for the deterministic state machine.
 * Invariants: a run is reproducible from its seed, the economy gates buys, and
 * round results advance / cost hearts / end the run correctly.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    startGauntletRun, buyOffer, buyItem, buyRelic, buyPremium, premiumUnlocked, rerollShop, releasePet, setField, fieldedPets,
    enemySquadForRound, beginFight, applyRoundResult, applyGauntletBuffs, itemCost, GAUNTLET_ITEMS, GAUNTLET_RELICS,
    boardModsFromRelics, petStar, wouldMerge, offerCost, mergeDiscountFromRelics,
    GAUNTLET_START_HEARTS, GAUNTLET_START_VALOR, GAUNTLET_FIELD_CAP, GAUNTLET_ROSTER_CAP, GAUNTLET_MAX_ROUNDS,
    GAUNTLET_SHARD_COST, GAUNTLET_PREMIUM_ROUND, GAUNTLET_MERGE_BOOST, GAUNTLET_LOSS_VALOR,
    type RelicId,
} from "./pet-gauntlet";
import type { Pet } from "../types/pet";
import { petStripVariant } from "./pet-battle-anim";

describe("startGauntletRun", () => {
    it("is deterministic from the seed", () => {
        const a = startGauntletRun(1234);
        const b = startGauntletRun(1234);
        assert.deepEqual(a.shop.map((o) => o.pet.id), b.shop.map((o) => o.pet.id));
        assert.equal(a.hearts, GAUNTLET_START_HEARTS);
        assert.equal(a.valor, GAUNTLET_START_VALOR);
        assert.equal(a.round, 1);
        assert.equal(a.roundsCleared, 0);
        assert.equal(a.maxRounds, GAUNTLET_MAX_ROUNDS);
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
    it("deducts valor, adds a unique run-pet, auto-fields, and consumes the offer", () => {
        const run = startGauntletRun(42);
        const cost = run.shop[0].cost;
        const after = buyOffer(run, 0);
        assert.equal(after.valor, GAUNTLET_START_VALOR - cost);
        assert.equal(after.roster.length, 1);
        assert.equal(after.shop.length, run.shop.length - 1);
        assert.equal(petStripVariant(after.roster[0].id), run.shop[0].pet.id, "run-pet id strips back to the canonical template id (so the 2.5D art resolves)");
        assert.deepEqual(after.fieldIds, [after.roster[0].id], "first buy auto-fields");
        assert.equal(run.roster.length, 0, "original run is not mutated");
    });

    it("blocks a buy with insufficient valor", () => {
        const run = { ...startGauntletRun(42), valor: 0 };
        assert.equal(buyOffer(run, 0).roster.length, 0);
    });

    it("blocks a buy when the roster is full", () => {
        let run = { ...startGauntletRun(42), valor: 999 };
        // Fill the roster (reroll between buys to keep offers available).
        for (let i = 0; run.roster.length < GAUNTLET_ROSTER_CAP && i < 40; i++) {
            run = run.shop.length ? buyOffer(run, 0) : rerollShop(run);
        }
        assert.equal(run.roster.length, GAUNTLET_ROSTER_CAP);
        const full = run.shop.length ? run : rerollShop(run);
        assert.equal(buyOffer(full, 0).roster.length, GAUNTLET_ROSTER_CAP, "no buy past the cap");
    });

    it("only auto-fields up to FIELD_CAP", () => {
        let run = { ...startGauntletRun(7), valor: 999 };
        for (let i = 0; i < GAUNTLET_FIELD_CAP + 1; i++) run = run.shop.length ? buyOffer(run, 0) : buyOffer(rerollShop(run), 0);
        assert.equal(run.fieldIds.length, GAUNTLET_FIELD_CAP);
    });
});

describe("buyOffer — merge (auto-battler level-up)", () => {
    it("recruiting an owned pet merges: boosts stats, bumps ★, adds no slot, still costs valor", () => {
        let run = { ...startGauntletRun(42), valor: 99 };
        const template = run.shop[0].pet;
        run = buyOffer(run, 0);                       // own one copy
        const owned = run.roster[0];
        const base = { hp: owned.hp, attack: owned.attack, defense: owned.defense, speed: owned.speed };
        assert.equal(petStar(run, owned.id), 1, "fresh pet is ★1");
        // Re-offer the SAME template and buy again → merge, not duplicate.
        run = { ...run, shop: [{ pet: template, cost: 3 }] };
        assert.equal(wouldMerge(run, template), true);
        const valorBefore = run.valor;
        run = buyOffer(run, 0);
        assert.equal(run.roster.length, 1, "merge adds no new roster slot");
        assert.equal(petStar(run, owned.id), 2, "merge bumps ★ to 2");
        assert.equal(run.valor, valorBefore - 3, "merge still costs valor");
        const m = run.roster[0];
        assert.equal(m.id, owned.id, "merged in place (same instance id)");
        assert.equal(m.attack, Math.round(base.attack * GAUNTLET_MERGE_BOOST), "attack scaled by merge boost");
        assert.equal(m.hp, Math.round(base.hp * GAUNTLET_MERGE_BOOST));
        assert.equal(m.defense, Math.round(base.defense * GAUNTLET_MERGE_BOOST));
        assert.equal(m.speed, Math.round(base.speed * GAUNTLET_MERGE_BOOST));
    });

    it("merges even when the roster is full (it consumes no slot)", () => {
        let run = { ...startGauntletRun(42), valor: 999 };
        for (let i = 0; run.roster.length < GAUNTLET_ROSTER_CAP && i < 40; i++) {
            run = run.shop.length ? buyOffer(run, 0) : rerollShop(run);
        }
        assert.equal(run.roster.length, GAUNTLET_ROSTER_CAP);
        const firstId = run.roster[0].id;
        const ownedTemplate = { ...run.roster[0], id: petStripVariant(firstId) } as Pet;
        run = { ...run, shop: [{ pet: ownedTemplate, cost: 3 }] };
        assert.equal(wouldMerge(run, ownedTemplate), true);
        run = buyOffer(run, 0);
        assert.equal(run.roster.length, GAUNTLET_ROSTER_CAP, "still capped — merge added no slot");
        assert.equal(petStar(run, firstId), 2, "full-roster merge still leveled it up");
    });

    it("Beast Bond discounts the merge cost (offerCost + buyOffer)", () => {
        assert.equal(mergeDiscountFromRelics([]), 0);
        assert.equal(mergeDiscountFromRelics(["beast_bond"] as RelicId[]), 2);
        let run = { ...startGauntletRun(42), valor: 99, relics: ["beast_bond"] as RelicId[] };
        const origOffer = run.shop[0];
        run = buyOffer(run, 0);                          // own one copy (first buy, not a merge)
        run = { ...run, shop: [origOffer] };             // re-offer the same template → a merge
        const expected = Math.max(0, origOffer.cost - 2);
        assert.equal(offerCost(run, origOffer), expected, "offerCost reflects the Beast Bond discount");
        const valorBefore = run.valor;
        run = buyOffer(run, 0);
        assert.equal(run.valor, valorBefore - expected, "merge charged the discounted cost");
        assert.equal(petStar(run, run.roster[0].id), 2, "still merged");
    });

    it("releasePet clears the merge rank", () => {
        let run = { ...startGauntletRun(42), valor: 99 };
        const template = run.shop[0].pet;
        run = buyOffer(run, 0);
        const id = run.roster[0].id;
        run = buyOffer({ ...run, shop: [{ pet: template, cost: 3 }] }, 0);
        assert.equal(petStar(run, id), 2);
        run = releasePet(run, id);
        assert.equal(petStar(run, id), 1, "rank resets once the pet leaves the roster");
    });
});

describe("buyItem", () => {
    it("Mend restores a heart, costs valor, and won't over-heal", () => {
        const run = { ...startGauntletRun(1), valor: 99, hearts: 1 };
        const after = buyItem(run, "mend");
        assert.equal(after.hearts, 2, "heart restored");
        assert.equal(after.itemsBought.mend, 1);
        assert.ok(after.valor < run.valor, "valor spent");
        const full = buyItem({ ...startGauntletRun(1), valor: 99 }, "mend");
        assert.equal(full.valor, 99, "no buy / no spend when already at full hearts");
    });

    it("stat items add a run-wide buff with rising cost", () => {
        const def = GAUNTLET_ITEMS.find((d) => d.id === "whetstone")!;
        let run = { ...startGauntletRun(1), valor: 999 };
        const c0 = itemCost(def, 0);
        run = buyItem(run, "whetstone");
        assert.ok(run.buffs.atk > 0, "attack buff applied");
        assert.equal(run.valor, 999 - c0);
        const c1 = itemCost(def, 1);
        assert.ok(c1 > c0, "second purchase costs more");
    });

    it("blocks a buy with insufficient valor", () => {
        const run = { ...startGauntletRun(1), valor: 0 };
        assert.equal(buyItem(run, "vigor").buffs.hp, 0);
    });
});

describe("buyRelic / relic economy", () => {
    it("buys a stat relic: spends valor, owns it once, folds into the squad buffs", () => {
        let run = { ...startGauntletRun(1), valor: 99, relicShop: ["razor_fang", "titan_heart"] as RelicId[] };
        run = buyRelic(run, "razor_fang");
        assert.ok(run.relics.includes("razor_fang"));
        assert.ok(run.buffs.atk > 0, "attack buff folded into run buffs");
        assert.equal(run.relicShop.includes("razor_fang"), false, "leaves the relic shelf");
        const cost = GAUNTLET_RELICS.find((r) => r.id === "razor_fang")!.cost;
        assert.equal(run.valor, 99 - cost);
        assert.equal(buyRelic(run, "razor_fang").relics.filter((r) => r === "razor_fang").length, 1, "can't own twice");
    });

    it("Merchant's Charm pays Valor each round; Lucky Coin frees the first reroll", () => {
        let run = beginFight({ ...startGauntletRun(2), relics: ["merchant_charm"] as RelicId[], fieldIds: ["x"], roster: [{ id: "x" } as never] });
        const before = run.valor;
        run = applyRoundResult(run, true);
        assert.equal(run.valor, before + (4 + 1) + 3, "round-1 reward (5) + 3 Valor income");

        let r2 = { ...startGauntletRun(3), valor: 5, relics: ["lucky_coin"] as RelicId[] };
        const v0 = r2.valor;
        r2 = rerollShop(r2);
        assert.equal(r2.valor, v0, "first reroll free with Lucky Coin");
        r2 = rerollShop(r2);
        assert.equal(r2.valor, v0 - 1, "second reroll costs Valor");
    });

    it("boardModsFromRelics merges only the combat relics", () => {
        const m = boardModsFromRelics(["stoneward", "vampiric_fang", "phoenix_plume"]);
        assert.equal(m.shieldStartFrac, 0.15);
        assert.equal(m.lifestealPct, 0.15);
        assert.equal(m.reviveCharges, 1);
        assert.equal(m.reviveHpFrac, 0.35);
        assert.deepEqual(
            boardModsFromRelics(["titan_heart", "merchant_charm"]),
            { shieldStartFrac: 0, reflectPct: 0, chainPct: 0, lifestealPct: 0, reviveCharges: 0, reviveHpFrac: 0 },
            "stat/economy relics contribute no board mods",
        );
    });
});

describe("buyPremium (Valor → Fate Shard / Bone Charm)", () => {
    it("is locked until round 9 is cleared", () => {
        const early = { ...startGauntletRun(1), valor: 99, roundsCleared: 5 };
        assert.equal(premiumUnlocked(early), false);
        assert.equal(buyPremium(early, "fateShard").boughtFateShard, false, "no buy before round 9");
        assert.equal(buyPremium(early, "fateShard").valor, 99, "no valor spent");
    });

    it("after clearing round 9, buys once, spends valor, sets the flag", () => {
        let run = { ...startGauntletRun(1), valor: 99, roundsCleared: 9 };
        assert.equal(premiumUnlocked(run), true);
        run = buyPremium(run, "fateShard");
        assert.equal(run.boughtFateShard, true);
        assert.equal(run.valor, 99 - GAUNTLET_SHARD_COST);
        // second buy of the same currency is a no-op (one per run)
        const again = buyPremium(run, "fateShard");
        assert.equal(again.valor, run.valor, "can't buy a 2nd fate shard this run");
        // bone charm is a separate buy
        const withCharm = buyPremium(run, "boneCharm");
        assert.equal(withCharm.boughtBoneCharm, true);
    });

    it("blocks a buy with insufficient valor", () => {
        const run = { ...startGauntletRun(1), valor: 0, roundsCleared: GAUNTLET_PREMIUM_ROUND };
        assert.equal(buyPremium(run, "boneCharm").boughtBoneCharm, false);
    });
});

describe("applyGauntletBuffs", () => {
    it("scales squad stats by the accumulated buffs (and is a no-op when empty)", () => {
        const pets: Pet[] = [{ id: "p", hp: 100, attack: 50, defense: 20, speed: 10 } as Pet];
        assert.equal(applyGauntletBuffs(pets, { atk: 0, def: 0, hp: 0, spd: 0 })[0].attack, 50, "empty buffs no-op");
        const boosted = applyGauntletBuffs(pets, { atk: 0.1, def: 0.5, hp: 0.2, spd: 0.3 })[0];
        assert.equal(boosted.attack, 55);
        assert.equal(boosted.hp, 120);
        assert.equal(boosted.defense, 30);
        assert.equal(boosted.speed, 13);
    });
});

describe("rerollShop", () => {
    it("costs valor and produces a fresh, deterministic shop", () => {
        const run = startGauntletRun(5);
        const r1 = rerollShop(run);
        assert.equal(r1.valor, run.valor - 1);
        const r1again = rerollShop(startGauntletRun(5));
        assert.deepEqual(r1.shop.map((o) => o.pet.id), r1again.shop.map((o) => o.pet.id), "reroll is reproducible");
    });
});

describe("setField / releasePet / fieldedPets", () => {
    it("fields chosen roster pets (lead first) and release pulls them from field", () => {
        let run = { ...startGauntletRun(11), valor: 999 };
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
        assert.equal(enemySquadForRound(run).length, 2, "early rounds field a small squad");
        assert.equal(enemySquadForRound({ ...run, round: 7 }).length, 5, "late rounds field a full squad");
        assert.deepEqual(
            enemySquadForRound(run).map((p) => p.id),
            enemySquadForRound(startGauntletRun(3)).map((p) => p.id),
            "same seed+round → same enemies",
        );
    });
});

describe("applyRoundResult", () => {
    it("a win advances the round, pays valor, and counts a cleared round", () => {
        let run = beginFight({ ...startGauntletRun(8), fieldIds: ["x"], roster: [{ id: "x" } as never] });
        const before = run.valor;
        run = applyRoundResult(run, true);
        assert.equal(run.round, 2);
        assert.equal(run.roundsCleared, 1);
        assert.equal(run.status, "drafting");
        assert.ok(run.valor > before, "won round pays valor");
    });

    it("a loss costs a heart; 0 hearts ends the run", () => {
        let run = beginFight({ ...startGauntletRun(8), hearts: 1, fieldIds: ["x"], roster: [{ id: "x" } as never] });
        run = applyRoundResult(run, false);
        assert.equal(run.hearts, 0);
        assert.equal(run.status, "lost");
    });

    it("a surviving loss does NOT advance the round and pays a little Valor", () => {
        let run = beginFight({ ...startGauntletRun(8), hearts: 2, round: 3, valor: 0, fieldIds: ["x"], roster: [{ id: "x" } as never] });
        run = applyRoundResult(run, false);
        assert.equal(run.round, 3, "stays on the same round to retry");
        assert.equal(run.hearts, 1, "still costs a heart");
        assert.equal(run.status, "drafting");
        assert.equal(run.roundsCleared, 0, "a loss clears no round");
        assert.equal(run.valor, GAUNTLET_LOSS_VALOR, "a little consolation Valor");
    });

    it("clearing the final round wins the run", () => {
        let run = beginFight({ ...startGauntletRun(8), round: GAUNTLET_MAX_ROUNDS, fieldIds: ["x"], roster: [{ id: "x" } as never] });
        run = applyRoundResult(run, true);
        assert.equal(run.status, "won");
    });
});
