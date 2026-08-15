import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { Character } from "../types/character";
import { captureOwnSaveRead, reconcileOwnSaveReadVitals } from "./own-save-read";

function character(name = "Rill", vitals: Partial<Pick<Character, "hp" | "chakra" | "stamina">> = {}): Character {
    return { name, hp: 10, chakra: 20, stamina: 30, ...vitals } as Character;
}

describe("owner-save elapsed-vital reconciliation", () => {
    it("adopts every settled vital that stayed unchanged during the read", () => {
        const before = character();
        const anchor = captureOwnSaveRead(before);
        const result = reconcileOwnSaveReadVitals(before, anchor, character("rill", { hp: 15, chakra: 25, stamina: 35 }));

        assert.deepEqual(
            result && { hp: result.hp, chakra: result.chakra, stamina: result.stamina },
            { hp: 15, chakra: 25, stamina: 35 },
        );
    });

    it("preserves fieldwise local edits made while the owner read was in flight", () => {
        const anchor = captureOwnSaveRead(character());
        const current = character("Rill", { hp: 7, chakra: 20, stamina: 30 });
        const result = reconcileOwnSaveReadVitals(current, anchor, character("Rill", { hp: 15, chakra: 25, stamina: 35 }));

        assert.deepEqual(
            result && { hp: result.hp, chakra: result.chakra, stamina: result.stamina },
            { hp: 7, chakra: 25, stamina: 35 },
        );
    });

    it("ignores cross-account receipts and keeps the current object identity", () => {
        const current = character("Kite");
        const anchor = captureOwnSaveRead(character("Rill"));
        const matchingCurrent = character("Rill");

        assert.equal(reconcileOwnSaveReadVitals(current, anchor, character("Rill", { hp: 99 })), current);
        assert.equal(reconcileOwnSaveReadVitals(matchingCurrent, anchor, character("Kite", { hp: 99 })), matchingCurrent);
    });

    it("keeps the runtime lazy and captures the remaining canonical owner reads before their requests", () => {
        const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
        const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");

        for (const source of [app, worldMap]) {
            assert.match(source, /import type \{[^}]*OwnSaveRead[^}]*\} from ["'][^"']+\/own-save-read["'];/);
            assert.match(source, /const loadOwnSaveRead = \(\) => import\(["'][^"']+\/own-save-read["']\);/);
            assert.doesNotMatch(source, /import \{[^}]*captureOwnSaveRead[^}]*\} from ["'][^"']+\/own-save-read["'];/);
        }

        const adopter = app.slice(app.indexOf("async function adoptOwnSaveRead"), app.indexOf("function commitVersionedCharacter"));
        assert.ok(adopter.indexOf('return "foreign"') < adopter.indexOf("await loadOwnSaveRead()"));
        assert.ok(adopter.indexOf("await loadOwnSaveRead()") < adopter.indexOf("acceptExternalSaveVersion(settledVersion, anchor.accountName)"));
        assert.ok(adopter.indexOf('result !== "accepted"') < adopter.indexOf("reconcileOwnSaveReadVitals"));

        assert.match(app, /await loadOwnSaveRead\(\)[\s\S]*?(?:const\s+)?p2ReadAnchor = captureOwnSaveRead\(acceptingCharacter\)[\s\S]*?fetchPlayerCombatSave\(acceptingCharacter\.name\)[\s\S]*?await adoptOwnSaveRead\(p2ReadAnchor, p2CombatSave\.character, p2CombatSave\._saveVersion\)/);
        assert.match(worldMap, /await loadOwnSaveRead\(\)[\s\S]*?const selfReadAnchor = captureOwnSaveRead\(character\)[\s\S]*?fetchPlayerCombatSave\(character\.name\)[\s\S]*?await onOwnSaveRead\(selfReadAnchor, selfSave\.character, selfSave\._saveVersion\)/);
        assert.match(app, /loadOwnSaveRead\(\)[\s\S]*?const vanguardReadAnchor = captureOwnSaveRead\(rewarded\)[\s\S]*?return fetch\(`\/api\/save\/[\s\S]*?await adoptOwnSaveRead\(vanguardReadAnchor, serverChar, \(data as Record<string, unknown> \| null\)\?\._saveVersion\)/);
    });
});
