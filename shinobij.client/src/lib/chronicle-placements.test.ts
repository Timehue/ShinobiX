import assert from "node:assert/strict";
import test from "node:test";
import {
  CHRONICLE_CARD_CATALOG,
  CHRONICLE_FIXED_FALLBACK_DECK,
  createMatch,
  projectMatchForViewer,
  type ChronicleDisplayCard,
} from "./chronicle-duel";
import { normalSummon, setTrap } from "../../../shared/chronicle-duel";
import { chronicleLegalPlacements } from "./chronicle-placements";

test("picking a card in hand lights exactly the zones the server accepts", () => {
  const cardsById = Object.fromEntries(
    CHRONICLE_CARD_CATALOG.map((card) => [card.id, card]),
  ) as Record<string, ChronicleDisplayCard>;
  const lowMonster = CHRONICLE_CARD_CATALOG.find(
    (card) => card.cardClass === "monster" && card.level <= 4,
  )!;
  const bigMonster = CHRONICLE_CARD_CATALOG.find(
    (card) => card.cardClass === "monster" && card.level >= 5 && card.level <= 6,
  )!;
  const trap = CHRONICLE_CARD_CATALOG.find(
    (card) => card.cardClass === "trap",
  )!;
  const occupant = (zoneIndex: number) => ({
    instanceId: `mine-${zoneIndex}`,
    cardId: lowMonster.id,
    owner: "p1" as const,
    zoneIndex,
    position: "attack" as const,
    faceUp: true,
    summonedOnTurn: 1,
    lastPositionChangeTurn: 0,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  });
  const build = (handCardId: string) => {
    const state = createMatch(
      "Akari",
      CHRONICLE_FIXED_FALLBACK_DECK,
      "Ren",
      CHRONICLE_FIXED_FALLBACK_DECK,
      () => 0,
      1_000,
    );
    state.phase = "main1";
    state.activePlayer = "p1";
    state.p1.hand = [handCardId];
    // Zones 1 and 3 are taken; 0, 2 and 4 stay open.
    state.p1.monsterZones[1] = occupant(1);
    state.p1.monsterZones[3] = occupant(3);
    state.p1.magicTrapZones[2] = {
      instanceId: "mine-t2",
      cardId: trap.id,
      owner: "p1",
      zoneIndex: 2,
      faceUp: false,
      setOnTurn: 1,
    };
    return state;
  };

  // A Level 4 Monster needs no Tribute, so the lit Monster Zones must be
  // exactly the ones a real Normal Summon succeeds into.
  const lowState = build(lowMonster.id);
  const lowPlacements = chronicleLegalPlacements(
    projectMatchForViewer(lowState, "p1"),
    cardsById[lowMonster.id],
  );
  assert.equal(lowPlacements.mode, "monster");
  assert.deepEqual(lowPlacements.monsterZones, [0, 2, 4]);
  assert.deepEqual(lowPlacements.tributeZones, []);
  for (let zoneIndex = 0; zoneIndex < 5; zoneIndex += 1) {
    const serverAccepts = normalSummon(lowState, "p1", {
      action: "normal-summon",
      handIndex: 0,
      zoneIndex,
      tributeZoneIndexes: [],
    }).ok;
    assert.equal(
      lowPlacements.monsterZones.includes(zoneIndex),
      serverAccepts,
      `Monster Zone ${zoneIndex} glow disagrees with the server`,
    );
  }

  // A Tribute Summon lights the Monsters that can be offered, and the summon
  // it sets up is one the server honours.
  const bigState = build(bigMonster.id);
  const bigPlacements = chronicleLegalPlacements(
    projectMatchForViewer(bigState, "p1"),
    cardsById[bigMonster.id],
  );
  assert.deepEqual(bigPlacements.tributeZones, [1, 3]);
  assert.deepEqual(bigPlacements.monsterZones, [0, 2, 4]);
  assert.ok(
    normalSummon(bigState, "p1", {
      action: "normal-summon",
      handIndex: 0,
      zoneIndex: bigPlacements.monsterZones[0],
      tributeZoneIndexes: bigPlacements.tributeZones.slice(0, 1),
    }).ok,
  );

  // Snares light the open half of the back row, and only the open half.
  const trapState = build(trap.id);
  const trapPlacements = chronicleLegalPlacements(
    projectMatchForViewer(trapState, "p1"),
    cardsById[trap.id],
  );
  assert.equal(trapPlacements.mode, "trap");
  assert.deepEqual(trapPlacements.monsterZones, []);
  for (let zoneIndex = 0; zoneIndex < 5; zoneIndex += 1)
    assert.equal(
      trapPlacements.trapZones.includes(zoneIndex),
      setTrap(trapState, "p1", 0, zoneIndex).ok,
      `Jutsu/Snare Zone ${zoneIndex} glow disagrees with the server`,
    );

  // Spent Normal Summon, wrong phase, and the opponent's turn light nothing.
  const spent = build(lowMonster.id);
  spent.normalSummonUsed = true;
  assert.equal(
    chronicleLegalPlacements(
      projectMatchForViewer(spent, "p1"),
      cardsById[lowMonster.id],
    ).mode,
    "none",
  );
  const battle = build(lowMonster.id);
  battle.phase = "battle";
  assert.equal(
    chronicleLegalPlacements(
      projectMatchForViewer(battle, "p1"),
      cardsById[lowMonster.id],
    ).mode,
    "none",
  );
  const foeTurn = build(lowMonster.id);
  foeTurn.activePlayer = "p2";
  assert.equal(
    chronicleLegalPlacements(
      projectMatchForViewer(foeTurn, "p1"),
      cardsById[lowMonster.id],
    ).mode,
    "none",
  );
});
