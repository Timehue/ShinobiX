import { test } from "node:test";
import assert from "node:assert/strict";
import type { TileCard } from "../data/tile-cards";
import { shinobiTileCards } from "../data/tile-cards";
import {
    deriveCardClashCard,
    deriveCardRole,
    deriveAbilityType,
    toClashCards,
    indexClashCards,
    validateDeck,
    canAddToDeck,
    deckCopyLimit,
    generateAiDeck,
    buildPlayableDeck,
    createCardClashMatch,
    getEffectiveCost,
    getLocationPowerBonus,
    getCardDisplayedPower,
    determineWinner,
    playCard,
    applyOnRevealEffect,
    aiTakeTurn,
    endTurn,
    retreat,
    cardClashReward,
    CARD_CLASH_LOCATIONS,
    CARD_CLASH_DECK_SIZE,
    CARD_CLASH_LOCATION_SLOTS,
    CARD_CLASH_MAX_LEGENDARY,
    SHADOW_CLONE_CARD,
    type CardClashCard,
    type CardClashMatchState,
    type CardClashLocation,
    type CardClashPlayedCard,
} from "./card-clash";

// ── Test fixtures ────────────────────────────────────────────────────────────

function tile(over: Partial<TileCard>): TileCard {
    return {
        id: "x",
        name: "Test",
        element: "None",
        top: 30,
        right: 30,
        bottom: 30,
        left: 30,
        rarity: "common",
        description: "",
        ...over,
    };
}

// ── Conversion ────────────────────────────────────────────────────────────────

test("deriveCardClashCard clamps cost 1..6 and power 1..12", () => {
    for (const c of shinobiTileCards) {
        const clash = deriveCardClashCard(c);
        assert.ok(clash.cost >= 1 && clash.cost <= 6, `${c.name} cost ${clash.cost}`);
        assert.ok(clash.power >= 1 && clash.power <= 12, `${c.name} power ${clash.power}`);
        assert.ok(clash.abilityText.length > 0);
    }
});

test("legendaries cost more than commons on average", () => {
    const avg = (r: TileCard["rarity"]) => {
        const cards = shinobiTileCards.filter((c) => c.rarity === r).map(deriveCardClashCard);
        return cards.reduce((s, c) => s + c.cost, 0) / cards.length;
    };
    assert.ok(avg("legendary") > avg("common"));
    assert.ok(avg("epic") > avg("rare"));
});

test("plain None commons have no ability; elements get abilities", () => {
    assert.equal(deriveAbilityType(tile({ rarity: "common", element: "None" }), "fighter"), "none");
    assert.equal(deriveAbilityType(tile({ element: "Fire" }), "fighter"), "onRevealDebuffEnemiesHere");
    assert.equal(deriveAbilityType(tile({ element: "Water" }), "fighter"), "onRevealBuffAlliesHere");
    assert.equal(deriveAbilityType(tile({ element: "Lightning" }), "fighter"), "discountNextCard");
});

test("role derivation keys off card name then element/spread", () => {
    assert.equal(deriveCardRole(tile({ name: "Shadow Clone" }), 0), "summoner");
    assert.equal(deriveCardRole(tile({ name: "Iron Mask Guard" }), 0), "defender");
    assert.equal(deriveCardRole(tile({ name: "Scroll Thief" }), 0), "assassin");
    assert.equal(deriveCardRole(tile({ name: "Shrine Monk" }), 0), "support");
    assert.equal(deriveCardRole(tile({ name: "Plain", element: "Ice" }), 0), "control");
    assert.equal(deriveCardRole(tile({ name: "Plain", element: "Fire" }), 40), "fighter");
});

// ── Deck rules ────────────────────────────────────────────────────────────────

test("deck copy limits: common/rare 2, epic/legendary 1", () => {
    assert.equal(deckCopyLimit("common"), 2);
    assert.equal(deckCopyLimit("rare"), 2);
    assert.equal(deckCopyLimit("epic"), 1);
    assert.equal(deckCopyLimit("legendary"), 1);
});

test("validateDeck enforces size, copies, and legendary cap", () => {
    const byId = indexClashCards(toClashCards(shinobiTileCards));
    const commons = shinobiTileCards.filter((c) => c.rarity === "common").map((c) => c.id);
    const legendaries = shinobiTileCards.filter((c) => c.rarity === "legendary").map((c) => c.id);

    // Valid: 12 distinct commons
    assert.equal(validateDeck(commons.slice(0, 12), byId).valid, true);

    // Wrong size
    assert.equal(validateDeck(commons.slice(0, 11), byId).valid, false);

    // 3 copies of one common (over limit of 2)
    const overCopies = [commons[0], commons[0], commons[0], ...commons.slice(1, 10)];
    assert.equal(validateDeck(overCopies, byId).valid, false);

    // 3 legendaries (over cap of 2)
    const overLegend = [
        legendaries[0], legendaries[1], legendaries[2],
        ...commons.slice(0, 9),
    ];
    assert.equal(validateDeck(overLegend, byId).valid, false);
});

