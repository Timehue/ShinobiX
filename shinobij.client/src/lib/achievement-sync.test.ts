import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
    achievementPatchFromSync,
    achievementSyncSignature,
    claimAchievementSync,
    createAchievementSyncGate,
    planAchievementSync,
    releaseAchievementSync,
    syncedToastIds,
    versionedAchievementMutationFromSync,
} from "./achievement-sync.js";

const plan = (over: Partial<Parameters<typeof planAchievementSync>[0]> = {}) => planAchievementSync({
    eligibleIds: [],
    unlocked: [],
    earnedTitles: [],
    titlesForUnlocked: [],
    ...over,
});

describe("planAchievementSync", () => {
    it("reports eligible ids the save has not recorded yet", () => {
        const p = plan({ eligibleIds: ["a", "b", "c"], unlocked: ["a"] });
        assert.deepEqual(p.pendingIds, ["b", "c"]);
        assert.equal(p.needed, true);
    });

    it("needs no sync once the save already holds every eligible id and title", () => {
        const p = plan({ eligibleIds: ["a", "b"], unlocked: ["a", "b"], earnedTitles: ["T"], titlesForUnlocked: ["T"] });
        assert.deepEqual(p.pendingIds, []);
        assert.equal(p.titlesStale, false);
        assert.equal(p.needed, false);
    });

    it("treats an undefined unlock array as a full backfill", () => {
        const p = plan({ eligibleIds: ["a", "b"], unlocked: undefined });
        assert.deepEqual(p.pendingIds, ["a", "b"]);
        assert.equal(p.uninitialized, true);
        assert.equal(p.needed, true);
    });

    it("syncs a brand-new save even with nothing eligible yet, to seed the ledger", () => {
        // The server's FIRST sync is a backfill that pays and toasts nothing. If we
        // deferred it until the first unlock, that unlock would be silently
        // absorbed as backfill instead of being rewarded and celebrated. So an
        // uninitialized save is worth a sync on its own.
        const p = plan({ eligibleIds: [], unlocked: undefined });
        assert.deepEqual(p.pendingIds, []);
        assert.equal(p.titlesStale, false);
        assert.equal(p.uninitialized, true);
        assert.equal(p.needed, true);
    });

    it("an initialized-but-empty unlock array needs no sync", () => {
        const p = plan({ eligibleIds: [], unlocked: [] });
        assert.equal(p.uninitialized, false);
        assert.equal(p.needed, false);
    });

    it("distinguishes the seeding sync from a later identical-pending sync", () => {
        // Same pending ids, but one is the uninitialized backfill and one is a real
        // unlock — they must not share a signature or the second would be skipped.
        const seeding = achievementSyncSignature("rill", plan({ eligibleIds: ["a"], unlocked: undefined }));
        const real = achievementSyncSignature("rill", plan({ eligibleIds: ["a"], unlocked: [] }));
        assert.notEqual(seeding, real);
    });

    it("still syncs when unlocks are stored but an implied title is missing", () => {
        // earnedTitles became server-owned after some saves were written; generic
        // saves cannot backfill it, so pendingIds alone would never repair these.
        const p = plan({ eligibleIds: ["a"], unlocked: ["a"], earnedTitles: [], titlesForUnlocked: ["Champion"] });
        assert.deepEqual(p.pendingIds, []);
        assert.equal(p.titlesStale, true);
        assert.equal(p.needed, true);
    });

    it("does not consider titles stale when they are already present", () => {
        const p = plan({ eligibleIds: ["a"], unlocked: ["a"], earnedTitles: ["Champion"], titlesForUnlocked: ["Champion"] });
        assert.equal(p.needed, false);
    });
});

