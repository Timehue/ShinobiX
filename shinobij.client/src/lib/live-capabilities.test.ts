import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PublicCapabilities } from "../../../shared/public-capabilities";
import { liveServiceNotice } from "./live-capabilities";

const available: PublicCapabilities = {
    gameplay: { state: "available", reason: "available" },
    gameplayMutations: { state: "available", reason: "available" },
    registrations: { state: "available", reason: "available" },
    villageWar: { state: "available", reason: "available" },
    clanBoss: { state: "available", reason: "available" },
    clanBossParties: { state: "available", reason: "available" },
    legacy: { state: "available", reason: "available" },
    petBreedingStarts: { state: "available", reason: "available" },
    weeklyBossGuardCycle: { state: "available", reason: "available" },
};

describe("live capability messaging", () => {
    it("shows no notice for healthy launched systems", () => {
        for (const screen of ["training", "petArena", "battleTowers", "villageWar", "hollowGateShrine"] as const) {
            assert.equal(liveServiceNotice(screen, available), null);
        }
    });

    it("shows only a current global or relevant feature outage", () => {
        assert.match(liveServiceNotice("training", { ...available, gameplayMutations: { state: "actions-paused", reason: "operations-paused" } })?.title ?? "", /actions are temporarily paused/);
        assert.match(liveServiceNotice("villageWar", { ...available, villageWar: { state: "temporarily-unavailable", reason: "temporarily-disabled" } })?.title ?? "", /Village War/);
        assert.match(liveServiceNotice("townHall", { ...available, villageWar: { state: "temporarily-unavailable", reason: "temporarily-disabled" } })?.title ?? "", /Village War/);
        assert.equal(liveServiceNotice("training", { ...available, villageWar: { state: "temporarily-unavailable", reason: "temporarily-disabled" } }), null);
    });

    it("connects registration and scoped Clan Boss status to their entry screens", () => {
        assert.match(liveServiceNotice("start", { ...available, registrations: { state: "temporarily-unavailable", reason: "temporarily-disabled" } })?.title ?? "", /registrations/);
        assert.match(liveServiceNotice("clan", { ...available, clanBoss: { state: "temporarily-unavailable", reason: "temporarily-disabled" } })?.title ?? "", /Clan Boss Operations/);
        assert.match(liveServiceNotice("clan", { ...available, clanBossParties: { state: "temporarily-unavailable", reason: "temporarily-disabled" } })?.title ?? "", /parties/);
    });

    it("fails silent instead of crashing on an incomplete capability response", () => {
        assert.equal(liveServiceNotice("clan", {} as PublicCapabilities), null);
        assert.equal(liveServiceNotice("weeklyBoss", { gameplay: available.gameplay } as PublicCapabilities), null);
    });

    it("keeps production Sentry off the healthy-player loading path", () => {
        const root = process.cwd();
        const sentrySource = readFileSync(join(root, "shinobij.client", "src", "lib", "sentry.ts"), "utf8");
        const runtimeSource = readFileSync(join(root, "shinobij.client", "src", "lib", "sentry-runtime.ts"), "utf8");
        const ciSource = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
        assert.doesNotMatch(sentrySource, /^import\s+.+["']@sentry\/react["'];?$/m);
        assert.match(sentrySource, /import\(["']\.\/sentry-runtime["']\)/);
        assert.match(runtimeSource, /import\s+\{\s*captureException,\s*init\s*\}\s+from\s+["']@sentry\/react["']/);
        assert.match(runtimeSource, /beforeSend/);
        assert.doesNotMatch(sentrySource, /username|setSentryUser|setUser/);
        assert.match(sentrySource, /window\.addEventListener\(["']error["']/);
        assert.ok(ciSource.includes("VITE_SENTRY_DSN: https://public@example.invalid/1"));
    });
});
