import test from "node:test";
import assert from "node:assert/strict";
import {
  CHRONICLE_CARD_CATALOG,
  CHRONICLE_DECEMBER_2003_FORMAT,
  CHRONICLE_DECEMBER_2003_LIMITED_IDS,
  CHRONICLE_DECEMBER_2003_SEMI_LIMITED_IDS,
  CHRONICLE_EFFECT_MONSTER_IDS,
  CHRONICLE_ELEMENT_ADVANTAGE,
  CHRONICLE_ELEMENT_BATTLE_BONUS,
  CHRONICLE_ELEMENTS,
  CHRONICLE_FIELD_DEFINITIONS,
  CHRONICLE_FIXED_FALLBACK_DECK,
  CHRONICLE_ROOM_TITLE,
  CHRONICLE_RULES_VERSION,
  CHRONICLE_STARTER_MONSTER_IDS,
  CHRONICLE_SUPPORT_CARDS,
  MAIN_DECK_SIZE,
  OPENING_HAND_SIZE,
  STARTING_LIFE_POINTS,
  advancePhase,
  activateMagic,
  activateTrap,
  changePosition,
  countChronicleCards,
  createMatch,
  declareAttack,
  deckLimitForCard,
  endTurn,
  enterEndPhase,
  enterMain2,
  elementBattleBonus,
  flipSummon,
  getChronicleCard,
  migrateLegacyDeck,
  normalSet,
  normalSummon,
  projectMatchForViewer,
  setTrap,
  startBattlePhase,
  tributeCountForLevel,
  validateDeckIds,
  type ChronicleMatch,
  type ChronicleSideKey,
} from "../../shared/chronicle-duel.js";
import {
  CHRONICLE_FOUNDING_EXCLUDED_EFFECTS,
  CHRONICLE_FOUNDING_EFFECT_AUDIT,
  CHRONICLE_FOUNDING_ROLE_AUDIT,
} from "../../shared/chronicle-duel-audit.js";
import { CHRONICLE_LEGACY_SOURCES } from "../../shared/legacy-card-sources.js";
import { CHRONICLE_STORY_SOURCES } from "../../shared/story-card-sources.js";

const deck = [...CHRONICLE_FIXED_FALLBACK_DECK];
const fixedRandom = () => 0;

function match(): ChronicleMatch {
  const opening = createMatch("One", deck, "Two", deck, fixedRandom, 1_000);
  const standby = advancePhase(opening, opening.activePlayer);
  assert.equal(standby.ok, true);
  if (!standby.ok) return opening;
  const main1 = advancePhase(standby.state, standby.state.activePlayer);
  assert.equal(main1.ok, true);
  return main1.ok ? main1.state : standby.state;
}

function summonReady(cardId: string, levelTributes = 0): ChronicleMatch {
  const state = match();
  const actor = state.activePlayer;
  const side = state[actor];
  side.hand[0] = cardId;
  for (let i = 0; i < levelTributes; i++) {
    side.monsterZones[i] = {
      instanceId: `tribute-${i}`,
      cardId: "tc-01",
      owner: actor,
      zoneIndex: i,
      position: "defense",
      faceUp: false,
      summonedOnTurn: 0,
      lastPositionChangeTurn: 0,
      lastAttackTurn: 0,
      temporaryAttack: 0,
      temporaryDefense: 0,
    };
  }
  return state;
}

function placeMonster(
  state: ChronicleMatch,
  owner: "p1" | "p2",
  zoneIndex: number,
  cardId: string,
  options: {
    position?: "attack" | "defense";
    faceUp?: boolean;
    instanceId?: string;
  } = {},
): string {
  const instanceId = options.instanceId ?? `${owner}-${zoneIndex}-${cardId}`;
  state[owner].monsterZones[zoneIndex] = {
    instanceId,
    cardId,
    owner,
    zoneIndex,
    position: options.position ?? "attack",
    faceUp: options.faceUp ?? true,
    summonedOnTurn: 1,
    lastPositionChangeTurn: 1,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
  return instanceId;
}

test("Chronicle constants and opening rules are locked", () => {
  const state = createMatch("One", deck, "Two", deck, fixedRandom, 1_000);
  assert.equal(state.rulesVersion, CHRONICLE_RULES_VERSION);
  assert.equal(CHRONICLE_ROOM_TITLE, "Founding Codex Format");
  assert.equal(CHRONICLE_DECEMBER_2003_FORMAT.latestLegalSet, "Founding Codex");
  assert.equal(
    CHRONICLE_DECEMBER_2003_FORMAT.limitedListEffective,
    "2003-11-17",
  );
  assert.deepEqual(CHRONICLE_ELEMENTS, [
    "Fire",
    "Water",
    "Earth",
    "Wind",
    "Lightning",
  ]);
  assert.deepEqual(CHRONICLE_ELEMENT_ADVANTAGE, {
    Fire: "Wind",
    Wind: "Lightning",
    Lightning: "Earth",
    Earth: "Water",
    Water: "Fire",
  });
  assert.equal(CHRONICLE_ELEMENT_BATTLE_BONUS, 200);
  assert.equal(elementBattleBonus("Earth", "Water"), 200);
  assert.equal(elementBattleBonus("Earth", "Fire"), 0);
  assert.deepEqual(CHRONICLE_DECEMBER_2003_FORMAT.defaultField, {
    name: "Neutral Field",
    attackModifier: 0,
    cardActive: false,
  });
  assert.deepEqual(
    CHRONICLE_DECEMBER_2003_FORMAT.phases.map((phase) => phase.id),
    ["draw", "standby", "main1", "battle", "main2", "end"],
  );
  assert.equal(state.p1.lifePoints, STARTING_LIFE_POINTS);
  assert.equal(state.p2.lifePoints, STARTING_LIFE_POINTS);
  assert.equal(
    state.p1.hand.length,
    OPENING_HAND_SIZE + 1,
    "the 2003 first player draws on turn one",
  );
  assert.equal(state.p2.hand.length, OPENING_HAND_SIZE);
  assert.equal(state.p1.deck.length, MAIN_DECK_SIZE - OPENING_HAND_SIZE - 1);
  assert.equal(state.p2.deck.length, MAIN_DECK_SIZE - OPENING_HAND_SIZE);
  assert.equal(state.phase, "draw");
  assert.ok(Number.isInteger(state.rngState));
  assert.equal(startBattlePhase(state, state.activePlayer).ok, false);
  const standby = advancePhase(state, state.activePlayer);
  assert.equal(standby.ok, true);
  if (!standby.ok) return;
  assert.equal(standby.state.phase, "standby");
  const main1 = advancePhase(standby.state, standby.state.activePlayer);
  assert.equal(main1.ok, true);
  if (main1.ok)
    assert.equal(
      startBattlePhase(main1.state, main1.state.activePlayer).ok,
      false,
    );
});

test("random card effects advance a persisted deterministic match RNG", () => {
  const first = match();
  const actor = first.activePlayer;
  first.rngState = 123_456_789;
  first[actor].hand = [
    "chronicle-crimson-insight",
    "tc-01",
    "tc-02",
    "tc-03",
  ];
  const second = structuredClone(first);
  const resolve = (state: ChronicleMatch) =>
    activateMagic(state, actor, {
      action: "activate-magic",
      handIndex: 0,
    });
  const a = resolve(first);
  const b = resolve(second);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.equal(a.state.rngState, b.state.rngState);
  assert.notEqual(a.state.rngState, 123_456_789);
  assert.deepEqual(a.state[actor].hand, b.state[actor].hand);
  assert.deepEqual(a.state[actor].graveyard, b.state[actor].graveyard);
});

test("every catalog card carries an original, unique name and id", () => {
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const card of CHRONICLE_CARD_CATALOG) {
    assert.ok(card.name.trim().length > 0, `${card.id} must have a name`);
    assert.equal(names.has(card.name), false, `duplicate name ${card.name}`);
    assert.equal(ids.has(card.id), false, `duplicate id ${card.id}`);
    names.add(card.name);
    ids.add(card.id);
  }
});

test("tribute ladder is 1-4/0, 5-6/1, 7-8/2", () => {
  assert.deepEqual(
    Array.from({ length: 8 }, (_, i) => tributeCountForLevel(i + 1)),
    [0, 0, 0, 0, 1, 1, 2, 2],
  );
  assert.throws(() => tributeCountForLevel(9));
});

test("deck validation enforces exactly 40 and at most three copies", () => {
  assert.equal(validateDeckIds(deck).valid, true);
  assert.equal(validateDeckIds(deck.slice(0, 39)).valid, false);
  assert.equal(validateDeckIds(Array(40).fill("tc-01")).valid, false);
  assert.equal(
    validateDeckIds([...deck.slice(0, 39), "forged-card"]).valid,
    false,
  );
});

test("deck validation enforces the number of physical copies owned", () => {
  const ownership = countChronicleCards(deck);
  assert.equal(validateDeckIds(deck, ownership).valid, true);
  ownership.set("tc-01", 1);
  const check = validateDeckIds(deck, ownership);
  assert.equal(check.valid, false);
  assert.ok(check.errors.some((error) => error.includes("Only 1 owned tc-01")));
});

test("all cards carry art while Smoke Bomb is the locked Trap", () => {
  assert.equal(CHRONICLE_CARD_CATALOG.length, 387);
  for (const card of CHRONICLE_CARD_CATALOG) {
    assert.ok(
      card.image?.startsWith("/"),
      `${card.id} is missing its project art path`,
    );
    if (card.cardClass === "monster")
      assert.ok(
        CHRONICLE_ELEMENTS.includes(card.element),
        `${card.id} has invalid element ${card.element}`,
      );
  }
  const smoke = getChronicleCard("chronicle-smoke-bomb");
  assert.equal(smoke?.cardClass, "trap");
  if (smoke?.cardClass === "trap") {
    assert.equal(smoke.effect.trigger, "onAttackDeclared");
    assert.equal(smoke.effect.kind, "negateOneAttack");
  }
  assert.equal(
    CHRONICLE_CARD_CATALOG.some(
      (c) => c.name === "Smoke Bomb" && c.cardClass === "magic",
    ),
    false,
  );
});

test("Effect Monsters occupy the reviewed 20-25 percent band with complete typed metadata", () => {
  const monsters = CHRONICLE_CARD_CATALOG.filter(
    (card) => card.cardClass === "monster",
  );
  const effectMonsters = monsters.filter(
    (card) => card.monsterType === "effect",
  );
  const share = effectMonsters.length / monsters.length;

  assert.equal(monsters.length, 287);
  assert.equal(effectMonsters.length, 66);
  assert.equal(CHRONICLE_EFFECT_MONSTER_IDS.length, 66);
  assert.ok(share >= 0.2 && share <= 0.25, `Effect share was ${share}`);
  assert.equal(new Set(CHRONICLE_EFFECT_MONSTER_IDS).size, 66);

  for (const card of monsters) {
    if (card.monsterType === "effect") {
      assert.ok(card.effectText?.trim(), `${card.id} is missing effect text`);
      assert.ok(card.monsterEffect, `${card.id} is missing a typed effect`);
    } else {
      assert.equal(card.monsterEffect, undefined);
      assert.equal(card.effectText, undefined);
    }
  }

  assert.deepEqual(
    [...new Set(effectMonsters.map((card) => card.monsterEffect?.kind))].sort(),
    [
      "alliedElementAttackBoost",
      "changeStrongestOpponentPositionOnFlip",
      "changeToDefenseWhenAttacked",
      "cycleHandsOnFlip",
      "destroyAttackerOnFlip",
      "destroyAttackerWhenDefenseHolds",
      "destroySetMagicTrapOnTributeSummon",
      "destroyStrongestOpponentOnFlip",
      "discardOpponentCardOnBattleDamage",
      "drawOnBattleDamage",
      "drawOnFlip",
      "drawOnTributeSummon",
      "drawWhenDestroyedByBattle",
      "gainAttackOnMagicActivated",
      "gainAttackPerOpponentMonster",
      "gainAttackWhenBattlingStronger",
      "gainAttackWhileOnlyMonster",
      "guardOtherMonsters",
      "healOnFlip",
      "phaseOutBattlePairAfterDamage",
      "piercingBattleDamage",
      "recoverFieldMagicWhenDestroyedByBattle",
      "recoverMagicOnFlip",
      "reflectDamageWhenAttacked",
      "returnBattleOpponentWhenDestroyed",
      "returnToDeckWhenDestroyed",
      "reviveNormalWhenDestroyedByBattle",
      "sealAllTraps",
      "sealAttackTraps",
      "searchNormalWhenDestroyedByBattle",
      "setStrongestOpponentFaceDownOnSummon",
      "shiftToDefenseAfterAttack",
      "surviveBattleOncePerTurn",
      "weakenAttackerOnFlip",
    ],
  );
});

