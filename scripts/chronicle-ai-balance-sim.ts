/**
 * Chronicle Showdown AI-vs-AI balance simulation.
 *
 * The older `chronicle-balance-sim.ts` drives both sides with a toy pilot that
 * never plays Jutsu or Snares, so it cannot see support cards at all. This one
 * drives BOTH sides with the real server Keeper AI (`advanceAi`), which plays
 * the whole card vocabulary. The Keeper only knows how to pilot `p2`, so the
 * `p1` turn is played on a side-swapped copy of the match and swapped back —
 * the rules are symmetric under relabeling, so this is the same game.
 *
 * Three modes, each answering one question:
 *
 *   mirror  starter vs starter, `games` matches: does going first decide it?
 *   ladder  starter deck vs each Keeper deck, games/2 per cell: is the
 *           difficulty ladder a ladder?
 *   cards   games×10 matches between random legal decks from the whole
 *           catalog: which cards win when drawn? Also rolls the same games up
 *           by Level, rarity × Tribute band and effect kind.
 *
 *   node --import tsx scripts/chronicle-ai-balance-sim.ts [mode] [games] [seed]
 *
 * mode is mirror | ladder | cards | all (default all). Environment options:
 * SIM_DUMP=<file> writes every per-card row as JSON; SIM_PILOTS=medium runs
 * only those ladder rows; SIM_LADDER_DECK=<comma-separated ids> swaps in
 * another player deck for the ladder. docs/chronicle-balance-pass-2026-10.md
 * records the 2026-10-14 runs and how to read them.
 */
import { writeFileSync } from "node:fs";
import {
  CHRONICLE_CARD_CATALOG,
  CHRONICLE_STARTER_GRANT_IDS,
  MAIN_DECK_SIZE,
  createMatch,
  deckLimitForCard,
  getChronicleCard,
  tributeCountForLevel,
  validateDeckIds,
  type ChronicleAiDifficulty,
  type ChronicleCard,
  type ChronicleMatch,
} from "../shared/chronicle-duel.js";
import {
  CHRONICLE_AI_DECKS,
  advanceAi,
  type AiMatchSession,
} from "../api/card-clash/_ai-engine.js";

const MODE = process.argv[2] ?? "all";
const GAMES = Math.max(1, Number(process.argv[3] ?? 400));
const SEED = Number(process.argv[4] ?? 1);
const NOW = 1_000;

