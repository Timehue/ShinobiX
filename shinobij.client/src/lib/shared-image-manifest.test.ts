import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imageEntries, imageUrl, parseImageManifest } from "./shared-image-manifest";

describe("shared image manifest", () => {
    it("reads the versioned shape", () => {
        const manifest = parseImageManifest({ version: "7", ids: ["jutsu:fireball", "jutsu:spiral-core"] });
        assert.deepEqual(manifest, { version: "7", ids: ["jutsu:fireball", "jutsu:spiral-core"] });
    });

    it("still reads the bare-array shape the endpoint used to return", () => {
        // Not hypothetical: the array response is cached at the edge, so a client
        // can be handed it after versioning ships. It must degrade to unversioned
        // URLs rather than being treated as a failed fetch.
        const manifest = parseImageManifest(["item:kunai", "item:shuriken"]);
        assert.deepEqual(manifest, { ids: ["item:kunai", "item:shuriken"] });
        assert.equal(manifest?.version, undefined);
    });

    it("returns null for a body that is neither shape", () => {
        // The caller treats null as a failed fetch and retries. An empty manifest
        // would instead be cached and the category marked loaded — the "ran a whole
        // session with missing art" failure that ids=1 mode exists to prevent.
        for (const body of [null, undefined, 42, "nope", {}, { ids: "not-an-array" }]) {
            assert.equal(parseImageManifest(body), null, `expected null for ${JSON.stringify(body)}`);
        }
    });

    it("drops ids that are not non-empty strings", () => {
        const manifest = parseImageManifest({ version: "1", ids: ["ok:a", "", null, 3, "ok:b"] });
        assert.deepEqual(manifest?.ids, ["ok:a", "ok:b"]);
    });

    it("drops a version the server itself would reject", () => {
        // api/_image-version.ts only honours /^[0-9]{1,20}$/. Forwarding anything
        // else would mint a URL that silently falls back to the short TTL.
        for (const version of ["abc", "-1", "1.5", "", "1".repeat(21), " 1"]) {
            const manifest = parseImageManifest({ version, ids: ["a:b"] });
            assert.equal(manifest?.version, undefined, `expected ${JSON.stringify(version)} to be dropped`);
        }
        assert.equal(parseImageManifest({ version: "1".repeat(20), ids: ["a:b"] })?.version, "1".repeat(20));
    });

    it("builds versioned and unversioned URLs", () => {
        assert.equal(imageUrl("jutsu:fireball", "7"), "/api/img?id=jutsu%3Afireball&v=7");
        assert.equal(imageUrl("jutsu:fireball"), "/api/img?id=jutsu%3Afireball");
    });

    it("maps every id to a URL carrying the manifest's version", () => {
        const entries = imageEntries({ version: "12", ids: ["pet:fox", "pet:owl"] });
        assert.deepEqual(entries, {
            "pet:fox": "/api/img?id=pet%3Afox&v=12",
            "pet:owl": "/api/img?id=pet%3Aowl&v=12",
        });
    });

    it("maps to unversioned URLs when the manifest carried no version", () => {
        const entries = imageEntries({ ids: ["pet:fox"] });
        assert.deepEqual(entries, { "pet:fox": "/api/img?id=pet%3Afox" });
    });

    it("changes every URL in a category when the version moves", () => {
        // This is the whole point: a bump has to retire the cached immutable URLs.
        const before = imageEntries({ version: "1", ids: ["pet:fox"] });
        const after = imageEntries({ version: "2", ids: ["pet:fox"] });
        assert.notEqual(before["pet:fox"], after["pet:fox"]);
    });
});