test("canAddToDeck blocks 3rd common copy and 3rd legendary", () => {
    const byId = indexClashCards(toClashCards(shinobiTileCards));
    const common = shinobiTileCards.find((c) => c.rarity === "common")!.id;
    assert.equal(canAddToDeck([common, common], common, byId).ok, false);
    assert.equal(canAddToDeck([common], common, byId).ok, true);

    const legs = shinobiTileCards.filter((c) => c.rarity === "legendary").map((c) => c.id);
    assert.equal(canAddToDeck([legs[0], legs[1]], legs[2], byId).ok, false);
});

// ── AI deck generation ────────────────────────────────────────────────────────

test("generateAiDeck always returns a legal 12-card deck", () => {
    const catalog = toClashCards(shinobiTileCards);
    const byId = indexClashCards(catalog);
    for (const lvl of [1, 30, 60]) {
        const deck = generateAiDeck(catalog, lvl);
        assert.equal(deck.length, CARD_CLASH_DECK_SIZE);
        const v = validateDeck(deck.map((c) => c.id), byId);
        assert.ok(v.valid, `level ${lvl} AI deck invalid: ${v.errors.join("; ")}`);
    }
});

test("low-level AI decks contain no epics/legendaries", () => {
    const catalog = toClashCards(shinobiTileCards);
    const deck = generateAiDeck(catalog, 5);
    assert.ok(deck.every((c) => c.rarity === "common" || c.rarity === "rare"));
});

test("buildPlayableDeck always returns a legal 12-card deck", () => {
    const catalog = toClashCards(shinobiTileCards);
    const byId = indexClashCards(catalog);

    // 0 owned → fully padded from catalog
    const padded = buildPlayableDeck([], byId, catalog);
    assert.equal(padded.length, CARD_CLASH_DECK_SIZE);
    assert.ok(validateDeck(padded, byId).valid);

    // A handful owned → owned cards preferred, padded to 12
    const owned = shinobiTileCards.slice(0, 5).map((c) => c.id);
    const deck = buildPlayableDeck(owned, byId, catalog);
    assert.equal(deck.length, CARD_CLASH_DECK_SIZE);
    assert.ok(validateDeck(deck, byId).valid);
    assert.ok(owned.every((id) => deck.includes(id)));
});

// ── Match creation ────────────────────────────────────────────────────────────

function makeMatch(level = 30): CardClashMatchState {
    const deck = shinobiTileCards.filter((c) => c.rarity === "common").slice(0, 12).map((c) => c.id);
    return createCardClashMatch(deck, shinobiTileCards, level);
}

test("createCardClashMatch deals 3-card hands, 3 locations, turn 1", () => {
    const m = makeMatch();
    assert.equal(m.turn, 1);
    assert.equal(m.playerChakra, 1);
    assert.equal(m.opponentChakra, 1);
    assert.equal(m.playerHand.length, 3);
    assert.equal(m.opponentHand.length, 3);
    assert.equal(m.locations.length, 3);
    assert.equal(m.playerDeck.length, 9); // 12 - 3
    assert.equal(m.status, "playing");
    // locations are distinct
    const ids = m.locations.map((l) => l.location.id);
    assert.equal(new Set(ids).size, 3);
});

// ── Playing cards ─────────────────────────────────────────────────────────────

test("getEffectiveCost applies discount with a floor of 1", () => {
    const card = deriveCardClashCard(tile({ rarity: "rare", top: 50, right: 50, bottom: 50, left: 50 }));
    assert.equal(getEffectiveCost(card, 0), card.cost);
    assert.equal(getEffectiveCost(card, 1), Math.max(1, card.cost - 1));
    assert.equal(getEffectiveCost({ ...card, cost: 1 }, 5), 1);
});

test("playCard rejects when not enough chakra", () => {
    const m = makeMatch();
    // Force an expensive card into hand at turn 1 (1 chakra)
    const pricey = deriveCardClashCard(
        shinobiTileCards.find((c) => c.rarity === "legendary")!,
    );
    const state: CardClashMatchState = { ...m, playerHand: [pricey, ...m.playerHand] };
    const res = playCard(state, "player", 0, 0);
    assert.ok(res.error);
    assert.equal(res.state, state); // unchanged
});

