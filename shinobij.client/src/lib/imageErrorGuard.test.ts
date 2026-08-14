import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    canonicalImageRetrySource,
    imageRetryLimitForSource,
    isRetryableImageSource,
    nextImageRetrySource,
} from "./imageErrorGuard";

const PAGE = "https://shinobijourney.com/arena";

describe("PvE image retry URLs", () => {
    it("retries same-origin game images but never arbitrary external sources", () => {
        assert.equal(isRetryableImageSource("/api/img?id=ai%3Araiko", PAGE), true);
        assert.equal(isRetryableImageSource("/assets/avatar-abcd1234.webp", PAGE), true);
        assert.equal(isRetryableImageSource("https://example.com/api/img?id=ai%3Araiko", PAGE), false);
        assert.equal(isRetryableImageSource("data:image/png;base64,YQ==", PAGE), false);
        assert.equal(isRetryableImageSource("not a valid url", "not a valid base"), false);
    });

    it("gives dynamic image storage an extra retry", () => {
        assert.equal(imageRetryLimitForSource("/api/img?id=ai%3Araiko", PAGE), 2);
        assert.equal(imageRetryLimitForSource("/scenes/intro.webp", PAGE), 1);
        assert.equal(imageRetryLimitForSource("https://cdn.example.com/intro.webp", PAGE), 0);
    });

    it("adds a changing cache-buster without losing the image id", () => {
        const first = nextImageRetrySource("/api/img?id=jutsu%3Afireball", 1, PAGE);
        const second = nextImageRetrySource(first, 2, PAGE);
        assert.equal(new URL(second).searchParams.get("id"), "jutsu:fireball");
        assert.equal(new URL(second).searchParams.get("__img_retry"), "2");
        assert.equal(second.match(/__img_retry=/g)?.length, 1);
    });

    it("canonicalizes every retry attempt back to the original resource", () => {
        assert.equal(
            canonicalImageRetrySource("/api/img?id=avatar%3Akazu&__img_retry=2", PAGE),
            "https://shinobijourney.com/api/img?id=avatar%3Akazu",
        );
    });
});
