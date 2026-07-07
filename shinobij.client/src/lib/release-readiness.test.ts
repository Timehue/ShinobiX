import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { RELEASE_SYSTEM_MATRIX, releaseNoticeForScreen } from "./release-readiness";

describe("release readiness metadata", () => {
    it("keeps high-risk reward and content systems gated for public beta", () => {
        const weeklyBoss = RELEASE_SYSTEM_MATRIX.find((row) => row.system === "Weekly Boss");
        const creatorTools = RELEASE_SYSTEM_MATRIX.find((row) => row.system === "Bloodline Maker and AI image generation");

        assert.equal(weeklyBoss?.launchState, "gate");
        assert.equal(creatorTools?.launchState, "gate");
    });

    it("surfaces notices for soft-launch screens without nagging core early screens", () => {
        assert.equal(releaseNoticeForScreen("training"), null);
        assert.equal(releaseNoticeForScreen("missions"), null);
        assert.equal(releaseNoticeForScreen("weeklyBoss")?.state, "gate");
        assert.equal(releaseNoticeForScreen("petArena")?.state, "monitor");
        assert.equal(releaseNoticeForScreen("hollowGateShrine")?.state, "desktop");
    });
});