test("playCard places a card, spends chakra, removes from hand", () => {
    let m = makeMatch();
    // Use a vanilla (no-ability) card so the assertion isn't perturbed by
    // on-reveal effects (a Wind mover would relocate, a summoner adds a clone).
    const vanilla = deriveCardClashCard(tile({ id: "vanilla", name: "Plain Card", rarity: "common", element: "None" }));
    m = { ...m, playerChakra: 6, playerHand: [vanilla, ...m.playerHand] };
    const res = playCard(m, "player", 0, 1);
    assert.equal(res.error, undefined);
    assert.equal(res.state.locations[1].playerCards.length, 1);
    assert.equal(res.state.locations[1].playerCards[0].name, vanilla.name);
    assert.equal(res.state.playerHand.length, 3); // had 4 (vanilla + 3 dealt), played 1
    assert.equal(res.state.playerChakra, 6 - getEffectiveCost(vanilla, 0));
});

test("playCard enforces the 4-card location slot limit", () => {
    let m = makeMatch();
    m = { ...m, playerChakra: 99 };
    const loc = m.locations[0];
    const full: CardClashPlayedCard[] = Array.from({ length: 4 }, (_, i) => ({
        ...deriveCardClashCard(tile({ id: `f${i}` })),
        instanceId: `pre-${i}`,
        owner: "player",
        basePower: 2,
        currentPower: 2,
        locationIndex: 0,
        revealed: true,
    }));
    m = { ...m, locations: m.locations.map((l, i) => (i === 0 ? { ...loc, playerCards: full } : l)) };
    const res = playCard(m, "player", 0, 0);
    assert.ok(res.error?.includes("full"));
});

// ── On-reveal effects ─────────────────────────────────────────────────────────

function playedCard(over: Partial<CardClashPlayedCard> & { abilityType: CardClashCard["abilityType"] }): CardClashPlayedCard {
    const base = deriveCardClashCard(tile({}));
    return {
        ...base,
        instanceId: "t1",
        owner: "player",
        basePower: 3,
        currentPower: 3,
        locationIndex: 0,
        revealed: true,
        ...over,
    };
}

function stateWith(playerCards: CardClashPlayedCard[], opponentCards: CardClashPlayedCard[] = []): CardClashMatchState {
    const loc: CardClashLocation = CARD_CLASH_LOCATIONS[0]; // no effect
    return {
        turn: 1, maxTurns: 6,
        playerDeck: [], opponentDeck: [],
        playerHand: [], opponentHand: [],
        locations: [{ location: loc, playerCards, opponentCards }],
        playerChakra: 1, opponentChakra: 1,
        playerNextCardDiscount: 0, opponentNextCardDiscount: 0,
        status: "playing", log: [], instanceCounter: 5,
    };
}

test("onRevealBuffSelf adds +2 to the card", () => {
    const card = playedCard({ abilityType: "onRevealBuffSelf", instanceId: "self" });
    const s = applyOnRevealEffect(stateWith([card]), "self");
    assert.equal(s.locations[0].playerCards[0].currentPower, 5);
});

test("onRevealBuffAlliesHere adds +1 to other allied cards only", () => {
    const ally = playedCard({ instanceId: "a", abilityType: "none" });
    const buffer = playedCard({ instanceId: "b", abilityType: "onRevealBuffAlliesHere" });
    const s = applyOnRevealEffect(stateWith([ally, buffer]), "b");
    assert.equal(s.locations[0].playerCards[0].currentPower, 4); // ally buffed
    assert.equal(s.locations[0].playerCards[1].currentPower, 3); // buffer unchanged
});

test("onRevealDebuffEnemiesHere reduces enemies but respects protection floor", () => {
    const enemyNormal = playedCard({ instanceId: "e1", owner: "opponent", currentPower: 3, basePower: 3, abilityType: "none" });
    const enemyProtected = playedCard({ instanceId: "e2", owner: "opponent", currentPower: 3, basePower: 3, protectedFromReduction: true, abilityType: "none" });
    const debuffer = playedCard({ instanceId: "d", abilityType: "onRevealDebuffEnemiesHere" });
    const s = applyOnRevealEffect(stateWith([debuffer], [enemyNormal, enemyProtected]), "d");
    assert.equal(s.locations[0].opponentCards[0].currentPower, 2); // reduced
    assert.equal(s.locations[0].opponentCards[1].currentPower, 3); // protected, can't go below base
});

