import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildNotifications,
    isBattleOnlyScreen,
    isBattleViewScreen,
    isLobbyFightScreen,
    liveFightScreen,
    savedRunScreen,
    shouldHideBattleChrome,
    type NotifInputs,
} from "./notifications-core";

const EMPTY: NotifInputs = { battle: null, territoryBreach: null, clanWar: null, villageWar: null, tournament: null };

test("ranked pet lobby retains chrome; its fullscreen battle hides it", () => {
    assert.equal(isLobbyFightScreen("petLadder"), true);
    assert.equal(shouldHideBattleChrome({ screen: "petLadder", arenaBattleActive: false, petBattleActive: false }), false);
    assert.equal(shouldHideBattleChrome({ screen: "petLadder", arenaBattleActive: false, petBattleActive: true }), true);
});

test("no signals → no notifications", () => {
    assert.deepEqual(buildNotifications(EMPTY), []);
});

test("in-battle chip links back to the screen hosting the fight", () => {
    const notes = buildNotifications({ ...EMPTY, battle: "hollowGateShrine" });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].id, "battle");
    assert.equal(notes[0].tone, "danger");
    assert.equal(notes[0].screen, "hollowGateShrine");
    assert.equal(notes[0].title, "Return to your battle");
});

test("lobbies with no live fight show no in-battle chip (Pet Colosseum report)", () => {
    // The old chip trusted the legacy battle-lock marker, which a finished
    // Story Boss fight could leave behind; opening any lobby then said "In battle".
    for (const screen of ["petArena", "petColiseum", "petShowdown", "petLadder", "arenaDistrict", "centralHub"] as const) {
        assert.equal(liveFightScreen(screen, null, null), null, screen);
    }
});

test("a saved run away from its screen points back to it", () => {
    assert.equal(savedRunScreen({ hollowGateRun: { completed: false } }), "hollowGateShrine");
    assert.equal(savedRunScreen({ hollowGateRun: { completed: true } }), null);
    assert.equal(savedRunScreen({ activeDungeonRun: { token: "run-1" } }), "dungeon");
    assert.equal(savedRunScreen({ activeDungeonRun: null, hollowGateRun: null }), null);
    assert.equal(savedRunScreen(null), null);

    assert.equal(liveFightScreen("village", "hollowGateShrine", null), "hollowGateShrine");
    assert.equal(liveFightScreen("petArena", "dungeon", null), "dungeon");
    // On the run's own screen, or any fight board, the chip is redundant.
    assert.equal(liveFightScreen("hollowGateShrine", "hollowGateShrine", null), null);
    assert.equal(liveFightScreen("hollowGateTiles", "hollowGateShrine", null), null);
    assert.equal(liveFightScreen("dungeon", "dungeon", null), null);
});

test("a Tower run key points to its host, never from a screen that hosts Tower fights", () => {
    assert.equal(liveFightScreen("village", null, "tower-0123abcd"), "battleTowers");
    assert.equal(liveFightScreen("village", null, "wcr80-0123abcd"), "worldCrisis");
    assert.equal(liveFightScreen("village", null, "wcr80pet:s1"), "worldCrisis");
    // Only the Team Arena can be left mid-match; Arena District locks until
    // ranked and tournament matches end.
    assert.equal(liveFightScreen("village", null, "pvp:tpvp-0123"), "battleArena");
    for (const screen of ["battleTowers", "worldCrisis", "arenaDistrict", "battleArena"] as const) {
        assert.equal(liveFightScreen(screen, null, "tower-0123abcd"), null, screen);
        assert.equal(liveFightScreen(screen, null, "pvp:tpvp-0123"), null, screen);
    }
});

test("no in-battle chip on the Hospital, which an admitted player cannot leave", () => {
    assert.equal(liveFightScreen("hospital", "dungeon", "tower-0123abcd"), null);
});

test("a World Crisis chip asks for the Level 80 tab, the one that resumes the fight", () => {
    const [crisis] = buildNotifications({ ...EMPTY, battle: "worldCrisis" });
    assert.equal(crisis.screen, "worldCrisis");
    assert.equal(crisis.targetView, "reckoning");
    const [towers] = buildNotifications({ ...EMPTY, battle: "battleTowers" });
    assert.equal(towers.targetView, undefined);
});

test("clan war chip names the enemy and links to the clan screen", () => {
    const notes = buildNotifications({ ...EMPTY, clanWar: { enemy: "Crimson Fang" } });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].id, "clanWar");
    assert.equal(notes[0].screen, "clan");
    assert.match(notes[0].label, /Crimson Fang/);
});

test("territory breach chip is urgent, time-bound, and deep-links to Clan Territory", () => {
    const notes = buildNotifications({
        ...EMPTY,
        territoryBreach: { sector: 40, minutesLeft: 719 },
    });
    assert.deepEqual(notes, [{
        id: "territoryBreach",
        icon: "🚨",
        label: "Sector 40 breached · 12h left",
        tone: "danger",
        screen: "clan",
        targetView: "territory",
    }]);
});

test("village war chip flags the pre-war pending window", () => {
    const live = buildNotifications({ ...EMPTY, villageWar: { enemy: "Frostfang Village", pending: false } });
    assert.equal(live[0].screen, "villageWar");
    assert.doesNotMatch(live[0].label, /starting/);

    const pending = buildNotifications({ ...EMPTY, villageWar: { enemy: "Frostfang Village", pending: true } });
    assert.match(pending[0].label, /starting/);
});

