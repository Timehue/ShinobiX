import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNoticePosts } from "./clan-notices";

test("an order stored with the squad's short-lived name shows the Anbu title", () => {
    const [order] = normalizeNoticePosts([{ id: "o1", type: "order", title: "Hold", body: "Hold the bridge", author: "Rin", authorRole: "Hush", createdAt: 1 }]);
    assert.equal(order.authorRole, "Anbu");
});

test("other author roles pass through unchanged", () => {
    const posts = normalizeNoticePosts(["Kage", "Village Elder", "Anbu", undefined].map((authorRole, i) => ({ id: `o${i}`, title: "t", body: "b", author: "Rin", authorRole, createdAt: i })));
    assert.deepEqual(posts.map(post => post.authorRole).sort(), ["Anbu", "Kage", "System", "Village Elder"]);
});