test("the Monster pool uses exactly five nearly-even elements and no neutral Monsters", () => {
  const monsters = CHRONICLE_CARD_CATALOG.filter(
    (card) => card.cardClass === "monster",
  );
  const counts = Object.fromEntries(
    CHRONICLE_ELEMENTS.map((element) => [
      element,
      monsters.filter((card) => card.element === element).length,
    ]),
  );
  assert.deepEqual(counts, {
    Fire: 57,
    Water: 57,
    Earth: 57,
    Wind: 57,
    Lightning: 59,
  });
  assert.equal(
    monsters.some((card) => !CHRONICLE_ELEMENTS.includes(card.element)),
    false,
  );
  assert.equal(
    CHRONICLE_CARD_CATALOG.some(
      (card) => card.cardClass !== "monster" && "element" in card,
    ),
    false,
  );
});

test("reviewed monster ladder keeps starter creatures weak and world entities mythic", () => {
  const training = getChronicleCard("tc-01");
  const cat = getChronicleCard("tc-02");
  const world = getChronicleCard("tc-150");
  assert.equal(training?.cardClass, "monster");
  assert.equal(cat?.cardClass, "monster");
  assert.equal(world?.cardClass, "monster");
  if (
    training?.cardClass === "monster" &&
    cat?.cardClass === "monster" &&
    world?.cardClass === "monster"
  ) {
    assert.equal(training.level, 1);
    assert.equal(cat.powerTier, "weak");
    assert.ok(cat.level <= 3);
    assert.equal(world.powerTier, "mythic");
    assert.equal(world.level, 8);
  }
});

test("classic starter spans low, medium, one-Tribute, and two-Tribute Monster bands", () => {
  const tiers = CHRONICLE_STARTER_MONSTER_IDS.map((id) =>
    getChronicleCard(id),
  ).flatMap((card) => (card?.cardClass === "monster" ? [card.powerTier] : []));
  assert.equal(CHRONICLE_STARTER_MONSTER_IDS.length, 20);
  assert.ok(tiers.includes("weak"));
  assert.ok(tiers.includes("standard"));
  assert.ok(tiers.includes("elite"));
  assert.ok(tiers.includes("boss"));
  const fallbackMonsters = CHRONICLE_FIXED_FALLBACK_DECK.filter(
    (id) => getChronicleCard(id)?.cardClass === "monster",
  );
  assert.equal(fallbackMonsters.length, 24);
  assert.deepEqual(
    Object.fromEntries(
      CHRONICLE_ELEMENTS.map((element) => [
        element,
        fallbackMonsters.filter((id) => {
          const card = getChronicleCard(id);
          return card?.cardClass === "monster" && card.element === element;
        }).length,
      ]),
    ),
    { Fire: 5, Water: 5, Earth: 5, Wind: 5, Lightning: 4 },
  );
  assert.equal(
    fallbackMonsters.filter((id) => {
      const card = getChronicleCard(id);
      return card?.cardClass === "monster" && card.monsterType === "effect";
    }).length,
    5,
  );
  assert.equal(
    new Set(
      fallbackMonsters.map(
        (id) => (getChronicleCard(id) as { powerTier?: string })?.powerTier,
      ),
    ).size,
    4,
  );
  const catalogTierCounts = CHRONICLE_CARD_CATALOG.filter(
    (card) => card.cardClass === "monster",
  ).reduce<Record<string, number>>(
    (counts, card) => ({
      ...counts,
      [card.powerTier]: (counts[card.powerTier] ?? 0) + 1,
    }),
    {},
  );
  assert.ok(catalogTierCounts.weak >= 50);
  assert.ok(catalogTierCounts.standard >= 40);
  assert.ok(catalogTierCounts.elite >= 50);
  assert.ok(catalogTierCounts.boss >= 30);
  assert.ok(catalogTierCounts.mythic >= 20);
});

test("U.S. 2002-2003 role pass provides deep Magic and Trap pools without copied identities", () => {
  const magicCards = CHRONICLE_SUPPORT_CARDS.filter(
    (card) => card.cardClass === "magic",
  );
  const trapCards = CHRONICLE_SUPPORT_CARDS.filter(
    (card) => card.cardClass === "trap",
  );
  assert.equal(magicCards.length, 48);
  assert.equal(trapCards.length, 52);
  assert.ok(
    magicCards.filter((card) => card.effectTier === "advanced").length >= 16,
  );
  assert.ok(
    trapCards.filter((card) => card.effectTier === "advanced").length >= 20,
  );
  assert.ok(
    new Set(trapCards.map((card) => card.effect.kind)).size >= 18,
    "the Trap pool must contain genuinely different outcomes",
  );
  assert.ok(
    new Set(
      trapCards
        .filter((card) => card.effect.trigger === "onAttackDeclared")
        .map((card) => card.effect.kind),
    ).size >= 12,
    "battle Traps must offer more than destroy, return, and negate",
  );
  for (const card of trapCards)
    assert.equal(
      card.trapType,
      card.effect.trigger === "onMagicActivated" ? "counter" : "normal",
      `${card.id} physical Trap type must match its response role`,
    );
  for (const row of CHRONICLE_FOUNDING_ROLE_AUDIT) {
    assert.ok(row.chronicleCardIds.length > 0);
    for (const id of row.chronicleCardIds)
      assert.ok(getChronicleCard(id), `${row.role} references missing ${id}`);
  }
  const expectedTriggerByRole = new Map<string, string>([
    ["attack declaration response", "onAttackDeclared"],
    ["summon response", "onMonsterSummoned"],
    ["Jutsu activation counter", "onMagicActivated"],
  ]);
  for (const row of CHRONICLE_FOUNDING_ROLE_AUDIT) {
    const expectedTrigger = expectedTriggerByRole.get(row.role);
    if (!expectedTrigger) continue;
    for (const id of row.chronicleCardIds) {
      const card = getChronicleCard(id);
      assert.equal(card?.cardClass, "trap", `${id} must be a Trap`);
      if (card?.cardClass === "trap")
        assert.equal(card.effect.trigger, expectedTrigger, id);
    }
  }
  const elementalTraps = trapCards.filter(
    (card) => card.effect.requiresFaceUpElement,
  );
  assert.deepEqual(
    Object.fromEntries(
      CHRONICLE_ELEMENTS.map((element) => [
        element,
        elementalTraps.filter(
          (card) => card.effect.requiresFaceUpElement === element,
        ).length,
      ]),
    ),
    { Fire: 5, Water: 5, Earth: 5, Wind: 5, Lightning: 5 },
  );
  for (const card of trapCards.filter(
    (candidate) => candidate.effect.trigger === "onMonsterSummoned",
  )) {
    assert.match(card.effectText, /Normal Summoned/);
    assert.doesNotMatch(card.effectText, / is Summoned/);
  }
});

test("popular legal December 2003 effects are translated into distinct Chronicle roles", () => {
  assert.equal(CHRONICLE_FOUNDING_EFFECT_AUDIT.length, 16);
  assert.ok(CHRONICLE_FOUNDING_EXCLUDED_EFFECTS.length >= 4);
  const expectedKinds: Readonly<Record<string, string>> = {
    "tc-08": "destroyStrongestOpponentOnFlip",
    "tc-33": "recoverMagicOnFlip",
    "tc-31": "discardOpponentCardOnBattleDamage",
    "tc-20": "searchNormalWhenDestroyedByBattle",
    "tc-50": "sealAllTraps",
    "tc-44": "phaseOutBattlePairAfterDamage",
    "tc-39": "setStrongestOpponentFaceDownOnSummon",
    "tc-63": "reflectDamageWhenAttacked",
    "chronicle-giant-felling-edict": "destroyAllOpponentMonsters",
    "chronicle-executioners-mandate": "destroyAllMonsters",
    "chronicle-hundredfold-tempest": "destroyAllOpponentMagicTraps",
    "chronicle-storm-shear": "destroyAllMagicTraps",
    "chronicle-mirror-shell-counter":
      "destroyAllAttackPositionMonsters",
    "chronicle-returning-cylinder-seal": "negateAttackAndInflictDamage",
    "chronicle-torrential-tag-field": "destroyAllMonsters",
    "chronicle-ringed-detonation": "destroyAttackerAndDamageBoth",
  };

  for (const row of CHRONICLE_FOUNDING_EFFECT_AUDIT) {
    assert.ok(row.chronicleCardIds.length > 0);
    for (const id of row.chronicleCardIds) {
      const card = getChronicleCard(id);
      assert.ok(card, `${row.role} references missing ${id}`);
      const kind =
        card?.cardClass === "monster"
          ? card.monsterEffect?.kind
          : card?.effect.kind;
      assert.equal(kind, expectedKinds[id], id);
      if (row.copyRule === "limited")
        assert.equal(deckLimitForCard(id), 1, `${id} must remain one-copy`);
    }
  }
});

