"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _wanderer_service_js_1 = require("./_wanderer-service.js");
(0, node_test_1.describe)("wanderer merchant service", () => {
    (0, node_test_1.it)("sells a bounded bone-charm bundle for deterministic ryo", () => {
        const a = (0, _wanderer_service_js_1.wandererMerchantOffer)(30, "w-7-1-0");
        const b = (0, _wanderer_service_js_1.wandererMerchantOffer)(30, "w-7-1-0");
        node_assert_1.strict.deepEqual(a, b);
        node_assert_1.strict.ok(a.boneCharms >= 2 && a.boneCharms <= 5);
        node_assert_1.strict.ok(a.cost > 0);
        node_assert_1.strict.ok((0, _wanderer_service_js_1.wandererMerchantOffer)(90, "w-7-1-0").cost > a.cost);
    });
});
(0, node_test_1.describe)("wanderer medic service", () => {
    (0, node_test_1.it)("prices missing hp/chakra/stamina and reports what will be restored", () => {
        const offer = (0, _wanderer_service_js_1.wandererMedicOffer)(40, 100, 1000, 50, 300, 4, 24);
        node_assert_1.strict.equal(offer.missingHp, 900);
        node_assert_1.strict.equal(offer.missingChakra, 250);
        node_assert_1.strict.equal(offer.missingStamina, 20);
        node_assert_1.strict.ok(offer.cost > 160);
    });
    (0, node_test_1.it)("stays bounded for very large pools", () => {
        const offer = (0, _wanderer_service_js_1.wandererMedicOffer)(100, 0, 1_000_000, 0, 1_000_000, 0, 1_000_000);
        node_assert_1.strict.equal(offer.cost, 25_000);
    });
});
(0, node_test_1.describe)("wanderer favor chain", () => {
    (0, node_test_1.it)("chooses a deterministic different sector", () => {
        const target = (0, _wanderer_service_js_1.wandererFavorTargetSector)("favor-a", 12);
        node_assert_1.strict.equal(target, (0, _wanderer_service_js_1.wandererFavorTargetSector)("favor-a", 12));
        node_assert_1.strict.ok(target >= 1 && target <= 60);
        node_assert_1.strict.notEqual(target, 12);
    });
    (0, node_test_1.it)("rewards modest ryo and 1-2 bone charms", () => {
        const reward = (0, _wanderer_service_js_1.wandererFavorReward)(45, "favor-a");
        node_assert_1.strict.ok(reward.ryo > 0);
        node_assert_1.strict.ok(reward.boneCharms >= 1 && reward.boneCharms <= 2);
    });
});