describe("achievementSyncSignature", () => {
    it("is stable regardless of pending id order and player casing", () => {
        const a = achievementSyncSignature("Rill", plan({ eligibleIds: ["b", "a"], unlocked: [] }));
        const b = achievementSyncSignature("rill", plan({ eligibleIds: ["a", "b"], unlocked: [] }));
        assert.equal(a, b);
    });

    it("differs when the divergence differs", () => {
        const one = achievementSyncSignature("rill", plan({ eligibleIds: ["a"], unlocked: [] }));
        const two = achievementSyncSignature("rill", plan({ eligibleIds: ["a", "b"], unlocked: [] }));
        assert.notEqual(one, two);
    });
});

describe("claimAchievementSync — the save-churn guard", () => {
    it("permits exactly one request per distinct divergence", () => {
        const gate = createAchievementSyncGate();
        const p = plan({ eligibleIds: ["a"], unlocked: [] });
        assert.equal(claimAchievementSync(gate, "rill", p), true);
        releaseAchievementSync(gate);
        assert.equal(claimAchievementSync(gate, "rill", p), false);
    });

    it("REGRESSION: a server that never persists cannot become a request loop", () => {
        // The shipped bug: the effect re-ran on every character change, the server
        // reply did not persist the unlock, so the same sync fired again and again
        // — hammering /api/save into 409s then 429s and re-rendering mid-combat.
        // Here the character never changes (unlock still pending) across 50
        // re-renders; exactly one request may be issued.
        const gate = createAchievementSyncGate();
        let requests = 0;
        for (let i = 0; i < 50; i++) {
            const p = plan({ eligibleIds: ["first-blood"], unlocked: [] }); // never persisted
            if (claimAchievementSync(gate, "rill", p)) requests++;
            releaseAchievementSync(gate);
        }
        assert.equal(requests, 1);
    });

    it("refuses to issue a second request while one is outstanding", () => {
        const gate = createAchievementSyncGate();
        assert.equal(claimAchievementSync(gate, "rill", plan({ eligibleIds: ["a"], unlocked: [] })), true);
        // No release: a concurrent re-render must not fire a parallel sync, even
        // for a different divergence.
        assert.equal(claimAchievementSync(gate, "rill", plan({ eligibleIds: ["a", "b"], unlocked: [] })), false);
    });

    it("allows a genuinely new unlock after the previous sync settled", () => {
        const gate = createAchievementSyncGate();
        assert.equal(claimAchievementSync(gate, "rill", plan({ eligibleIds: ["a"], unlocked: [] })), true);
        releaseAchievementSync(gate);
        // 'a' persisted, 'b' just unlocked — a different divergence, so it syncs.
        assert.equal(claimAchievementSync(gate, "rill", plan({ eligibleIds: ["a", "b"], unlocked: ["a"] })), true);
    });

    it("never fires when nothing diverges, or without a player name", () => {
        const gate = createAchievementSyncGate();
        assert.equal(claimAchievementSync(gate, "rill", plan()), false);
        assert.equal(claimAchievementSync(gate, "", plan({ eligibleIds: ["a"], unlocked: [] })), false);
    });
});