test("five Field Magic environments apply the requested elemental ATK shifts and replace one another", () => {
  assert.deepEqual(
    CHRONICLE_FIELD_DEFINITIONS.map(
      ({ id, boostElement, penaltyElement, attackBonus, attackPenalty }) => ({
        id,
        boostElement,
        penaltyElement,
        attackBonus,
        attackPenalty,
      }),
    ),
    [
      {
        id: "volcano",
        boostElement: "Fire",
        penaltyElement: "Wind",
        attackBonus: 300,
        attackPenalty: -200,
      },
      {
        id: "ocean",
        boostElement: "Water",
        penaltyElement: "Fire",
        attackBonus: 300,
        attackPenalty: -200,
      },
      {
        id: "desert",
        boostElement: "Earth",
        penaltyElement: "Water",
        attackBonus: 300,
        attackPenalty: -200,
      },
      {
        id: "sky",
        boostElement: "Wind",
        penaltyElement: "Lightning",
        attackBonus: 300,
        attackPenalty: -200,
      },
      {
        id: "lightning-storm",
        boostElement: "Lightning",
        penaltyElement: "Earth",
        attackBonus: 300,
        attackPenalty: -200,
      },
    ],
  );

  const state = match();
  const actor = state.activePlayer;
  const defender = actor === "p1" ? "p2" : "p1";
  state[actor].hand[0] = "chronicle-field-volcano";
  state[actor].monsterZones[0] = {
    instanceId: "fire-monster",
    cardId: "tc-08",
    owner: actor,
    zoneIndex: 0,
    position: "attack",
    faceUp: true,
    summonedOnTurn: 0,
    lastPositionChangeTurn: 0,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
  state[defender].monsterZones[0] = {
    instanceId: "wind-monster",
    cardId: "tc-02",
    owner: defender,
    zoneIndex: 0,
    position: "attack",
    faceUp: true,
    summonedOnTurn: 0,
    lastPositionChangeTurn: 0,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
  state[actor].magicTrapZones = state[actor].magicTrapZones.map(
    (_, zoneIndex) => ({
      instanceId: `occupied-${zoneIndex}`,
      cardId: "chronicle-smoke-bomb",
      owner: actor,
      zoneIndex,
      faceUp: false,
      setOnTurn: 0,
    }),
  );

  const volcano = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(
    volcano.ok,
    true,
    "Field Magic should not consume a regular Magic/Trap Zone",
  );
  if (!volcano.ok) return;
  assert.deepEqual(volcano.state.activeField, {
    cardId: "chronicle-field-volcano",
    fieldId: "volcano",
    owner: actor,
  });
  const fireCard = getChronicleCard("tc-08");
  const windCard = getChronicleCard("tc-02");
  const projected = projectMatchForViewer(volcano.state, actor);
  assert.equal(
    projected[actor].monsterZones[0]?.attack,
    (fireCard?.cardClass === "monster" ? fireCard.attack : 0) + 300,
  );
  assert.equal(
    projected[defender].monsterZones[0]?.attack,
    (windCard?.cardClass === "monster" ? windCard.attack : 0) - 200,
  );
  assert.equal(projected.activeField?.image, "/chronicle/fields/volcano.webp");

  volcano.state[actor].hand[0] = "chronicle-field-ocean";
  const ocean = activateMagic(volcano.state, actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(ocean.ok, true);
  if (!ocean.ok) return;
  assert.equal(ocean.state.activeField?.fieldId, "ocean");
  assert.ok(ocean.state[actor].graveyard.includes("chronicle-field-volcano"));
});

test("iconic high-impact roles use visible one- or two-copy deck limits", () => {
  assert.ok(CHRONICLE_DECEMBER_2003_LIMITED_IDS.length >= 10);
  assert.ok(CHRONICLE_DECEMBER_2003_SEMI_LIMITED_IDS.length >= 10);
  for (const id of CHRONICLE_DECEMBER_2003_LIMITED_IDS)
    assert.equal(deckLimitForCard(id), 1);
  for (const id of CHRONICLE_DECEMBER_2003_SEMI_LIMITED_IDS)
    assert.equal(deckLimitForCard(id), 2);
  assert.equal(deckLimitForCard("chronicle-stacked-scrolls"), 1);
  assert.equal(deckLimitForCard("chronicle-sealbreak-verdict"), 2);
  assert.equal(deckLimitForCard("tc-01"), 3);
  const forged = [...CHRONICLE_FIXED_FALLBACK_DECK];
  forged[0] = "chronicle-stacked-scrolls";
  forged[1] = "chronicle-stacked-scrolls";
  assert.equal(validateDeckIds(forged).valid, false);
});

test("all 100 Legacies map exactly once and obey their reviewed rarity bands", () => {
  assert.equal(CHRONICLE_LEGACY_SOURCES.length, 100);
  const cards = CHRONICLE_CARD_CATALOG.filter((card) =>
    card.id.startsWith("legacy-"),
  );
  assert.equal(cards.length, 100);
  assert.equal(new Set(cards.map((card) => card.id)).size, 100);
  for (const source of CHRONICLE_LEGACY_SOURCES) {
    const card = getChronicleCard(`legacy-${source.id}`);
    assert.equal(card?.cardClass, "monster");
    if (card?.cardClass !== "monster") continue;
    assert.equal(card.family, "Legacy Incarnation");
    if (source.rarity === "basic")
      assert.ok(card.level >= 2 && card.level <= 4);
    if (source.rarity === "rare") assert.ok(card.level >= 4 && card.level <= 5);
    if (source.rarity === "legendary")
      assert.ok(card.level >= 6 && card.level <= 7);
    if (source.rarity === "mythic")
      assert.ok(card.level >= 7 && card.level <= 8);
  }
});

test("every reviewed story boss plus the Wandering Sage maps without narrator/player rows", () => {
  assert.equal(CHRONICLE_STORY_SOURCES.length, 36);
  for (const source of CHRONICLE_STORY_SOURCES) {
    const card = getChronicleCard(`story-${source.aiProfileId}`);
    assert.equal(card?.cardClass, "monster");
    assert.doesNotMatch(source.bossName, /^(Narrator|Player)$/i);
    if (source.levelReq >= 100 && card?.cardClass === "monster")
      assert.equal(card.powerTier, "mythic");
  }
  const sage = getChronicleCard("story-wandering-sage");
  assert.equal(sage?.cardClass, "monster");
  assert.equal(sage?.image, "/portraits/wandering-sage.webp");
});

test("Normal Summon/Set uses exact distinct Tributes and sends them to Graveyard", () => {
  const level5 = summonReady("tc-96", 1);
  const actor = level5.activePlayer;
  assert.equal(
    normalSummon(level5, actor, {
      action: "normal-summon",
      handIndex: 0,
      zoneIndex: 1,
      tributeZoneIndexes: [],
    }).ok,
    false,
  );
  const summoned = normalSummon(level5, actor, {
    action: "normal-summon",
    handIndex: 0,
    zoneIndex: 1,
    tributeZoneIndexes: [0],
  });
  assert.equal(summoned.ok, true);
  if (summoned.ok) {
    assert.equal(summoned.state[actor].graveyard.includes("tc-01"), true);
    assert.equal(summoned.state[actor].monsterZones[1]?.cardId, "tc-96");
    assert.equal(summoned.state[actor].monsterZones[1]?.position, "attack");
    assert.equal(summoned.state.normalSummonUsed, true);
    assert.equal(
      normalSet(summoned.state, actor, {
        action: "set-monster",
        handIndex: 0,
        zoneIndex: 2,
      }).ok,
      false,
    );
  }
  const level8 = summonReady("tc-150", 2);
  assert.equal(
    normalSummon(level8, level8.activePlayer, {
      action: "normal-summon",
      handIndex: 0,
      zoneIndex: 2,
      tributeZoneIndexes: [0, 0],
    }).ok,
    false,
  );
});

test("Flip Summon and manual position changes respect turn restrictions", () => {
  let state = summonReady("tc-01");
  const actor = state.activePlayer;
  const set = normalSet(state, actor, {
    action: "set-monster",
    handIndex: 0,
    zoneIndex: 0,
  });
  assert.equal(set.ok, true);
  if (!set.ok) return;
  assert.equal(set.state[actor].monsterZones[0]?.faceUp, false);
  assert.equal(set.state[actor].monsterZones[0]?.position, "defense");
  assert.equal(flipSummon(set.state, actor, 0).ok, false);
  state = set.state;
  state.turnNumber += 2;
  state.activePlayer = actor;
  state.normalSummonUsed = false;
  const flipped = flipSummon(state, actor, 0);
  assert.equal(flipped.ok, true);
  if (flipped.ok)
    assert.equal(changePosition(flipped.state, actor, 0, "defense").ok, false);
});

test("six-phase flow reaches Main 2, End, and the next Draw Phase", () => {
  let state = match();
  const first = state.activePlayer;
  const second = first === "p1" ? "p2" : "p1";
  state.turnNumber = 2;
  const firstHandBefore = state[first].hand.length;
  const secondHandBefore = state[second].hand.length;
  const battle = startBattlePhase(state, first);
  assert.equal(battle.ok, true);
  if (!battle.ok) return;
  const main2 = enterMain2(battle.state, first);
  assert.equal(main2.ok, true);
  if (!main2.ok) return;
  const end = enterEndPhase(main2.state, first);
  assert.equal(end.ok, true);
  if (!end.ok) return;
  assert.equal(end.state.phase, "end");
  const ended = endTurn(end.state, first, 2_000);
  assert.equal(ended.ok, true);
  if (ended.ok) {
    assert.equal(ended.state.activePlayer === first, false);
    assert.equal(ended.state.phase, "draw");
    assert.equal(ended.state[first].hand.length, firstHandBefore);
    assert.equal(ended.state[second].hand.length, secondHandBefore + 1);
  }
});

test("direct attack is blocked by a defender and battle damage is server-computed", () => {
  const state = match();
  const actor = state.activePlayer;
  const defenderKey = actor === "p1" ? "p2" : "p1";
  state.turnNumber = 2;
  state.phase = "battle";
  state[actor].monsterZones[0] = {
    instanceId: "a",
    cardId: "tc-21",
    owner: actor,
    zoneIndex: 0,
    position: "attack",
    faceUp: true,
    summonedOnTurn: 1,
    lastPositionChangeTurn: 1,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
  state[defenderKey].monsterZones[0] = {
    instanceId: "d",
    cardId: "tc-01",
    owner: defenderKey,
    zoneIndex: 0,
    position: "defense",
    faceUp: false,
    summonedOnTurn: 1,
    lastPositionChangeTurn: 1,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
  assert.equal(
    declareAttack(state, actor, {
      action: "attack",
      attackerZoneIndex: 0,
      targetZoneIndex: null,
    }).ok,
    false,
  );
  const battle = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(battle.ok, true);
  if (battle.ok) {
    assert.equal(battle.state[defenderKey].monsterZones[0], null);
    assert.equal(battle.state[actor].monsterZones[0]?.lastAttackTurn, 2);
    assert.equal(
      declareAttack(battle.state, actor, {
        action: "attack",
        attackerZoneIndex: 0,
        targetZoneIndex: null,
      }).ok,
      false,
    );
  }
});

test("the five-element wheel adds 200 only to the advantaged battle stat", () => {
  const state = match();
  const actor = state.activePlayer;
  const defender = actor === "p1" ? "p2" : "p1";
  state.turnNumber = 2;
  state.phase = "battle";
  placeMonster(state, actor, 0, "tc-21"); // Earth, 1500 ATK
  placeMonster(state, defender, 0, "tc-23"); // Water, 1600 ATK

  const result = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state[defender].monsterZones[0], null);
  assert.equal(result.state[defender].lifePoints, STARTING_LIFE_POINTS - 100);
  assert.ok(result.state.log.some((line) => line.includes("Element edge")));
});

test("Field Magic replaces rather than stacks with the neutral element wheel", () => {
  const state = match();
  const actor = state.activePlayer;
  const defender = actor === "p1" ? "p2" : "p1";
  state.turnNumber = 2;
  state.phase = "battle";
  state.activeField = {
    cardId: "chronicle-field-desert",
    fieldId: "desert",
    owner: actor,
  };
  placeMonster(state, actor, 0, "tc-21"); // Earth 1500 +300
  placeMonster(state, defender, 0, "tc-23"); // Water 1600 -200

  const result = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state[defender].lifePoints, STARTING_LIFE_POINTS - 400);
  assert.equal(result.state.log.some((line) => line.includes("Element edge")), false);
  assert.equal(
    elementBattleBonus("Earth", "Water", result.state.activeField),
    0,
  );
});

test("Flip effects draw, heal, weaken an attacker, and spring a concealed tag ambush", () => {
  let state = summonReady("tc-10");
  const actor = state.activePlayer;
  const setLookout = normalSet(state, actor, {
    action: "set-monster",
    handIndex: 0,
    zoneIndex: 0,
  });
  assert.equal(setLookout.ok, true);
  if (!setLookout.ok) return;
  state = setLookout.state;
  state.turnNumber += 2;
  state.activePlayer = actor;
  state.phase = "main1";
  const handBefore = state[actor].hand.length;
  const deckBefore = state[actor].deck.length;
  const lookout = flipSummon(state, actor, 0);
  assert.equal(lookout.ok, true);
  if (!lookout.ok) return;
  assert.equal(lookout.state[actor].hand.length, handBefore + 1);
  assert.equal(lookout.state[actor].deck.length, deckBefore - 1);

  state = summonReady("tc-13");
  state[state.activePlayer].lifePoints = 7_900;
  const setWisp = normalSet(state, state.activePlayer, {
    action: "set-monster",
    handIndex: 0,
    zoneIndex: 0,
  });
  assert.equal(setWisp.ok, true);
  if (!setWisp.ok) return;
  setWisp.state.turnNumber += 2;
  setWisp.state.phase = "main1";
  const wisp = flipSummon(setWisp.state, setWisp.state.activePlayer, 0);
  assert.equal(wisp.ok, true);
  if (wisp.ok)
    assert.equal(wisp.state[wisp.state.activePlayer].lifePoints, 8_400);

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  const attackSide = state.activePlayer;
  const defendSide = attackSide === "p1" ? "p2" : "p1";
  placeMonster(state, attackSide, 0, "tc-21", { instanceId: "tag-attacker" });
  placeMonster(state, defendSide, 0, "tc-08", {
    position: "defense",
    faceUp: false,
    instanceId: "tag-mouse",
  });
  const tagAmbush = declareAttack(state, attackSide, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(tagAmbush.ok, true);
  if (!tagAmbush.ok) return;
  assert.equal(tagAmbush.state[attackSide].monsterZones[0], null);
  assert.equal(tagAmbush.state[defendSide].monsterZones[0], null);
  assert.ok(tagAmbush.state[attackSide].graveyard.includes("tc-21"));
  assert.ok(tagAmbush.state[defendSide].graveyard.includes("tc-08"));

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  const weakenedAttackSide = state.activePlayer;
  const weakenedDefendSide = weakenedAttackSide === "p1" ? "p2" : "p1";
  placeMonster(state, weakenedAttackSide, 0, "tc-02");
  placeMonster(state, weakenedDefendSide, 0, "tc-85", {
    position: "defense",
    faceUp: false,
  });
  const weakened = declareAttack(state, weakenedAttackSide, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(weakened.ok, true);
  if (weakened.ok) {
    assert.equal(weakened.state[weakenedAttackSide].lifePoints, 7_000);
    assert.ok(weakened.state[weakenedAttackSide].monsterZones[0]);
    assert.ok(weakened.state[weakenedDefendSide].monsterZones[0]);
  }
});

test("popular 2003 Monster roles remove, recover, recruit, discard, and suppress Traps", () => {
  let state = summonReady("tc-08");
  let actor = state.activePlayer;
  let opponent: ChronicleSideKey = actor === "p1" ? "p2" : "p1";
  const setRemoval = normalSet(state, actor, {
    action: "set-monster",
    handIndex: 0,
    zoneIndex: 0,
  });
  assert.equal(setRemoval.ok, true);
  if (!setRemoval.ok) return;
  state = setRemoval.state;
  state.turnNumber += 2;
  state.phase = "main1";
  placeMonster(state, opponent, 0, "tc-01", { instanceId: "weak-target" });
  placeMonster(state, opponent, 1, "tc-150", {
    instanceId: "strong-target",
  });
  const removal = flipSummon(state, actor, 0);
  assert.equal(removal.ok, true);
  if (!removal.ok) return;
  assert.ok(removal.state[opponent].monsterZones[0]);
  assert.equal(removal.state[opponent].monsterZones[1], null);

  state = summonReady("tc-33");
  actor = state.activePlayer;
  const setRecovery = normalSet(state, actor, {
    action: "set-monster",
    handIndex: 0,
    zoneIndex: 0,
  });
  assert.equal(setRecovery.ok, true);
  if (!setRecovery.ok) return;
  state = setRecovery.state;
  state[actor].graveyard.push(
    "chronicle-recon-scroll",
    "tc-01",
    "chronicle-medical-salve",
  );
  state.turnNumber += 2;
  state.phase = "main1";
  const recovery = flipSummon(state, actor, 0);
  assert.equal(recovery.ok, true);
  if (!recovery.ok) return;
  assert.ok(recovery.state[actor].hand.includes("chronicle-medical-salve"));
  assert.equal(
    recovery.state[actor].graveyard.includes("chronicle-medical-salve"),
    false,
  );

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-150", { instanceId: "recruit-attacker" });
  placeMonster(state, opponent, 0, "tc-20", {
    instanceId: "village-messenger",
  });
  state[opponent].deck.unshift("tc-01");
  const recruitedHandSize = state[opponent].hand.length;
  const recruiterBattle = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(recruiterBattle.ok, true);
  if (!recruiterBattle.ok) return;
  assert.equal(
    recruiterBattle.state[opponent].hand.length,
    recruitedHandSize + 1,
  );
  assert.ok(recruiterBattle.state[opponent].hand.includes("tc-01"));

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-31", { instanceId: "scroll-thief" });
  const opponentHandSize = state[opponent].hand.length;
  const opponentGraveSize = state[opponent].graveyard.length;
  const theft = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: null,
  });
  assert.equal(theft.ok, true);
  if (!theft.ok) return;
  assert.equal(theft.state[opponent].hand.length, opponentHandSize - 1);
  assert.equal(theft.state[opponent].graveyard.length, opponentGraveSize + 1);

  state = summonReady("tc-39");
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  placeMonster(state, opponent, 0, "tc-01", { instanceId: "small-mark" });
  placeMonster(state, opponent, 1, "tc-150", { instanceId: "large-mark" });
  const moonshadow = normalSummon(state, actor, {
    action: "normal-summon",
    handIndex: 0,
    zoneIndex: 0,
  });
  assert.equal(moonshadow.ok, true);
  if (!moonshadow.ok) return;
  assert.equal(moonshadow.state[opponent].monsterZones[1]?.faceUp, false);
  assert.equal(
    moonshadow.state[opponent].monsterZones[1]?.position,
    "defense",
  );
  assert.equal(moonshadow.state[opponent].monsterZones[0]?.faceUp, true);

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-21", { instanceId: "bounder-attacker" });
  placeMonster(state, opponent, 0, "tc-63", { instanceId: "static-beetle" });
  const reflectedAttack = getChronicleCard("tc-21");
  const reflectedDamage =
    reflectedAttack?.cardClass === "monster" ? reflectedAttack.attack : 0;
  const reflectedBattle = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(reflectedBattle.ok, true);
  if (!reflectedBattle.ok) return;
  assert.equal(
    reflectedBattle.state[actor].lifePoints,
    STARTING_LIFE_POINTS - reflectedDamage,
  );

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-21", { instanceId: "phase-attacker" });
  placeMonster(state, opponent, 0, "tc-44", { instanceId: "phase-defender" });
  const phased = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(phased.ok, true);
  if (!phased.ok) return;
  assert.equal(phased.state[actor].monsterZones[0], null);
  assert.equal(phased.state[opponent].monsterZones[0], null);
  assert.equal(phased.state[actor].deck.at(-1), "tc-21");
  assert.equal(phased.state[opponent].deck.at(-1), "tc-44");

  state = summonReady("tc-50", 1);
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  state.turnNumber = 3;
  state[opponent].magicTrapZones[0] = {
    instanceId: "summon-pitfall",
    cardId: "chronicle-torrential-tag-field",
    owner: opponent,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  const trapMaster = normalSummon(state, actor, {
    action: "normal-summon",
    handIndex: 0,
    zoneIndex: 1,
    tributeZoneIndexes: [0],
  });
  assert.equal(trapMaster.ok, true);
  if (trapMaster.ok) assert.equal(trapMaster.state.responseWindow, null);
});

test("battle effects resolve piercing, defensive retaliation, and once-per-turn survival", () => {
  let state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  let actor = state.activePlayer;
  let defender: ChronicleSideKey = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-142");
  placeMonster(state, defender, 0, "tc-01", { position: "defense" });
  const pierced = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(pierced.ok, true);
  if (!pierced.ok) return;
  assert.equal(pierced.state[defender].lifePoints, 5_600);
  assert.equal(pierced.state[defender].monsterZones[0], null);

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  actor = state.activePlayer;
  defender = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-21");
  placeMonster(state, defender, 0, "tc-96", { position: "defense" });
  const retaliated = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(retaliated.ok, true);
  if (!retaliated.ok) return;
  assert.equal(retaliated.state[actor].monsterZones[0], null);
  assert.ok(retaliated.state[actor].graveyard.includes("tc-21"));
  assert.ok(retaliated.state[defender].monsterZones[0]);

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  actor = state.activePlayer;
  defender = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-150", { instanceId: "first-attacker" });
  placeMonster(state, actor, 1, "tc-150", { instanceId: "second-attacker" });
  placeMonster(state, defender, 0, "tc-127", { instanceId: "glacier-king" });
  const first = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.state[defender].monsterZones[0]?.cardId, "tc-127");
  assert.equal(first.state[defender].monsterZones[0]?.monsterEffectUsedTurn, 2);
  const second = declareAttack(first.state, actor, {
    action: "attack",
    attackerZoneIndex: 1,
    targetZoneIndex: 0,
  });
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.state[defender].monsterZones[0], null);
});

test("destroyed-by-battle effects draw, displace, recycle, and revive deterministically", () => {
  const battle = (
    defenderId: string,
  ): {
    state: ChronicleMatch;
    actor: ChronicleSideKey;
    defender: ChronicleSideKey;
  } => {
    const state = match();
    state.turnNumber = 2;
    state.phase = "battle";
    const actor = state.activePlayer;
    const defender = actor === "p1" ? "p2" : "p1";
    placeMonster(state, actor, 0, "tc-150", { instanceId: "battle-attacker" });
    placeMonster(state, defender, 0, defenderId, {
      position: "defense",
      instanceId: "effect-defender",
    });
    return { state, actor, defender };
  };

  let setup = battle("tc-05");
  const handBefore = setup.state[setup.defender].hand.length;
  let result = declareAttack(setup.state, setup.actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state[setup.defender].hand.length, handBefore + 1);

  setup = battle("tc-65");
  result = declareAttack(setup.state, setup.actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state[setup.actor].monsterZones[0], null);
  assert.ok(result.state[setup.actor].hand.includes("tc-150"));

  setup = battle("tc-51");
  result = declareAttack(setup.state, setup.actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state[setup.defender].graveyard.includes("tc-51"), false);
  assert.equal(result.state[setup.defender].deck.at(-1), "tc-51");

  setup = battle("tc-99");
  setup.state[setup.defender].graveyard.push("tc-01");
  result = declareAttack(setup.state, setup.actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.state[setup.defender].monsterZones[0]?.cardId, "tc-01");
    assert.equal(
      result.state[setup.defender].monsterZones[0]?.position,
      "defense",
    );
    assert.equal(
      result.state[setup.defender].graveyard.includes("tc-01"),
      false,
    );
  }
});

test("continuous, attack-success, withdrawal, and Tribute effects alter authoritative state", () => {
  let state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  let actor = state.activePlayer;
  let defender: ChronicleSideKey = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-45", { instanceId: "storm-serpent" });
  let projected = projectMatchForViewer(state, actor);
  assert.equal(projected[actor].monsterZones[0]?.attack, 1_950);
  state.phase = "main1";
  state[actor].hand[0] = "chronicle-recon-scroll";
  const fueled = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(fueled.ok, true);
  if (!fueled.ok) return;
  state = fueled.state;
  projected = projectMatchForViewer(state, actor);
  assert.equal(projected[actor].monsterZones[0]?.attack, 2_150);

  state = match();
  actor = state.activePlayer;
  placeMonster(state, actor, 0, "tc-100", { instanceId: "marshal" });
  placeMonster(state, actor, 1, "tc-02", { instanceId: "wind-ally" });
  projected = projectMatchForViewer(state, actor);
  assert.equal(projected[actor].monsterZones[1]?.attack, 1_200);

  state = match();
  state.turnNumber = 3;
  state.phase = "battle";
  actor = state.activePlayer;
  defender = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-50", { instanceId: "tag-master" });
  state[defender].magicTrapZones[0] = {
    instanceId: "smoke",
    cardId: "chronicle-smoke-bomb",
    owner: defender,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  const sealedAttack = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: null,
  });
  assert.equal(sealedAttack.ok, true);
  if (!sealedAttack.ok) return;
  assert.equal(sealedAttack.state.responseWindow, null);
  assert.ok(sealedAttack.state[defender].lifePoints < STARTING_LIFE_POINTS);

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  actor = state.activePlayer;
  defender = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-04", { instanceId: "scout" });
  const withdrew = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: null,
  });
  assert.equal(withdrew.ok, true);
  if (!withdrew.ok) return;
  assert.equal(withdrew.state[actor].monsterZones[0]?.position, "defense");

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  actor = state.activePlayer;
  placeMonster(state, actor, 0, "tc-101", {
    instanceId: "nightveil-assassin",
  });
  const deckBefore = state[actor].deck.length;
  const stole = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: null,
  });
  assert.equal(stole.ok, true);
  if (!stole.ok) return;
  assert.equal(stole.state[actor].deck.length, deckBefore - 1);

  state = summonReady("story-wandering-sage", 1);
  actor = state.activePlayer;
  const tributeDeckBefore = state[actor].deck.length;
  const tributeHandBefore = state[actor].hand.length;
  const sage = normalSummon(state, actor, {
    action: "normal-summon",
    handIndex: 0,
    zoneIndex: 1,
    tributeZoneIndexes: [0],
  });
  assert.equal(sage.ok, true);
  if (sage.ok) {
    assert.equal(sage.state[actor].deck.length, tributeDeckBefore - 1);
    assert.equal(sage.state[actor].hand.length, tributeHandBefore);
  }
});

