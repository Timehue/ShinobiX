import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Character, PlayerRecord } from "../types/character";
import { pvpStableBattleIdFromRequestBody } from "./pvp-session-create";
import { attackSectorPlayer, type SectorAttackOptions } from "./sector-attack";

/*
 * Behavioural tests for the open-world sector attack.
 *
 * This is a reward-bearing, server-authoritative PvP path: it gates on
 * settlement, CLAIMS the target (stamping them "engaged"), creates a sealed PvP
 * session, registers the sector battle, and only then routes the attacker. Until
 * it was drained out of App.tsx these guarantees were pinned only by grepping
 * App's JSX for substrings — the flow itself could not be executed, because
 * App.tsx imports a .webp and node:test cannot load it.
 *
 * What these cover are the FENCES: the refusals and the account-change re-checks
 * that decide whether a player gets attacked at all. Every await in the real flow
 * is followed by `createIsCurrent()`, because the signed-in account can change
 * under a slow request and painting a foreign save is the failure being guarded.
 * `capturePvpCreateScope` is a parameter, so a test can make that fence fire on
 * demand — which is the whole reason the extraction was worth doing.
 *
 * The settlement gate itself is NOT exercised here: SERVER_SETTLEMENT_STATUS is a
 * static policy table with no runtime setter, so it always admits. That the gate
 * is the FIRST statement is asserted in lib/server-settlement-gate.test.ts.
 */

type Recorded = { calls: string[]; fetches: string[] };

const realFetch = globalThis.fetch;
const realAlert = (globalThis as { alert?: unknown }).alert;

let alerts: string[] = [];

beforeEach(() => {
    alerts = [];
    (globalThis as { alert?: unknown }).alert = (message?: unknown) => { alerts.push(String(message)); };
});

afterEach(() => {
    globalThis.fetch = realFetch;
    (globalThis as { alert?: unknown }).alert = realAlert;
});

/** Every state setter records itself, so "nothing was touched" is assertable. */
function harness(over: Partial<SectorAttackOptions> = {}) {
    const rec: Recorded = { calls: [], fetches: [] };
    const note = (name: string) => (...args: unknown[]) => {
        rec.calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
    };

    const opts: SectorAttackOptions = {
        opponent: { name: "Quarry", character: { name: "Quarry", level: 10 } } as unknown as PlayerRecord,
        character: { name: "Attacker", level: 20, equippedJutsuIds: [] } as unknown as Character,
        isTraveling: false,
        creatorItems: [],
        creatorJutsus: [],
        savedBloodlines: [],
        currentSector: 3,
        currentBiome: "central",
        currentWeather: "clear",
        capturePvpCreateScope: () => ({ signal: new AbortController().signal, isCurrent: () => true }),
        installPvpRecovery: note("installPvpRecovery"),
        setPvpBattleId: note("setPvpBattleId"),
        setPvpRole: note("setPvpRole"),
        setPvpBattleContext: note("setPvpBattleContext"),
        setPvpSeedSession: note("setPvpSeedSession"),
        setRaidBattleKind: note("setRaidBattleKind"),
        setScreen: note("setScreen"),
        ...over,
    } as SectorAttackOptions;

    const stubFetch = (handler: (url: string) => unknown) => {
        globalThis.fetch = (async (input: unknown) => {
            const url = String(input);
            rec.fetches.push(url);
            return handler(url);
        }) as unknown as typeof fetch;
    };

    return { opts, rec, stubFetch };
}

const ok = () => ({ ok: true, json: async () => ({}) });
const refused = (error: string) => ({ ok: false, json: async () => ({ error }) });

describe("refusals that must happen before anything is claimed", () => {
    it("refuses while traveling, and touches nothing", async () => {
        const { opts, rec, stubFetch } = harness({ isTraveling: true });
        stubFetch(() => ok());

        await attackSectorPlayer(opts);

        assert.deepEqual(alerts, ["You cannot attack while traveling."]);
        assert.deepEqual(rec.fetches, [], "a traveling player must not even claim the target");
        assert.deepEqual(rec.calls, [], "no navigation or PvP state may be set");
    });
});

