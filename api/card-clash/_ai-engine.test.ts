import test from "node:test";
import assert from "node:assert/strict";
import {
  CHRONICLE_AI_DIFFICULTIES,
  CHRONICLE_FIXED_FALLBACK_DECK,
  MAIN_DECK_SIZE,
  validateDeckIds,
} from "../../shared/chronicle-duel.js";
import {
  CHRONICLE_AI_DECKS,
  advanceAi,
  applyPlayerAction,
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
test("AI obeys phases and yields when the human must act", () => {
  const session = createAiMatch(
    "match-ai",
    "Tester",
    [...CHRONICLE_FIXED_FALLBACK_DECK],
    "medium",
    1_000,
    () => 0,
  );
  assert.equal(session.state.activePlayer, "p1");
  assert.equal(session.state.phase, "draw");
  assert.equal(
    applyPlayerAction(session, { action: "advance-phase" }, 1_100).ok,
    true,
  );
  assert.equal(session.state.phase, "standby");
  assert.equal(
    applyPlayerAction(session, { action: "advance-phase" }, 1_200).ok,
    true,
  );
  assert.equal(session.state.phase, "main1");
  assert.equal(
    applyPlayerAction(session, { action: "enter-end-phase" }, 1_300).ok,
    true,
  );
  assert.equal(session.state.phase, "end");
  const ended = applyPlayerAction(session, { action: "end-turn" }, 2_000);
  assert.equal(ended.ok, true);
  assert.equal(session.state.activePlayer, "p1");
  assert.equal(session.state.phase, "draw");
  assert.equal(session.state.status, "active");
  assert.ok(
    session.state.p2.monsterZones.some(Boolean),
    "AI made a legal summon",
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
  session.state.p2.hand = ["tc-10"];
  session.state.p2.monsterZones = session.state.p2.monsterZones.map(() => null);
  session.state.p2.magicTrapZones = session.state.p2.magicTrapZones.map(
    () => null,
  );
  advanceAi(session, 2_000);
  const setLookout = session.state.p2.monsterZones.find(Boolean);
  assert.equal(setLookout?.cardId, "tc-10");
  assert.equal(setLookout?.faceUp, false);
  assert.equal(setLookout?.position, "defense");

  session.state.activePlayer = "p2";
  session.state.turnNumber = 4;
  session.state.phase = "main1";
  session.state.normalSummonUsed = false;
  advanceAi(session, 4_000);
  const revealedLookout = session.state.p2.monsterZones.find(
    (monster) => monster?.cardId === "tc-10",
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
  session.state.p1.monsterZones[0] = {
    instanceId: "weak-target",
    cardId: "tc-13",
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
    cardId: "tc-04",
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
  assert.equal(session.state.p1.monsterZones[0]?.cardId, "tc-13");
  assert.equal(session.state.p1.monsterZones[1], null);
  assert.ok(session.state.p1.graveyard.includes("tc-04"));
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