test("optional monster guidelines add position locks, tactical scaling, recovery, and guarding", () => {
  let state = summonReady("tc-24");
  let actor = state.activePlayer;
  let opponent: ChronicleSideKey = actor === "p1" ? "p2" : "p1";
  const setFox = normalSet(state, actor, {
    action: "set-monster",
    handIndex: 0,
    zoneIndex: 0,
  });
  assert.equal(setFox.ok, true);
  if (!setFox.ok) return;
  state = setFox.state;
  state.turnNumber += 2;
  state.phase = "main1";
  placeMonster(state, opponent, 0, "tc-21");
  const flipped = flipSummon(state, actor, 0);
  assert.equal(flipped.ok, true);
  if (!flipped.ok) return;
  assert.equal(flipped.state[opponent].monsterZones[0]?.position, "defense");
  flipped.state.turnNumber += 1;
  flipped.state.activePlayer = opponent;
  const locked = changePosition(flipped.state, opponent, 0, "attack");
  assert.equal(locked.ok, false);
  flipped.state.turnNumber += 1;
  const unlocked = changePosition(flipped.state, opponent, 0, "attack");
  assert.equal(unlocked.ok, true);

  state = summonReady("tc-57");
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  const setWisp = normalSet(state, actor, {
    action: "set-monster",
    handIndex: 0,
    zoneIndex: 0,
  });
  assert.equal(setWisp.ok, true);
  if (!setWisp.ok) return;
  state = setWisp.state;
  state.turnNumber += 2;
  state.phase = "main1";
  const actorDeckBeforeCycle = state[actor].deck.length;
  const opponentDeckBeforeCycle = state[opponent].deck.length;
  const actorGraveBeforeCycle = state[actor].graveyard.length;
  const opponentGraveBeforeCycle = state[opponent].graveyard.length;
  const handCycle = flipSummon(state, actor, 0);
  assert.equal(handCycle.ok, true);
  if (!handCycle.ok) return;
  assert.equal(handCycle.state[actor].deck.length, actorDeckBeforeCycle - 1);
  assert.equal(
    handCycle.state[opponent].deck.length,
    opponentDeckBeforeCycle - 1,
  );
  assert.equal(
    handCycle.state[actor].graveyard.length,
    actorGraveBeforeCycle + 1,
  );
  assert.equal(
    handCycle.state[opponent].graveyard.length,
    opponentGraveBeforeCycle + 1,
  );

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-01");
  placeMonster(state, opponent, 0, "tc-34");
  const shelled = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(shelled.ok, true);
  if (!shelled.ok) return;
  assert.equal(shelled.state[opponent].monsterZones[0]?.position, "defense");

  state = match();
  actor = state.activePlayer;
  placeMonster(state, actor, 0, "tc-48");
  let projection = projectMatchForViewer(state, actor);
  assert.equal(projection[actor].monsterZones[0]?.attack, 2_300);
  placeMonster(state, actor, 1, "tc-01");
  projection = projectMatchForViewer(state, actor);
  assert.equal(projection[actor].monsterZones[0]?.attack, 1_800);

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-81");
  placeMonster(state, opponent, 0, "tc-45");
  const underdog = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(underdog.ok, true);
  if (!underdog.ok) return;
  assert.ok(underdog.state[actor].monsterZones[0]);
  assert.equal(underdog.state[opponent].monsterZones[0], null);

  state = summonReady("tc-97", 1);
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  state[opponent].magicTrapZones[0] = {
    instanceId: "set-backrow",
    cardId: "chronicle-smoke-bomb",
    owner: opponent,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 0,
  };
  const stormbreaker = normalSummon(state, actor, {
    action: "normal-summon",
    handIndex: 0,
    zoneIndex: 1,
    tributeZoneIndexes: [0],
  });
  assert.equal(stormbreaker.ok, true);
  if (!stormbreaker.ok) return;
  assert.equal(stormbreaker.state[opponent].magicTrapZones[0], null);
  stormbreaker.state.phase = "battle";
  const blockedAttack = declareAttack(stormbreaker.state, actor, {
    action: "attack",
    attackerZoneIndex: 1,
    targetZoneIndex: null,
  });
  assert.equal(blockedAttack.ok, false);

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-01");
  placeMonster(state, opponent, 0, "tc-121", { position: "defense" });
  placeMonster(state, opponent, 1, "tc-02");
  const bypass = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 1,
  });
  assert.equal(bypass.ok, false);
  const guard = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(guard.ok, true);

  state = match();
  state.turnNumber = 2;
  state.phase = "battle";
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-150");
  placeMonster(state, opponent, 0, "tc-49");
  state[opponent].graveyard.push("chronicle-field-volcano");
  const shrineFallen = declareAttack(state, actor, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(shrineFallen.ok, true);
  if (shrineFallen.ok)
    assert.ok(
      shrineFallen.state[opponent].hand.includes("chronicle-field-volcano"),
    );
});

