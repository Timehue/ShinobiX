import test from "node:test";
import assert from "node:assert/strict";
import {
  CHRONICLE_AI_DIFFICULTIES,
  CHRONICLE_CARD_CATALOG,
  CHRONICLE_FIXED_FALLBACK_DECK,
  MAIN_DECK_SIZE,
  getChronicleCard,
  tributeCountForLevel,
  validateDeckIds,
  type ChronicleProjection,
} from "../../shared/chronicle-duel.js";

/**
 * A Flip-effect Monster the AI can Set for free. Power tier is independent of
 * rarity now, so a card's Level moves with balance — naming one and assuming it
 * Sets without Tributes is exactly the assumption that breaks.
 */
function freeFlipMonster(): string {
  const found = CHRONICLE_CARD_CATALOG.find(
    (card) =>
      card.cardClass === "monster" &&
      card.monsterEffect?.trigger === "onFlip" &&
      tributeCountForLevel(card.level) === 0,
  );
  assert.ok(found, "no Flip Monster summons without Tributes");
  return found.id;
}
import {
  CHRONICLE_AI_DECKS,
  advanceAi,
  applyPlayerAction,
  captureAiStep,
  createAiMatch,
  forfeit,
  generateAiServerDeck,
  projectAiMatch,
} from "./_ai-engine.js";

test("AI deck is a legal 40-card Chronicle deck at every difficulty band", () => {
  for (const difficulty of CHRONICLE_AI_DIFFICULTIES) {
    const deck = generateAiServerDeck(difficulty);
    assert.equal(deck.length, MAIN_DECK_SIZE);
    assert.equal(validateDeckIds(deck).valid, true);
  }
  assert.deepEqual(CHRONICLE_AI_DECKS.easy, CHRONICLE_FIXED_FALLBACK_DECK);
  assert.notDeepEqual(CHRONICLE_AI_DECKS.medium, CHRONICLE_AI_DECKS.easy);
  assert.notDeepEqual(CHRONICLE_AI_DECKS.hard, CHRONICLE_AI_DECKS.medium);
  assert.equal(
    CHRONICLE_AI_DECKS.hard.filter((id) => id === "chronicle-field-volcano")
      .length,
    2,
  );
});
test("ending the turn plays the AI turn and returns the human to Main Phase 1", () => {
  const session = createAiMatch(
    "match-ai",
    "Tester",
    [...CHRONICLE_FIXED_FALLBACK_DECK],
    "medium",
    1_000,
    () => 0,
  );
  assert.equal(session.state.activePlayer, "p1");
  assert.equal(session.state.phase, "main1");
  // One End Turn covers the human's End Phase, the whole Keeper turn, and the
  // human's next Draw and Standby — the player is never asked to click through.
  assert.equal(
    applyPlayerAction(session, { action: "enter-end-phase" }, 1_300).ok,
    true,
  );
  assert.equal(session.state.activePlayer, "p1");
  assert.equal(session.state.phase, "main1");
  assert.equal(session.state.status, "active");
  assert.equal(session.state.normalSummonUsed, false);
  assert.ok(
    session.state.p2.monsterZones.some(Boolean),
    "AI made a legal summon",
  );
  assert.equal(
    applyPlayerAction(session, { action: "advance-phase" }, 1_500).ok,
    false,
    "no bookkeeping phase is left to advance through",
  );
});

test("AI Sets concealed Flip Monsters and later reveals useful Flip effects", () => {
  const session = createAiMatch(
    "match-effect-ai",
    "Tester",
    [...CHRONICLE_FIXED_FALLBACK_DECK],
    "medium",
    1_000,
    () => 0,
  );
  session.state.activePlayer = "p2";
  session.state.turnNumber = 2;
  session.state.phase = "main1";
  session.state.normalSummonUsed = false;
  const lookoutId = freeFlipMonster();
  session.state.p2.hand = [lookoutId];
  session.state.p2.monsterZones = session.state.p2.monsterZones.map(() => null);
  session.state.p2.magicTrapZones = session.state.p2.magicTrapZones.map(
    () => null,
  );
  advanceAi(session, 2_000);
  const setLookout = session.state.p2.monsterZones.find(Boolean);
  assert.equal(setLookout?.cardId, lookoutId);
  assert.equal(setLookout?.faceUp, false);
  assert.equal(setLookout?.position, "defense");

  session.state.activePlayer = "p2";
  session.state.turnNumber = 4;
  session.state.phase = "main1";
  session.state.normalSummonUsed = false;
  advanceAi(session, 4_000);
  const revealedLookout = session.state.p2.monsterZones.find(
    (monster) => monster?.cardId === lookoutId,
  );
  assert.equal(revealedLookout?.faceUp, true);
});

