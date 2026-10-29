import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ClanSaveError } from "./clan-api";
import { GUARD_DUTY_REFRESH_MS, guardRefusalEndsDuty } from "./use-guard-duty-refresh";

const source = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("Village Guard duty refresh", () => {
    it("re-signs well inside the server post's lifetime", () => {
        const queue = source("../../../api/village-guard/queue.ts");
        const ttl = Number(/`guard:\$\{normalizedName\}`[^;]*\{\s*ex:\s*(\d+)\s*\}/.exec(queue)?.[1]);
        assert.ok(ttl > 0, "the guard post write in api/village-guard/queue.ts must still carry an ex TTL");
        assert.ok(GUARD_DUTY_REFRESH_MS * 2 <= ttl * 1000, "one missed refresh must not let the post lapse");
    });

    it("clears duty only on a refusal, never on a network or auth blip", () => {
        assert.equal(guardRefusalEndsDuty(new ClanSaveError(409, "You are in the hospital.")), true);
        assert.equal(guardRefusalEndsDuty(new ClanSaveError(403, "Reach Genin first.")), true);
        assert.equal(guardRefusalEndsDuty(new ClanSaveError(0, "network")), false);
        assert.equal(guardRefusalEndsDuty(new ClanSaveError(401, "sign in")), false);
        assert.equal(guardRefusalEndsDuty(new ClanSaveError(429, "slow down")), false);
        assert.equal(guardRefusalEndsDuty(new Error("other")), false);
    });

    it("is mounted by the App, lazily, while on duty and gameplay is open", () => {
        const app = source("../App.tsx");
        assert.match(app, /character\?\.guardQueued && gameplayMutationsOpen && <Suspense fallback=\{null\}><GuardDutyRefresher /);
        assert.match(app, /const GuardDutyRefresher = lazyWithRetry\(\(\) => import\("\.\/components\/GuardDutyRefresher"\)/);
        assert.match(source("../components/GuardDutyRefresher.tsx"), /useGuardDutyRefresh\(character, setCharacter, notify\)/);
    });
});
