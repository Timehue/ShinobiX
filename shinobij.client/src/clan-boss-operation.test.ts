import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const activity = read("./components/ActivitySpine.tsx");
const lobby = read("./components/ClanBossPartyLobby.tsx");
const boss = read("./screens/ClanBoss.tsx");
const admin = read("./screens/AdminDiagnosticsPanel.tsx");
const api = read("./lib/clan-boss-api.ts");
const css = read("./styles/index/36-clan-boss-operation.css");

describe("Clan Boss operation client contract", () => {
    it("renders all four activity horizons with eligibility and commitment", () => {
        for (const horizon of ["Now", "Today", "This Week", "Long Term"]) assert.match(activity, new RegExp(`\\b${horizon}\\b`));
        assert.match(activity, /activity\.eligibility === "blocked"/);
        assert.match(activity, /activity\.commitment/);
        assert.match(activity, /activity\.blocker/);
    });

    it("uses only server party state and never presents offline members as AI", () => {
        assert.match(boss, /partyState\?\.party/);
        assert.match(api, /\/api\/clan-boss\/party/);
        assert.doesNotMatch(boss, /offline.*auto-act|allies:\s*clanmates/is);
        assert.match(lobby, /No offline player will be replaced or presented as AI/);
    });

    it("keeps the party kill switch on the explicit server-owned solo path", () => {
        assert.match(api, /response\.status === 404[\s\S]*parties-disabled/);
        assert.match(boss, /errorCode === "parties-disabled"/);
        assert.match(boss, /Solo Compatibility/);
        assert.match(boss, /startClanBossAssault\(character\.name, party\?\.id, party\?\.version/);
    });

    it("distinguishes an intentional party-route 404 from an outage at runtime", async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response('{"error":"Not found."}', { status: 404, headers: { "content-type": "application/json" } });
        try {
            const { fetchClanBossParty } = await import("./lib/clan-boss-api");
            const result = await fetchClanBossParty("solo-check");
            assert.equal(result?.errorCode, "parties-disabled");
            assert.equal(result?.party, null);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("exposes honest population, ready, reconnect, bounded fallback, and tactical pings", () => {
        assert.match(lobby, /real current population/i);
        assert.match(lobby, /Seal Loadout & Ready/);
        assert.match(lobby, /bounded two-minute wait/);
        assert.match(lobby, /Recover Leadership/);
        assert.match(boss, /Rejoin your accepted operation/);
        assert.match(read("./components/ClanBossOperationComms.tsx"), /focus-boss[\s\S]*clear-adds[\s\S]*need-heal[\s\S]*hold[\s\S]*ready/);
    });

    it("keeps canonical responsive boundaries and accessible phone controls", () => {
        assert.match(css, /@media \(max-width: 979px\)/);
        assert.match(css, /@media \(max-width: 559px\)/);
        assert.match(css, /min-height:\s*44px/);
        assert.match(css, /prefers-reduced-motion:\s*reduce/);
        assert.doesNotMatch(css, /transform:\s*scale/);
    });

    it("limits admin recovery to explicit versioned disband requests", () => {
        assert.match(admin, /expectedVersion:\s*party\.version/);
        assert.match(admin, /action:\s*"recover-disband"/);
        assert.match(admin, /confirm:\s*true/);
        assert.match(admin, /Active combat and reward values cannot be changed here/);
    });
});
