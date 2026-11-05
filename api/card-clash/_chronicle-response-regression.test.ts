import assert from "node:assert/strict";
import test from "node:test";
import {
  CHRONICLE_CARD_CATALOG, CHRONICLE_FIXED_FALLBACK_DECK,
  activateMagic, activateTrap, applyAction, createMatch, declareAttack,
  getChronicleCard, normalSummon, passExpiredResponse, passResponse, projectMatchForViewer, startBattlePhase,
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

const reanimation = "chronicle-reanimation-jutsu";
const reversal = "chronicle-guardians-reversal";

test("Reanimation Special Summons one chosen high-level Monster from the owner's Graveyard", () => {
  const state = match();
  state.phase = "main1";
  state.normalSummonUsed = true;
  state.p1.hand = [reanimation];
  state.p1.graveyard = [junior.id, senior.id, senior.id, "chronicle-recon-scroll", "summon-cinderhorn-qilin"];
  state.p2.graveyard = [senior.id];
  place(state, "p1", 0);
  const intent = { action: "activate-magic", handIndex: 0, graveyardIndex: 1 };
  for (const graveyardIndex of [-1, 1.5, 3, 4, 5]) {
    assert.equal(activateMagic(state, "p1", { ...intent, graveyardIndex }).ok, false);
  }
  const revived = accepted(applyAction(state, "p1", intent));
  assert.equal(revived.p1.monsterZones[1]?.cardId, senior.id);
  assert.equal(revived.p1.monsterZones[1]?.position, "defense");
  assert.equal(revived.p1.monsterZones[1]?.faceUp, true);
  assert.equal(revived.normalSummonUsed, true);
  assert.deepEqual(revived.p1.graveyard, [junior.id, senior.id, "chronicle-recon-scroll", "summon-cinderhorn-qilin", reanimation]);
  assert.deepEqual(revived.p2.graveyard, [senior.id]);
  assert.deepEqual(revived.p1.hand, []);
  for (let zone = 1; zone < state.p1.monsterZones.length; zone++) place(state, "p1", zone);
  assert.equal(activateMagic(state, "p1", intent).ok, false);
  assert.deepEqual(state.p1.hand, [reanimation]);
});

test("Guardian's Reversal negates a Jutsu targeting the defender's Monster", () => {
  const state = match();
  state.phase = "main1";
  place(state, "p1", 0);
  place(state, "p2", 0);
  setSnare(state, reversal);
  state.p1.hand = ["chronicle-recall-seal", "chronicle-recon-scroll", "chronicle-tempered-kunai"];
  assert.equal(activateMagic(state, "p1", {
    action: "activate-magic", handIndex: 0, targetZoneIndex: null,
  }).ok, false);
  for (const intent of [
    { action: "activate-magic", handIndex: 1 },
    { action: "activate-magic", handIndex: 2, targetSide: "p1" as const, targetZoneIndex: 0 },
  ]) {
    assert.equal(accepted(activateMagic(state, "p1", intent)).responseWindow, null);
  }
  const activated = accepted(applyAction(state, "p1", {
    action: "activate-magic", handIndex: 0, targetSide: "p2", targetZoneIndex: 0,
  }));
  assert.deepEqual(activated.responseWindow?.eligibleZoneIndexes, [0]);
  const stopped = accepted(applyAction(activated, "p2", { action: "activate-trap", zoneIndex: 0 }));
  assert.equal(stopped.responseWindow, null);
  assert.equal(stopped.p2.monsterZones[0]?.cardId, junior.id);
  assert.deepEqual(stopped.p2.graveyard, [reversal]);
  assert.deepEqual(stopped.p1.graveyard, ["chronicle-recall-seal"]);
});

test("Guardian's Reversal can answer a targeting Snare and resumes the original attack once", () => {
  const state = match();
  place(state, "p1", 0);
  setSnare(state, "chronicle-explosive-tag");
  setSnare(state, "chronicle-smoke-bomb", 1);
  state.p1.magicTrapZones[0] = {
    instanceId: "guardian", cardId: reversal, owner: "p1", zoneIndex: 0, faceUp: false, setOnTurn: 1,
  };
  const attack = accepted(applyAction(state, "p1", { action: "attack", attackerZoneIndex: 0, targetZoneIndex: null }, 2_000));
  const targeted = accepted(applyAction(attack, "p2", { action: "activate-trap", zoneIndex: 0 }, 3_000));
  const window = targeted.responseWindow!;
  assert.equal(window.trigger, "onTrapActivated");
  assert.equal(window.responder, "p1");
  assert.deepEqual(window.eligibleZoneIndexes, [0]);
  assert.equal(projectMatchForViewer(targeted, "p2").responseWindow?.eligibleZoneIndexes, undefined);
  assert.equal(applyAction(targeted, "p2", { action: "activate-trap", zoneIndex: 0 }).ok, false);
  const resumed = accepted(applyAction(targeted, "p1", { action: "activate-trap", zoneIndex: 0 }, 4_000));
  assert.equal(resumed.responseWindow, null);
  assert.equal(resumed.p2.lifePoints, state.p2.lifePoints - junior.attack);
  assert.equal(resumed.attacksDeclaredThisTurn, 1);
  assert.deepEqual(resumed.p1.graveyard, [reversal]);
  assert.deepEqual(resumed.p2.graveyard, ["chronicle-explosive-tag"]);
  assert.equal(resumed.p1.monsterZones[0]?.lastAttackTurn, state.turnNumber);
  const expired = accepted(passExpiredResponse(targeted, window.expiresAt));
  assert.equal(expired.responseWindow, null);
  assert.equal(expired.p1.monsterZones[0], null);
  assert.equal(expired.p1.magicTrapZones[0]?.cardId, reversal);
  const nonTargeting = accepted(applyAction(attack, "p2", { action: "activate-trap", zoneIndex: 1 }));
  assert.equal(nonTargeting.responseWindow, null);
  assert.equal(nonTargeting.p1.magicTrapZones[0]?.cardId, reversal);
});

for (const snare of ["chronicle-ironwood-bulwark", "chronicle-scorpion-wire"]) {
  test(`Guardian's Reversal protects the attacker from ${snare}`, () => {
    const state = match();
    place(state, "p1", 0, senior.id);
    place(state, "p2", 0);
    setSnare(state, snare);
    state.p1.magicTrapZones[0] = {
      instanceId: "guardian", cardId: reversal, owner: "p1", zoneIndex: 0,
      faceUp: false, setOnTurn: 1,
    };
    const attack = accepted(applyAction(state, "p1", {
      action: "attack", attackerZoneIndex: 0, targetZoneIndex: 0,
    }));
    const unmodifiedBattle = accepted(passResponse(attack, "p2"));
    const counterWindow = accepted(activateTrap(attack, "p2", 0));
    assert.deepEqual(counterWindow.responseWindow?.eligibleZoneIndexes, [0]);
    const resolved = accepted(activateTrap(counterWindow, "p1", 0));
    assert.equal(resolved.responseWindow, null);
    assert.deepEqual(resolved.p1.monsterZones, unmodifiedBattle.p1.monsterZones);
    assert.deepEqual(resolved.p2.monsterZones, unmodifiedBattle.p2.monsterZones);
    assert.equal(resolved.p2.lifePoints, unmodifiedBattle.p2.lifePoints);
    assert.ok(resolved.p2.graveyard.includes(snare));
  });
}

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
