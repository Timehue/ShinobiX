import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, afterEach } from "node:test";
import { claimWorldAttack, releaseWorldAttack } from "./world-attack-claim";

type Call = { url: string; body: Record<string, unknown> };

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(reply: (url: string) => { ok: boolean; body?: unknown }): Call[] {
    const calls: Call[] = [];
    globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
        const url = String(input);
        calls.push({ url, body: JSON.parse(init?.body ?? "{}") });
        const { ok, body } = reply(url);
        return { ok, json: async () => body ?? {} } as unknown as Response;
    }) as typeof fetch;
    return calls;
}

describe("world attack claim", () => {
    it("claims the engagement and sends only the attacker's name", async () => {
        const calls = stubFetch(() => ({ ok: true }));
        assert.deepEqual(await claimWorldAttack("Quarry", "Raider"), { ok: true });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, "/api/player/attack");
        assert.equal(calls[0].body.targetName, "Quarry");
        // Not the whole character: this lands verbatim on the presence row and
        // rides the per-second heartbeat back to the defender.
        assert.deepEqual(calls[0].body.attacker, { name: "Raider" });
    });

    it("surfaces the server's own refusal text so the player learns WHY", async () => {
        stubFetch(() => ({ ok: false, body: { error: "This shinobi is under Academy protection." } }));
        const result = await claimWorldAttack("Rookie", "Raider");
        assert.equal(result.ok, false);
        assert.match(result.ok === false ? result.error : "", /Academy protection/);
    });

    it("treats an unconfirmable claim as a refusal, never as granted", async () => {
        // Fail-closed: opening a fight on a claim we could not confirm is exactly
        // the bypass this gate exists to prevent.
        globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
        const result = await claimWorldAttack("Quarry", "Raider");
        assert.equal(result.ok, false);
    });

    it("lets an abort propagate rather than reading as a refusal", async () => {
        globalThis.fetch = (async () => { throw new DOMException("Aborted", "AbortError"); }) as typeof fetch;
        await assert.rejects(() => claimWorldAttack("Quarry", "Raider"), /Aborted/);
    });

    it("releases a claim by target name, fire-and-forget", async () => {
        const calls = stubFetch(() => ({ ok: true }));
        releaseWorldAttack("Quarry");
        await Promise.resolve();
        assert.equal(calls[0].url, "/api/player/clear-attack");
        assert.deepEqual(calls[0].body, { name: "Quarry" });
    });

    it("a failed release cannot throw into the caller", () => {
        globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
        assert.doesNotThrow(() => releaseWorldAttack("Quarry"));
    });
});

describe("world attack claim wiring", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

    it("claims BEFORE creating the session, and releases on both failure paths", () => {
        const claim = app.indexOf("await claimWorldAttack(opponent.name");
        const create = app.indexOf("createPvpSessionWithRecovery(", claim);
        assert.ok(claim >= 0, "the sector attack must go through the claim gate");
        assert.ok(create > claim,
            "the claim must precede session creation — sessionOpponentBlock exempts an "
            + "engagement stamped by the CALLER, so claiming afterwards would gate nothing");

        const rejected = app.indexOf('createResult.kind === "rejected"', create);
        assert.ok(app.indexOf("releaseWorldAttack(opponent.name)", rejected) > rejected,
            "a refused session must release the claim it took");
        const registration = app.indexOf("confirmSectorBattleRegistration", create);
        assert.ok(app.indexOf("releaseWorldAttack(opponent.name)", registration) > registration,
            "an unconfirmed sector registration must release the claim it took");
    });
});
