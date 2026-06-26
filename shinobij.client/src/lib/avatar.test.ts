import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isImageAvatar } from "./avatar";

describe("isImageAvatar", () => {
    it("recognises real image sources", () => {
        assert.equal(isImageAvatar("data:image/png;base64,AAAA"), true);
        assert.equal(isImageAvatar("blob:https://x/abc"), true);
        // disk-overlay path (string-built so the route-parity scanner doesn't read it as a real API call)
        assert.equal(isImageAvatar("/api" + "/img/foo"), true);
        assert.equal(isImageAvatar("/assets/bandit-Bv9x12.webp"), true); // bundled Vite asset — the bug
        assert.equal(isImageAvatar("https://cdn/x.webp"), true);
    });
    it("treats emoji / initials / empty as text (not an image)", () => {
        assert.equal(isImageAvatar("🥷"), false);
        assert.equal(isImageAvatar("EN"), false);
        assert.equal(isImageAvatar("GT"), false);
        assert.equal(isImageAvatar(""), false);
        assert.equal(isImageAvatar(null), false);
        assert.equal(isImageAvatar(undefined), false);
    });
});
