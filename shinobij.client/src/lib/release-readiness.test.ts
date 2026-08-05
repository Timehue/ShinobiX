import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_SYSTEM_MATRIX, releaseNoticeForScreen } from "./release-readiness";

describe("release readiness metadata", () => {
    it("marks receipt-backed rewards ready while keeping creator tools gated", () => {
        const weeklyBoss = RELEASE_SYSTEM_MATRIX.find((row) => row.system === "Weekly Boss");
        const creatorTools = RELEASE_SYSTEM_MATRIX.find((row) => row.system === "Bloodline Maker and AI image generation");

        assert.equal(weeklyBoss?.launchState, "ready");
        assert.equal(creatorTools?.launchState, "gate");
    });

    it("surfaces notices for soft-launch screens without nagging core early screens", () => {
        assert.equal(releaseNoticeForScreen("training"), null);
        assert.equal(releaseNoticeForScreen("missions"), null);
        assert.equal(releaseNoticeForScreen("weeklyBoss"), null);
        assert.equal(releaseNoticeForScreen("petArena")?.state, "monitor");
        assert.equal(releaseNoticeForScreen("hollowGateShrine")?.state, "desktop");
    });

    it("keeps production Sentry off the healthy-player loading path", () => {
        const root = process.cwd();
        const sentrySource = readFileSync(join(root, "shinobij.client", "src", "lib", "sentry.ts"), "utf8");
        const runtimeSource = readFileSync(join(root, "shinobij.client", "src", "lib", "sentry-runtime.ts"), "utf8");
        const ciSource = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");

        assert.doesNotMatch(sentrySource, /^import\s+.+["']@sentry\/react["'];?$/m);
        assert.match(sentrySource, /import\(["']\.\/sentry-runtime["']\)/);
        assert.match(runtimeSource, /import\s+\{\s*captureException,\s*init\s*\}\s+from\s+["']@sentry\/react["']/);
        assert.match(runtimeSource, /sanitizeSentryEvent/);
        assert.doesNotMatch(sentrySource, /username|setSentryUser|setUser/);
        assert.doesNotMatch(runtimeSource, /import\s+\*\s+as/);
        assert.match(sentrySource, /window\.addEventListener\(["']error["']/);
        assert.ok(ciSource.includes("VITE_SENTRY_DSN: https://public@example.invalid/1"));
    });
});

