import assert from "node:assert/strict";
import test from "node:test";
import {
    OPEN_SECTOR_BATTLE_EVENT,
    beginOpenSectorBattle,
    beginSectorContest,
    contestBackKey,
    openSectorBattleFromNotice,
    sectorContestGarrisonReady,
    sectorContestEntryFor,
    sectorContestLabel,
    sectorEngagementFor,
    stashedContestBackScreen,
    stashedOpenBattleId,
    viewerSectorContest,
    type SectorWarContestView,
} from "./sector-war-engagement";

// The screens read their handoff from sessionStorage; node:test has none.
const store = new Map<string, string>();
(globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
};

const NOW = 1_700_000_000_000;

function contest(over: Partial<SectorWarContestView> = {}): SectorWarContestView {
    return {
        id: "12:leaf-vs-mist",
        sector: 12,
        winCondition: "card",
        attackerVillage: "Leaf Village",
        defenderVillage: "Mist Village",
        endsAt: NOW + 60_000,
        ...over,
    };
}

const attack = (over: Partial<Parameters<typeof sectorEngagementFor>[0]> = {}) => sectorEngagementFor({
    contest: contest(),
    sector: 12,
    myVillage: "Leaf Village",
    targetVillage: "Mist Village",
    now: NOW,
    ...over,
});

test("a Card sector routes an attack to the card table, not a shinobi fight", () => {
    const engagement = attack();
    assert.equal(engagement.kind, "contest");
    assert.partialDeepStrictEqual(engagement, {
        winCondition: "card",
        contestId: "12:leaf-vs-mist",
        screen: "sectorCard",
        stashKey: "sectorWarCard.v1",
    });
});

test("a Pet sector routes to the pet duel screen and its own stash", () => {
    const engagement = attack({ contest: contest({ winCondition: "pet" }) });
    assert.partialDeepStrictEqual(engagement, { winCondition: "pet", screen: "sectorPet", stashKey: "sectorWarPet.v1" });
});

test("the defender attacking the besieger routes the same way — this is not attacker-only", () => {
    assert.equal(attack({ myVillage: "Mist Village", targetVillage: "Leaf Village" }).kind, "contest");
});

test("Combat sectors and sectors with no war keep the shinobi fight untouched", () => {
    assert.equal(attack({ contest: contest({ winCondition: "combat" }) }).kind, "combat");
    assert.equal(attack({ contest: null }).kind, "combat");
    assert.equal(attack({ contest: undefined }).kind, "combat");
});

test("a bystander village fighting inside someone else's war stays ordinary world PvP", () => {
    // The server refuses a non-participant at both contest endpoints (403), so
    // routing them to the table would only send them somewhere to be rejected.
    assert.equal(attack({ myVillage: "Sand Village" }).kind, "combat");
    assert.equal(attack({ targetVillage: "Sand Village" }).kind, "combat");
    assert.equal(attack({ myVillage: "Sand Village", targetVillage: "Cloud Village" }).kind, "combat");
});

test("same-village, blank and missing villages fall back to combat rather than routing", () => {
    assert.equal(attack({ myVillage: "Leaf Village", targetVillage: "Leaf Village" }).kind, "combat");
    assert.equal(attack({ myVillage: "" }).kind, "combat");
    assert.equal(attack({ targetVillage: null }).kind, "combat");
    assert.equal(attack({ myVillage: undefined }).kind, "combat");
});

test("a contest polled for another sector never routes the sector on screen", () => {
    assert.equal(attack({ sector: 13 }).kind, "combat");
    assert.equal(attack({ contest: contest({ sector: 13 }) }).kind, "combat");
});

test("a war whose 72h window has closed stops routing, even from a stale poll", () => {
    assert.equal(attack({ now: NOW + 60_000 }).kind, "combat");
    assert.equal(attack({ now: NOW + 999_999 }).kind, "combat");
    assert.equal(attack({ contest: contest({ endsAt: NOW }) }).kind, "combat");
});