test("protectSelf sets the protection flag", () => {
    const card = playedCard({ instanceId: "p", abilityType: "protectSelf" });
    const s = applyOnRevealEffect(stateWith([card]), "p");
    assert.equal(s.locations[0].playerCards[0].protectedFromReduction, true);
});

test("summonClone adds a 1-power token when there is space", () => {
    const card = playedCard({ instanceId: "c", abilityType: "summonClone" });
    const s = applyOnRevealEffect(stateWith([card]), "c");
    assert.equal(s.locations[0].playerCards.length, 2);
    const token = s.locations[0].playerCards[1];
    assert.equal(token.name, SHADOW_CLONE_CARD.name);
    assert.equal(token.currentPower, 1);
    assert.equal(token.isToken, true);
});

test("moveAfterReveal relocates to another friendly location with space", () => {
    const mover = playedCard({ instanceId: "m", abilityType: "moveAfterReveal" });
    const base = stateWith([mover]);
    // add a 2nd and 3rd location
    const multi: CardClashMatchState = {
        ...base,
        locations: [
            base.locations[0],
            { location: CARD_CLASH_LOCATIONS[1], playerCards: [], opponentCards: [] },
            { location: CARD_CLASH_LOCATIONS[2], playerCards: [], opponentCards: [] },
        ],
    };
    const s = applyOnRevealEffect(multi, "m");
    assert.equal(s.locations[0].playerCards.length, 0);
    assert.equal(s.locations[1].playerCards.length, 1);
    assert.equal(s.locations[1].playerCards[0].locationIndex, 1);
});

test("legendaries get hand-tuned marquee abilities", () => {
    assert.equal(deriveCardClashCard(shinobiTileCards.find((c) => c.id === "tc-142")!).abilityType, "onRevealDoubleSelf");
    assert.equal(deriveCardClashCard(shinobiTileCards.find((c) => c.id === "tc-150")!).abilityType, "onRevealBuffAlliesEverywhere");
    assert.equal(deriveCardClashCard(shinobiTileCards.find((c) => c.id === "tc-148")!).abilityType, "onRevealDebuffEnemiesEverywhere");
});

test("onRevealDoubleSelf doubles the card's power", () => {
    const card = playedCard({ instanceId: "d", abilityType: "onRevealDoubleSelf", currentPower: 6, basePower: 6 });
    const s = applyOnRevealEffect(stateWith([card]), "d");
    assert.equal(s.locations[0].playerCards[0].currentPower, 12);
});

test("onRevealBuffAlliesEverywhere buffs allies across all locations, not self", () => {
    const ally1 = playedCard({ instanceId: "a1", abilityType: "none" });
    const buffer = playedCard({ instanceId: "b", abilityType: "onRevealBuffAlliesEverywhere" });
    const ally2 = playedCard({ instanceId: "a2", abilityType: "none", locationIndex: 1 });
    const base = stateWith([ally1, buffer]);
    const multi: CardClashMatchState = {
        ...base,
        locations: [base.locations[0], { location: CARD_CLASH_LOCATIONS[1], playerCards: [ally2], opponentCards: [] }],
    };
    const s = applyOnRevealEffect(multi, "b");
    assert.equal(s.locations[0].playerCards[0].currentPower, 4); // ally1 +1
    assert.equal(s.locations[0].playerCards[1].currentPower, 3); // buffer unchanged
    assert.equal(s.locations[1].playerCards[0].currentPower, 4); // ally2 +1 (other location)
});

test("onRevealDebuffEnemiesEverywhere weakens enemies across all locations", () => {
    const debuffer = playedCard({ instanceId: "d", abilityType: "onRevealDebuffEnemiesEverywhere" });
    const enemy1 = playedCard({ instanceId: "e1", owner: "opponent", currentPower: 3, basePower: 3, abilityType: "none" });
    const enemy2 = playedCard({ instanceId: "e2", owner: "opponent", currentPower: 3, basePower: 3, abilityType: "none", locationIndex: 1 });
    const base = stateWith([debuffer], [enemy1]);
    const multi: CardClashMatchState = {
        ...base,
        locations: [base.locations[0], { location: CARD_CLASH_LOCATIONS[1], playerCards: [], opponentCards: [enemy2] }],
    };
    const s = applyOnRevealEffect(multi, "d");
    assert.equal(s.locations[0].opponentCards[0].currentPower, 2);
    assert.equal(s.locations[1].opponentCards[0].currentPower, 2);
});

// ── Location bonuses & scoring ────────────────────────────────────────────────

