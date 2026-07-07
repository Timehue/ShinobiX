import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    wandererFavorReward,
    wandererFavorTargetSector,
    wandererMedicOffer,
    wandererMerchantOffer,
} from "./_wanderer-service.js";

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
        assert.ok(target >= 1 && target <= 60);
        assert.notEqual(target, 12);
    });

    it("rewards modest ryo and 1-2 bone charms", () => {
        const reward = wandererFavorReward(45, "favor-a");
        assert.ok(reward.ryo > 0);
        assert.ok(reward.boneCharms >= 1 && reward.boneCharms <= 2);
    });
});
