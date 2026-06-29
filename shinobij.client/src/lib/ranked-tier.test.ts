import { test } from "node:test";
import assert from "node:assert/strict";
import { eloTier, rankTierProgress, RANK_TIERS } from "./ranked-tier";

test("eloTier maps representative ratings to the right tier", () => {
    assert.equal(eloTier(0).key, "novice");
    assert.equal(eloTier(999).key, "novice");
    assert.equal(eloTier(1000).key, "adept"); // the unrated default
    assert.equal(eloTier(1200).key, "veteran");
    assert.equal(eloTier(1400).key, "expert");
    assert.equal(eloTier(1500).key, "master");
    assert.equal(eloTier(1700).key, "grandmaster");
    assert.equal(eloTier(2400).key, "legend");
});

test("ranked tiers never reuse a reserved village career rank / role", () => {
    // A ranked tier is dueling SKILL, not an in-world office — Kage especially is
    // a single reserved title, so none of these may appear as a ladder tier.
    const reserved = ["genin", "chunin", "chūnin", "jonin", "jōnin", "anbu", "sannin", "kage"];
    for (const t of RANK_TIERS) {
        assert.ok(!reserved.includes(t.key.toLowerCase()), `tier key "${t.key}" collides with a career rank`);
        assert.ok(!reserved.includes(t.name.toLowerCase().replace(/[- ].*$/, "")), `tier name "${t.name}" collides with a career rank`);
    }
});

test("eloTier is monotonic across the whole ladder and handles bad input", () => {
    let last = -1;
    for (let r = 0; r <= 2600; r += 25) {
        const idx = RANK_TIERS.findIndex((t) => t.key === eloTier(r).key);
        assert.ok(idx >= last, `tier must not regress as rating climbs (rating ${r})`);
        last = idx;
    }
    assert.equal(eloTier(Number.NaN).key, "adept"); // NaN falls back to 1000
});

test("rankTierProgress: top tier is 100% with no next, mid tier interpolates", () => {
    const top = rankTierProgress(2000);
    assert.equal(top.tier.key, "legend");
    assert.equal(top.next, null);
    assert.equal(top.pct, 100);

    const mid = rankTierProgress(1075); // adept(1000)→veteran(1150), halfway = 50%
    assert.equal(mid.tier.key, "adept");
    assert.equal(mid.next?.key, "veteran");
    assert.equal(mid.pct, 50);
});