test("optional Magic guidelines add low-DEF removal, hand cycling, Field recovery, and Equip tradeoffs", () => {
  let state = match();
  let actor = state.activePlayer;
  let opponent: ChronicleSideKey = actor === "p1" ? "p2" : "p1";
  state[actor].hand[0] = "chronicle-hollow-breach";
  placeMonster(state, opponent, 0, "tc-34");
  const illegalBreach = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
    targetSide: opponent,
    targetZoneIndex: 0,
  });
  assert.equal(illegalBreach.ok, false);
  state[opponent].monsterZones[0] = null;
  placeMonster(state, opponent, 0, "tc-13");
  const breach = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
    targetSide: opponent,
    targetZoneIndex: 0,
  });
  assert.equal(breach.ok, true);
  if (!breach.ok) return;
  assert.equal(breach.state[opponent].monsterZones[0], null);

  state = match();
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  state[actor].hand = ["chronicle-war-camp-feast", "tc-01"];
  state[opponent].hand = ["tc-02"];
  const actorDeck = state[actor].deck.length;
  const opponentDeck = state[opponent].deck.length;
  const cycled = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(cycled.ok, true);
  if (!cycled.ok) return;
  assert.equal(cycled.state[actor].deck.length, actorDeck - 1);
  assert.equal(cycled.state[opponent].deck.length, opponentDeck - 1);
  assert.equal(cycled.state[actor].hand.length, 1);
  assert.equal(cycled.state[opponent].hand.length, 1);

  state = match();
  actor = state.activePlayer;
  placeMonster(state, actor, 0, "tc-01");
  const base = getChronicleCard("tc-01");
  assert.equal(base?.cardClass, "monster");
  state[actor].hand[0] = "chronicle-flame-tempered-blade";
  const blade = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
    targetSide: actor,
    targetZoneIndex: 0,
  });
  assert.equal(blade.ok, true);
  if (!blade.ok || base?.cardClass !== "monster") return;
  const bladeProjection = projectMatchForViewer(blade.state, actor);
  assert.equal(bladeProjection[actor].monsterZones[0]?.attack, base.attack + 500);
  assert.equal(bladeProjection[actor].monsterZones[0]?.defense, base.defense - 300);

  state = match();
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-01", { position: "defense" });
  state[actor].hand[0] = "chronicle-stoneplate-harness";
  const harness = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
    targetSide: actor,
    targetZoneIndex: 0,
  });
  assert.equal(harness.ok, true);
  if (!harness.ok) return;
  harness.state.turnNumber = 2;
  harness.state.phase = "battle";
  harness.state.activePlayer = opponent;
  placeMonster(harness.state, opponent, 0, "tc-150");
  const shielded = declareAttack(harness.state, opponent, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(shielded.ok, true);
  if (!shielded.ok) return;
  assert.ok(shielded.state[actor].monsterZones[0]);
  assert.equal(
    shielded.state[actor].monsterZones[0]?.attachedEquipId,
    undefined,
  );
  assert.ok(
    shielded.state[actor].graveyard.includes("chronicle-stoneplate-harness"),
  );

  state = match();
  actor = state.activePlayer;
  state[actor].graveyard.push(
    "chronicle-recon-scroll",
    "chronicle-field-volcano",
  );
  state[actor].hand[0] = "chronicle-grave-lantern-rite";
  const wrongRecovery = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
    graveyardIndex: state[actor].graveyard.length - 2,
  });
  assert.equal(wrongRecovery.ok, false);
  const fieldRecovery = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
    graveyardIndex: state[actor].graveyard.length - 1,
  });
  assert.equal(fieldRecovery.ok, true);
  if (fieldRecovery.ok)
    assert.ok(fieldRecovery.state[actor].hand.includes("chronicle-field-volcano"));
});