test("viewerSectorContest narrows to a war the viewer is IN, so the panel stays presentation-only", () => {
    assert.equal(viewerSectorContest(contest(), 12, "Leaf Village", NOW)?.id, "12:leaf-vs-mist");
    assert.equal(viewerSectorContest(contest(), 12, "Mist Village", NOW)?.id, "12:leaf-vs-mist");
    assert.equal(viewerSectorContest(contest(), 12, "Sand Village", NOW), null);
    assert.equal(viewerSectorContest(contest({ winCondition: "combat" }), 12, "Leaf Village", NOW), null);
    assert.equal(viewerSectorContest(contest(), 13, "Leaf Village", NOW), null);
    assert.equal(viewerSectorContest(contest(), 12, "Leaf Village", NOW + 60_000), null);
    assert.equal(viewerSectorContest(null, 12, "Leaf Village", NOW), null);
});

test("the sector's own entry needs no co-located opponent, only a participant village", () => {
    // The whole point: a Card/Pet table is opened by one side and answered later,
    // so requiring someone to stand there would have kept the War Map menu as the
    // only way in.
    assert.equal(sectorContestEntryFor(contest(), 12, "Leaf Village", NOW).kind, "contest");
    assert.equal(sectorContestEntryFor(contest(), 12, "Mist Village", NOW).kind, "contest");
    assert.equal(sectorContestEntryFor(contest(), 12, "Sand Village", NOW).kind, "combat");
    assert.equal(sectorContestEntryFor(contest({ winCondition: "combat" }), 12, "Leaf Village", NOW).kind, "combat");
});

test("labels name the game the button opens", () => {
    assert.equal(sectorContestLabel("card"), "Card Battle");
    assert.equal(sectorContestLabel("pet"), "Pet Battle");
});

test("the contest stash keeps the War Map's exact shape — the back target rides beside it", () => {
    // ClanWarTileCardDuel posts `{ action, ...stash }`, so an extra key in the
    // stash becomes request body. The return target must stay out of it.
    store.clear();
    const screen = beginSectorContest(attack(), "worldMap");
    assert.equal(screen, "sectorCard");
    assert.deepEqual(JSON.parse(store.get("sectorWarCard.v1")!), { sectorWarId: "12:leaf-vs-mist" });
    assert.equal(store.get(contestBackKey("sectorWarCard.v1")), "worldMap");
    assert.equal(stashedContestBackScreen("sectorWarCard.v1", "villageWarMap"), "worldMap");
});

test("a combat engagement writes nothing and routes nowhere", () => {
    store.clear();
    assert.equal(beginSectorContest({ kind: "combat" }, "worldMap"), null);
    assert.equal(store.size, 0);
});

test("the War Map's own launch, which records no target, still goes back to the War Map", () => {
    store.clear();
    store.set("sectorWarPet.v1", JSON.stringify({ sectorWarId: "12:leaf-vs-mist" }));
    assert.equal(stashedContestBackScreen("sectorWarPet.v1", "villageWarMap"), "villageWarMap");
});

test("the garrison button follows the SERVER's verdict, never a re-derived clock", () => {
    // The rule spans an idle window, a re-form window between garrison battles,
    // and attacker-side-only — and the re-form half reads `appliedBattles`, which
    // no client projection carries. Re-deriving it here would drift from what the
    // endpoints actually enforce, so the client only relays the answer.
    assert.equal(sectorContestGarrisonReady(contest({ garrisonReady: true }) as never, NOW), true);
    assert.equal(sectorContestGarrisonReady(contest({ garrisonReady: false }) as never, NOW), false);
    assert.equal(sectorContestGarrisonReady(contest() as never, NOW), false, "absent means no");
    assert.equal(sectorContestGarrisonReady(null, NOW), false);
});

test("a closed war never offers the garrison, whatever the server last said", () => {
    // The contest poll can outlive the 72h window between renders; a stale
    // garrisonReady must not survive the clock running out.
    assert.equal(sectorContestGarrisonReady(contest({ garrisonReady: true }) as never, NOW + 60_000), false);
});