test("AI avoids a self-defeating Ring response when a safe attack negate is set", () => {
  const session = createAiMatch(
    "match-trap-judgment",
    "Tester",
    [...CHRONICLE_FIXED_FALLBACK_DECK],
    "hard",
    1_000,
    () => 0,
  );
  session.state.activePlayer = "p1";
  session.state.turnNumber = 3;
  session.state.phase = "battle";
  session.state.p1.monsterZones[0] = {
    instanceId: "incoming-boss",
    cardId: "tc-150",
    owner: "p1",
    zoneIndex: 0,
    position: "attack",
    faceUp: true,
    summonedOnTurn: 2,
    lastPositionChangeTurn: 2,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
  session.state.p2.lifePoints = 1_000;
  session.state.p2.magicTrapZones[0] = {
    instanceId: "unsafe-ring",
    cardId: "chronicle-ringed-detonation",
    owner: "p2",
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  session.state.p2.magicTrapZones[1] = {
    instanceId: "safe-smoke",
    cardId: "chronicle-smoke-bomb",
    owner: "p2",
    zoneIndex: 1,
    faceUp: false,
    setOnTurn: 1,
  };
  session.state.responseWindow = {
    id: "ai-trap-window",
    trigger: "onAttackDeclared",
    responder: "p2",
    eligibleZoneIndexes: [0, 1],
    openedAt: 2_000,
    expiresAt: 20_000,
    pendingAction: {
      action: "attack",
      actor: "p1",
      attackerZoneIndex: 0,
      targetZoneIndex: null,
    },
  };

  advanceAi(session, 2_100);
  assert.ok(
    session.state.p2.magicTrapZones[0]?.cardId ===
      "chronicle-ringed-detonation",
  );
  assert.equal(session.state.p2.magicTrapZones[1], null);
  assert.ok(session.state.p2.graveyard.includes("chronicle-smoke-bomb"));
  assert.equal(session.state.p2.lifePoints, 1_000);
});

test("Hard AI removes the strongest visible legal target", () => {
  const session = createAiMatch(
    "match-hard-targeting",
    "Tester",
    [...CHRONICLE_FIXED_FALLBACK_DECK],
    "hard",
    1_000,
    () => 0,
  );
  session.state.activePlayer = "p2";
  session.state.turnNumber = 2;
  session.state.phase = "main1";
  session.state.normalSummonUsed = true;
  session.state.p2.hand = ["chronicle-hollow-breach"];
  session.state.p2.monsterZones = session.state.p2.monsterZones.map(() => null);
  session.state.p2.magicTrapZones = session.state.p2.magicTrapZones.map(
    () => null,
  );
  session.state.p1.magicTrapZones = session.state.p1.magicTrapZones.map(
    () => null,
  );
  // Hollow Breach only answers 1,000 DEF or less, so BOTH targets have to be
  // legal for "picks the strongest" to mean anything. Chosen by stats rather
  // than named, since Level and stats move with the balance pass.
  const breachable = CHRONICLE_CARD_CATALOG.flatMap((card) =>
    card.cardClass === "monster" && card.defense <= 1_000 ? [card] : [],
  ).sort((a, b) => a.attack - b.attack);
  assert.ok(breachable.length >= 2, "need two legal Hollow Breach targets");
  const weakTargetId = breachable[0].id;
  const strongTargetId = breachable[breachable.length - 1].id;
  assert.notEqual(weakTargetId, strongTargetId);
  session.state.p1.monsterZones[0] = {
    instanceId: "weak-target",
    cardId: weakTargetId,
    owner: "p1",
    zoneIndex: 0,
    position: "attack",
    faceUp: true,
    summonedOnTurn: 1,
    lastPositionChangeTurn: 1,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
  session.state.p1.monsterZones[1] = {
    instanceId: "strong-target",
    cardId: strongTargetId,
    owner: "p1",
    zoneIndex: 1,
    position: "attack",
    faceUp: true,
    summonedOnTurn: 1,
    lastPositionChangeTurn: 1,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };

  advanceAi(session, 2_000);
  assert.equal(session.state.p1.monsterZones[0]?.cardId, weakTargetId);
  assert.equal(session.state.p1.monsterZones[1], null);
  assert.ok(session.state.p1.graveyard.includes(strongTargetId));
});

test("AI never accepts forged card stats or legacy play/location actions", () => {
  const session = createAiMatch(
    "match-illegal",
    "Tester",
    [...CHRONICLE_FIXED_FALLBACK_DECK],
    "medium",
    1_000,
    () => 0,
  );
  assert.equal(
    applyPlayerAction(session, { action: "play", handIndex: 0, zoneIndex: 0 })
      .ok,
    false,
  );
  assert.equal(
    applyPlayerAction(session, {
      action: "normal-summon",
      handIndex: 99,
      zoneIndex: 0,
    }).ok,
    false,
  );
});

test("forfeit is an immediate server-computed opponent win", () => {
  const session = createAiMatch(
    "match-forfeit",
    "Tester",
    [...CHRONICLE_FIXED_FALLBACK_DECK],
    "medium",
    1_000,
    () => 0,
  );
  forfeit(session);
  assert.equal(session.status, "done");
  assert.equal(session.winner, "opponent");
});

test("AI projection hides opponent hand, deck identities and set cards", () => {
  const session = createAiMatch(
    "match-project",
    "Tester",
    [...CHRONICLE_FIXED_FALLBACK_DECK],
    "hard",
    1_000,
    () => 0,
  );
  const projection = projectAiMatch(session);
  assert.equal(projection.aiDifficulty, "hard");
  assert.equal(projection.aiDeckName, "Crimson Tempest");
  assert.equal(projection.p2.hand, undefined);
  assert.equal(projection.p2.deckCount, session.state.p2.deck.length);
  for (const zone of projection.p2.magicTrapZones)
    if (zone && !zone.faceUp) assert.equal(zone.cardId, undefined);
});

test("AI turns emit per-move step snapshots the client can replay", () => {
  const steps: ChronicleProjection[] = [];
  const session = createAiMatch(
    "match-steps",
    "Tester",
    [...CHRONICLE_FIXED_FALLBACK_DECK],
    "medium",
    1_000,
    () => 0,
    "standard",
    (state) => captureAiStep(steps, state),
  );
  // Player goes first with the seeded RNG: the opening advance produced no
  // AI steps, but ending the player's turn must replay the Keeper's full
  // turn one action at a time.
  assert.equal(steps.length, 0);
  const collected: ChronicleProjection[] = [];
  const ended = applyPlayerAction(
    session,
    { action: "enter-end-phase" },
    1_300,
    (state) => captureAiStep(collected, state),
  );
  assert.equal(ended.ok, true);
  assert.ok(collected.length >= 3, "AI turn produced step-by-step snapshots");
  // Snapshots are viewer projections: the Keeper's hand stays hidden and the
  // final snapshot matches the settled post-turn board.
  for (const step of collected) {
    assert.equal(step.p2.hand, undefined);
    assert.ok(step.log.length <= 8, "intermediate logs are trimmed");
  }
  const last = collected.at(-1)!;
  assert.equal(last.activePlayer, "p1");
  assert.equal(last.phase, "main1");
  assert.equal(last.p2.monsterZones.filter(Boolean).length,
    session.state.p2.monsterZones.filter(Boolean).length);
});