describe("achievementPatchFromSync", () => {
    it("copies the authoritative fields the server returned", () => {
        const patch = achievementPatchFromSync({
            character: {
                unlockedAchievements: ["a", "b"],
                achievementUnlockedAt: { a: 111 },
                earnedTitles: ["Champion"],
                ryo: 500,
                fateShards: 3,
            },
        });
        assert.deepEqual(patch, {
            unlockedAchievements: ["a", "b"],
            achievementUnlockedAt: { a: 111 },
            earnedTitles: ["Champion"],
            ryo: 500,
            fateShards: 3,
        });
    });

    it("REGRESSION: wallet fields are absolute server values, never deltas", () => {
        // Applying a reward as `c.ryo + reward` re-paid it on every repeated or
        // late reply. An absolute value is idempotent by construction.
        const data = { character: { unlockedAchievements: ["a"], ryo: 500, fateShards: 3 } };
        const first = achievementPatchFromSync(data);
        const second = achievementPatchFromSync(data);
        assert.equal(first?.ryo, 500);
        assert.equal(second?.ryo, 500, "a second application must not accumulate");
    });

    it("returns null when the reply carries no achievement state", () => {
        assert.equal(achievementPatchFromSync(null), null);
        assert.equal(achievementPatchFromSync({}), null);
        assert.equal(achievementPatchFromSync({ character: {} }), null);
        assert.equal(achievementPatchFromSync({ character: { unlockedAchievements: "nope" } }), null);
    });

    it("drops non-string ids, non-numeric stamps, and non-finite wallet values", () => {
        const patch = achievementPatchFromSync({
            character: {
                unlockedAchievements: ["a", 7, null, "b"],
                achievementUnlockedAt: { a: 1, b: "x", c: NaN },
                ryo: NaN,
                fateShards: "5",
            },
        });
        assert.deepEqual(patch?.unlockedAchievements, ["a", "b"]);
        assert.deepEqual(patch?.achievementUnlockedAt, { a: 1 });
        assert.equal(patch?.ryo, undefined);
        assert.equal(patch?.fateShards, undefined);
    });

    it("omits earnedTitles entirely when the server did not send it", () => {
        const patch = achievementPatchFromSync({ character: { unlockedAchievements: ["a"] } });
        assert.ok(patch);
        assert.equal("earnedTitles" in patch!, false, "must not clobber local titles with undefined");
    });
});

describe("versionedAchievementMutationFromSync", () => {
    it("REGRESSION: a new-account v2 achievement backfill becomes the next autosave base", () => {
        // First full save committed v1. The automatic achievement backfill then
        // mutated that stored save to v2 before the dirty autosave ran.
        const liveCharacter = {
            name: "CohesionQA812",
            level: 1,
            storyProgress: 0,
            tileCards: [],
            pendingLocalChoice: "protect-this-unrelated-local-field",
        };
        const mutation = versionedAchievementMutationFromSync(liveCharacter, {
            _saveVersion: 2,
            character: {
                unlockedAchievements: [],
                achievementUnlockedAt: {},
                earnedTitles: [],
                ryo: 100,
                fateShards: 0,
            },
        });

        assert.ok(mutation);
        assert.equal(mutation._saveVersion, 2, "the next full save must echo v2, not the stale first-save v1");
        assert.equal(mutation.character.pendingLocalChoice, liveCharacter.pendingLocalChoice,
            "an in-flight server reply must not replace unrelated live progress");
        assert.deepEqual(mutation.character.unlockedAchievements, []);
        assert.equal(({ ...mutation.character, _baseSaveVersion: mutation._saveVersion })._baseSaveVersion, 2);
    });

    it("fails closed when a character-bearing mutation omits its authoritative version", () => {
        assert.equal(versionedAchievementMutationFromSync(
            { name: "CohesionQA812" },
            { character: { unlockedAchievements: [] } },
        ), null);
    });

    it("wires the automatic achievement response through App's atomic character+version gate", () => {
        const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
        const start = app.indexOf("const data = await res.json() as AchievementSyncResponse;");
        const end = app.indexOf("} catch", start);
        assert.ok(start >= 0 && end > start, "achievement response block must remain discoverable");
        const responseBlock = app.slice(start, end);
        assert.match(responseBlock, /versionedAchievementMutationFromSync\(characterRef\.current, data\)/);
        assert.match(responseBlock, /commitVersionedCharacter\(mutation\.character, mutation\._saveVersion\)/);
        assert.doesNotMatch(responseBlock, /setCharacter\(/,
            "split character-only adoption recreates the v1-to-v2 first-session conflict");
    });
});

describe("syncedToastIds", () => {
    it("returns the server's newly-unlocked ids, filtered to strings", () => {
        assert.deepEqual(syncedToastIds({ newlyUnlocked: ["a", 2, "b"] }), ["a", "b"]);
        assert.deepEqual(syncedToastIds({}), []);
        assert.deepEqual(syncedToastIds(null), []);
    });
});
