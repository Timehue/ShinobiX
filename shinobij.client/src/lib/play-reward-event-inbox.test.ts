import test from "node:test";
import assert from "node:assert/strict";
import { createPlayRewardEventInbox } from "./play-reward-event-inbox";

test("native reward receipts arriving before the lazy platform chunk are retained once", () => {
    const inbox = createPlayRewardEventInbox();
    const receipt = { productId: "sj_reward_title_dawn", purchaseToken: "token-with-more-than-16-bytes" };
    inbox.capture([receipt]);
    inbox.capture({ malformed: true });
    assert.deepEqual(inbox.take(), [[receipt]]);
    inbox.capture([receipt]);
    assert.deepEqual(inbox.take(), []);
});
