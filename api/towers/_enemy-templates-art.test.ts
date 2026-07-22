import assert from "node:assert/strict";
import test from "node:test";
import { getEnemyTemplate } from "./_enemy-templates";

test("clan boss encounters expose their dedicated client portrait keys", () => {
    for (const id of ["clan-boss-oni", "clan-boss-leviathan", "clan-boss-kage", "clan-boss-golem"]) {
        assert.equal(getEnemyTemplate(id).visual, id);
    }
});