test("optional Trap guidelines add scaling armor, redirection, defensive feints, and targeted counters", () => {
  const trapBattle = (
    trapId: string,
    attackerId: string,
    defenders: readonly { zone: number; id: string; position?: "attack" | "defense" }[],
    targetZoneIndex: number,
  ) => {
    const state = match();
    state.turnNumber = 3;
    state.phase = "battle";
    const actor = state.activePlayer;
    const responder: ChronicleSideKey = actor === "p1" ? "p2" : "p1";
    placeMonster(state, actor, 0, attackerId);
    for (const defender of defenders)
      placeMonster(state, responder, defender.zone, defender.id, {
        position: defender.position,
      });
    state[responder].magicTrapZones[0] = {
      instanceId: `${trapId}-set`,
      cardId: trapId,
      owner: responder,
      zoneIndex: 0,
      faceUp: false,
      setOnTurn: 1,
    };
    const declared = declareAttack(state, actor, {
      action: "attack",
      attackerZoneIndex: 0,
      targetZoneIndex,
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) throw new Error("Trap response did not open");
    const activated = activateTrap(declared.state, responder, 0);
    assert.equal(activated.ok, true);
    if (!activated.ok) throw new Error("Trap did not resolve");
    return { state: activated.state, actor, responder };
  };

  const armored = trapBattle(
    "chronicle-stone-clone-barrier",
    "tc-21",
    [{ zone: 0, id: "tc-23", position: "defense" }],
    0,
  );
  const attackerCard = getChronicleCard("tc-21");
  assert.equal(attackerCard?.cardClass, "monster");
  assert.equal(
    armored.state[armored.responder].monsterZones[0]?.temporaryDefense,
    attackerCard?.cardClass === "monster"
      ? Math.floor(attackerCard.attack / 2)
      : 0,
  );

  const redirected = trapBattle(
    "chronicle-moonshadow-slip",
    "tc-150",
    [
      { zone: 0, id: "tc-13", position: "defense" },
      { zone: 1, id: "tc-34", position: "defense" },
      { zone: 2, id: "tc-10", position: "defense" },
    ],
    0,
  );
  assert.ok(redirected.state[redirected.responder].monsterZones[0]);
  assert.equal(redirected.state[redirected.responder].monsterZones[1], null);

  const feinted = trapBattle(
    "chronicle-ironwood-bulwark",
    "tc-01",
    [{ zone: 0, id: "tc-24", position: "attack" }],
    0,
  );
  assert.equal(
    feinted.state[feinted.responder].monsterZones[0]?.position,
    "defense",
  );
  assert.equal(
    feinted.state[feinted.actor].monsterZones[0]?.temporaryAttack,
    -300,
  );

  let state = match();
  let actor = state.activePlayer;
  let responder: ChronicleSideKey = actor === "p1" ? "p2" : "p1";
  state.turnNumber = 3;
  state[responder].magicTrapZones[0] = {
    instanceId: "target-counter",
    cardId: "chronicle-counter-script-cache",
    owner: responder,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  state[actor].hand[0] = "chronicle-medical-salve";
  const untargeted = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(untargeted.ok, true);
  if (!untargeted.ok) return;
  assert.equal(untargeted.state.responseWindow, null);

  state = match();
  actor = state.activePlayer;
  responder = actor === "p1" ? "p2" : "p1";
  state.turnNumber = 3;
  placeMonster(state, actor, 0, "tc-01");
  state[actor].hand[0] = "chronicle-soldier-pill";
  state[responder].hand = ["tc-02"];
  state[responder].magicTrapZones[0] = {
    instanceId: "target-counter",
    cardId: "chronicle-counter-script-cache",
    owner: responder,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  const targeted = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
    targetSide: actor,
    targetZoneIndex: 0,
  });
  assert.equal(targeted.ok, true);
  if (!targeted.ok) return;
  assert.deepEqual(targeted.state.responseWindow?.eligibleZoneIndexes, [0]);
  const countered = activateTrap(targeted.state, responder, 0);
  assert.equal(countered.ok, true);
  if (!countered.ok) return;
  assert.equal(countered.state[responder].hand.length, 0);
  assert.ok(countered.state[actor].graveyard.includes("chronicle-soldier-pill"));
});

test("Smoke Bomb is hidden, cannot activate on its set turn, then negates one attack", () => {
  let state = match();
  const attackerSide = state.activePlayer;
  const defenderSide = attackerSide === "p1" ? "p2" : "p1";
  state.turnNumber = 2;
  state.phase = "main1";
  state[defenderSide].hand[0] = "chronicle-smoke-bomb";
  state.activePlayer = defenderSide;
  const set = setTrap(state, defenderSide, 0, 0);
  assert.equal(set.ok, true);
  if (!set.ok) return;
  assert.equal(set.state[defenderSide].magicTrapZones[0]?.faceUp, false);
  state = set.state;
  state.turnNumber = 3;
  state.activePlayer = attackerSide;
  state.phase = "battle";
  state[attackerSide].monsterZones[0] = {
    instanceId: "a",
    cardId: "tc-21",
    owner: attackerSide,
    zoneIndex: 0,
    position: "attack",
    faceUp: true,
    summonedOnTurn: 2,
    lastPositionChangeTurn: 2,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
  const declared = declareAttack(
    state,
    attackerSide,
    { action: "attack", attackerZoneIndex: 0, targetZoneIndex: null },
    5_000,
  );
  assert.equal(declared.ok, true);
  if (!declared.ok) return;
  assert.ok(declared.state.responseWindow);
  const projected = projectMatchForViewer(declared.state, attackerSide);
  assert.equal(projected[defenderSide].magicTrapZones[0]?.cardId, undefined);
  assert.equal(projected.responseWindow?.eligibleZoneIndexes, undefined);
  const activated = activateTrap(declared.state, defenderSide, 0);
  assert.equal(activated.ok, true);
  if (activated.ok) {
    assert.equal(
      activated.state[defenderSide].lifePoints,
      STARTING_LIFE_POINTS,
    );
    assert.equal(activated.state.responseWindow, null);
    assert.equal(
      activated.state[defenderSide].graveyard.includes("chronicle-smoke-bomb"),
      true,
    );
  }
});

test("period battle Traps reinforce DEF, weaken attackers, draw, and change position", () => {
  const setup = (
    trapId: string,
    targetZoneIndex: number | null,
    defenderCardId = "tc-23",
  ) => {
    const state = match();
    state.turnNumber = 3;
    state.phase = "battle";
    const attacker = state.activePlayer;
    const responder: ChronicleSideKey = attacker === "p1" ? "p2" : "p1";
    placeMonster(state, attacker, 0, "tc-21", { instanceId: `${trapId}-a` });
    if (targetZoneIndex !== null)
      placeMonster(state, responder, targetZoneIndex, defenderCardId, {
        position: "defense",
        instanceId: `${trapId}-d`,
      });
    state[responder].magicTrapZones[0] = {
      instanceId: `${trapId}-trap`,
      cardId: trapId,
      owner: responder,
      zoneIndex: 0,
      faceUp: false,
      setOnTurn: 1,
    };
    const declared = declareAttack(state, attacker, {
      action: "attack",
      attackerZoneIndex: 0,
      targetZoneIndex,
    });
    assert.equal(declared.ok, true);
    assert.ok(declared.ok && declared.state.responseWindow);
    if (!declared.ok) throw new Error("attack response did not open");
    const activated = activateTrap(declared.state, responder, 0);
    assert.equal(activated.ok, true);
    if (!activated.ok) throw new Error("battle Trap did not resolve");
    return { state: activated.state, attacker, responder };
  };

  const defended = setup("chronicle-tidal-deflection", 0);
  assert.ok(defended.state[defended.attacker].monsterZones[0]);
  assert.ok(defended.state[defended.responder].monsterZones[0]);
  assert.equal(
    defended.state[defended.attacker].lifePoints,
    STARTING_LIFE_POINTS - 400,
  );

  const weakened = setup("chronicle-wall-of-smoke", null);
  assert.equal(
    weakened.state[weakened.responder].lifePoints,
    STARTING_LIFE_POINTS - 1_000,
  );
  assert.equal(
    weakened.state[weakened.attacker].monsterZones[0]?.temporaryAttack,
    -500,
  );

  const watchedState = match();
  watchedState.turnNumber = 3;
  watchedState.phase = "battle";
  const watchedAttacker = watchedState.activePlayer;
  const watcher: ChronicleSideKey = watchedAttacker === "p1" ? "p2" : "p1";
  placeMonster(watchedState, watchedAttacker, 0, "tc-21");
  watchedState[watcher].magicTrapZones[0] = {
    instanceId: "long-watch",
    cardId: "chronicle-long-watch",
    owner: watcher,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  watchedState[watcher].hand = ["tc-24"];
  const watchWindow = declareAttack(watchedState, watchedAttacker, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: null,
  });
  assert.equal(watchWindow.ok, true);
  if (!watchWindow.ok) return;
  const watched = activateTrap(watchWindow.state, watcher, 0);
  assert.equal(watched.ok, true);
  if (!watched.ok) return;
  assert.equal(watched.state[watcher].hand.length, 0);
  assert.equal(watched.state[watcher].monsterZones[0]?.cardId, "tc-24");
  assert.equal(watched.state[watcher].monsterZones[0]?.position, "defense");
  assert.equal(watched.state[watcher].lifePoints, STARTING_LIFE_POINTS);

  const warded = setup("chronicle-palm-ward", null);
  assert.equal(
    warded.state[warded.attacker].monsterZones[0]?.position,
    "defense",
  );
  assert.equal(warded.state[warded.responder].lifePoints, STARTING_LIFE_POINTS);
});

test("supplied Trap guidelines add reinforcement, delayed retribution, formation control, and summon sealing", () => {
  let state = match();
  state.turnNumber = 3;
  state.phase = "battle";
  let attacker = state.activePlayer;
  let defender: ChronicleSideKey = attacker === "p1" ? "p2" : "p1";
  placeMonster(state, attacker, 0, "tc-21", { instanceId: "toll-attacker" });
  placeMonster(state, defender, 0, "tc-01", {
    position: "defense",
    instanceId: "toll-target",
  });
  state[defender].magicTrapZones[0] = {
    instanceId: "reapers-toll",
    cardId: "chronicle-reapers-toll",
    owner: defender,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  const tollWindow = declareAttack(state, attacker, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(tollWindow.ok, true);
  if (!tollWindow.ok) return;
  const toll = activateTrap(tollWindow.state, defender, 0);
  assert.equal(toll.ok, true);
  if (!toll.ok) return;
  assert.equal(toll.state[attacker].monsterZones[0], null);
  assert.equal(toll.state[defender].monsterZones[0], null);
  assert.ok(toll.state[attacker].graveyard.includes("tc-21"));
  assert.ok(toll.state[defender].graveyard.includes("tc-01"));

  state = match();
  state.turnNumber = 3;
  state.phase = "battle";
  attacker = state.activePlayer;
  defender = attacker === "p1" ? "p2" : "p1";
  placeMonster(state, attacker, 0, "tc-21", {
    instanceId: "first-attacker",
  });
  placeMonster(state, attacker, 1, "tc-22", {
    instanceId: "second-attacker",
  });
  state[attacker].monsterZones[0]!.lastAttackTurn = state.turnNumber;
  placeMonster(state, defender, 0, "tc-05", {
    position: "defense",
    instanceId: "water-formation",
  });
  placeMonster(state, defender, 1, "tc-23", {
    position: "defense",
    instanceId: "formation-ally",
  });
  state[defender].magicTrapZones[0] = {
    instanceId: "floodgate-mist",
    cardId: "chronicle-floodgate-mist",
    owner: defender,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  const floodWindow = declareAttack(state, attacker, {
    action: "attack",
    attackerZoneIndex: 1,
    targetZoneIndex: 0,
  });
  assert.equal(floodWindow.ok, true);
  if (!floodWindow.ok) return;
  assert.deepEqual(floodWindow.state.responseWindow?.eligibleZoneIndexes, [0]);
  const flood = activateTrap(floodWindow.state, defender, 0);
  assert.equal(flood.ok, true);
  if (!flood.ok) return;
  assert.equal(flood.state.phase, "main2");
  assert.ok(flood.state[attacker].monsterZones[1]);
  assert.ok(flood.state[defender].monsterZones[0]);

  state = match();
  state.turnNumber = 3;
  state.phase = "battle";
  attacker = state.activePlayer;
  defender = attacker === "p1" ? "p2" : "p1";
  placeMonster(state, attacker, 0, "tc-21", {
    instanceId: "coffin-attacker",
  });
  placeMonster(state, attacker, 1, "tc-02", {
    instanceId: "coffin-lowest",
  });
  placeMonster(state, defender, 0, "tc-03", {
    position: "defense",
    instanceId: "earth-anchor",
  });
  state[defender].magicTrapZones[0] = {
    instanceId: "sand-coffin",
    cardId: "chronicle-sand-coffin-counter",
    owner: defender,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  const coffinWindow = declareAttack(state, attacker, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(coffinWindow.ok, true);
  if (!coffinWindow.ok) return;
  const coffin = activateTrap(coffinWindow.state, defender, 0);
  assert.equal(coffin.ok, true);
  if (!coffin.ok) return;
  assert.equal(coffin.state[attacker].monsterZones[1], null);
  assert.ok(coffin.state[attacker].graveyard.includes("tc-02"));

  const summonTrap = (
    trapId: string,
    anchorId: string,
  ): ChronicleMatch => {
    const summonState = summonReady("tc-01");
    const summoner = summonState.activePlayer;
    const responder: ChronicleSideKey = summoner === "p1" ? "p2" : "p1";
    summonState.turnNumber = 3;
    placeMonster(summonState, responder, 4, anchorId, {
      position: "defense",
      instanceId: `${trapId}-anchor`,
    });
    summonState[responder].magicTrapZones[0] = {
      instanceId: `${trapId}-set`,
      cardId: trapId,
      owner: responder,
      zoneIndex: 0,
      faceUp: false,
      setOnTurn: 1,
    };
    const summonWindow = normalSummon(summonState, summoner, {
      action: "normal-summon",
      handIndex: 0,
      zoneIndex: 0,
    });
    assert.equal(summonWindow.ok, true);
    if (!summonWindow.ok) throw new Error(`${trapId} response did not open`);
    const resolved = activateTrap(summonWindow.state, responder, 0);
    assert.equal(resolved.ok, true);
    if (!resolved.ok) throw new Error(`${trapId} did not resolve`);
    return resolved.state;
  };
  const weakened = summonTrap("chronicle-earthen-grave-array", "tc-03");
  assert.equal(weakened[weakened.activePlayer].monsterZones[0]?.temporaryAttack, -800);
  assert.equal(
    weakened[weakened.activePlayer].monsterZones[0]?.positionLockedUntilTurn,
    3,
  );

  const sealed = summonTrap("chronicle-flash-burial-tag", "tc-04");
  const sealedMonster = sealed[sealed.activePlayer].monsterZones[0];
  assert.equal(sealedMonster?.faceUp, false);
  assert.equal(sealedMonster?.position, "defense");
  assert.equal(sealedMonster?.positionLockedUntilTurn, 5);
  const projected = projectMatchForViewer(sealed, sealed.activePlayer);
  assert.equal(projected[sealed.activePlayer].monsterZones[0]?.canFlipSummon, false);
});

test("elemental Traps require a matching face-up Monster before their response opens", () => {
  const build = (withFireMonster: boolean) => {
    const state = match();
    state.turnNumber = 3;
    state.phase = "battle";
    const attacker = state.activePlayer;
    const defender: ChronicleSideKey = attacker === "p1" ? "p2" : "p1";
    placeMonster(state, attacker, 0, "tc-22", {
      instanceId: `element-attacker-${withFireMonster}`,
    });
    state[defender].magicTrapZones[0] = {
      instanceId: `ashen-veil-${withFireMonster}`,
      cardId: "chronicle-ashen-veil",
      owner: defender,
      zoneIndex: 0,
      faceUp: false,
      setOnTurn: 1,
    };
    if (withFireMonster)
      placeMonster(state, defender, 0, "tc-08", {
        position: "defense",
        instanceId: "fire-specialist",
      });
    return { state, attacker, targetZoneIndex: withFireMonster ? 0 : null };
  };

  const unsupported = build(false);
  const noWindow = declareAttack(unsupported.state, unsupported.attacker, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: unsupported.targetZoneIndex,
  });
  assert.equal(noWindow.ok, true);
  if (noWindow.ok) assert.equal(noWindow.state.responseWindow, null);

  const supported = build(true);
  const window = declareAttack(supported.state, supported.attacker, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: supported.targetZoneIndex,
  });
  assert.equal(window.ok, true);
  if (window.ok) {
    assert.equal(window.state.responseWindow?.trigger, "onAttackDeclared");
    assert.deepEqual(window.state.responseWindow?.eligibleZoneIndexes, [0]);
  }
});

test("summon Traps ignore Sets and enforce their pending Monster Level cap", () => {
  const build = (cardId: string, tributes: number) => {
    const state = summonReady(cardId, tributes);
    const actor = state.activePlayer;
    const defender = actor === "p1" ? "p2" : "p1";
    state.turnNumber = 3;
    state[defender].magicTrapZones[0] = {
      instanceId: "seal",
      cardId: "chronicle-sealing-circle",
      owner: defender,
      zoneIndex: 0,
      faceUp: false,
      setOnTurn: 1,
    };
    return { state, actor };
  };
  const lowSet = build("tc-01", 0);
  const set = normalSet(lowSet.state, lowSet.actor, {
    action: "set-monster",
    handIndex: 0,
    zoneIndex: 0,
  });
  assert.equal(set.ok, true);
  if (set.ok) assert.equal(set.state.responseWindow, null);

  const high = build("tc-150", 2);
  const summoned = normalSummon(high.state, high.actor, {
    action: "normal-summon",
    handIndex: 0,
    zoneIndex: 2,
    tributeZoneIndexes: [0, 1],
  });
  assert.equal(summoned.ok, true);
  if (summoned.ok) assert.equal(summoned.state.responseWindow, null);

  const low = build("tc-01", 0);
  const answered = normalSummon(low.state, low.actor, {
    action: "normal-summon",
    handIndex: 0,
    zoneIndex: 0,
  });
  assert.equal(answered.ok, true);
  if (answered.ok)
    assert.equal(answered.state.responseWindow?.trigger, "onMonsterSummoned");
});

test("Normal Magic resolves to Graveyard and Equip remains attached", () => {
  let state = summonReady("tc-01");
  const actor = state.activePlayer;
  const summoned = normalSummon(state, actor, {
    action: "normal-summon",
    handIndex: 0,
    zoneIndex: 0,
  });
  assert.equal(summoned.ok, true);
  if (!summoned.ok) return;
  state = summoned.state;
  state[actor].hand[0] = "chronicle-medical-salve";
  state[actor].lifePoints = 7_900;
  const healed = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(healed.ok, true);
  if (!healed.ok) return;
  assert.equal(healed.state[actor].lifePoints, 8_700);
  assert.equal(healed.state[actor].graveyard.at(-1), "chronicle-medical-salve");
  healed.state[actor].hand[0] = "chronicle-tempered-kunai";
  const equipped = activateMagic(healed.state, actor, {
    action: "activate-magic",
    handIndex: 0,
    targetZoneIndex: 0,
    targetSide: actor,
  });
  assert.equal(equipped.ok, true);
  if (equipped.ok) {
    assert.ok(equipped.state[actor].monsterZones[0]?.attachedEquipId);
    assert.equal(
      equipped.state[actor].magicTrapZones.some(
        (zone) => zone?.cardId === "chronicle-tempered-kunai",
      ),
      true,
    );
  }
});

test("diversified Magic draws with a cost and recovers different graveyard cards", () => {
  let state = match();
  let actor = state.activePlayer;
  state[actor].hand[0] = "chronicle-crimson-insight";
  const handBefore = state[actor].hand.length;
  const deckBefore = state[actor].deck.length;
  const graveBefore = state[actor].graveyard.length;
  const insight = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(insight.ok, true);
  if (!insight.ok) return;
  assert.equal(insight.state[actor].hand.length, handBefore);
  assert.equal(insight.state[actor].deck.length, deckBefore - 2);
  assert.equal(insight.state[actor].graveyard.length, graveBefore + 2);

  state = match();
  actor = state.activePlayer;
  state[actor].graveyard.push("chronicle-medical-salve");
  const salveIndex = state[actor].graveyard.length - 1;
  state[actor].hand[0] = "chronicle-chakra-ledger";
  const ledger = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
    graveyardIndex: salveIndex,
  });
  assert.equal(ledger.ok, true);
  if (!ledger.ok) return;
  assert.ok(ledger.state[actor].hand.includes("chronicle-medical-salve"));
  assert.ok(ledger.state[actor].graveyard.includes("chronicle-chakra-ledger"));

  state = match();
  actor = state.activePlayer;
  state[actor].graveyard.push("tc-08");
  const effectMonsterIndex = state[actor].graveyard.length - 1;
  state[actor].hand[0] = "chronicle-ancestral-muster";
  const muster = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
    graveyardIndex: effectMonsterIndex,
  });
  assert.equal(muster.ok, true);
  if (!muster.ok) return;
  assert.equal(muster.state[actor].monsterZones[0]?.cardId, "tc-08");
  assert.equal(muster.state[actor].monsterZones[0]?.position, "defense");

  state = match();
  actor = state.activePlayer;
  for (let zoneIndex = 0; zoneIndex < 5; zoneIndex += 1)
    placeMonster(state, actor, zoneIndex, "tc-01", {
      instanceId: `full-zone-${zoneIndex}`,
    });
  state[actor].graveyard.push("tc-23");
  const monsterIndex = state[actor].graveyard.length - 1;
  state[actor].hand[0] = "chronicle-second-wind-recall";
  const recovered = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
    graveyardIndex: monsterIndex,
  });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) return;
  assert.ok(recovered.state[actor].hand.includes("tc-23"));
});

