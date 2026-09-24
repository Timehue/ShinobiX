import assert from "node:assert/strict";
import test from "node:test";
import { CHRONICLE_CARD_CATALOG, CHRONICLE_FIXED_FALLBACK_DECK, applyAction, createMatch, projectMatchForViewer, type ChronicleMatch, type ChroniclePresentationEvent, type ChronicleActionIntent } from "../../../shared/chronicle-duel";
import { ChronicleBeatQueue, chronicleBeats, chronicleEffectTargets, chronicleReplayDelay, chronicleBeatDuration } from "./chronicle-presentation";

const cards = Object.fromEntries(CHRONICLE_CARD_CATALOG.map(card => [card.id, card]));
const names = { p1: "Akari", p2: "Keeper" };
function act(state: ChronicleMatch, actor: "p1" | "p2", intent: ChronicleActionIntent) {
  const result = applyAction(state, actor, intent, 5_000);
  assert.equal(result.ok, true, result.ok ? "Action succeeds" : result.error);
  return result.state;
}
function response(kind: string) {
  let state = createMatch(names.p1, CHRONICLE_FIXED_FALLBACK_DECK, names.p2, CHRONICLE_FIXED_FALLBACK_DECK, () => 0, 1_000);
  state.turnNumber = 4;
  state.activePlayer = "p2";
  state.phase = "main1";
  const monster = CHRONICLE_CARD_CATALOG.find(card => card.cardClass === "monster" && card.level <= 4 && card.monsterType === "normal")!;
  const snare = CHRONICLE_CARD_CATALOG.find(card => card.cardClass === "trap" && card.effect.kind === kind && card.effect.trigger === (kind === "negateOneAttack" ? "onAttackDeclared" : "onMonsterSummoned"))!;
  assert.ok(snare);
  if (snare.cardClass === "trap" && snare.effect.requiresFaceUpElement) {
    const ally = CHRONICLE_CARD_CATALOG.find(card => card.cardClass === "monster" && card.element === snare.effect.requiresFaceUpElement)!;
    state.p1.monsterZones[4] = { instanceId: "element-ally", cardId: ally.id, owner: "p1", zoneIndex: 4, faceUp: true, position: "defense", summonedOnTurn: 2, lastPositionChangeTurn: 2, lastAttackTurn: 0, temporaryAttack: 0, temporaryDefense: 0 };
  }
  state.p2.hand = [monster.id];
  state.p1.magicTrapZones[1] = { instanceId: "snare-1", cardId: snare.id, owner: "p1", zoneIndex: 1, faceUp: false, setOnTurn: 2 };
  if (kind === "negateOneAttack") {
    state.p1.magicTrapZones[1] = null;
    state = act(state, "p2", { action: "normal-summon", handIndex: 0, zoneIndex: 0 });
    state.p1.magicTrapZones[1] = { instanceId: "snare-1", cardId: snare.id, owner: "p1", zoneIndex: 1, faceUp: false, setOnTurn: 2 };
    state = act(state, "p2", { action: "start-battle" });
    state = act(state, "p2", { action: "attack", attackerZoneIndex: 0, targetZoneIndex: null });
  } else state = act(state, "p2", { action: "normal-summon", handIndex: 0, zoneIndex: 0 });
  assert.ok(state.responseWindow);
  return { state, monster, snare };
}

test("a revealed Snare and its destroyed target form one cause/result beat for both viewers", () => {
  const { state, monster, snare } = response("destroyOneMonster");
  const next = act(state, "p1", { action: "activate-trap", zoneIndex: 1 });
  for (const viewer of ["p1", "p2"] as const) {
    const beats = chronicleBeats(projectMatchForViewer(next, viewer).events!, cards, names);
    const beat = beats.at(-1)!;
    assert.equal(beat.card?.id, snare.id);
    assert.equal(beat.tone, "snare");
    assert.equal(beat.motif, "shatter");
    assert.match(beat.results.join(" "), new RegExp(`${monster.name}.*destroyed`));
    assert.equal(beat.event.targetSide, "p2");
    assert.equal(beat.event.targetZoneIndex, 0);
    assert.ok(beat.events.every(event => event.actionId === beat.id));
  }
});

test("a zero-damage attack denial explicitly says the attack stopped", () => {
  const { state } = response("negateOneAttack");
  const next = act(state, "p1", { action: "activate-trap", zoneIndex: 1 });
  const beat = chronicleBeats(next.events!, cards, names).at(-1)!;
  assert.equal(next.p1.lifePoints, state.p1.lifePoints);
  assert.match(beat.results.join(" "), /stops the attack. No battle damage/);
  assert.equal(beat.motif, "seal");
});

