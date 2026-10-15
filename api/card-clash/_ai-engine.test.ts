import test from "node:test";
import assert from "node:assert/strict";
import {
  CHRONICLE_AI_DIFFICULTIES,
  CHRONICLE_CARD_CATALOG,
  CHRONICLE_FIXED_FALLBACK_DECK,
  MAIN_DECK_SIZE,
  elementBattleBonus,
  getChronicleCard,
  tributeCountForLevel,
  validateDeckIds,
  type ChronicleProjection,
} from "../../shared/chronicle-duel.js";

/**
 * A Flip-effect Monster the AI can Set for free. Power tier is independent of
 * rarity now, so a card's Level moves with balance — naming one and assuming it
 * Sets without Tributes is exactly the assumption that breaks.
 *
 * Its effect must be one the AI reveals on an EMPTY opposing board (draw,
 * cycle, heal). "Destroy their strongest" is held until there is a target, so
 * a fixture that happened to pick it would not flip — correctly.
 */
const UNCONDITIONAL_FLIPS = new Set(["drawOnFlip", "cycleHandsOnFlip", "healOnFlip"]);
function freeFlipMonster(): string {
  const found = CHRONICLE_CARD_CATALOG.find(
    (card) =>
      card.cardClass === "monster" &&
      card.monsterEffect?.trigger === "onFlip" &&
      UNCONDITIONAL_FLIPS.has(card.monsterEffect.kind) &&
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

test("Keeper decks keep a curve they can actually summon", () => {
  // A deck's curve is not stored anywhere: it falls out of each card's Level,
  // and Levels are a balance decision that moves. Crimson Tempest was written
  // as 19 free bodies, 3 one-Tribute and 2 two-Tribute Monsters; a re-tier in
  // 2026-08 silently turned it into 5 / 11 / 8, and "Hard" stopped being hard.
  // The 2026-10-14 balance pass tuned it to 16 / 5 / 3 against the simulator.
  const curve = (deck: readonly string[]) => {
    const bands = [0, 0, 0];
    for (const id of deck) {
      const card = getChronicleCard(id);
      if (card?.cardClass === "monster") bands[tributeCountForLevel(card.level)]++;
    }
    return bands;
  };
  assert.deepEqual(curve(CHRONICLE_AI_DECKS.hard), [16, 5, 3]);
  for (const difficulty of CHRONICLE_AI_DIFFICULTIES) {
    const [free, one, two] = curve(CHRONICLE_AI_DECKS[difficulty]);
    assert.ok(free >= 12, `${difficulty} fields only ${free} free-summon Monsters`);
    assert.ok(one + two <= free, `${difficulty} holds ${one + two} Tribute Monsters for ${free} free bodies`);
  }
});

test("AI resumes after a player's Smoke Bomb without retrying its stopped attacker", () => {
  const session = createAiMatch("smoke-ai-continuation", "Tester", [...CHRONICLE_FIXED_FALLBACK_DECK], "hard", 1_000, () => 0);
  const state = session.state;
  state.activePlayer = "p2";
  state.turnNumber = 3;
  state.phase = "battle";
  state.p2.hand = [];
  const vanilla = CHRONICLE_CARD_CATALOG.find(card => card.cardClass === "monster" && card.monsterType === "normal");
  assert.ok(vanilla?.cardClass === "monster");
  for (let index = 0; index < 2; index++) {
    state.p2.monsterZones[index] = {
      instanceId: `ai-attacker-${index}`, cardId: vanilla.id, owner: "p2", zoneIndex: index,
      position: "attack", faceUp: true, summonedOnTurn: 1, lastPositionChangeTurn: 1,
      lastAttackTurn: 0, temporaryAttack: 0, temporaryDefense: 0,
    };
  }
  state.p1.magicTrapZones[0] = { instanceId: "human-smoke", cardId: "chronicle-smoke-bomb", owner: "p1", zoneIndex: 0, faceUp: false, setOnTurn: 1 };
  advanceAi(session, 2_000);
  assert.equal(session.state.responseWindow?.responder, "p1");
  const stoppedZone = session.state.responseWindow!.pendingAction.attackerZoneIndex;
  const steps: ChronicleProjection[] = [];
  assert.equal(applyPlayerAction(session, { action: "activate-trap", zoneIndex: 0 }, 2_100, step => captureAiStep(steps, step)).ok, true);
  assert.equal(session.state.activePlayer, "p1");
  assert.equal(session.state.phase, "main1");
  assert.equal(session.state.p1.lifePoints, state.p1.lifePoints - vanilla.attack, "Only the other monster's direct attack deals damage");
  const attacks = session.state.events?.filter(event => event.kind === "attack-declared" && event.turnNumber === 3) ?? [];
  assert.equal(attacks.length, 2);
  assert.equal(attacks.filter(event => event.sourceZoneIndex === stoppedZone).length, 1);
  assert.ok(steps[0].p1.graveyard.includes("chronicle-smoke-bomb"), "Replay first shows the player's committed Snare");
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
  // Assert the reveal itself. Once flipped, the card may legitimately leave the
  // board in the same turn: a "draw 1" can hand the AI a Tribute Monster, and
  // the flipped body is its only Tribute.
  assert.ok(
    session.state.events?.some(
      (event) => event.kind === "monster-flipped" && event.cardId === lookoutId,
    ),
    "the AI Flip Summons its useful Flip Monster",
  );
});

/** A Keeper session on its own Main Phase 1, hand and board set by the test. */
function keeperTurn(hand: string[], turnNumber = 2) {
  const session = createAiMatch("match-new-jutsu", "Tester", [...CHRONICLE_FIXED_FALLBACK_DECK], "medium", 1_000, () => 0);
  const state = session.state;
  state.activePlayer = "p2";
  state.turnNumber = turnNumber;
  state.phase = "main1";
  state.normalSummonUsed = false;
  state.p2.hand = hand;
  state.p2.monsterZones = state.p2.monsterZones.map(() => null);
  state.p2.magicTrapZones = state.p2.magicTrapZones.map(() => null);
  state.p1.magicTrapZones = state.p1.magicTrapZones.map(() => null);
  return session;
}

test("the Keeper casts a Summoning Call when it holds both halves", () => {
  const call = CHRONICLE_CARD_CATALOG.find(
    (card) => card.cardClass === "magic" && card.effect.kind === "callSummon",
  );
  assert.ok(call?.cardClass === "magic");
  const calledId = call.effect.calledMonsterId ?? "";
  const session = keeperTurn([call.id, calledId]);
  advanceAi(session, 2_000);
  assert.ok(
    session.state.p2.monsterZones.some((monster) => monster?.cardId === calledId),
    "the called Monster is on the Keeper's field",
  );
  assert.ok(session.state.p2.graveyard.includes(call.id));
});

test("the Keeper casts Shadow Clone for a waiting two-Tribute Monster and spends the Doubles next turn", () => {
  const boss = CHRONICLE_CARD_CATALOG.find(
    (card) =>
      card.cardClass === "monster" &&
      tributeCountForLevel(card.level) === 2 &&
      card.monsterEffect?.kind !== "callSummonOnly",
  );
  assert.ok(boss);
  const session = keeperTurn(["chronicle-shadow-clone", boss.id], 2);
  advanceAi(session, 2_000);
  const doubles = session.state.p2.monsterZones.filter(
    (monster) => monster?.cardId === "chronicle-shadow-double",
  );
  assert.equal(doubles.length, 2, "two Shadow Doubles wait on the field");
  assert.ok(session.state.p2.hand.includes(boss.id), "the boss waits a turn");

  session.state.activePlayer = "p2";
  session.state.turnNumber = 4;
  session.state.phase = "main1";
  session.state.normalSummonUsed = false;
  advanceAi(session, 4_000);
  assert.ok(
    session.state.p2.monsterZones.some((monster) => monster?.cardId === boss.id),
    "the Keeper Tributes both Doubles for its Level 7-8 Monster",
  );
  assert.equal(
    session.state.p2.monsterZones.some((monster) => monster?.cardId === "chronicle-shadow-double"),
    false,
  );
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

test("Hard AI does not attack into a face-up Monster that gains ATK against stronger attackers", () => {
  // The battle preview shows the defender's "+X vs a stronger Monster", and the
  // engine applies it. The Keeper's own margin used to leave it out, so it
  // attacked these cards and lost the battle. Searched by shape: a defender
  // with the effect, and a vanilla attacker that out-ATKs it by less than X,
  // with no element edge either way.
  const monsters = CHRONICLE_CARD_CATALOG.flatMap((card) =>
    card.cardClass === "monster" ? [card] : [],
  );
  let pair: { attacker: string; defender: string } | null = null;
  for (const defender of monsters) {
    const effect = defender.monsterEffect;
    if (effect?.kind !== "gainAttackWhenBattlingStronger") continue;
    const bonus = effect.amount ?? 0;
    const attacker = monsters.find(
      (card) =>
        card.monsterType === "normal" &&
        card.attack > defender.attack &&
        card.attack < defender.attack + bonus &&
        elementBattleBonus(card.element, defender.element) === 0 &&
        elementBattleBonus(defender.element, card.element) === 0,
    );
    if (attacker) {
      pair = { attacker: attacker.id, defender: defender.id };
      break;
    }
  }
  assert.ok(pair, "no attacker sits inside a battling-stronger bonus");

  const session = createAiMatch("match-stronger-bonus", "Tester", [...CHRONICLE_FIXED_FALLBACK_DECK], "hard", 1_000, () => 0);
  const state = session.state;
  state.activePlayer = "p2";
  state.turnNumber = 3;
  state.phase = "battle";
  state.p2.hand = [];
  state.p2.monsterZones = state.p2.monsterZones.map(() => null);
  state.p1.monsterZones = state.p1.monsterZones.map(() => null);
  state.p1.magicTrapZones = state.p1.magicTrapZones.map(() => null);
  const body = (cardId: string, owner: "p1" | "p2") => ({
    instanceId: `${owner}-${cardId}`,
    cardId,
    owner,
    zoneIndex: 0,
    position: "attack" as const,
    faceUp: true,
    summonedOnTurn: 1,
    lastPositionChangeTurn: 1,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  });
  state.p2.monsterZones[0] = body(pair.attacker, "p2");
  state.p1.monsterZones[0] = body(pair.defender, "p1");
  advanceAi(session, 2_000);
  assert.equal(
    session.state.p2.monsterZones[0]?.lastAttackTurn,
    0,
    "the Keeper holds back instead of losing its Monster",
  );
  assert.equal(session.state.p1.monsterZones[0]?.cardId, pair.defender);
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


test("player summon remains visible before an automatic AI Snare resolves", () => {
  const session = createAiMatch("match-response-replay", "Tester", [...CHRONICLE_FIXED_FALLBACK_DECK], "hard", 1_000, () => 0);
  session.state.activePlayer = "p1";
  session.state.turnNumber = 4;
  session.state.phase = "main1";
  session.state.normalSummonUsed = false;
  const monster = CHRONICLE_CARD_CATALOG.filter(card => card.cardClass === "monster" && card.level <= 4 && card.monsterType === "normal")
    .sort((a, b) => (b.cardClass === "monster" ? b.attack : 0) - (a.cardClass === "monster" ? a.attack : 0))[0];
  session.state.p1.hand = [monster.id];
  session.state.p1.monsterZones.fill(null);
  session.state.p2.magicTrapZones.fill(null);
  session.state.p2.magicTrapZones[1] = { instanceId: "ai-snare", owner: "p2", zoneIndex: 1, cardId: "chronicle-pitfall-tag-array", faceUp: false, setOnTurn: 2 };
  const steps: ChronicleProjection[] = [];
  const result = applyPlayerAction(session, { action: "normal-summon", handIndex: 0, zoneIndex: 0 }, 5_000, state => captureAiStep(steps, state));
  assert.equal(result.ok, true);
  assert.ok(steps.length >= 2);
  assert.equal(steps[0].p1.monsterZones[0]?.cardId, monster.id);
  assert.equal(steps[0].responseWindow?.responder, "p2");
  assert.equal(steps[0].p2.magicTrapZones[1]?.cardId, undefined);
  assert.equal(steps.at(-1)?.p1.monsterZones[0], null);
  assert.ok(steps.at(-1)?.events?.some(event => event.kind === "trap-activated"));
});