test("advanced Magic supports position control, back-row removal, and Monster removal", () => {
  let state = match();
  const actor = state.activePlayer;
  const defender = actor === "p1" ? "p2" : "p1";
  state.turnNumber = 3;
  state[defender].monsterZones[0] = {
    instanceId: "target-monster",
    cardId: "tc-21",
    owner: defender,
    zoneIndex: 0,
    position: "attack",
    faceUp: true,
    summonedOnTurn: 1,
    lastPositionChangeTurn: 1,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
  state[defender].magicTrapZones[0] = {
    instanceId: "target-trap",
    cardId: "chronicle-smoke-bomb",
    owner: defender,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };

  state[actor].hand[0] = "chronicle-moonfold-genjutsu";
  const shifted = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
    targetSide: defender,
    targetZoneIndex: 0,
  });
  assert.equal(shifted.ok, true);
  if (!shifted.ok) return;
  assert.equal(shifted.state[defender].monsterZones[0]?.position, "defense");

  state = shifted.state;
  state[actor].hand[0] = "chronicle-sealbreak-verdict";
  const sealbroken = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
    targetSide: defender,
    targetZoneIndex: 0,
  });
  assert.equal(sealbroken.ok, true);
  if (!sealbroken.ok) return;
  assert.equal(sealbroken.state[defender].magicTrapZones[0], null);
  assert.ok(
    sealbroken.state[defender].graveyard.includes("chronicle-smoke-bomb"),
  );

  state = sealbroken.state;
  state[actor].hand[0] = "chronicle-giant-felling-edict";
  const felled = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
    targetSide: defender,
    targetZoneIndex: 0,
  });
  assert.equal(felled.ok, true);
  if (!felled.ok) return;
  assert.equal(felled.state[defender].monsterZones[0], null);
  assert.ok(felled.state[defender].graveyard.includes("tc-21"));
});