const ENGAGE_ID = "0123456789abcdef01234567";

test("an inbox notice routes into an open battle only when it names one this client can trust", () => {
    const battle = { kind: "pet", sectorWarId: "12:leaf-vs-mist", engageId: ENGAGE_ID };
    assert.deepEqual(openSectorBattleFromNotice({ sectorContest: battle }), battle);
    assert.deepEqual(openSectorBattleFromNotice({ sectorContest: { ...battle, kind: "card" } }), { ...battle, kind: "card" });
    // A Combat attack's notice carries no contest: it keeps its own route.
    assert.equal(openSectorBattleFromNotice({}), null);
    assert.equal(openSectorBattleFromNotice(null), null);
    assert.equal(openSectorBattleFromNotice({ sectorContest: { ...battle, kind: "combat" } }), null);
    // The id addresses a server key, so only the server's own shape is routed on.
    assert.equal(openSectorBattleFromNotice({ sectorContest: { ...battle, engageId: "../sector-pet:12" } }), null);
    assert.equal(openSectorBattleFromNotice({ sectorContest: { ...battle, engageId: ENGAGE_ID.toUpperCase() } }), null);
    assert.equal(openSectorBattleFromNotice({ sectorContest: { ...battle, sectorWarId: " " } }), null);
});

test("an open battle stashes its id for the screen, and the table's entry clears it", () => {
    store.clear();
    const battle = { sectorWarId: "12:leaf-vs-mist", engageId: ENGAGE_ID };
    assert.equal(beginOpenSectorBattle({ kind: "card", ...battle }, "worldMap"), "sectorCard");
    // The Chronicle screen posts `{ action, ...stash }`, and the server needs the
    // id to address the duel, so it rides IN the stash. The back target does not.
    assert.deepEqual(JSON.parse(store.get("sectorWarCard.v1")!), battle);
    assert.equal(stashedOpenBattleId("sectorWarCard.v1"), ENGAGE_ID);
    assert.equal(stashedContestBackScreen("sectorWarCard.v1", "villageWarMap"), "worldMap");
    assert.equal(beginOpenSectorBattle({ kind: "pet", ...battle }, "worldMap"), "sectorPet");
    assert.equal(stashedOpenBattleId("sectorWarPet.v1"), ENGAGE_ID);
    // A later visit to the table must never be mistaken for the open battle.
    beginSectorContest(attack(), "worldMap");
    assert.equal(stashedOpenBattleId("sectorWarCard.v1"), "");
    store.set("sectorWarPet.v1", "{not json");
    assert.equal(stashedOpenBattleId("sectorWarPet.v1"), "");
});

test("stashing an open battle tells a contest screen that is already showing to remount", () => {
    // App does not remount a screen it is asked to show again, so a player still
    // on the Pet or Card screen would otherwise never see the new battle.
    const target = new EventTarget();
    const heard: unknown[] = [];
    target.addEventListener(OPEN_SECTOR_BATTLE_EVENT, (event) => { heard.push((event as CustomEvent<unknown>).detail); });
    (globalThis as { window?: unknown }).window = target;
    try {
        store.clear();
        beginOpenSectorBattle({ kind: "pet", sectorWarId: "12:leaf-vs-mist", engageId: ENGAGE_ID }, "worldMap");
        beginOpenSectorBattle({ kind: "card", sectorWarId: "12:leaf-vs-mist", engageId: ENGAGE_ID }, "worldMap");
        // The stash is written first, so the remounted screen reads the new battle.
        assert.deepEqual(heard, ["sectorWarPet.v1", "sectorWarCard.v1"]);
        assert.equal(stashedOpenBattleId("sectorWarCard.v1"), ENGAGE_ID);
        // The table's own entry is a navigation, not a battle drawn onto a screen.
        beginSectorContest(attack(), "worldMap");
        assert.equal(heard.length, 2);
    } finally {
        delete (globalThis as { window?: unknown }).window;
    }
});