describe("the claim gate", () => {
    it("claims the target before anything else touches the network", async () => {
        const { opts, rec, stubFetch } = harness();
        stubFetch((url) => (url.includes("/api/player/attack") ? refused("Nope.") : ok()));

        await attackSectorPlayer(opts);

        assert.ok(rec.fetches.length > 0, "the flow must reach the network");
        assert.match(rec.fetches[0], /\/api\/player\/attack$/,
            "the admission claim must be the FIRST request — claiming later would gate nothing");
    });

    it("surfaces the server's refusal and starts no battle", async () => {
        const { opts, rec, stubFetch } = harness();
        stubFetch(() => refused("They are already engaged."));

        await attackSectorPlayer(opts);

        assert.deepEqual(alerts, ["They are already engaged."]);
        assert.deepEqual(rec.calls, [], "a refused claim must not create or route a battle");
    });

    it("treats an unreachable server as a refusal rather than a crash", async () => {
        const { opts, rec, stubFetch } = harness();
        stubFetch(() => { throw new TypeError("network down"); });

        await assert.doesNotReject(() => attackSectorPlayer(opts));

        assert.equal(alerts.length, 1);
        assert.match(alerts[0], /Could not reach the server/);
        assert.deepEqual(rec.calls, []);
    });
});

describe("the account-change fence", () => {
    it("abandons the attack silently when the account changes under the claim", async () => {
        // isCurrent() flips false while the claim is in flight — the signed-in
        // account is no longer the one that started this. The flow must stop
        // BEFORE reporting anything, because both the refusal alert and the
        // battle state would belong to a save we no longer own.
        let live = true;
        const { opts, rec, stubFetch } = harness({
            capturePvpCreateScope: () => ({
                signal: new AbortController().signal,
                isCurrent: () => live,
            }),
        });
        stubFetch(() => { live = false; return refused("They are already engaged."); });

        await attackSectorPlayer(opts);

        assert.deepEqual(alerts, [], "a stale scope must not alert — the refusal is not ours to report");
        assert.deepEqual(rec.calls, [], "a stale scope must not paint PvP state");
    });

    it("scopes the attack to the acting account", async () => {
        const seen: string[] = [];
        const { opts, stubFetch } = harness({
            capturePvpCreateScope: (accountName: string) => {
                seen.push(accountName);
                return { signal: new AbortController().signal, isCurrent: () => true };
            },
        });
        stubFetch(() => refused("stop here"));

        await attackSectorPlayer(opts);

        assert.deepEqual(seen, ["Attacker"],
            "the scope must be captured for the attacker, so a later account switch is detectable");
    });
});

/*
 * Past the claim, the flow forks on what the battle server said. The branch that
 * matters is whether the claim is RELEASED: a claim left behind marks a player
 * "engaged" for a fight that never started, and nothing else clears it.
 *
 * Releasing is correct only when the session provably does not exist. Where the
 * outcome is ambiguous or recovered, the battle may well be live, so releasing
 * would un-engage a player who is genuinely in a fight.
 */

/** Minimal projection that satisfies parsePvpSessionProjection. */
const fighter = (name: string) => ({
    name, hp: 100, maxHp: 100, chakra: 50, maxChakra: 50, stamina: 50, maxStamina: 50,
    shield: 0, pos: 0, character: { name }, statuses: [],
});

const session = (battleId: string) => ({
    battleId, stateRevision: 1, p1: fighter("Attacker"), p2: fighter("Quarry"),
    round: 0, activePlayer: "p1", ap: { p1: 3, p2: 3 }, actionsThisTurn: 0,
    cooldowns: { p1: {}, p2: {} }, log: [], status: "active", winner: null,
});

const CLAIM = "/api/player/attack";
const RELEASE = "/api/player/clear-attack";
const CREATE = "/api/pvp/session";

/** Routes by URL; the create POST can inspect the body to echo the stable id. */
function router(routes: { create: (body: string) => unknown; pending: () => unknown; other?: () => unknown }) {
    return (url: string, init?: { body?: unknown }) => {
        if (url.includes(CLAIM)) return ok();
        if (url.includes(RELEASE)) return ok();
        if (url.startsWith("/api/save/")) return { ok: false, status: 404, json: async () => null };
        if (url.includes("pending=1")) return routes.pending();
        if (url.includes(CREATE)) return routes.create(String(init?.body ?? ""));
        return routes.other?.() ?? { ok: false, status: 500, json: async () => ({ error: "unmatched" }) };
    };
}

const noPending = () => ({ status: 204, ok: true, json: async () => null });

