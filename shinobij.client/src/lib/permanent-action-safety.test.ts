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
        assert.match(kick, /nextChar\.clan = null;/);
        assert.match(kick, /nextChar\.clanUpgradeLevels = null;/);
        assert.match(kick, /nextChar\.clanDoctrine = null;/);

        const dissolution = source("../../../api/clan/_dissolve.ts");
        assert.match(dissolution, /nextCharacter\.clan = null;/);
        assert.match(dissolution, /nextCharacter\.clanUpgradeLevels = null;/);
        assert.match(dissolution, /nextCharacter\.clanDoctrine = null;/);

        const saveHandler = source("../../../api/save/[name].ts");
        assert.match(saveHandler, /CLAN_DISSOLUTION_LOCK_TTL_SEC = 120;/);
        assert.match(saveHandler, /isClanSave\s*\? \{ failClosed: true, ttlSec: CLAN_DISSOLUTION_LOCK_TTL_SEC \}/);
    });

    test("ambiguous exchange failures tell players to refresh before retrying", () => {
        const playerApi = source("./player-api.ts");
        const purchase = between(playerApi, "export async function postClanExchangePurchase", "// Server-authoritative clan kick");
        assert.match(purchase, /AMBIGUOUS_ACTION_MESSAGE/);
    });

    test("guard queue failures cannot be adopted as local success", () => {
        const api = source("./clan-api.ts");
        const guardRequest = api.slice(api.indexOf("export async function postGuardQueue"));
        assert.match(guardRequest, /if \(!res\.ok\)/);
        assert.doesNotMatch(guardRequest, /catch\(\(\) => \{ \}\)/);

        for (const relative of ["../screens/ClanHall.tsx", "../screens/TownHall.tsx"]) {
            const screen = source(relative);
            const toggle = between(screen, relative.includes("ClanHall") ? "async function toggleGuard" : "async function toggleTownGuard", relative.includes("ClanHall") ? "\n    async function donateRyo" : "\n    const isSeatedKage");
            const request = toggle.indexOf("await postGuardQueue(");
            const localWrite = toggle.indexOf("updateCharacter(");
            assert.match(toggle, /if \(guardBusyRef\.current\) return;/);
            assert.ok(request >= 0 && localWrite > request, `${relative} must update local guard state only after server success`);
            assert.match(toggle, /finally\s*\{[\s\S]*guardBusyRef\.current = false;/);
        }
    });

    test("clan document changes are shown only after persistence succeeds", () => {
        const hall = source("../screens/ClanHall.tsx");
        const save = between(hall, "async function saveClan", "\n    // Claim a completed clan mission");
        const request = save.indexOf("await writeClanData(enhanced)");
        const localWrite = save.indexOf("setClanData(enhanced)");
        assert.ok(request >= 0 && localWrite > request, "clan state must not optimistically claim an unpersisted save");
        assert.match(save, /return true;/);
        assert.match(save, /return false;/);

        const recruitment = between(hall, "async function saveRecruitment", "\n    async function createClan");
        assert.match(recruitment, /if \(await saveClan/);
        assert.match(recruitment, /Recruitment pitch updated\./);
    });

    test("resource-spending screens use synchronous duplicate guards", () => {
        const cases: Array<[string, string]> = [
            ["../components/Shop.tsx", "purchaseBusyRef"],
            ["../screens/Bank.tsx", "sendingRef"],
            ["../screens/ClanBattlesTab.tsx", "busyRef"],
            ["../screens/ClanHall.tsx", "donateBusyRef"],
            ["../screens/ClanSealPool.tsx", "busyRef"],
            ["../screens/Hospital.tsx", "busyRef"],
            ["../screens/PetYard.tsx", "evolveBusyRef"],
            ["../screens/Profile.tsx", "profileMutationBusyRef"],
            ["../screens/SunscarFestival.tsx", "bmBusyRef"],
            ["../screens/TownHall.tsx", "donateBusyRef"],
            ["../screens/Training.tsx", "busyRef"],
        ];
        for (const [relative, refName] of cases) {
            const file = source(relative);
            assert.match(file, new RegExp(`if \\(.*${refName}\\.current`), `${relative} must check ${refName} synchronously`);
            assert.match(file, new RegExp(`${refName}\\.current = true;`), `${relative} must acquire ${refName}`);
            assert.match(file, new RegExp(`${refName}\\.current = false;`), `${relative} must release ${refName}`);
        }
    });

    test("ambiguous paid-action failures direct players to refresh", () => {
        assert.match(source("./ambiguous-action.ts"), /AMBIGUOUS_ACTION_MESSAGE = "Action unconfirmed\. Refresh before retrying\."/);
        const profileSettlement = source("./profile-settlement.ts");
        assert.match(profileSettlement, /AMBIGUOUS_ACTION_MESSAGE/);

        const shop = source("../components/Shop.tsx");
        assert.match(shop, /AMBIGUOUS_ACTION_MESSAGE/);

        const training = source("../screens/Training.tsx");
        assert.match(training, /AMBIGUOUS_ACTION_MESSAGE/);

        for (const relative of ["./player-trade.ts", "./card-pack.ts", "./black-market.ts", "./sunscar-festival.ts", "./player-api.ts"]) {
            assert.match(source(relative), /unconfirmed|response lost|AMBIGUOUS_ACTION_MESSAGE/i, `${relative} must label an ambiguous response`);
            if (relative !== "./player-api.ts") assert.match(source(relative), /Refresh before retrying/i, `${relative} must not encourage a blind retry`);
        }
    });

    test("shop and permanent legacy choice use the canonical accessible modal", () => {
        const shop = source("../components/Shop.tsx");
        assert.match(shop, /<Modal open onClose=\{closeItem\}/);
        assert.doesNotMatch(shop, /createPortal|useBodyScrollLock/);

        const sage = source("../components/SageOfferModal.tsx");
        assert.match(sage, /<Modal open onClose=\{close\}/);
        assert.match(sage, /if \(busyRef\.current\) return;/);
        assert.doesNotMatch(sage, /createPortal/);
    });
});
