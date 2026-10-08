import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Wiring contracts for the Sector War Card / Pet / Garrison screens. They pull
 * in stylesheets and the 3D arena, which node tests cannot load, so the
 * decisions live in lib/sector-war-tables.ts and lib/sector-war-garrison-api.ts
 * (tested there) and this file pins that the screens actually use them — and
 * that the screens they share with Clan War and Free Play stay as they were.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const garrison = read("./SectorWarGarrisonAssault.tsx");
const cardScreen = read("./SectorWarCardBattle.tsx");
const duel = read("./ClanWarTileCardDuel.tsx");
const freePlay = read("./CardClashFreePlay.tsx");
const petScreen = read("./SectorWarPetBattle.tsx");
const clanPet = read("./ClanWarPetBattle.tsx");
const petShell = read("../components/PetDuelReplayScreen.tsx");

test("a finished assault always reaches its result screen, even under a newer save", () => {
    // `if (... && !onVersionedCharacter(...)) return r;` left the player on
    // "Reporting the outcome…" for good whenever a newer save was installed.
    assert.doesNotMatch(garrison, /!onVersionedCharacter\(/);
    const adopt = garrison.slice(garrison.indexOf("function adoptResult("), garrison.indexOf("const adoptResultFromMount"));
    assert.match(adopt, /onVersionedCharacter\(r\.character, r\._saveVersion\);/);
    assert.match(adopt, /setPhase\("result"\)/);
});

test("a remount shows a finished assault's result instead of starting another", () => {
    assert.match(garrison, /const plan = garrisonMountPlan\(stashed\);/);
    assert.match(garrison, /plan\.kind === "show-result"/);
    assert.match(garrison, /done: true/, "the result marks the hand-off finished");
    assert.match(garrison, /res\.settledPrevious/, "an unreported earlier assault is shown, not resumed");
    assert.match(garrison, /GARRISON_IDLE_LAPSE_MINUTES/, "the idle limit is on screen");
});

test("the Sector War card table seats a defender who arrived first — and only it does", () => {
    assert.match(cardScreen, /joinWhenSeatOpens: true/);
    assert.match(cardScreen, /waitingNote: sectorCardWaitingNote/);
    assert.match(cardScreen, /sectorTableBackLabel\(backScreen\)/, "Back says where it goes");
    assert.match(duel, /if \(!config\.joinWhenSeatOpens \|\| !seatOpen \|\| view \|\| seatJoinInFlight\.current\) return;/);
    assert.match(duel, /config\.doneNote\(won, draw, warResult\)/);
    // The hosts that share the screen set none of it, so they behave as before.
    const clanConfig = duel.slice(duel.indexOf("const CLAN_WAR_DUEL_CONFIG"), duel.indexOf("export function CardClashDuelScreen"));
    assert.ok(clanConfig.length > 0);
    for (const source of [clanConfig, freePlay]) {
        assert.doesNotMatch(source, /\bjoinWhenSeatOpens\b|\bwaitingNote\b/);
    }
});

test("the Sector War pet table hands the defender a picker and offers the next duel", () => {
    assert.match(petScreen, /waiting: \(s\) => sectorPetWaiting\(s, me\)/);
    assert.match(petScreen, /nextDuel: \(s\) => sectorPetNextDuelLabel\(s, garrison\)/);
    assert.match(petShell, /nextDuel\?: \(session: S\) => string \| null;/, "optional: unset keeps the old shell");
    assert.match(petShell, /onExit=\{replayFromCard \? \(\) => setArrivedDecided\(true\) : onBack\}/);
    assert.doesNotMatch(clanPet, /nextDuel/, "the Clan War pet challenge is unchanged");
});