describe("what happens to the claim after the battle server answers", () => {
    it("RELEASES the claim when the create is conclusively rejected", async () => {
        const { opts, rec } = harness();
        globalThis.fetch = (async (input: unknown, init?: unknown) => {
            const url = String(input);
            rec.fetches.push(url);
            return router({
                create: () => ({ ok: false, status: 400, json: async () => ({ error: "Refused by the arbiter." }) }),
                pending: noPending,
            })(url, init as { body?: unknown });
        }) as unknown as typeof fetch;

        await attackSectorPlayer(opts);

        assert.ok(rec.fetches.some((u) => u.includes(RELEASE)),
            "a refused session must release the claim — otherwise the target stays engaged for a fight that never began");
        assert.deepEqual(alerts, ["Refused by the arbiter."]);
        assert.ok(rec.calls.includes('setScreen("worldMap")'), "the attacker must be routed back out");
        assert.ok(rec.calls.includes('setPvpBattleId("")'));
        assert.ok(rec.calls.includes("setPvpSeedSession(null)"));
        assert.ok(rec.calls.includes('setRaidBattleKind("none")'));
    });

    it("KEEPS the claim when the create is ambiguous, and routes into the battle", async () => {
        const { opts, rec } = harness();
        globalThis.fetch = (async (input: unknown, init?: unknown) => {
            const url = String(input);
            rec.fetches.push(url);
            // 409 is retried, never conclusive — the session may well exist.
            return router({
                create: () => ({ ok: false, status: 409, json: async () => ({ error: "conflict" }) }),
                pending: noPending,
            })(url, init as { body?: unknown });
        }) as unknown as typeof fetch;

        await attackSectorPlayer(opts);

        assert.ok(!rec.fetches.some((u) => u.includes(RELEASE)),
            "an ambiguous create must NOT release: the battle may be live, and un-engaging a fighting player is worse");
        assert.ok(rec.calls.includes('setScreen("pvpBattle")'), "the attacker is routed so GET recovery can find the session");
        assert.equal(alerts.length, 1);
        assert.match(alerts[0], /interrupted/i);
    });

    it("installs the recovered pointer in the same mount, and keeps the claim", async () => {
        // The pending probe publishes a DIFFERENT battle id than the one this
        // create intended — the authoritative pointer wins.
        const recoveredId = "recovered-battle-id";
        const { opts, rec } = harness();
        globalThis.fetch = (async (input: unknown, init?: unknown) => {
            const url = String(input);
            rec.fetches.push(url);
            return router({
                create: () => ({ ok: false, status: 409, json: async () => ({ error: "conflict" }) }),
                pending: () => ({
                    ok: true,
                    status: 200,
                    json: async () => ({ battleId: recoveredId, role: "p1", session: session(recoveredId) }),
                }),
            })(url, init as { body?: unknown });
        }) as unknown as typeof fetch;

        await attackSectorPlayer(opts);

        assert.ok(rec.calls.some((c) => c.startsWith("installPvpRecovery(")),
            "a recovered create must install the reconciled pointer in the same mount");
        assert.ok(rec.calls.includes('setScreen("pvpBattle")'));
        assert.ok(!rec.fetches.some((u) => u.includes(RELEASE)),
            "a recovered session is live — releasing its claim would un-engage a real fight");
        assert.deepEqual(alerts, [], "recovery is not an error the player needs told about");
    });

    it("RELEASES the claim when sector registration never confirms", async () => {
        // The session was created, but the sector-war registration that makes it
        // a real sector battle failed. The claim must not survive that.
        const { opts, rec } = harness();
        globalThis.fetch = (async (input: unknown, init?: unknown) => {
            const url = String(input);
            rec.fetches.push(url);
            return router({
                create: (body) => {
                    const id = pvpStableBattleIdFromRequestBody(body);
                    return { ok: true, status: 200, json: async () => ({ battleId: id, session: session(id) }) };
                },
                pending: noPending,
                // every other call — the sector registration — fails
                other: () => ({ ok: false, status: 500, json: async () => ({ error: "registry down" }) }),
            })(url, init as { body?: unknown });
        }) as unknown as typeof fetch;

        await attackSectorPlayer(opts);

        assert.ok(rec.fetches.some((u) => u.includes(RELEASE)),
            "an unconfirmed sector registration must release the claim it took");
        assert.equal(alerts.length, 1);
        assert.ok(!rec.calls.includes('setScreen("pvpBattle")'),
            "an unregistered sector battle must not route the attacker into it");
    });
});
