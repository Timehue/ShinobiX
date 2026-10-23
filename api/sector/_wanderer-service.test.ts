import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    FAVOR_RYO_SPREAD,
    wandererFavorReward,
    wandererFavorTargetSector,
    wandererMedicOffer,
    wandererMerchantOffer,
} from "./_wanderer-service.js";
import { MAX_WILD_SECTOR } from "../../shared/sector-geo.js";
import { anchorRyoPerMinute } from "../../shared/economy-anchor.js";

describe("wanderer merchant service", () => {
    it("sells a bounded bone-charm bundle for deterministic ryo", () => {
        const a = wandererMerchantOffer(30, "w-7-1-0");
        const b = wandererMerchantOffer(30, "w-7-1-0");
        assert.deepEqual(a, b);
        assert.ok(a.boneCharms >= 2 && a.boneCharms <= 5);
        assert.ok(a.cost > 0);
        assert.ok(wandererMerchantOffer(90, "w-7-1-0").cost > a.cost);
    });
});

describe("wanderer medic service", () => {
    it("prices missing hp/chakra/stamina and reports what will be restored", () => {
        const offer = wandererMedicOffer(40, 100, 1000, 50, 300, 4, 24);
        assert.equal(offer.missingHp, 900);
        assert.equal(offer.missingChakra, 250);
        assert.equal(offer.missingStamina, 20);
        assert.ok(offer.cost > 160);
    });

    it("stays bounded for very large pools", () => {
        const offer = wandererMedicOffer(100, 0, 1_000_000, 0, 1_000_000, 0, 1_000_000);
        assert.equal(offer.cost, 25_000);
    });
});

describe("wanderer favor chain", () => {
    it("chooses a deterministic different sector", () => {
        const target = wandererFavorTargetSector("favor-a", 12);
        assert.equal(target, wandererFavorTargetSector("favor-a", 12));
        assert.ok(target >= 1 && target <= MAX_WILD_SECTOR);
        assert.notEqual(target, 12);
        for (let i = 0; i < 500; i += 1) {
            assert.notEqual(wandererFavorTargetSector(`favor-${i}`, 12), 54);
        }
    });

    it("reaches the outer sectors 61-66, not only the first 60", () => {
        // A stale SECTOR_COUNT = 60 default kept every favour out of 61-66.
        const targets = Array.from({ length: 500 }, (_, i) => wandererFavorTargetSector(`favor-${i}`, 12));
        assert.ok(targets.some((t) => t >= 61 && t <= MAX_WILD_SECTOR), "some favour targets an outer sector");
        assert.ok(targets.every((t) => t >= 1 && t <= MAX_WILD_SECTOR && t !== 54 && t !== 12));
    });

    it("pays two anchor minutes plus 10, a 0-95 spread and 1-2 bone charms", () => {
        // 0.5 x (100 + 16 x min(L, 70)) + (h % 96). The old formula paid 915 here.
        assert.deepEqual(wandererFavorReward(45, "favor-a"), { ryo: 443, boneCharms: 2 });
        assert.deepEqual(wandererFavorReward(45, "favor-b"), { ryo: 482, boneCharms: 1 });
        assert.equal(wandererFavorReward(70, "favor-a").ryo, 643);
        assert.equal(wandererFavorReward(100, "favor-a").ryo, 643, "frozen at L70 with the anchor");
        for (let i = 0; i < 500; i++) {
            const r1 = wandererFavorReward(1, `f-${i}`).ryo;
            const r10 = wandererFavorReward(10, `f-${i}`).ryo;
            assert.ok(r1 >= 58 && r1 <= 153, `L1 ${r1}`);
            assert.ok(r10 >= 130 && r10 <= 225, `L10 ${r10}`);
            const { boneCharms } = wandererFavorReward(30, `f-${i}`);
            assert.ok(boneCharms >= 1 && boneCharms <= 2);
        }
        let sum = 0;
        for (let i = 0; i < 4000; i++) sum += wandererFavorReward(50, `m-${i}`).ryo;
        assert.ok(Math.abs(sum / 4000 - 497.5) < 6, `L50 mean ${sum / 4000}`);
        assert.equal(FAVOR_RYO_SPREAD, 96);
    });

    it("stays inside the core band of 0.85-1.20x the anchor from L30, at two minutes a favour", () => {
        for (const level of [30, 50, 70, 90, 100]) {
            let sum = 0;
            for (let i = 0; i < 4000; i++) sum += wandererFavorReward(level, `band-${i}`).ryo;
            const perMinute = sum / 4000 / 2 / anchorRyoPerMinute(level);
            assert.ok(perMinute >= 0.85 && perMinute <= 1.21, `L${level}: ${perMinute.toFixed(2)}x A(L)`);
        }
    });

    it("reads a missing or junk level as L1", () => {
        for (const bad of [undefined, null, 0, -5, "x"]) assert.equal(wandererFavorReward(bad, "favor-a").ryo, 91);
    });
});
