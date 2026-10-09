import { strict as assert } from "node:assert";
import test from "node:test";
import {
    SECTOR_CARD_FORFEIT_CONFIRM,
    SECTOR_CARD_GARRISON_FORFEIT_CONFIRM,
    sectorCardDoneNote,
    sectorCardGarrisonDoneNote,
    sectorCardWaitEnded,
    sectorCardWaitingNote,
    sectorPetBanner,
    sectorPetNextDuelLabel,
    sectorPetWaiting,
    sectorTableBackLabel,
    type SectorPetView,
} from "./sector-war-tables";

function petTable(overrides: Partial<SectorPetView> = {}): SectorPetView {
    return {
        status: "awaiting-defender",
        attackerVillage: "Moonshadow Village",
        defenderVillage: "Frostfang Village",
        p1: { name: "raider" },
        ...overrides,
    };
}

test("only the attacker who opened a pet duel waits on it; a defender gets the picker", () => {
    // Everyone used to get the attacker's waiting card, so a defender who came
    // to answer never saw a picker and could not answer at all.
    const opener = sectorPetWaiting(petTable({ viewerSide: "p1", p1: { name: "raider", pet: { name: "Ashfang" } } }), "raider");
    assert.equal(opener?.headline, "Waiting for a defender to answer with their pet…");
    assert.match(opener?.detail ?? "", /Ashfang/);

    assert.equal(sectorPetWaiting(petTable({ viewerSide: null, canAnswer: true }), "holdout"), null, "the defender answers from the picker");

    const teammate = sectorPetWaiting(petTable({ viewerSide: null, canAnswer: false }), "raidertwo");
    assert.ok(teammate);
    assert.doesNotMatch(teammate!.detail, /Your pet/, "a teammate is not told it is their pet waiting");

    assert.equal(sectorPetWaiting(petTable({ status: "done" }), "raider"), null);
});

test("an older server's answer (no viewerSide) still resolves the opener by name", () => {
    assert.ok(sectorPetWaiting(petTable(), "Raider"));
    assert.equal(sectorPetWaiting(petTable({ canAnswer: true }), "holdout"), null);
});

test("the banner never calls a duel that outlived its war a score", () => {
    const decided = petTable({ status: "done", viewerSide: "p1", winner: "p1", p2: { name: "holdout" } });
    assert.equal(sectorPetBanner(decided, "raider"), "Your pet won the sector duel!");
    assert.equal(sectorPetBanner({ ...decided, viewerSide: "p2" }, "holdout"), "Your pet was defeated.");
    assert.equal(sectorPetBanner({ ...decided, viewerSide: null }, "watcher"), "Moonshadow Village took the duel.");
    const late = sectorPetBanner({ ...decided, warResult: { scored: false, reason: "superseded" } }, "raider");
    assert.match(late, /^Your pet won the sector duel! It did not count/);
    assert.doesNotMatch(sectorPetBanner({ ...decided, warResult: { scored: true, points: 5 } }, "raider"), /did not count/);
});

test("a decided pet duel offers the next one; a garrison duel does not", () => {
    const decided = petTable({ status: "done", winner: "p2", p2: { name: "holdout" } });
    assert.equal(sectorPetNextDuelLabel({ ...decided, viewerSide: "p1" }, false), "Open a new duel");
    assert.equal(sectorPetNextDuelLabel({ ...decided, viewerSide: "p2" }, false), "Back to the table");
    assert.equal(sectorPetNextDuelLabel({ ...decided, viewerSide: "p1" }, true), null, "the garrison re-forms on its own clock");
    assert.equal(sectorPetNextDuelLabel({ ...decided, garrison: true, viewerSide: "p1" }, false), null);
    assert.equal(sectorPetNextDuelLabel(petTable({ viewerSide: "p1" }), false), null, "an open duel is not decided yet");
});

test("the card table's waiting line is right for the side that reads it", () => {
    // "Waiting for the defending challenger to join." used to be shown to the
    // defender, who WAS the defending challenger.
    assert.match(sectorCardWaitingNote({ status: "awaiting-defender", viewerSide: "p1" }), /Waiting for a defender/);
    assert.match(sectorCardWaitingNote({ status: "awaiting-attacker", viewerSide: null }), /No attacker has opened/);
    assert.match(sectorCardWaitingNote({ status: "awaiting-defender", viewerSide: null }), /defender's seat/);
    for (const status of ["awaiting-defender", "awaiting-attacker"]) {
        assert.doesNotMatch(sectorCardWaitingNote({ status, viewerSide: null }), /defending challenger/);
    }
});

test("an open-world card duel names who each duelist is waiting on", () => {
    // The challenger waits on the player they attacked; the challenged player's
    // client is already taking its seat. Either may be the war's attacking side.
    const challenger = sectorCardWaitingNote({ status: "awaiting-target", viewerSide: "p2", opponent: "raider", initiator: "warden" });
    assert.match(challenger, /^Waiting for raider to take their seat\./);
    assert.match(challenger, /nothing scores/);
    assert.equal(
        sectorCardWaitingNote({ status: "awaiting-target", viewerSide: "p1", opponent: "warden", initiator: "warden" }),
        "warden challenged you to a card duel for this sector. Taking your seat…",
    );
    assert.match(sectorCardWaitingNote({ status: "awaiting-target", viewerSide: "p1" }), /^Waiting for your opponent/);
    assert.match(sectorCardWaitingNote({ status: "void", viewerSide: "p1", opponent: "raider", initiator: "warden" }), /called off before it began\. Nothing scored/);
});

test("only a called-off open duel ends the wait; every table wait keeps polling", () => {
    assert.equal(sectorCardWaitEnded({ status: "void" }), true);
    for (const status of ["awaiting-target", "awaiting-defender", "awaiting-attacker", undefined]) {
        assert.equal(sectorCardWaitEnded({ status }), false, String(status));
    }
});

test("the card table says 'scored' only when the server says it scored", () => {
    assert.equal(sectorCardDoneNote(true, false), "The server scored this win for your side of the war.");
    assert.equal(sectorCardDoneNote(false, false, { scored: true, points: 3 }), "The server scored this win for the enemy side of the war.");
    assert.match(sectorCardDoneNote(true, false, { scored: false, reason: "superseded" }), /did not count/);
    assert.match(sectorCardGarrisonDoneNote(true, false, { scored: false, reason: "terminal" }), /did not count/);
    assert.match(sectorCardDoneNote(false, true, { scored: false, reason: "draw" }), /draw scores nothing/);
});

test("a forfeit is the other side's win, and the confirm says so", () => {
    for (const confirm of [SECTOR_CARD_FORFEIT_CONFIRM, SECTOR_CARD_GARRISON_FORFEIT_CONFIRM]) {
        assert.doesNotMatch(confirm, /scores nothing/);
        // CardClashDuelScreen's Leave reuses everything after the first "? ".
        assert.ok(confirm.split("? ").slice(1).join("? ").length > 0);
    }
    assert.match(SECTOR_CARD_FORFEIT_CONFIRM, /enemy side takes the win/);
    assert.match(SECTOR_CARD_GARRISON_FORFEIT_CONFIRM, /garrison takes the win/);
});

test("a table opened from the world map says it goes back there", () => {
    assert.equal(sectorTableBackLabel("worldMap"), "Back to World Map");
    assert.equal(sectorTableBackLabel("villageWarMap"), "Back to War Map");
});