test("period staple Magic sweeps resolve one-sided and symmetrical board clears", () => {
  let state = match();
  let actor = state.activePlayer;
  let opponent: ChronicleSideKey = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-01", { instanceId: "own-survivor" });
  placeMonster(state, opponent, 0, "tc-21", { instanceId: "enemy-one" });
  placeMonster(state, opponent, 1, "tc-150", { instanceId: "enemy-two" });
  state[actor].hand[0] = "chronicle-giant-felling-edict";
  const oneSidedMonsters = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(oneSidedMonsters.ok, true);
  if (!oneSidedMonsters.ok) return;
  assert.ok(oneSidedMonsters.state[actor].monsterZones[0]);
  assert.equal(
    oneSidedMonsters.state[opponent].monsterZones.every((zone) => !zone),
    true,
  );

  state = match();
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  placeMonster(state, actor, 0, "tc-01");
  placeMonster(state, opponent, 0, "tc-21");
  state[actor].hand[0] = "chronicle-executioners-mandate";
  const allMonsters = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(allMonsters.ok, true);
  if (!allMonsters.ok) return;
  assert.equal(
    allMonsters.state.p1.monsterZones.every((zone) => !zone),
    true,
  );
  assert.equal(
    allMonsters.state.p2.monsterZones.every((zone) => !zone),
    true,
  );

  state = match();
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  state[actor].magicTrapZones[0] = {
    instanceId: "own-backrow",
    cardId: "chronicle-smoke-bomb",
    owner: actor,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  state[opponent].magicTrapZones[0] = {
    instanceId: "enemy-backrow-a",
    cardId: "chronicle-smoke-bomb",
    owner: opponent,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  state[opponent].magicTrapZones[1] = {
    instanceId: "enemy-backrow-b",
    cardId: "chronicle-substitution-log",
    owner: opponent,
    zoneIndex: 1,
    faceUp: false,
    setOnTurn: 1,
  };
  state.activeField = {
    cardId: "chronicle-field-ocean",
    fieldId: "ocean",
    owner: opponent,
  };
  state[actor].hand[0] = "chronicle-hundredfold-tempest";
  const oneSidedBackrow = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(oneSidedBackrow.ok, true);
  if (!oneSidedBackrow.ok) return;
  assert.ok(oneSidedBackrow.state[actor].magicTrapZones[0]);
  assert.equal(
    oneSidedBackrow.state[opponent].magicTrapZones.every((zone) => !zone),
    true,
  );
  assert.equal(oneSidedBackrow.state.activeField, null);

  state = match();
  actor = state.activePlayer;
  opponent = actor === "p1" ? "p2" : "p1";
  for (const [sideKey, cardId] of [
    [actor, "chronicle-smoke-bomb"],
    [opponent, "chronicle-substitution-log"],
  ] as const)
    state[sideKey].magicTrapZones[0] = {
      instanceId: `${sideKey}-backrow`,
      cardId,
      owner: sideKey,
      zoneIndex: 0,
      faceUp: false,
      setOnTurn: 1,
    };
  state.activeField = {
    cardId: "chronicle-field-volcano",
    fieldId: "volcano",
    owner: actor,
  };
  state[actor].hand[0] = "chronicle-storm-shear";
  const allBackrow = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(allBackrow.ok, true);
  if (!allBackrow.ok) return;
  assert.equal(
    allBackrow.state.p1.magicTrapZones.every((zone) => !zone),
    true,
  );
  assert.equal(
    allBackrow.state.p2.magicTrapZones.every((zone) => !zone),
    true,
  );
  assert.equal(allBackrow.state.activeField, null);
});

test("a set counter Trap negates an activated Magic Card before its effect resolves", () => {
  const state = match();
  const actor = state.activePlayer;
  const defender = actor === "p1" ? "p2" : "p1";
  state.turnNumber = 3;
  state[actor].hand[0] = "chronicle-recon-scroll";
  state[defender].magicTrapZones[0] = {
    instanceId: "counter-trap",
    cardId: "chronicle-kage-judgment-seal",
    owner: defender,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  const deckSize = state[actor].deck.length;
  const activated = activateMagic(state, actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(activated.ok, true);
  if (!activated.ok) return;
  assert.equal(activated.state.responseWindow?.trigger, "onMagicActivated");

  const countered = activateTrap(activated.state, defender, 0);
  assert.equal(countered.ok, true);
  if (!countered.ok) return;
  assert.equal(countered.state.responseWindow, null);
  assert.equal(countered.state[actor].deck.length, deckSize);
  assert.ok(
    countered.state[actor].graveyard.includes("chronicle-recon-scroll"),
  );
  assert.ok(
    countered.state[defender].graveyard.includes(
      "chronicle-kage-judgment-seal",
    ),
  );
  assert.equal(
    countered.state[defender].lifePoints,
    STARTING_LIFE_POINTS - 1_500,
  );
});

test("specialized counter Traps answer only their printed Magic subtype", () => {
  const build = (magicId: string) => {
    const state = match();
    const actor = state.activePlayer;
    const defender: ChronicleSideKey = actor === "p1" ? "p2" : "p1";
    state.turnNumber = 3;
    state[actor].hand[0] = magicId;
    state[defender].magicTrapZones[0] = {
      instanceId: `field-counter-${magicId}`,
      cardId: "chronicle-sovereigns-decree",
      owner: defender,
      zoneIndex: 0,
      faceUp: false,
      setOnTurn: 1,
    };
    return { state, actor, defender };
  };

  const normal = build("chronicle-recon-scroll");
  const normalResolved = activateMagic(normal.state, normal.actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(normalResolved.ok, true);
  if (!normalResolved.ok) return;
  assert.equal(normalResolved.state.responseWindow, null);
  assert.ok(
    normalResolved.state[normal.actor].graveyard.includes(
      "chronicle-recon-scroll",
    ),
  );
  assert.ok(normalResolved.state[normal.defender].magicTrapZones[0]);

  const field = build("chronicle-field-volcano");
  const fieldWindow = activateMagic(field.state, field.actor, {
    action: "activate-magic",
    handIndex: 0,
  });
  assert.equal(fieldWindow.ok, true);
  if (!fieldWindow.ok) return;
  assert.deepEqual(fieldWindow.state.responseWindow?.eligibleZoneIndexes, [0]);
  const fieldCountered = activateTrap(fieldWindow.state, field.defender, 0);
  assert.equal(fieldCountered.ok, true);
  if (!fieldCountered.ok) return;
  assert.equal(fieldCountered.state.activeField, null);
  assert.ok(
    fieldCountered.state[field.actor].graveyard.includes(
      "chronicle-field-volcano",
    ),
  );
});

test("summon and attack Traps resolve their destroy and return responses", () => {
  let state = summonReady("tc-01");
  const actor = state.activePlayer;
  const defender = actor === "p1" ? "p2" : "p1";
  state.turnNumber = 3;
  state[defender].magicTrapZones[0] = {
    instanceId: "pitfall",
    cardId: "chronicle-pitfall-tag-array",
    owner: defender,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  const summoned = normalSummon(state, actor, {
    action: "normal-summon",
    handIndex: 0,
    zoneIndex: 0,
  });
  assert.equal(summoned.ok, true);
  if (!summoned.ok) return;
  const trapped = activateTrap(summoned.state, defender, 0);
  assert.equal(trapped.ok, true);
  if (!trapped.ok) return;
  assert.equal(trapped.state[actor].monsterZones[0], null);
  assert.ok(trapped.state[actor].graveyard.includes("tc-01"));
  assert.equal(trapped.state.normalSummonUsed, true);

  state = match();
  state.turnNumber = 3;
  state.phase = "battle";
  state[state.activePlayer].monsterZones[0] = {
    instanceId: "attacker",
    cardId: "tc-21",
    owner: state.activePlayer,
    zoneIndex: 0,
    position: "attack",
    faceUp: true,
    summonedOnTurn: 2,
    lastPositionChangeTurn: 2,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
  const attacker = state.activePlayer;
  const responder = attacker === "p1" ? "p2" : "p1";
  state[responder].magicTrapZones[0] = {
    instanceId: "returning-seal",
    cardId: "chronicle-returning-cylinder-seal",
    owner: responder,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  const declared = declareAttack(state, attacker, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: null,
  });
  assert.equal(declared.ok, true);
  if (!declared.ok) return;
  const reflected = activateTrap(declared.state, responder, 0);
  assert.equal(reflected.ok, true);
  if (!reflected.ok) return;
  const attackerCard = getChronicleCard("tc-21");
  assert.ok(reflected.state[attacker].monsterZones[0]);
  assert.equal(
    reflected.state[attacker].lifePoints,
    STARTING_LIFE_POINTS -
      (attackerCard?.cardClass === "monster" ? attackerCard.attack : 0),
  );
  assert.equal(reflected.state[responder].lifePoints, STARTING_LIFE_POINTS);
});

test("period staple Traps resolve formation wipe, summon wipe, reflection, and shared burn", () => {
  let state = match();
  state.turnNumber = 3;
  state.phase = "battle";
  let attacker = state.activePlayer;
  let responder: ChronicleSideKey = attacker === "p1" ? "p2" : "p1";
  placeMonster(state, attacker, 0, "tc-21", { instanceId: "attack-a" });
  placeMonster(state, attacker, 1, "tc-22", { instanceId: "attack-b" });
  placeMonster(state, attacker, 2, "tc-03", {
    position: "defense",
    instanceId: "defense-survivor",
  });
  state[responder].magicTrapZones[0] = {
    instanceId: "mirror-shell",
    cardId: "chronicle-mirror-shell-counter",
    owner: responder,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  const mirrorWindow = declareAttack(state, attacker, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: null,
  });
  assert.equal(mirrorWindow.ok, true);
  if (!mirrorWindow.ok) return;
  const mirrored = activateTrap(mirrorWindow.state, responder, 0);
  assert.equal(mirrored.ok, true);
  if (!mirrored.ok) return;
  assert.equal(mirrored.state[attacker].monsterZones[0], null);
  assert.equal(mirrored.state[attacker].monsterZones[1], null);
  assert.ok(mirrored.state[attacker].monsterZones[2]);

  state = summonReady("tc-01");
  attacker = state.activePlayer;
  responder = attacker === "p1" ? "p2" : "p1";
  state.turnNumber = 3;
  placeMonster(state, attacker, 1, "tc-03", { instanceId: "old-ally" });
  placeMonster(state, responder, 0, "tc-02", { instanceId: "old-enemy" });
  state[responder].magicTrapZones[0] = {
    instanceId: "torrential-field",
    cardId: "chronicle-torrential-tag-field",
    owner: responder,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  const summonWindow = normalSummon(state, attacker, {
    action: "normal-summon",
    handIndex: 0,
    zoneIndex: 0,
  });
  assert.equal(summonWindow.ok, true);
  if (!summonWindow.ok) return;
  const torrential = activateTrap(summonWindow.state, responder, 0);
  assert.equal(torrential.ok, true);
  if (!torrential.ok) return;
  assert.equal(
    torrential.state.p1.monsterZones.every((zone) => !zone),
    true,
  );
  assert.equal(
    torrential.state.p2.monsterZones.every((zone) => !zone),
    true,
  );

  state = match();
  state.turnNumber = 3;
  state.phase = "battle";
  attacker = state.activePlayer;
  responder = attacker === "p1" ? "p2" : "p1";
  placeMonster(state, attacker, 0, "tc-21", { instanceId: "ring-attacker" });
  placeMonster(state, responder, 0, "tc-08", {
    position: "defense",
    instanceId: "fire-anchor",
  });
  state[responder].magicTrapZones[0] = {
    instanceId: "ringed-detonation",
    cardId: "chronicle-ringed-detonation",
    owner: responder,
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 1,
  };
  const attackerCard = getChronicleCard("tc-21");
  const ringDamage =
    attackerCard?.cardClass === "monster" ? attackerCard.attack : 0;
  const ringWindow = declareAttack(state, attacker, {
    action: "attack",
    attackerZoneIndex: 0,
    targetZoneIndex: 0,
  });
  assert.equal(ringWindow.ok, true);
  if (!ringWindow.ok) return;
  const ringed = activateTrap(ringWindow.state, responder, 0);
  assert.equal(ringed.ok, true);
  if (!ringed.ok) return;
  assert.equal(ringed.state[attacker].monsterZones[0], null);
  assert.ok(ringed.state[responder].monsterZones[0]);
  assert.equal(
    ringed.state[attacker].lifePoints,
    STARTING_LIFE_POINTS - ringDamage,
  );
  assert.equal(
    ringed.state[responder].lifePoints,
    STARTING_LIFE_POINTS - ringDamage,
  );
});

test("projection never leaks opponent hand, set Trap, or face-down Monster identity", () => {
  const state = match();
  state.p2.magicTrapZones[0] = {
    instanceId: "t",
    cardId: "chronicle-smoke-bomb",
    owner: "p2",
    zoneIndex: 0,
    faceUp: false,
    setOnTurn: 0,
  };
  state.p2.monsterZones[0] = {
    instanceId: "m",
    cardId: "tc-150",
    owner: "p2",
    zoneIndex: 0,
    position: "defense",
    faceUp: false,
    summonedOnTurn: 0,
    lastPositionChangeTurn: 0,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
  const view = projectMatchForViewer(state, "p1");
  assert.equal(view.p2.hand, undefined);
  assert.equal(view.p2.magicTrapZones[0]?.cardId, undefined);
  assert.equal(view.p2.monsterZones[0]?.cardId, undefined);
  assert.equal(view.p2.monsterZones[0]?.attack, undefined);
  assert.equal(view.p2.monsterZones[0]?.level, undefined);
});

test("legacy deck migration is immutable, trims copies, grants starter core, and can fall back", () => {
  const old = ["tc-01", "tc-01", "tc-01", "tc-01", "unknown"];
  const snapshot = old.slice();
  const migrated = migrateLegacyDeck(old, ["tc-01", "tc-02"], true);
  assert.deepEqual(old, snapshot);
  assert.equal(migrated.deck.length, MAIN_DECK_SIZE);
  assert.equal(validateDeckIds(migrated.deck).valid, true);
  assert.ok(migrated.starterGrants.includes("chronicle-smoke-bomb"));
  const limitedMigration = migrateLegacyDeck(
    ["chronicle-stacked-scrolls", "chronicle-stacked-scrolls"],
    ["chronicle-stacked-scrolls"],
    false,
  );
  assert.equal(
    limitedMigration.deck.filter((id) => id === "chronicle-stacked-scrolls")
      .length,
    1,
  );
});
