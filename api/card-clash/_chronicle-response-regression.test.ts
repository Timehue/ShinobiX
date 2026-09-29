import assert from "node:assert/strict";
import test from "node:test";
import {
  CHRONICLE_CARD_CATALOG, CHRONICLE_FIXED_FALLBACK_DECK,
  activateMagic, activateTrap, applyAction, createMatch, declareAttack,
  getChronicleCard, normalSummon, passResponse, projectMatchForViewer, startBattlePhase,
  type ChronicleMatch, type ChronicleMonsterCard, type ChronicleResult,
  type ChronicleSideKey,
} from "../../shared/chronicle-duel.js";

function accepted(result: ChronicleResult): ChronicleMatch {
  if (!result.ok) assert.fail(result.error);
  return result.state;
}

function match(): ChronicleMatch {
  const state = createMatch("One", CHRONICLE_FIXED_FALLBACK_DECK, "Two", CHRONICLE_FIXED_FALLBACK_DECK, () => 0, 1_000);
  state.activePlayer = "p1";
  state.turnNumber = 3;
  state.phase = "battle";
  return state;
}

function monsterWhere(predicate: (card: ChronicleMonsterCard) => boolean): ChronicleMonsterCard {
  const card = CHRONICLE_CARD_CATALOG.find((card): card is ChronicleMonsterCard => card.cardClass === "monster" && predicate(card));
  assert.ok(card);
  return card;
}
const junior = monsterWhere(card => card.level <= 4 && card.monsterType === "normal");
const senior = monsterWhere(card => card.level > 4 && card.monsterType === "normal");

function place(state: ChronicleMatch, owner: ChronicleSideKey, zoneIndex: number, cardId = junior.id, position: "attack" | "defense" = "attack") {
  state[owner].monsterZones[zoneIndex] = {
    instanceId: `${owner}-${zoneIndex}`, cardId, owner, zoneIndex, position,
    faceUp: true, summonedOnTurn: 1, lastPositionChangeTurn: 1,
    lastAttackTurn: 0, temporaryAttack: 0, temporaryDefense: 0,
  };
}

function setSnare(state: ChronicleMatch, cardId: string, zoneIndex = 0) {
  const card = getChronicleCard(cardId);
  assert.ok(card?.cardClass === "trap");
  if (card.effect.requiresFaceUpElement) {
    const anchor = monsterWhere(monster => monster.element === card.effect.requiresFaceUpElement && monster.monsterType === "normal");
    place(state, "p2", 4, anchor.id, "defense");
  }
  state.p2.magicTrapZones[zoneIndex] = {
    instanceId: `trap-${zoneIndex}`, cardId, owner: "p2", zoneIndex,
    faceUp: false, setOnTurn: 1,
  };
}

for (const targetZoneIndex of [null, undefined]) {
  test(`Long Watch intercepts a high-level direct attacker (target ${targetZoneIndex})`, () => {
    const state = match();
    place(state, "p1", 0, senior.id);
    state.p2.hand = [junior.id];
    setSnare(state, "chronicle-long-watch");
    const declared = accepted(declareAttack(state, "p1", { action: "attack", attackerZoneIndex: 0, targetZoneIndex }));
    assert.deepEqual(declared.responseWindow?.eligibleZoneIndexes, [0]);
    const resolved = accepted(activateTrap(declared, "p2", 0));
    assert.equal(resolved.p2.hand.length, 0);
    assert.ok(resolved.log.some(line => line.includes("Special Summons") && line.includes("redirects")));
    assert.equal(resolved.p1.monsterZones[0]?.lastAttackTurn, state.turnNumber);
  });
}

