import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildChronicleRecordReceipt } from "./legacy.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => readFileSync(path.resolve(HERE, relative), "utf8");

test("Chronicle receipts are conditional, deduplicated, and never expose server ids", () => {
    assert.equal(buildChronicleRecordReceipt(undefined, "sage-acceptance"), null);
    assert.equal(buildChronicleRecordReceipt([], "legacy-awakening", "Legacy of Mercy"), null);

    const cardIds = ["story-wandering-sage", "story-wandering-sage", ""];
    const before = [...cardIds];
    const sage = buildChronicleRecordReceipt(cardIds, "sage-acceptance");
    assert.deepEqual(cardIds, before, "building presentation copy must not mutate the server receipt");
    assert.equal(sage?.count, 1);
    assert.equal(sage?.heading, "Chronicle Record Preserved");
    assert.match(sage?.message ?? "", /witnessed covenant with the Wandering Sage/i);
    assert.match(sage?.message ?? "", /a new card/i);
    assert.match(sage?.message ?? "", /already in your Chronicle collection/i);
    assert.doesNotMatch(sage?.message ?? "", /story-wandering-sage/i);
});

test("awakening receipts frame the card as a witnessed record of chosen deeds", () => {
    const receipt = buildChronicleRecordReceipt(
        ["legacy-mercy-at-the-ford", "legacy-second-record"],
        "legacy-awakening",
        "Legacy of Mercy at the Ford",
    );
    assert.equal(receipt?.count, 2);
    assert.match(receipt?.message ?? "", /Legacy of Mercy at the Ford awakened/i);
    assert.match(receipt?.message ?? "", /freely chosen, witnessed deeds/i);
    assert.match(receipt?.message ?? "", /2 new cards/i);
    assert.doesNotMatch(receipt?.message ?? "", /legacy-mercy-at-the-ford|legacy-second-record/i);
});

test("Sage and both trial surfaces announce only server-confirmed receipts", () => {
    const api = source("./legacy.ts");
    assert.equal((api.match(/chronicleCards\?: string\[\]/g) ?? []).length, 2);

    const sage = source("../components/SageOfferModal.tsx");
    const profile = source("../screens/LegacyPanel.tsx");
    const emissary = source("../components/EmissaryTrialPanel.tsx");
    const moment = source("../components/LegacyMoment.tsx");

    assert.match(sage, /buildChronicleRecordReceipt\(result\.chronicleCards,\s*"sage-acceptance"\)/);
    assert.match(profile, /buildChronicleRecordReceipt\(result\.chronicleCards,\s*"legacy-awakening",\s*def\.name\)/);
    assert.match(emissary, /buildChronicleRecordReceipt\(r\.chronicleCards,\s*"legacy-awakening",\s*defView\?\.name\)/);
    assert.match(moment, /role="status"/);
    assert.match(moment, /aria-live="polite"/);

    for (const [label, text] of [["Sage", sage], ["Profile", profile], ["Emissary", emissary]] as const) {
        assert.doesNotMatch(text, /\btileCards\b|setTileCards|updateTileCards/i, `${label} must not grant Chronicle cards client-side`);
    }
});