/** Deterministic LCG so every run is reproducible from its seed. */
function lcg(seed: number): () => number {
  let s = (Math.floor(seed) * 2654435761 + 12345) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// AI-vs-AI driver
// ---------------------------------------------------------------------------

const flip = <T>(key: T): T =>
  (key === "p1" ? "p2" : key === "p2" ? "p1" : key) as T;

/** The same match with p1 and p2 relabeled. */
function swapSides(state: ChronicleMatch): ChronicleMatch {
  const next = structuredClone(state);
  [next.p1, next.p2] = [next.p2, next.p1];
  next.activePlayer = flip(next.activePlayer);
  next.firstPlayer = flip(next.firstPlayer);
  if (next.winner) next.winner = flip(next.winner);
  if (next.responseWindow) {
    next.responseWindow.responder = flip(next.responseWindow.responder);
    next.responseWindow.pendingAction.actor = flip(
      next.responseWindow.pendingAction.actor,
    );
    if (next.responseWindow.pendingAction.targetSide)
      next.responseWindow.pendingAction.targetSide = flip(
        next.responseWindow.pendingAction.targetSide,
      );
  }
  if (next.activeField) next.activeField.owner = flip(next.activeField.owner);
  for (const side of [next.p1, next.p2]) {
    for (const monster of side.monsterZones) if (monster) monster.owner = flip(monster.owner);
    for (const zone of side.magicTrapZones) if (zone) zone.owner = flip(zone.owner);
  }
  if (next.afkStrikes)
    next.afkStrikes = { p1: next.afkStrikes.p2, p2: next.afkStrikes.p1 };
  return next;
}

/** Log and replay events are presentation-only; trimming keeps cloning cheap. */
function trim(state: ChronicleMatch): void {
  if (state.log.length > 12) state.log.splice(0, state.log.length - 12);
  if (state.events && state.events.length > 12)
    state.events.splice(0, state.events.length - 12);
}

interface GameResult {
  /** "A" | "B" | "draw" | "stalled" */
  winner: "A" | "B" | "draw" | "stalled";
  aWentFirst: boolean;
  turns: number;
  drawnA: Set<string>;
  drawnB: Set<string>;
  lifeA: number;
  lifeB: number;
  /** Tribute Summons each side made, read from the duel log. */
  tributesA: number;
  tributesB: number;
}

function seen(set: Set<string>, side: ChronicleMatch["p1"]): void {
  for (const id of side.hand) set.add(id);
  for (const monster of side.monsterZones) if (monster) set.add(monster.cardId);
  for (const zone of side.magicTrapZones) if (zone) set.add(zone.cardId);
}

/**
 * Deck A sits in p1, deck B in p2. createMatch picks the first player from the
 * seed, so across many seeds each deck goes first about half the time.
 */
function playAiVsAi(
  deckA: readonly string[],
  deckB: readonly string[],
  difficultyA: ChronicleAiDifficulty,
  difficultyB: ChronicleAiDifficulty,
  seed: number,
): GameResult {
  let state = createMatch("A", deckA, "B", deckB, lcg(seed), NOW);
  const drawnA = new Set<string>();
  const drawnB = new Set<string>();
  const aWentFirst = state.firstPlayer === "p1";
  const session: AiMatchSession = {
    matchId: `sim-${seed}`,
    playerName: "A",
    createdAt: NOW,
    rulesVersion: state.rulesVersion,
    difficulty: difficultyB,
    state,
    status: "active",
  };
  let swapped = false;
  let tributesA = 0;
  let tributesB = 0;
  const observe = (current: ChronicleMatch) => {
    seen(swapped ? drawnB : drawnA, current.p1);
    seen(swapped ? drawnA : drawnB, current.p2);
  };
  observe(state);
  for (let guard = 0; guard < 600 && state.status === "active"; guard++) {
    if (state.turnNumber > 80) break;
    const needs = state.responseWindow
      ? state.responseWindow.responder
      : state.activePlayer;
    const before = `${state.turnNumber}/${state.phase}/${state.activePlayer}/${state.responseWindow?.id ?? ""}/${state.iidCounter}`;
    swapped = needs === "p1";
    session.state = swapped ? swapSides(state) : state;
    session.status = "active";
    session.difficulty = swapped ? difficultyA : difficultyB;
    const logBefore = session.state.log.length;
    advanceAi(session, NOW, observe);
    const tributeSummons = session.state.log
      .slice(logBefore)
      .filter((line) => / using \d Tributes?\./.test(line)).length;
    if (swapped) tributesA += tributeSummons;
    else tributesB += tributeSummons;
    state = swapped ? swapSides(session.state) : session.state;
    swapped = false;
    trim(state);
    const after = `${state.turnNumber}/${state.phase}/${state.activePlayer}/${state.responseWindow?.id ?? ""}/${state.iidCounter}`;
    if (after === before) break;
  }
  const winner =
    state.status !== "complete"
      ? "stalled"
      : state.winner === "p1"
        ? "A"
        : state.winner === "p2"
          ? "B"
          : "draw";
  return {
    winner,
    aWentFirst,
    turns: state.turnNumber,
    drawnA,
    drawnB,
    lifeA: state.p1.lifePoints,
    lifeB: state.p2.lifePoints,
    tributesA,
    tributesB,
  };
}

// ---------------------------------------------------------------------------
// Random legal decks drawn from the whole catalog, with a playable curve.
// ---------------------------------------------------------------------------

const monsters = CHRONICLE_CARD_CATALOG.filter(
  (card): card is Extract<ChronicleCard, { cardClass: "monster" }> =>
    card.cardClass === "monster",
);
const support = CHRONICLE_CARD_CATALOG.filter(
  (card) => card.cardClass !== "monster",
);
const band = (tributes: number) =>
  monsters.filter((card) => tributeCountForLevel(card.level) === tributes);
const POOLS = { free: band(0), one: band(1), two: band(2), support };

function randomDeck(random: () => number): string[] {
  const deck: string[] = [];
  const room = (id: string) =>
    deckLimitForCard(id) - deck.filter((held) => held === id).length;
  const fill = (pool: readonly ChronicleCard[], count: number) => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < 500; tries++) {
      const card = pool[Math.floor(random() * pool.length)];
      const copies = 1 + Math.floor(random() * 3);
      for (let i = 0; i < copies && placed < count && room(card.id) > 0; i++) {
        deck.push(card.id);
        placed++;
      }
    }
  };
  fill(POOLS.free, 15);
  fill(POOLS.one, 5);
  fill(POOLS.two, 3);
  fill(POOLS.support, MAIN_DECK_SIZE - deck.length);
  return deck;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const pct = (wins: number, total: number) =>
  total ? `${((wins / total) * 100).toFixed(1).padStart(5)}%` : "  n/a ";

