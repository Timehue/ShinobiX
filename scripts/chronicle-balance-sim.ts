/**
 * Chronicle Showdown balance simulation.
 *
 * Plays REAL matches through the real server engine and the real catalog, so
 * what it measures is the shipped game rather than a model of it. Two modes:
 *
 *   ladder       each cohort's deck against the Keeper AI at every difficulty
 *   head-to-head cohort vs cohort, same pilot on both sides
 *
 * The head-to-head is the one that answers "does a player have to pay?" — it
 * holds the pilot constant so the ONLY variable is which cards a cohort is
 * allowed to own. Read the mirror-match control first: if free-vs-free is not
 * near 50%, the harness is skewed and the other rows mean nothing.
 *
 *   node --import tsx scripts/chronicle-balance-sim.ts [matchesPerCohort]
 */
import {
  CHRONICLE_CARD_CATALOG,
  CHRONICLE_STARTER_GRANT_IDS,
  MAIN_DECK_SIZE,
  applyAction,
  createMatch,
  deckLimitForCard,
  getChronicleCard,
  tributeCountForLevel,
  validateDeckIds,
  type ChronicleActionIntent,
  type ChronicleAiDifficulty,
  type ChronicleMatch,
  type ChronicleSideKey,
} from "../shared/chronicle-duel.js";
import { createAiMatch, isDone, applyPlayerAction } from "../api/card-clash/_ai-engine.js";
import { isMarketplaceCard } from "../api/clan/war/_card-catalog.js";
import { CHRONICLE_PROGRESSION_CARD_IDS } from "../api/card-clash/_progression-cards.js";

const PROGRESSION = new Set<string>(CHRONICLE_PROGRESSION_CARD_IDS);
const MATCHES = Math.max(1, Number(process.argv[2] ?? 200));