test("getLocationPowerBonus applies element/rarity/cost bonuses", () => {
    const fire = playedCard({ element: "Fire" });
    const volcano = CARD_CLASH_LOCATIONS.find((l) => l.effectType === "fireBonus")!;
    assert.equal(getLocationPowerBonus(fire, volcano), 2);
    assert.equal(getCardDisplayedPower(fire, volcano), fire.currentPower + 2);

    const cheap = playedCard({ cost: 1 });
    const dojo = CARD_CLASH_LOCATIONS.find((l) => l.effectType === "lowCostBonus")!;
    assert.equal(getLocationPowerBonus(cheap, dojo), 1);
});

test("determineWinner counts locations, tiebreaks on board power, else draw", () => {
    const p = (power: number, instanceId: string): CardClashPlayedCard => playedCard({ instanceId, currentPower: power, basePower: power, abilityType: "none" });
    const loc = (pc: CardClashPlayedCard[], oc: CardClashPlayedCard[]) => ({ location: CARD_CLASH_LOCATIONS[0], playerCards: pc, opponentCards: oc });
    const base = stateWith([]);

    // Player wins 2 of 3 locations
    const playerWins: CardClashMatchState = {
        ...base,
        locations: [loc([p(5, "1")], [p(2, "2")]), loc([p(5, "3")], [p(2, "4")]), loc([], [p(9, "5")])],
    };
    assert.equal(determineWinner(playerWins), "player");

    // 1-1 with one tied location → board power tiebreak (player higher)
    const tiebreak: CardClashMatchState = {
        ...base,
        locations: [loc([p(10, "a")], [p(2, "b")]), loc([p(1, "c")], [p(8, "d")]), loc([p(3, "e")], [p(3, "f")])],
    };
    assert.equal(determineWinner(tiebreak), "player");

    // total draw
    const drawState: CardClashMatchState = {
        ...base,
        locations: [loc([p(3, "g")], [p(3, "h")])],
    };
    assert.equal(determineWinner(drawState), "draw");
});

// ── AI + end turn ─────────────────────────────────────────────────────────────

test("aiTakeTurn plays at least one card when it can afford one", () => {
    let m = makeMatch(1);
    m = { ...m, opponentChakra: 6 };
    const before = m.locations.reduce((s, l) => s + l.opponentCards.length, 0);
    const after = aiTakeTurn(m);
    const placed = after.locations.reduce((s, l) => s + l.opponentCards.length, 0);
    assert.ok(placed > before);
});

test("aiTakeTurn never overspends chakra", () => {
    let m = makeMatch(60);
    m = { ...m, opponentChakra: 3 };
    const after = aiTakeTurn(m);
    assert.ok(after.opponentChakra >= 0);
});

test("endTurn advances turn, bumps chakra, draws for both", () => {
    const m = makeMatch();
    const next = endTurn(m);
    assert.equal(next.turn, 2);
    assert.equal(next.playerChakra, 2);
    assert.equal(next.opponentChakra, 2);
    assert.equal(next.playerHand.length, 4); // started 3, played none, +1 drawn on advance
});

test("a full 6-turn match completes with a winner", () => {
    let m = makeMatch(30);
    let guard = 0;
    while (m.status === "playing" && guard < 20) {
        // player plays first affordable card if possible
        const idx = m.playerHand.findIndex((c) => getEffectiveCost(c, m.playerNextCardDiscount) <= m.playerChakra);
        if (idx >= 0) {
            const openLoc = m.locations.findIndex((l) => l.playerCards.length < CARD_CLASH_LOCATION_SLOTS);
            if (openLoc >= 0) {
                const res = playCard(m, "player", idx, openLoc);
                if (!res.error) { m = res.state; continue; }
            }
        }
        m = endTurn(m);
        guard++;
    }
    assert.equal(m.status, "complete");
    assert.ok(["player", "opponent", "draw"].includes(m.winner!));
});

test("retreat forfeits the match to the opponent", () => {
    const m = makeMatch();
    const r = retreat(m);
    assert.equal(r.status, "complete");
    assert.equal(r.winner, "opponent");
});

// ── Rewards ───────────────────────────────────────────────────────────────────

test("cardClashReward pays base + first-win-of-day bonus", () => {
    const firstWin = cardClashReward("player", false);
    assert.equal(firstWin.baseRyo, 50);
    assert.equal(firstWin.dailyBonus, true);
    assert.equal(firstWin.ryo, 50 + 250);

    const repeatWin = cardClashReward("player", true);
    assert.equal(repeatWin.dailyBonus, false);
    assert.equal(repeatWin.ryo, 50);

    assert.equal(cardClashReward("draw", false).ryo, 15);
    assert.equal(cardClashReward("opponent", false).ryo, 5);
});

void CARD_CLASH_MAX_LEGENDARY;