test("returns and stat changes have authoritative notes and affected zones", () => {
  for (const [kind, note] of [["returnOneMonsterToHand", /returned to Keeper's hand/], ["weakenSummonedMonster", /ATK \d+ → \d+/]] as const) {
    const { state } = response(kind);
    const next = act(state, "p1", { action: "activate-trap", zoneIndex: 1 });
    const beat = chronicleBeats(next.events!, cards, names).at(-1)!;
    assert.match(beat.results.join(" "), note);
    assert.equal(beat.event.affectedZones?.[0].side, "p2");
    assert.equal(beat.event.affectedZones?.[0].zoneIndex, 0);
    assert.equal(beat.event.affectedZones?.[0].change, kind === "returnOneMonsterToHand" ? "returned" : "stats");
    const target = chronicleEffectTargets(beat)[0];
    assert.match(target.label, kind === "returnOneMonsterToHand" ? /^RETURNED$/ : /^ATK −\d+/);
    assert.equal(target.motif, kind === "returnOneMonsterToHand" ? "recall" : "surge");
  }
});

test("AI pacing holds each source and result until its presentation finishes", () => {
  const { state } = response("destroyOneMonster");
  const next = act(state, "p1", { action: "activate-trap", zoneIndex: 1 });
  const before = projectMatchForViewer(state, "p1");
  const after = projectMatchForViewer(next, "p1");
  const beat = chronicleBeats(after.events!, cards, names).at(-1)!;
  assert.equal(chronicleReplayDelay(before, after), chronicleBeatDuration(beat.event) + 120);
  assert.equal(chronicleReplayDelay(after, structuredClone(after)), 350);
  assert.deepEqual(chronicleEffectTargets(beat), [{ side: "p2", row: "monster", index: 0, label: "DESTROYED", motif: "shatter" }]);
});

test("attack denial labels the attacker and terminal events survive phase-only groups", () => {
  const { state } = response("negateOneAttack");
  const next = act(state, "p1", { action: "activate-trap", zoneIndex: 1 });
  const beat = chronicleBeats(next.events!, cards, names).at(-1)!;
  assert.equal(chronicleEffectTargets(beat)[0].label, "ATTACK STOPPED");
  const terminal = act(next, "p1", { action: "forfeit" });
  const end = chronicleBeats(terminal.events!, cards, names).at(-1)!;
  assert.equal(end.winner, "p2");
  assert.equal(end.terminalOnly, true);
  const bookkeeping: ChroniclePresentationEvent = { ...end.event, id: "phase-end", kind: "turn-started", actionId: end.id };
  assert.equal(chronicleBeats([bookkeeping, end.event], cards, names)[0]?.winner, "p2");
  const queue = new ChronicleBeatQueue();
  queue.observe(next.events!, cards, names);
  queue.observe(terminal.events!, cards, names);
  assert.equal(queue.clear(), "p2", "background completion still reaches the host result panel");
});

test("set events never expose an opponent's hidden card through recap or VFX", () => {
  let state = createMatch(names.p1, CHRONICLE_FIXED_FALLBACK_DECK, names.p2, CHRONICLE_FIXED_FALLBACK_DECK, () => 0, 1_000);
  state.phase = "main1";
  state.p1.hand = ["chronicle-pitfall-tag-array"];
  state = act(state, "p1", { action: "set-trap", handIndex: 0, zoneIndex: 0 });
  const beats = chronicleBeats(projectMatchForViewer(state, "p2").events!, cards, names);
  assert.equal(beats[0].card, undefined);
  assert.doesNotMatch(JSON.stringify(beats), /Pitfall|pitfall/);
});

test("rapid refreshes preserve every queued action and never replay initial history", () => {
  const queue = new ChronicleBeatQueue();
  const event = (id: string): ChroniclePresentationEvent => ({ id, actionId: id, kind: "trap-activated", turnNumber: 4, at: 5_000, actor: "p1", cardId: "chronicle-pitfall-tag-array" });
  const history = [event("initial")];
  queue.observe(history, cards, names);
  assert.equal(queue.length, 0);
  const live = [...history, ...Array.from({ length: 5 }, (_, index) => event(`live-${index}`))];
  queue.observe(live, cards, names);
  assert.equal(queue.take()?.id, "live-0");
  queue.observe(structuredClone(live), cards, names);
  assert.equal(queue.length, 4);
  queue.observe(history, cards, names);
  queue.observe(live, cards, names);
  assert.equal(queue.length, 4, "a stale refresh must not replay seen effects");
  assert.deepEqual(Array.from({ length: 4 }, () => queue.take()?.id), ["live-1", "live-2", "live-3", "live-4"]);
});