/** Deterministic LCG so any run is reproducible from its seed. */
function lcg(seed: number): () => number {
  let s = (Math.floor(seed) * 2654435761 + 12345) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const monsterOf = (id: string) => {
  const card = getChronicleCard(id);
  return card?.cardClass === "monster" ? card : null;
};

// ---------------------------------------------------------------------------
// Cohorts — what each kind of player is actually allowed to own.
// ---------------------------------------------------------------------------

type Cohort = { name: string; deck: string[] };

const shopPool = CHRONICLE_CARD_CATALOG.filter(
  (card) =>
    !isMarketplaceCard(card.id) &&
    !PROGRESSION.has(card.id) &&
    (card.rarity === "common" || card.rarity === "rare"),
);
const marketPool = CHRONICLE_CARD_CATALOG.filter((card) => isMarketplaceCard(card.id));
const grindPool = CHRONICLE_CARD_CATALOG.filter(
  (card) =>
    !isMarketplaceCard(card.id) &&
    (PROGRESSION.has(card.id) || card.rarity === "common" || card.rarity === "rare"),
);

/**
 * A PLAYABLE deck, not merely an expensive one.
 *
 * Taking the top 24 cards by raw stats builds a deck of nothing but two-Tribute
 * bodies, which can never summon anything and loses 100% of matches however
 * strong the cards are. Tribute fodder is what makes the fat castable, so this
 * fills a curve shaped like the shipped starter deck and takes the best cards
 * each band offers.
 */
const CURVE = [
  { tributes: 0, count: 12 },
  { tributes: 1, count: 6 },
  { tributes: 2, count: 6 },
];

function buildDeck(pool: typeof CHRONICLE_CARD_CATALOG): string[] {
  const deck: string[] = [];
  const room = (id: string) =>
    deckLimitForCard(id) - deck.filter((held) => held === id).length;
  const byPower = (a: { attack: number; defense: number }, b: typeof a) =>
    b.attack + b.defense - (a.attack + a.defense);

  for (const band of CURVE) {
    const inBand = pool
      .filter(
        (card) =>
          card.cardClass === "monster" &&
          tributeCountForLevel(card.level) === band.tributes,
      )
      .sort(byPower);
    let placed = 0;
    for (const card of inBand) {
      while (placed < band.count && room(card.id) > 0) {
        deck.push(card.id);
        placed++;
      }
      if (placed >= band.count) break;
    }
  }
  for (const card of pool.filter((entry) => entry.cardClass !== "monster")) {
    while (deck.length < MAIN_DECK_SIZE && room(card.id) > 0) deck.push(card.id);
  }
  const castable = pool
    .filter(
      (card) => card.cardClass === "monster" && tributeCountForLevel(card.level) === 0,
    )
    .sort(byPower);
  while (deck.length < MAIN_DECK_SIZE) {
    const filler = castable.find((card) => room(card.id) > 0);
    if (!filler) break;
    deck.push(filler.id);
  }
  return deck;
}

const COHORTS: Cohort[] = [
  { name: "free (ryo shop)", deck: buildDeck(shopPool) },
  { name: "paid (marketplace)", deck: buildDeck(marketPool) },
  { name: "free + progression", deck: buildDeck(grindPool) },
  { name: "starter codex", deck: [...CHRONICLE_STARTER_GRANT_IDS] },
];

// ---------------------------------------------------------------------------
// The pilot — ONE implementation, driven by both modes.
//
// Deliberately simple and identical for every cohort: the variable under test
// is the DECK, not the skill. It summons the biggest body it can pay for and
// swings at whatever it profitably beats. It does NOT play Magic or Traps, so
// support-heavy decks are undervalued — equally, on both sides.
// ---------------------------------------------------------------------------

type Act = (intent: ChronicleActionIntent) => boolean;

function pilot(side: ChronicleSideKey, read: () => ChronicleMatch, act: Act): void {
  const passResponses = () => {
    for (let guard = 0; guard < 4; guard++) {
      const window = read().responseWindow;
      if (!window || window.responder !== side || read().status !== "active") return;
      if (!act({ action: "pass-response" })) return;
    }
  };
  const me = () => (side === "p1" ? read().p1 : read().p2);
  const foe = () => (side === "p1" ? read().p2 : read().p1);

  passResponses();
  if (read().activePlayer !== side || read().status !== "active") return;

  // draw -> standby -> main1; advancePhase only walks those two steps.
  for (let guard = 0; guard < 3; guard++) {
    const phase = read().phase;
    if (phase !== "draw" && phase !== "standby") break;
    if (!act({ action: "advance-phase" })) break;
  }

  if (read().phase === "main1" && !read().normalSummonUsed) {
    const open = me()
      .monsterZones.map((zone, index) => (zone === null ? index : -1))
      .filter((index) => index >= 0);
    const fodder = me()
      .monsterZones.map((zone, index) => (zone ? index : -1))
      .filter((index) => index >= 0);
    const hand = me()
      .hand.map((id, handIndex) => ({ card: monsterOf(id), handIndex }))
      .filter((entry) => entry.card)
      .sort((a, b) => b.card!.attack - a.card!.attack);
    for (const entry of hand) {
      const cost = tributeCountForLevel(entry.card!.level);
      if (cost > fodder.length) continue;
      const zoneIndex = cost > 0 ? fodder[0] : open[0];
      if (zoneIndex === undefined) continue;
      const summoned = act({
        action: "normal-summon",
        handIndex: entry.handIndex,
        zoneIndex,
        ...(cost ? { tributeZoneIndexes: fodder.slice(0, cost) } : {}),
      } as ChronicleActionIntent);
      if (summoned) break;
    }
  }

  if (read().phase === "main1") act({ action: "start-battle" });
  if (read().phase === "battle") {
    for (let attacker = 0; attacker < 5; attacker++) {
      const mine = me().monsterZones[attacker];
      if (!mine || mine.position !== "attack" || mine.lastAttackTurn >= read().turnNumber)
        continue;
      const card = monsterOf(mine.cardId);
      if (!card) continue;
      const live = foe()
        .monsterZones.map((zone, index) => ({ zone, index }))
        .filter((slot) => slot.zone);
      if (!live.length) {
        act({ action: "attack", attackerZoneIndex: attacker, targetZoneIndex: null });
        continue;
      }
      const best = live
        .map((slot) => {
          const target = monsterOf(slot.zone!.cardId);
          const wall =
            slot.zone!.position === "attack" ? target?.attack ?? 0 : target?.defense ?? 0;
          return { index: slot.index, margin: card.attack - wall };
        })
        .filter((entry) => entry.margin > 0)
        .sort((a, b) => b.margin - a.margin)[0];
      if (best)
        act({ action: "attack", attackerZoneIndex: attacker, targetZoneIndex: best.index });
    }
  }

  for (const closer of ["enter-main-2", "enter-end-phase", "end-turn"]) {
    if (read().status !== "active" || read().activePlayer !== side) break;
    passResponses();
    act({ action: closer });
  }
}

// ---------------------------------------------------------------------------
// Mode 1 — the AI ladder.
// ---------------------------------------------------------------------------

function playLadder(deck: string[], difficulty: ChronicleAiDifficulty, seed: number) {
  const session = createAiMatch(`sim-${seed}`, "Sim", deck, difficulty, 1_000, lcg(seed));
  const act: Act = (intent) => applyPlayerAction(session, intent, 1_000).ok;
  for (let guard = 0; guard < 400 && !isDone(session); guard++) {
    const before = `${session.state.turnNumber}/${session.state.phase}/${session.state.activePlayer}`;
    pilot("p1", () => session.state, act);
    if (before === `${session.state.turnNumber}/${session.state.phase}/${session.state.activePlayer}`)
      break;
  }
  return { done: isDone(session), winner: session.winner, turns: session.state.turnNumber };
}

// ---------------------------------------------------------------------------
// Mode 2 — head to head. Same pilot both sides; first turn alternates so turn
// order cannot skew the result.
// ---------------------------------------------------------------------------

function headToHead(deckA: string[], deckB: string[], matches: number) {
  let aWins = 0;
  let bWins = 0;
  let stalled = 0;
  for (let seed = 1; seed <= matches; seed++) {
    const aFirst = seed % 2 === 1;
    let state = createMatch(
      aFirst ? "A" : "B",
      aFirst ? deckA : deckB,
      aFirst ? "B" : "A",
      aFirst ? deckB : deckA,
      lcg(seed),
      1_000,
    );
    const act: Act = (intent) => {
      const out = applyAction(state, state.activePlayer, intent, 1_000);
      if (out.ok) state = out.state;
      return out.ok;
    };
    for (let guard = 0; guard < 300 && state.status === "active"; guard++) {
      const before = `${state.turnNumber}/${state.phase}/${state.activePlayer}`;
      pilot(state.activePlayer, () => state, act);
      if (before === `${state.turnNumber}/${state.phase}/${state.activePlayer}`) break;
    }
    if (state.status !== "complete") {
      stalled++;
      continue;
    }
    if (state.winner === "p1" || state.winner === "p2")
      ((state.winner === "p1") === aFirst ? aWins++ : bWins++);
  }
  return { aWins, bWins, stalled };
}

// ---------------------------------------------------------------------------

console.log(
  `Chronicle balance simulation — ${MATCHES} matches per cohort\n` +
    `(real engine, real catalog; identical pilot for every cohort)\n`,
);

for (const cohort of COHORTS) {
  const check = validateDeckIds(cohort.deck);
  const monsters = cohort.deck.map(monsterOf).filter(Boolean);
  const avgAtk = Math.round(
    monsters.reduce((sum, card) => sum + card!.attack, 0) / Math.max(1, monsters.length),
  );
  console.log(
    `${cohort.name.padEnd(20)} deck ${cohort.deck.length}/${MAIN_DECK_SIZE} legal=${check.valid} avgATK=${avgAtk}`,
  );
  if (!check.valid) {
    console.log(`   ILLEGAL: ${check.errors.join(" | ")}`);
    continue;
  }
  for (const difficulty of ["easy", "medium", "hard"] as ChronicleAiDifficulty[]) {
    let wins = 0;
    let losses = 0;
    let other = 0;
    for (let seed = 1; seed <= MATCHES; seed++) {
      const out = playLadder(cohort.deck, difficulty, seed);
      if (!out.done) other++;
      else if (out.winner === "player") wins++;
      else if (out.winner === "opponent") losses++;
      else other++;
    }
    const decided = wins + losses;
    const rate = decided ? ((wins / decided) * 100).toFixed(1) : "n/a";
    console.log(
      `   vs ${difficulty.padEnd(6)} win ${String(rate).padStart(5)}%  (W${wins}/L${losses}, other ${other})`,
    );
  }
}

console.log("\nHead-to-head — read the mirror control first\n");
const [free, paid, grind, codex] = COHORTS.map((cohort) => cohort.deck);
for (const [label, a, b] of [
  ["mirror (control)", free, free],
  ["free vs paid", free, paid],
  ["free+progression vs paid", grind, paid],
  ["codex vs free", codex, free],
] as [string, string[], string[]][]) {
  const result = headToHead(a, b, MATCHES);
  const decided = result.aWins + result.bWins;
  const rate = decided ? ((result.aWins / decided) * 100).toFixed(1) : "n/a";
  console.log(
    `   ${label.padEnd(26)} first side wins ${String(rate).padStart(5)}%  (${result.aWins}-${result.bWins}, stalled ${result.stalled})`,
  );
}
