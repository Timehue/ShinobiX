import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PublicCapabilities } from "../../../shared/public-capabilities";
import {
    CAPABILITY_MAX_AGE_MS,
    LiveCapabilitiesStore,
    canViewCapability,
    canStartCapability,
    capabilityMutationAvailability,
    capabilityViewAvailability,
    nextCapabilityRefreshDelay,
    parsePublicCapabilitiesResponse,
    startLiveCapabilitiesPolling,
    type CapabilityFetcher,
} from "./live-capabilities";
import { liveServiceNotice } from "./live-service-notice";

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
    anbuInfiltration: { state: "available", reason: "available" },
};

function okResponse(capabilities: PublicCapabilities) {
    return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, capabilities }),
    };
}

function freshSnapshot(capabilities: PublicCapabilities | null = available, lastUpdatedAt = 100) {
    return { capabilities, freshness: "fresh" as const, lastUpdatedAt, error: null };
}

const flushTasks = () => new Promise<void>((resolve) => { setImmediate(resolve); });

describe("live capability messaging", () => {
    it("shows no notice for healthy launched systems", () => {
        for (const screen of ["training", "petArena", "battleTowers", "villageWar", "hollowGateShrine"] as const) {
            assert.equal(liveServiceNotice(screen, available), null);
        }
    });

    it("scopes Sector Map outages without hiding mixed or legacy war screens", () => {
        const disabled = {
            ...available,
            villageWar: { state: "temporarily-unavailable", reason: "temporarily-disabled" },
        } satisfies PublicCapabilities;
        assert.match(liveServiceNotice("villageWarMap", disabled)?.title ?? "", /Sector campaign/);
        assert.match(liveServiceNotice("sectorCard", disabled)?.title ?? "", /Sector campaign/);
        assert.match(liveServiceNotice("sectorPet", disabled)?.title ?? "", /Sector campaign/);
        assert.equal(liveServiceNotice("villageWar", disabled), null);
        assert.equal(liveServiceNotice("townHall", disabled), null);
        assert.equal(liveServiceNotice("worldMap", disabled), null);
    });

    it("keeps registration and mixed-feature outages operation-scoped", () => {
        assert.match(liveServiceNotice("start", {
            ...available,
            registrations: { state: "temporarily-unavailable", reason: "temporarily-disabled" },
        })?.title ?? "", /registrations/);
        assert.equal(liveServiceNotice("clan", {
            ...available,
            clanBoss: { state: "temporarily-unavailable", reason: "temporarily-disabled" },
        }), null);
        assert.equal(liveServiceNotice("hallOfLegends", {
            ...available,
            legacy: { state: "temporarily-unavailable", reason: "configuration-unavailable" },
        }), null);
        assert.equal(liveServiceNotice("weeklyBoss", {
            ...available,
            weeklyBossGuardCycle: { state: "temporarily-unavailable", reason: "temporarily-disabled" },
        }), null);
        const requestPause = liveServiceNotice("training", {
            ...available,
            gameplayMutations: { state: "actions-paused", reason: "operations-paused" },
        });
        assert.match(requestPause?.title ?? "", /web requests/);
        assert.match(requestPause?.body ?? "", /background settlement/);
        assert.doesNotMatch(requestPause?.body ?? "", /progress and economy actions are paused/);
    });

    it("fails new admissions closed on cold, partial, or malformed responses", () => {
        assert.equal(parsePublicCapabilitiesResponse({ ok: true, capabilities: {} }), null);
        assert.equal(parsePublicCapabilitiesResponse({ ok: true, capabilities: {
            ...available,
            villageWar: { state: "maybe", reason: "available" },
        } }), null);
        assert.equal(parsePublicCapabilitiesResponse({ ok: true, capabilities: {
            ...available,
            registrations: { state: "available", reason: "maintenance" },
        } }), null);
        assert.equal(canStartCapability({ capabilities: null, freshness: "unknown", lastUpdatedAt: null, error: null }, "registrations", 100), false);
        assert.equal(canStartCapability(freshSnapshot({ gameplay: available.gameplay } as PublicCapabilities), "registrations", 100), false);
        assert.equal(canStartCapability(freshSnapshot(), "registrations", 100), true);
        assert.equal(canStartCapability(freshSnapshot(), "registrations", 100 + CAPABILITY_MAX_AGE_MS + 1), false);

        const parsed = parsePublicCapabilitiesResponse({
            ok: true,
            capabilities: { ...available, unboundedServerDetail: { secret: true } },
        });
        assert.ok(parsed);
        assert.equal(Object.isFrozen(parsed), true);
        assert.equal(Object.isFrozen(parsed.clanBoss), true);
        assert.equal("unboundedServerDetail" in parsed, false);
    });

    it("composes gameplay and narrow truth for views, plus the mutation freeze for actions", () => {
        const mutationFreeze = freshSnapshot({
            ...available,
            gameplayMutations: { state: "actions-paused", reason: "operations-paused" },
        });
        assert.equal(capabilityViewAvailability(mutationFreeze, "clanBoss", 100), "available");
        assert.equal(capabilityMutationAvailability(mutationFreeze, "clanBoss", 100), "unavailable");
        assert.equal(canViewCapability(mutationFreeze, "clanBoss", 100), true);
        assert.equal(canStartCapability(mutationFreeze, "clanBoss", 100), false);

        const maintenance = freshSnapshot({
            ...available,
            gameplay: { state: "temporarily-unavailable", reason: "maintenance" },
        });
        assert.equal(capabilityViewAvailability(maintenance, "clanBoss", 100), "unavailable");
        assert.equal(capabilityMutationAvailability(maintenance, "clanBoss", 100), "unavailable");

        const narrowOutage = freshSnapshot({
            ...available,
            clanBoss: { state: "temporarily-unavailable", reason: "temporarily-disabled" },
        });
        assert.equal(capabilityViewAvailability(narrowOutage, "clanBoss", 100), "unavailable");
        assert.equal(capabilityMutationAvailability(narrowOutage, "clanBoss", 100), "unavailable");

        assert.equal(capabilityViewAvailability(freshSnapshot(), "clanBoss", 100), "available");
        assert.equal(capabilityMutationAvailability(freshSnapshot(), "clanBoss", 100), "available");
    });

    it("fails both composed views and mutations closed on cold, stale, and expired truth", () => {
        const cold = { capabilities: null, freshness: "unknown" as const, lastUpdatedAt: null, error: null };
        const stale = { ...freshSnapshot(), freshness: "stale" as const, error: "offline" };
        const expiredNow = 100 + CAPABILITY_MAX_AGE_MS + 1;

        for (const snapshot of [cold, stale]) {
            assert.equal(capabilityViewAvailability(snapshot, "legacy", 100), "unknown");
            assert.equal(capabilityMutationAvailability(snapshot, "legacy", 100), "unknown");
            assert.equal(canViewCapability(snapshot, "legacy", 100), false);
            assert.equal(canStartCapability(snapshot, "legacy", 100), false);
        }
        assert.equal(capabilityViewAvailability(freshSnapshot(), "legacy", expiredNow), "unknown");
        assert.equal(capabilityMutationAvailability(freshSnapshot(), "legacy", expiredNow), "unknown");
        assert.equal(canViewCapability(freshSnapshot(), "legacy", expiredNow), false);
        assert.equal(canStartCapability(freshSnapshot(), "legacy", expiredNow), false);
    });

    it("publishes lease expiry so mounted consumers revoke controls without a network event", async () => {
        let now = 1_000;
        const store = new LiveCapabilitiesStore(async () => okResponse(available), () => now);
        await store.refresh();
        let publications = 0;
        const unsubscribe = store.subscribe(() => { publications += 1; });

        now += CAPABILITY_MAX_AGE_MS + 1;
        assert.equal(store.expireIfAged(), true);
        assert.equal(store.getSnapshot().freshness, "stale");
        assert.equal(capabilityViewAvailability(store.getSnapshot(), "villageWar", now), "unknown");
        assert.equal(capabilityMutationAvailability(store.getSnapshot(), "villageWar", now), "unknown");
        assert.equal(publications, 1);
        assert.equal(store.expireIfAged(), false, "expiry publishes at most once per fresh lease");
        unsubscribe();
    });

    it("coalesces only the current request", async () => {
        let calls = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const fetcher: CapabilityFetcher = async () => {
            calls += 1;
            await gate;
            return okResponse(available);
        };
        const store = new LiveCapabilitiesStore(fetcher, () => 10);
        const first = store.refresh();
        const second = store.refresh();
        assert.equal(first, second);
        assert.equal(calls, 1);
        release();
        await first;
        await store.refresh();
        assert.equal(calls, 2, "a completed request must not be cached forever");
    });

    it("jitters healthy polling and exponentially backs off failures", () => {
        assert.equal(nextCapabilityRefreshDelay(0, () => 0), 25_500);
        assert.equal(nextCapabilityRefreshDelay(0, () => 1), 34_500);
        assert.equal(nextCapabilityRefreshDelay(1, () => 0.5), 60_000);
        assert.equal(nextCapabilityRefreshDelay(20, () => 0.5), 300_000);
    });

    it("coordinates visible polling, foreground/online refresh, and cleanup", async () => {
        let calls = 0;
        const store = new LiveCapabilitiesStore(async () => {
            calls += 1;
            return okResponse(available);
        }, () => calls);
        let visible = true;
        let onlineListener: (() => void) | null = null;
        let visibilityListener: (() => void) | null = null;
        const timers: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];
        const stop = startLiveCapabilitiesPolling(store, {
            schedule: (callback, delay) => {
                const timer = { callback, delay, cancelled: false };
                timers.push(timer);
                return timer;
            },
            cancel: (handle) => { (handle as { cancelled: boolean }).cancelled = true; },
            isVisible: () => visible,
            onOnline: (listener) => {
                onlineListener = listener;
                return () => { onlineListener = null; };
            },
            onVisibilityChange: (listener) => {
                visibilityListener = listener;
                return () => { visibilityListener = null; };
            },
            random: () => 0.5,
        });

        await flushTasks();
        assert.equal(calls, 1);
        assert.equal(timers.at(-1)?.delay, 30_000);
        assert.equal(timers.at(-1)?.cancelled, false);

        visible = false;
        visibilityListener?.();
        assert.equal(timers.at(-1)?.cancelled, true);

        visible = true;
        visibilityListener?.();
        await flushTasks();
        assert.equal(calls, 2);
        assert.equal(timers.at(-1)?.cancelled, false);

        onlineListener?.();
        await flushTasks();
        assert.equal(calls, 3);
        assert.equal(timers.filter((timer) => !timer.cancelled).length, 1);

        stop();
        assert.equal(onlineListener, null);
        assert.equal(visibilityListener, null);
        assert.equal(timers.filter((timer) => !timer.cancelled).length, 0);
    });

    it("does not schedule after unmount during an in-flight refresh", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const store = new LiveCapabilitiesStore(async () => {
            await gate;
            return okResponse(available);
        });
        let scheduled = 0;
        const stop = startLiveCapabilitiesPolling(store, {
            schedule: () => { scheduled += 1; return scheduled; },
            cancel: () => undefined,
            isVisible: () => true,
            onOnline: () => () => undefined,
            onVisibilityChange: () => () => undefined,
            random: () => 0.5,
        });
        stop();
        release();
        await flushTasks();
        assert.equal(scheduled, 0);
    });

    it("counts one failed refresh cycle when foreground signals coalesce", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const store = new LiveCapabilitiesStore(async () => {
            await gate;
            throw new Error("offline");
        });
        let onlineListener: (() => void) | null = null;
        let visibilityListener: (() => void) | null = null;
        const delays: number[] = [];
        const stop = startLiveCapabilitiesPolling(store, {
            schedule: (_callback, delay) => { delays.push(delay); return delays.length; },
            cancel: () => undefined,
            isVisible: () => true,
            onOnline: (listener) => {
                onlineListener = listener;
                return () => { onlineListener = null; };
            },
            onVisibilityChange: (listener) => {
                visibilityListener = listener;
                return () => { visibilityListener = null; };
            },
            random: () => 0.5,
        });

        onlineListener?.();
        visibilityListener?.();
        onlineListener?.();
        release();
        await flushTasks();

        assert.deepEqual(delays, [60_000], "one coalesced failure must advance backoff exactly once");
        stop();
    });

    it("expires an aged lease synchronously when a foreground signal joins an in-flight cycle", async () => {
        let now = 1_000;
        let release!: () => void;
        let calls = 0;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const store = new LiveCapabilitiesStore(async () => {
            calls += 1;
            if (calls > 1) await gate;
            return okResponse(available);
        }, () => now);
        await store.refresh();

        let onlineListener: (() => void) | null = null;
        const stop = startLiveCapabilitiesPolling(store, {
            schedule: () => 1,
            cancel: () => undefined,
            isVisible: () => true,
            onOnline: (listener) => {
                onlineListener = listener;
                return () => { onlineListener = null; };
            },
            onVisibilityChange: () => () => undefined,
            random: () => 0.5,
        });
        await flushTasks();
        assert.equal(calls, 2, "the coordinator owns a still-pending refresh cycle");

        now += CAPABILITY_MAX_AGE_MS + 1;
        onlineListener?.();
        assert.equal(store.getSnapshot().freshness, "stale", "online expiry must publish before the in-flight request resolves");
        assert.equal(capabilityMutationAvailability(store.getSnapshot(), undefined, now), "unknown");

        release();
        await flushTasks();
        stop();
    });

    it("retries a cold failure and publishes live state changes without reload", async () => {
        const disabled = {
            ...available,
            clanBoss: { state: "temporarily-unavailable", reason: "temporarily-disabled" },
            clanBossParties: { state: "temporarily-unavailable", reason: "temporarily-disabled" },
        } satisfies PublicCapabilities;
        const replies: Array<Error | PublicCapabilities> = [new Error("offline"), available, disabled];
        const fetcher: CapabilityFetcher = async () => {
            const next = replies.shift();
            if (next instanceof Error) throw next;
            assert.ok(next);
            return okResponse(next);
        };
        let updates = 0;
        const store = new LiveCapabilitiesStore(fetcher, () => 20 + updates);
        const unsubscribe = store.subscribe(() => { updates += 1; });

        await store.refresh();
        assert.equal(store.getSnapshot().freshness, "unknown");
        assert.equal(store.getSnapshot().capabilities, null);
        await store.refresh();
        assert.equal(store.getSnapshot().freshness, "fresh");
        assert.equal(canStartCapability(store.getSnapshot(), "clanBoss", store.getSnapshot().lastUpdatedAt ?? 0), true);
        await store.refresh();
        assert.equal(canStartCapability(store.getSnapshot(), "clanBoss", store.getSnapshot().lastUpdatedAt ?? 0), false);
        assert.equal(updates, 3);
        unsubscribe();
    });

    it("retains the last-known-good snapshot when a later refresh fails", async () => {
        let fail = false;
        const store = new LiveCapabilitiesStore(async () => {
            if (fail) throw new Error("gateway unavailable");
            return okResponse(available);
        }, () => 42);
        await store.refresh();
        const knownGood = store.getSnapshot().capabilities;
        fail = true;
        await store.refresh();
        assert.equal(store.getSnapshot().capabilities, knownGood);
        assert.equal(store.getSnapshot().freshness, "stale");
        assert.equal(store.getSnapshot().lastUpdatedAt, 42);
        assert.equal(canStartCapability(store.getSnapshot(), "clanBoss", 42), false);
        assert.match(store.getSnapshot().error ?? "", /gateway unavailable/);
    });

    it("times out a hung request so a later refresh can recover", async () => {
        let calls = 0;
        const store = new LiveCapabilitiesStore(async () => {
            calls += 1;
            if (calls === 1) return new Promise<never>(() => undefined);
            return okResponse(available);
        }, () => 77, 5);

        await store.refresh();
        assert.equal(store.getSnapshot().freshness, "unknown");
        assert.match(store.getSnapshot().error ?? "", /timed out/);
        await store.refresh();
        assert.equal(store.getSnapshot().freshness, "fresh");
        assert.equal(calls, 2);
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