test("Floodgate Mist remembers an earlier attacker destroyed by a Snare and ends the Battle Phase", () => {
  const state = match();
  place(state, "p1", 0);
  place(state, "p1", 1);
  place(state, "p2", 0, junior.id, "defense");
  place(state, "p2", 1, junior.id, "defense");
  setSnare(state, "chronicle-explosive-tag");
  setSnare(state, "chronicle-floodgate-mist", 1);
  const first = accepted(declareAttack(state, "p1", { action: "attack", attackerZoneIndex: 0, targetZoneIndex: 0 }));
  assert.deepEqual(first.responseWindow?.eligibleZoneIndexes, [0], "Floodgate must not answer the first attack");
  const destroyed = accepted(activateTrap(first, "p2", 0));
  assert.equal(destroyed.p1.monsterZones[0], null);
  const second = accepted(declareAttack(destroyed, "p1", { action: "attack", attackerZoneIndex: 1, targetZoneIndex: 0 }));
  assert.deepEqual(second.responseWindow?.eligibleZoneIndexes, [1]);
  const ended = accepted(activateTrap(second, "p2", 1));
  assert.equal(ended.phase, "main2");
  assert.equal(declareAttack(ended, "p1", { action: "attack", attackerZoneIndex: 1, targetZoneIndex: 0 }).ok, false);
  assert.equal(startBattlePhase(ended, "p1").ok, false);
  const next = accepted(applyAction(ended, "p1", { action: "enter-end-phase" }));
  assert.equal(next.attacksDeclaredThisTurn, 0);
  place(next, "p2", 2);
  const waterAnchor = monsterWhere(card => card.element === "Water" && card.monsterType === "normal");
  place(next, "p1", 0, waterAnchor.id, "defense");
  next.p1.monsterZones[1]!.position = "defense";
  next.p1.magicTrapZones[0] = { instanceId: "next-flood", cardId: "chronicle-floodgate-mist", owner: "p1", zoneIndex: 0, faceUp: false, setOnTurn: 1 };
  const battle = accepted(startBattlePhase(next, "p2"));
  const firstNextTurn = accepted(declareAttack(battle, "p2", { action: "attack", attackerZoneIndex: 2, targetZoneIndex: 0 }));
  assert.equal(firstNextTurn.responseWindow, null, "A new turn resets the attack count");
  assert.equal(firstNextTurn.attacksDeclaredThisTurn, 1);
});

test("Floodgate Mist recovers prior attacks from older persisted matches", () => {
  const state = match();
  place(state, "p1", 0);
  place(state, "p1", 1);
  place(state, "p2", 0, junior.id, "defense");
  place(state, "p2", 1, junior.id, "defense");
  setSnare(state, "chronicle-explosive-tag");
  setSnare(state, "chronicle-floodgate-mist", 1);
  const declared = accepted(applyAction(state, "p1", { action: "attack", attackerZoneIndex: 0, targetZoneIndex: 0 }));
  const destroyed = accepted(applyAction(declared, "p2", { action: "activate-trap", zoneIndex: 0 }));
  delete destroyed.attacksDeclaredThisTurn;
  const restored: ChronicleMatch = JSON.parse(JSON.stringify(destroyed));
  const second = accepted(applyAction(restored, "p1", { action: "attack", attackerZoneIndex: 1, targetZoneIndex: 0 }));
  assert.deepEqual(second.responseWindow?.eligibleZoneIndexes, [1]);
  assert.equal(second.attacksDeclaredThisTurn, 2);
});

test("Long Watch still needs a junior defender, and removal Snares keep their attacker level caps", () => {
  const state = match();
  place(state, "p1", 0, senior.id);
  state.p2.hand = [senior.id];
  setSnare(state, "chronicle-long-watch");
  setSnare(state, "chronicle-explosive-tag", 1);
  const result = accepted(declareAttack(state, "p1", { action: "attack", attackerZoneIndex: 0, targetZoneIndex: null }));
  assert.equal(result.responseWindow, null);
  assert.deepEqual(result.p2.hand, [senior.id]);
  assert.ok(result.p2.magicTrapZones[0]);
  assert.ok(result.p2.magicTrapZones[1]);
});

test("Floodgate Mist does not count a summon effect's attack restriction as a declared attack", () => {
  const state = match();
  state.phase = "main1";
  const demolisher = monsterWhere(card => card.monsterEffect?.kind === "destroySetMagicTrapOnTributeSummon");
  state.p1.hand = [demolisher.id];
  const tributeCount = demolisher.level >= 7 ? 2 : 1;
  for (let i = 0; i < tributeCount; i++) place(state, "p1", i);
  place(state, "p1", 4);
  place(state, "p2", 0, junior.id, "defense");
  place(state, "p2", 1, junior.id, "defense");
  setSnare(state, "chronicle-smoke-bomb");
  setSnare(state, "chronicle-floodgate-mist", 1);
  const summoned = accepted(normalSummon(state, "p1", { action: "normal-summon", handIndex: 0, zoneIndex: 0, tributeZoneIndexes: Array.from({ length: tributeCount }, (_, i) => i) }));
  assert.equal(summoned.p1.monsterZones[0]?.lastAttackTurn, state.turnNumber);
  const battle = accepted(startBattlePhase(summoned, "p1"));
  const first = accepted(declareAttack(battle, "p1", { action: "attack", attackerZoneIndex: 4, targetZoneIndex: 0 }));
  assert.equal(first.responseWindow, null);
});

