import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

function source(relativeUrl: string): string {
    return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

function between(fileSource: string, startMarker: string, endMarker: string): string {
    const start = fileSource.indexOf(startMarker);
    assert.notEqual(start, -1, `${startMarker} must exist`);
    const end = fileSource.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `${endMarker} must follow ${startMarker}`);
    return fileSource.slice(start, end);
}

describe("permanent action interaction safety", () => {
    test("clan exchange blocks rapid duplicate purchases and uses canonical dialogs", () => {
        const exchange = source("../components/ClanExchange.tsx");
        const purchase = between(exchange, "async function purchase", "\n    return (");
        const guard = purchase.indexOf("if (purchaseBusyRef.current) return;");
        const request = purchase.indexOf("postClanExchangePurchase(");
        assert.ok(guard >= 0 && request > guard, "the synchronous guard must run before the purchase request");
        assert.match(purchase, /purchaseBusyRef\.current = true;/);
        assert.match(purchase, /finally\s*\{[\s\S]*purchaseBusyRef\.current = false;/);
        assert.ok((exchange.match(/<Modal/g) ?? []).length >= 2, "confirmation and reveal must use the canonical modal");
        assert.doesNotMatch(exchange, /createPortal|modal-overlay/);
    });

    test("clan deletion changes local membership only after verified server success", () => {
        const hall = source("../screens/ClanHall.tsx");
        const deletion = between(hall, "async function deleteClan", "\n    async function toggleGuard");
        const duplicateGuard = deletion.indexOf("clanDeleteBusyRef.current");
        const request = deletion.indexOf('method: "DELETE"');
        const verified = deletion.indexOf("data.ok !== true");
        const localWrite = deletion.indexOf("updateCharacter(");
        assert.ok(duplicateGuard >= 0 && request > duplicateGuard, "the synchronous guard must run before deletion");
        assert.ok(verified > request && localWrite > verified, "local clan state must change only after a verified response");
        assert.match(deletion, /Refresh the game to check before trying again\./);
        assert.match(deletion, /Nothing was changed locally\./);
        assert.match(deletion, /clanUpgradeLevels: undefined, clanDoctrine: undefined/);

        const kick = source("../../../api/clan/kick.ts");
        assert.match(kick, /delete nextChar\.clanUpgradeLevels;/);
        assert.match(kick, /delete nextChar\.clanDoctrine;/);
    });

    test("ambiguous exchange failures tell players to refresh before retrying", () => {
        const playerApi = source("./player-api.ts");
        const purchase = between(playerApi, "export async function postClanExchangePurchase", "// Server-authoritative clan kick");
        assert.match(purchase, /did not confirm whether the purchase completed/);
        assert.match(purchase, /Refresh your character before trying again/);
    });
});