function mirror(games: number) {
  const deck = [...CHRONICLE_STARTER_GRANT_IDS];
  let firstWins = 0;
  let decided = 0;
  let stalled = 0;
  let draws = 0;
  let turns = 0;
  let tributes = 0;
  for (let seed = SEED; seed < SEED + games; seed++) {
    const out = playAiVsAi(deck, deck, "hard", "hard", seed);
    turns += out.turns;
    tributes += out.tributesA + out.tributesB;
    if (out.winner === "stalled") stalled++;
    else if (out.winner === "draw") draws++;
    else {
      decided++;
      if ((out.winner === "A") === out.aWentFirst) firstWins++;
    }
  }
  console.log(
    `mirror (starter vs starter, hard pilots): first player wins ${pct(firstWins, decided)}` +
      `  (${firstWins}/${decided}, draws ${draws}, stalled ${stalled}, avg turns ${(turns / games).toFixed(1)},` +
      ` Tribute Summons per side per game ${(tributes / games / 2).toFixed(2)})`,
  );
}

function ladder(games: number) {
  // SIM_LADDER_DECK (comma-separated ids) swaps in another player deck.
  const starter = process.env.SIM_LADDER_DECK
    ? process.env.SIM_LADDER_DECK.split(",")
    : [...CHRONICLE_STARTER_GRANT_IDS];
  if (!validateDeckIds(starter).valid)
    throw new Error(validateDeckIds(starter).errors.join(" "));
  // SIM_PILOTS=medium runs one row, for quick deck tuning.
  const pilots = (process.env.SIM_PILOTS ?? "easy,medium,hard").split(",") as ChronicleAiDifficulty[];
  for (const pilot of pilots) {
    const cells: string[] = [];
    for (const keeper of ["easy", "medium", "hard"] as ChronicleAiDifficulty[]) {
      let wins = 0;
      let decided = 0;
      let turns = 0;
      for (let seed = SEED; seed < SEED + games; seed++) {
        const out = playAiVsAi(
          starter,
          CHRONICLE_AI_DECKS[keeper],
          pilot,
          keeper,
          seed,
        );
        turns += out.turns;
        if (out.winner === "A" || out.winner === "B") decided++;
        if (out.winner === "A") wins++;
      }
      cells.push(`vs ${keeper.padEnd(6)} ${pct(wins, decided)} (${(turns / games).toFixed(1)}t)`);
    }
    console.log(`starter deck, ${pilot.padEnd(6)} pilot: ${cells.join("   ")}`);
  }
}

interface Tally {
  drawnGames: number;
  drawnWins: number;
  deckGames: number;
  deckWins: number;
}