test("tournament chip links to the arena district; falls back to a generic label", () => {
    const named = buildNotifications({ ...EMPTY, tournament: { name: "Chunin Cup" } });
    assert.equal(named[0].id, "tournament");
    assert.equal(named[0].screen, "arenaDistrict");
    assert.match(named[0].label, /Chunin Cup/);

    const unnamed = buildNotifications({ ...EMPTY, tournament: { name: "" } });
    assert.match(unnamed[0].label, /Tournament/);
});

test("notifications are ordered: battle → territory breach → clan war → village war → tournament", () => {
    const notes = buildNotifications({
        battle: "dungeon",
        territoryBreach: { sector: 40, minutesLeft: 30 },
        clanWar: { enemy: "A" },
        villageWar: { enemy: "B", pending: false },
        tournament: { name: "C" },
    });
    assert.deepEqual(notes.map((n) => n.id), ["battle", "territoryBreach", "clanWar", "villageWar", "tournament"]);
});

test("battle-only vs lobby-fight screen classification", () => {
    assert.equal(isBattleOnlyScreen("pvpBattle"), true);
    assert.equal(isBattleOnlyScreen("storyBoss"), true);
    assert.equal(isBattleOnlyScreen("sectorCard"), true);
    // All three Sector War tables hide the side rails like any other fight.
    assert.equal(isBattleOnlyScreen("sectorPet"), true);
    assert.equal(isBattleOnlyScreen("sectorGarrison"), true);
    assert.equal(shouldHideBattleChrome({ screen: "sectorPet", arenaBattleActive: false, petBattleActive: false }), true);
    assert.equal(shouldHideBattleChrome({ screen: "sectorGarrison", arenaBattleActive: false, petBattleActive: false }), true);
    assert.equal(isBattleOnlyScreen("cardClashFreePlay"), true);
    assert.equal(isBattleOnlyScreen("arena"), false); // arena has a lobby
    assert.equal(isLobbyFightScreen("arena"), true);
    assert.equal(isLobbyFightScreen("petArena"), true);
    assert.equal(isLobbyFightScreen("village"), false);
});

test("battle-view screens suppress the redundant in-battle chip", () => {
    // On the actual fight board the chip is redundant (you're looking at it).
    assert.equal(isBattleViewScreen("arena"), true);
    assert.equal(isBattleViewScreen("pvpBattle"), true);
    assert.equal(isBattleViewScreen("cardClashFreePlay"), true);
    assert.equal(isBattleViewScreen("battleTowers"), true);
    assert.equal(isBattleViewScreen("dungeon"), true);
    // Lobbies / non-battle screens keep the "return to your fight" reminder.
    assert.equal(isBattleViewScreen("arenaDistrict"), false);
    assert.equal(isBattleViewScreen("petArena"), false);
    assert.equal(isBattleViewScreen("village"), false);
});

test("battle chrome hides on fight boards but stays on mixed-screen lobbies", () => {
    assert.equal(shouldHideBattleChrome({ screen: "pvpBattle", arenaBattleActive: false, petBattleActive: false }), true);
    assert.equal(shouldHideBattleChrome({ screen: "cardClashFreePlay", arenaBattleActive: false, petBattleActive: false }), true);
    assert.equal(shouldHideBattleChrome({ screen: "arena", arenaBattleActive: false, petBattleActive: false }), false);
    assert.equal(shouldHideBattleChrome({ screen: "arena", arenaBattleActive: true, petBattleActive: false }), true);
    assert.equal(shouldHideBattleChrome({ screen: "battleArena", arenaBattleActive: false, petBattleActive: false }), false);
    assert.equal(shouldHideBattleChrome({ screen: "battleArena", arenaBattleActive: true, petBattleActive: false }), true);
    assert.equal(shouldHideBattleChrome({ screen: "arenaDistrict", arenaBattleActive: false, petBattleActive: false }), false);
    assert.equal(shouldHideBattleChrome({ screen: "arenaDistrict", arenaBattleActive: true, petBattleActive: false }), true);
    assert.equal(shouldHideBattleChrome({ screen: "petArena", arenaBattleActive: false, petBattleActive: false }), false);
    assert.equal(shouldHideBattleChrome({ screen: "petArena", arenaBattleActive: false, petBattleActive: true }), true);
    // Pet Showdown: same mixed lobby/fight contract as petArena.
    assert.equal(shouldHideBattleChrome({ screen: "petShowdown", arenaBattleActive: false, petBattleActive: false }), false);
    assert.equal(shouldHideBattleChrome({ screen: "petShowdown", arenaBattleActive: false, petBattleActive: true }), true);
    // The First Pact city is full-viewport from its first frame — no rails,
    // regardless of whether its embedded battle has raised the signals yet.
    assert.equal(shouldHideBattleChrome({ screen: "firstPact", arenaBattleActive: false, petBattleActive: false }), true);
    assert.equal(shouldHideBattleChrome({ screen: "firstPact", arenaBattleActive: false, petBattleActive: true }), true);
    assert.equal(shouldHideBattleChrome({ screen: "village", arenaBattleActive: true, petBattleActive: true }), false);
});