for (const hasCounter of [false, true]) {
  test(`an already-equipped Monster rejects another Equip before effects or responses (counter ${hasCounter})`, () => {
    const state = match();
    state.phase = "main1";
    const mage = monsterWhere(card => card.monsterEffect?.kind === "gainAttackOnMagicActivated");
    place(state, "p1", 0, mage.id);
    state.p1.hand = ["chronicle-stoneplate-harness", "chronicle-stoneplate-harness"];
    const equipped = accepted(activateMagic(state, "p1", { action: "activate-magic", handIndex: 0, targetZoneIndex: 0 }));
    if (hasCounter) setSnare(equipped, "chronicle-kage-judgment-seal");
    const rejected = activateMagic(equipped, "p1", { action: "activate-magic", handIndex: 0, targetZoneIndex: 0 });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.error, /already has an Equip/);
    assert.deepEqual(rejected.state, equipped, "An illegal activation must not grant ATK, consume cards, or open a response");
  });
}

for (const trap of CHRONICLE_CARD_CATALOG.filter(card => card.cardClass === "trap" && ["negateOneAttack", "negateAttackAndInflictDamage", "changeOneMonsterPosition"].includes(card.effect.kind))) {
  test(`${trap.name} spends the stopped attack and cannot be activated twice`, () => {
    const state = match();
    place(state, "p1", 0);
    place(state, "p1", 1);
    setSnare(state, trap.id);
    const target = state.p2.monsterZones.findIndex(Boolean);
    const intent = { action: "attack", attackerZoneIndex: 0, targetZoneIndex: target < 0 ? null : target };
    const declared = accepted(declareAttack(state, "p1", intent));
    const stopped = accepted(activateTrap(declared, "p2", 0));
    assert.equal(stopped.p2.lifePoints, state.p2.lifePoints);
    assert.equal(stopped.p1.monsterZones[0]?.lastAttackTurn, state.turnNumber);
    assert.equal(declareAttack(stopped, "p1", intent).ok, false);
    assert.equal(projectMatchForViewer(stopped, "p1").p1.monsterZones[1]?.canAttack, true);
    assert.deepEqual(stopped.p2.graveyard, [trap.id]);
    assert.equal(activateTrap(stopped, "p2", 0).ok, false);
    assert.equal(passResponse(stopped, "p2").ok, false);
  });
}

test("passing a Snare response resolves damage once and spends exactly one attack", () => {
  const state = match();
  place(state, "p1", 0);
  setSnare(state, "chronicle-smoke-bomb");
  const intent = { action: "attack", attackerZoneIndex: 0, targetZoneIndex: null };
  const declared = accepted(declareAttack(state, "p1", intent));
  assert.equal(declared.attacksDeclaredThisTurn, 1);
  const passed = accepted(passResponse(declared, "p2"));
  assert.equal(passed.p2.lifePoints, state.p2.lifePoints - junior.attack);
  assert.equal(passed.attacksDeclaredThisTurn, 1);
  assert.equal(passResponse(passed, "p2").ok, false);
  assert.equal(declareAttack(passed, "p1", intent).ok, false);
  assert.ok(passed.p2.magicTrapZones[0]);
});

test("a countered Jutsu is consumed without resolving or allowing a replay", () => {
  const state = match();
  state.phase = "main1";
  state.p1.hand = ["chronicle-recon-scroll"];
  setSnare(state, "chronicle-kage-judgment-seal");
  const intent = { action: "activate-magic", handIndex: 0 };
  const activated = accepted(activateMagic(state, "p1", intent));
  const stopped = accepted(activateTrap(activated, "p2", 0));
  assert.deepEqual(stopped.p1.hand, []);
  assert.deepEqual(stopped.p1.deck, state.p1.deck);
  assert.deepEqual(stopped.p1.graveyard, ["chronicle-recon-scroll"]);
  assert.equal(activateMagic(stopped, "p1", intent).ok, false);
  assert.equal(activateTrap(stopped, "p2", 0).ok, false);
});

for (const trapId of ["chronicle-pitfall-tag-array", "chronicle-sealing-circle", "chronicle-flash-burial-tag"]) {
  test(`${trapId} does not refund the Normal Summon`, () => {
    const state = match();
    state.phase = "main1";
    state.p1.hand = [junior.id, junior.id];
    setSnare(state, trapId);
    const summoned = accepted(normalSummon(state, "p1", { action: "normal-summon", handIndex: 0, zoneIndex: 0 }));
    const stopped = accepted(activateTrap(summoned, "p2", 0));
    assert.equal(stopped.normalSummonUsed, true);
    const retry = normalSummon(stopped, "p1", { action: "normal-summon", handIndex: 0, zoneIndex: 1 });
    assert.equal(retry.ok, false);
    if (!retry.ok) assert.match(retry.error, /already used your Normal Summon/);
  });
}