function cards(games: number) {
  const random = lcg(SEED * 7919);
  const tallies = new Map<string, Tally>();
  const tally = (id: string) => {
    let row = tallies.get(id);
    if (!row) {
      row = { drawnGames: 0, drawnWins: 0, deckGames: 0, deckWins: 0 };
      tallies.set(id, row);
    }
    return row;
  };
  let firstWins = 0;
  let decided = 0;
  let turns = 0;
  let stalled = 0;
  let slowest = { ms: 0, game: -1 };
  const begun = Date.now();
  for (let game = 0; game < games; game++) {
    if (game && game % 2_000 === 0)
      process.stderr.write(`  ...${game}/${games} games, ${((Date.now() - begun) / 1000).toFixed(0)}s\n`);
    const deckA = randomDeck(random);
    const deckB = randomDeck(random);
    if (!validateDeckIds(deckA).valid || !validateDeckIds(deckB).valid) continue;
    const t0 = Date.now();
    const out = playAiVsAi(deckA, deckB, "hard", "hard", SEED * 100_003 + game);
    const ms = Date.now() - t0;
    if (ms > slowest.ms) slowest = { ms, game };
    if (out.winner === "stalled") stalled++;
    turns += out.turns;
    if (out.winner !== "A" && out.winner !== "B") continue;
    decided++;
    if ((out.winner === "A") === out.aWentFirst) firstWins++;
    for (const [deck, drawn, won] of [
      [deckA, out.drawnA, out.winner === "A"],
      [deckB, out.drawnB, out.winner === "B"],
    ] as const) {
      for (const id of new Set(deck)) {
        const row = tally(id);
        row.deckGames++;
        if (won) row.deckWins++;
        if (drawn.has(id)) {
          row.drawnGames++;
          if (won) row.drawnWins++;
        }
      }
    }
  }
  console.log(
    `random-deck games: ${decided} decided, first player wins ${pct(firstWins, decided)}, avg turns ${(turns / games).toFixed(1)}, stalled ${stalled}, slowest ${slowest.ms}ms (game ${slowest.game})`,
  );

  // "Drawn" win rate minus "in deck but never drawn" win rate. A card that does
  // nothing scores ~0; a card that wins games when it shows up scores high.
  const rows = [...tallies]
    .map(([id, row]) => {
      const undrawnGames = row.deckGames - row.drawnGames;
      const undrawnWins = row.deckWins - row.drawnWins;
      const drawnRate = row.drawnGames ? row.drawnWins / row.drawnGames : 0;
      const undrawnRate = undrawnGames ? undrawnWins / undrawnGames : 0.5;
      return { id, ...row, drawnRate, delta: drawnRate - undrawnRate };
    })
    .filter((row) => row.drawnGames >= 30);

  const describe = (id: string) => {
    const card = getChronicleCard(id)!;
    if (card.cardClass === "monster")
      return `${card.rarity.padEnd(9)} L${card.level} ${String(card.attack).padStart(4)}/${String(card.defense).padStart(4)} ${card.monsterEffect ? `${card.monsterEffect.kind}${card.monsterEffect.amount ? `:${card.monsterEffect.amount}` : ""}` : "-"}`;
    return `${card.rarity.padEnd(9)} ${card.cardClass} ${card.effect.kind}`;
  };
  const print = (row: (typeof rows)[number]) =>
    console.log(
      `  ${(row.delta * 100).toFixed(1).padStart(6)}  WR ${pct(row.drawnWins, row.drawnGames)} n=${String(row.drawnGames).padStart(4)}  ${row.id.padEnd(38)} ${describe(row.id)}`,
    );
  rows.sort((a, b) => b.delta - a.delta);
  console.log("\nstrongest when drawn (drawn WR minus undrawn WR, in points):");
  rows.slice(0, 30).forEach(print);
  console.log("\nweakest when drawn:");
  rows.slice(-30).forEach(print);

  // Group roll-ups: the per-card rows are noisy, the groups are not.
  const group = (label: string, keyOf: (card: ChronicleCard) => string | null) => {
    const groups = new Map<string, { n: number; delta: number; drawn: number }>();
    for (const row of rows) {
      const key = keyOf(getChronicleCard(row.id)!);
      if (!key) continue;
      const g = groups.get(key) ?? { n: 0, delta: 0, drawn: 0 };
      g.n++;
      g.delta += row.delta * row.drawnGames;
      g.drawn += row.drawnGames;
      groups.set(key, g);
    }
    console.log(`\n${label} (draw-weighted mean delta, points):`);
    for (const [key, g] of [...groups].sort((a, b) => b[1].delta / b[1].drawn - a[1].delta / a[1].drawn))
      console.log(`  ${((g.delta / g.drawn) * 100).toFixed(1).padStart(6)}  cards=${String(g.n).padStart(3)} drawn=${String(g.drawn).padStart(6)}  ${key}`);
  };
  group("by Level", (card) => (card.cardClass === "monster" ? `L${card.level} (T${tributeCountForLevel(card.level)})` : null));
  group("by rarity x tribute band", (card) =>
    card.cardClass === "monster" ? `${card.rarity} T${tributeCountForLevel(card.level)}` : null,
  );
  group("by monster effect", (card) =>
    card.cardClass === "monster" ? (card.monsterEffect?.kind ?? "vanilla") : null,
  );
  group("by support effect", (card) =>
    card.cardClass === "monster" ? null : `${card.cardClass}:${card.effect.kind}`,
  );

  // Every row, for regrouping offline without replaying the games.
  if (process.env.SIM_DUMP)
    writeFileSync(process.env.SIM_DUMP, JSON.stringify({ decided, firstWins, rows }, null, 1));
}

