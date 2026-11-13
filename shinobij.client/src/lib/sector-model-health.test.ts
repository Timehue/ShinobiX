import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    missingSectorModelFeature, reportSectorModelUnavailable, reportSectorModelUnsupported, resetSectorModelHealthForTests,
} from "./sector-model-health";

beforeEach(() => resetSectorModelHealthForTests());

const full = {
    DecompressionStream: function DecompressionStream() {}, Worker: function Worker() {},
    WebAssembly: {}, crypto: { subtle: { digest() {} } },
};

test("names the first missing browser feature", () => {
    assert.equal(missingSectorModelFeature(full), undefined);
    assert.equal(missingSectorModelFeature({ ...full, DecompressionStream: undefined }), "DecompressionStream");
    assert.equal(missingSectorModelFeature({ ...full, Worker: undefined }), "Worker");
    assert.equal(missingSectorModelFeature({ ...full, WebAssembly: undefined }), "WebAssembly");
    assert.equal(missingSectorModelFeature({ ...full, crypto: {} }), "crypto.subtle");
});

test("each distinct problem is reported once per session", () => {
    const sent: Error[] = [];
    const report = (error: unknown) => { sent.push(error as Error); };
    reportSectorModelUnsupported("Worker", report);
    reportSectorModelUnsupported("Worker", report);
    reportSectorModelUnavailable("page", false, new TypeError("Failed to fetch"), report);
    reportSectorModelUnavailable("page", false, new TypeError("Failed to fetch"), report);
    reportSectorModelUnavailable("page", true, new TypeError("Failed to fetch"), report);
    assert.deepEqual(sent.map(error => error.message), [
        "Sector model unsupported: missing Worker",
        "Sector model unavailable at page for a roster model (TypeError: Failed to fetch)",
        "Sector model unavailable at page for a player-made model (TypeError: Failed to fetch)",
    ]);
    assert.ok(sent.every(error => error.name === "SectorModelFallback"));
});

test("never sends a URL", () => {
    const sent: Error[] = [];
    reportSectorModelUnavailable("manifest", true,
        new Error("load failed https://art.example/sector-models/players/0123456789abcdef0123456789abcdef/x.json"),
        error => { sent.push(error as Error); });
    assert.ok(!sent[0]!.message.includes("http"));
    assert.ok(!sent[0]!.message.includes("0123456789abcdef"));
});
