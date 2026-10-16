import test from "node:test";
import assert from "node:assert/strict";
import { PLAY_GAMES_REWARD_PRODUCTS } from "../../../shared/play-games-rewards";
import { describePlayRewardBundle, playRewardLabelForProduct } from "./google-play-games";

test("every server Play reward product is claimable from the app with the same label", () => {
    for (const product of PLAY_GAMES_REWARD_PRODUCTS) {
        assert.equal(playRewardLabelForProduct(product.productId), product.label, product.productId);
    }
});

test("the pre-registration box describes every part of its payout", () => {
    assert.equal(
        describePlayRewardBundle({ ryo: 10_000, fateShards: 50, boneCharms: 10, supporterDays: 14 }),
        `${(10_000).toLocaleString()} Ryo, 50 Fate Shards, 10 Bone Charms and 14 days of Shinobi Supporter`,
    );
    assert.equal(describePlayRewardBundle({ ryo: 0, fateShards: 5, boneCharms: 0, supporterDays: 0 }), "5 Fate Shards");
});