/**
 * Do the two-Tribute casting tools help? The starter deck carries eight
 * two-Tribute Monsters, so it is the deck that needs them most. Each variant
 * swaps a few support cards for Shadow Clone and/or a Summoning Call pair and
 * plays the plain starter, same pilot on both sides.
 */
function upgrades(games: number) {
  const base = [...CHRONICLE_STARTER_GRANT_IDS];
  const swap = (out: string[], into: string[]) => {
    const deck = [...base];
    for (const id of out) deck.splice(deck.indexOf(id), 1);
    return [...deck, ...into];
  };
  const call = "chronicle-call-of-the-cinderhorn";
  const called = "summon-cinderhorn-qilin";
  const variants: [string, string[]][] = [
    ["control (plain starter)", base],
    ["+2 Shadow Clone", swap(["chronicle-medical-salve", "chronicle-medical-salve"], ["chronicle-shadow-clone", "chronicle-shadow-clone"])],
    ["+1 Call pair", swap(["chronicle-guard-stance", "chronicle-soldier-pill"], [call, called])],
    ["+2 Call pairs", swap(["chronicle-guard-stance", "chronicle-guard-stance", "chronicle-soldier-pill", "chronicle-soldier-pill"], [call, call, called, called])],
    ["+2 Clone, +2 Call pairs", swap(
      ["chronicle-medical-salve", "chronicle-medical-salve", "chronicle-guard-stance", "chronicle-guard-stance", "chronicle-soldier-pill", "chronicle-soldier-pill"],
      ["chronicle-shadow-clone", "chronicle-shadow-clone", call, call, called, called],
    )],
  ];
  for (const [label, deck] of variants) {
    if (!validateDeckIds(deck).valid) throw new Error(`${label}: ${validateDeckIds(deck).errors.join(" ")}`);
    let wins = 0;
    let decided = 0;
    let tributesA = 0;
    let tributesB = 0;
    for (let seed = SEED; seed < SEED + games; seed++) {
      const out = playAiVsAi(deck, base, "hard", "hard", seed);
      tributesA += out.tributesA;
      tributesB += out.tributesB;
      if (out.winner === "A" || out.winner === "B") decided++;
      if (out.winner === "A") wins++;
    }
    console.log(
      `${label.padEnd(26)} beats the plain starter ${pct(wins, decided)}  Tribute Summons/game ${(tributesA / games).toFixed(2)} vs ${(tributesB / games).toFixed(2)}`,
    );
  }
}

const started = Date.now();
if (MODE === "upgrades") upgrades(GAMES);
if (MODE === "mirror" || MODE === "all") mirror(GAMES);
if (MODE === "ladder" || MODE === "all") ladder(Math.max(1, Math.floor(GAMES / 2)));
if (MODE === "cards" || MODE === "all") cards(GAMES * 10);
console.log(`\n(${((Date.now() - started) / 1000).toFixed(1)}s)`);
