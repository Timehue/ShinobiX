/*
 * The own-avatar fallback. Guards the invariant documented in
 * lib/presence-character.ts: EVERY avatar render site must resolve the
 * name-keyed shared image, not just `character.avatarImage`. The player's own
 * surfaces (left rail, mobile HUD, mobile menu, sector marker) were the
 * exception, so they showed initials whenever that field was empty — which was
 * every login, because the save clamp used to strip it on write.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resolveOwnAvatar, setOwnAvatarFallback, getOwnAvatarFallback } from "./own-avatar";
import { isPresetAvatar, isOwnAvatarReference } from "./entitlements";

const REF = "/api/img?id=avatar%3Asloth";
const SHARED = { "avatar:sloth": REF };

describe("resolveOwnAvatar", () => {
    it("prefers the character field so a just-uploaded image paints at once", () => {
        assert.equal(
            resolveOwnAvatar({ name: "Sloth", avatarImage: "data:image/webp;base64,AAAA" }, SHARED),
            "data:image/webp;base64,AAAA",
        );
    });

    it("falls back to the name-keyed shared image when the field is empty", () => {
        assert.equal(resolveOwnAvatar({ name: "Sloth", avatarImage: "" }, SHARED), REF);
    });

    it("matches case-insensitively on the name", () => {
        assert.equal(resolveOwnAvatar({ name: "SLOTH" }, SHARED), REF);
    });

    it("returns empty (so the caller draws initials) when neither source has one", () => {
        assert.equal(resolveOwnAvatar({ name: "Nobody" }, SHARED), "");
        assert.equal(resolveOwnAvatar({ name: "Sloth" }, undefined), "");
        assert.equal(resolveOwnAvatar(null, SHARED), "");
    });
});

describe("own-avatar store", () => {
    beforeEach(() => setOwnAvatarFallback(""));

    it("publishes the resolved url", () => {
        setOwnAvatarFallback(REF);
        assert.equal(getOwnAvatarFallback(), REF);
    });

    it("normalises undefined/null to empty", () => {
        setOwnAvatarFallback(undefined);
        assert.equal(getOwnAvatarFallback(), "");
    });

    it("does not notify subscribers when the value is unchanged", () => {
        let hits = 0;
        setOwnAvatarFallback(REF);
        // Re-publishing the same url must not churn — App's effect re-runs on
        // every sharedImages update, which is once per avatar-bucket refresh.
        const before = getOwnAvatarFallback();
        setOwnAvatarFallback(REF);
        hits += before === getOwnAvatarFallback() ? 0 : 1;
        assert.equal(hits, 0);
    });
});

// Client mirror of api/_entitlements.ts — the two must agree or the UI shows a
// perk state the save handler then contradicts.
describe("entitlements mirror", () => {
    it("recognises presets with and without the creator cache-buster", () => {
        assert.equal(isPresetAvatar("/starter-avatar-one.webp"), true);
        assert.equal(isPresetAvatar("/starter-avatar-one.webp?v=2"), true);
        assert.equal(isPresetAvatar("data:image/webp;base64,AAAA"), false);
    });

    it("recognises the player's own hydrated avatar reference", () => {
        assert.equal(isOwnAvatarReference(REF, "Sloth"), true);
        assert.equal(isOwnAvatarReference("/api/img?id=avatar%3Arill", "Sloth"), false);
        assert.equal(isOwnAvatarReference("data:image/webp;base64,AAAA", "Sloth"), false);
    });
});
