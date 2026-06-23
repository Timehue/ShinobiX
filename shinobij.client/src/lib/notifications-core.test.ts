import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildNotifications,
    isBattleOnlyScreen,
    isLobbyFightScreen,
    type NotifInputs,
} from "./notifications-core";

const EMPTY: NotifInputs = { inBattle: false, clanWar: null, villageWar: null, tournament: null };

test("no signals → no notifications", () => {
    assert.deepEqual(buildNotifications(EMPTY), []);
});

test("in-battle chip is informational (no click target)", () => {
    const notes = buildNotifications({ ...EMPTY, inBattle: true });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].id, "battle");
    assert.equal(notes[0].tone, "danger");
    assert.equal(notes[0].screen, undefined);
});

test("clan war chip names the enemy and links to the clan screen", () => {
    const notes = buildNotifications({ ...EMPTY, clanWar: { enemy: "Crimson Fang" } });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].id, "clanWar");
    assert.equal(notes[0].screen, "clan");
    assert.match(notes[0].label, /Crimson Fang/);
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

test("notifications are ordered: battle → clan war → village war → tournament", () => {
    const notes = buildNotifications({
        inBattle: true,
        clanWar: { enemy: "A" },
        villageWar: { enemy: "B", pending: false },
        tournament: { name: "C" },
    });
    assert.deepEqual(notes.map((n) => n.id), ["battle", "clanWar", "villageWar", "tournament"]);
});

test("battle-only vs lobby-fight screen classification", () => {
    assert.equal(isBattleOnlyScreen("pvpBattle"), true);
    assert.equal(isBattleOnlyScreen("storyBoss"), true);
    assert.equal(isBattleOnlyScreen("arena"), false); // arena has a lobby
    assert.equal(isLobbyFightScreen("arena"), true);
    assert.equal(isLobbyFightScreen("petArena"), true);
    assert.equal(isLobbyFightScreen("village"), false);
});
