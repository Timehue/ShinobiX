import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CHRONICLE_AI_DECKS } from "./_ai-engine.js";
import {
  CHRONICLE_CARD_CATALOG,
  CHRONICLE_RULES_VERSION,
  CHRONICLE_STARTER_CORE_IDS,
  createMatch,
} from "../../shared/chronicle-duel.js";

process.env.ADMIN_PASSWORD = "cc-match-test-admin";
process.env.SUPABASE_URL ??= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ??= "x";
process.env.ENABLE_LEGACY = "1";

const store = new Map<string, unknown>();
let failLegacyWrites = 0;
const clone = (value: unknown) =>
  value === undefined || value === null ? null : structuredClone(value);

function fakeReq(body: unknown, authenticated = true) {
  return {
    method: "POST",
    query: {},
    body,
    headers: {
      ...(authenticated
        ? { "x-admin-password": "cc-match-test-admin" }
        : {}),
      "x-forwarded-for": "10.0.0.3",
    },
    socket: { remoteAddress: "10.0.0.3" },
  } as never;
}

function fakeRes() {
  const out = { statusCode: 200, body: undefined as unknown };
  const res = {
    setHeader: () => res,
    status: (code: number) => {
      out.statusCode = code;
      return res;
    },
    json: (body: unknown) => {
      out.body = body;
      return res;
    },
    end: () => res,
  };
  return { res: res as never, out };
}

type Handler = (req: never, res: never) => Promise<unknown>;
let match: Handler;
let resolveDeck: (
  playerName: string,
  requested: readonly string[],
) => Promise<string[] | null>;

before(async () => {
  const kv = (await import("../_storage.js")).kv as unknown as Record<
    string,
    unknown
  >;
  kv.get = async (key: string) => clone(store.get(key));
  kv.set = async (key: string, value: unknown, options?: { nx?: boolean }) => {
    if (key.startsWith("legacy:stats:") && failLegacyWrites > 0) {
      failLegacyWrites -= 1;
      throw new Error("injected Legacy write outage");
    }
    if (options?.nx && store.has(key)) return null;
    store.set(key, clone(value));
    return "OK";
  };
  kv.compareSet = async (key: string, expected: unknown | null, value: unknown) => {
    const current = store.has(key) ? clone(store.get(key)) : null;
    if (!isDeepStrictEqual(current, expected)) return false;
    store.set(key, clone(value));
    return true;
  };
  kv.del = async (...keys: string[]) =>
    keys.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
  kv.delIfEqual = async (key: string, expected: string) => {
    if (store.get(key) !== expected) return false;
    store.delete(key);
    return true;
  };
  resolveDeck = (await import("./_deck.js")).resolveChronicleDeck;
  match = (await import("./match.js")).default as unknown as Handler;
});

async function call(body: unknown, authenticated = true) {
  const { res, out } = fakeRes();
  await match(fakeReq(body, authenticated), res);
  return out;
}

const MATCH_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_KEY = `cc-freeplay:${MATCH_ID}`;
const PAIR_KEY = `cc-pair:${MATCH_ID}`;

function installPlayer(name: string, savedDeck: readonly string[]) {
  store.set(`save:${name}`, {
    character: {
      name,
      tileCards: [...savedDeck],
      cardClashDeck: [...savedDeck],
    },
  });
}

function unownedReplacement(savedDeck: readonly string[]): string[] {
  const ownedAfterStarterGrant = new Set([
    ...savedDeck,
    ...CHRONICLE_STARTER_CORE_IDS,
  ]);
  const unowned = CHRONICLE_CARD_CATALOG.find(
    (card) => !ownedAfterStarterGrant.has(card.id),
  );
  assert.ok(unowned, "catalog must contain a card outside this test collection");
  return [unowned.id, ...savedDeck.slice(1)];
}

function installTerminalMatch(params: {
  matchId: string;
  winner: "p1" | "p2";
  p1Name?: string;
  p2Name?: string;
  qualified?: boolean;
}) {
  const now = Date.now();
  const p1Name = params.p1Name ?? "alpha";
  const p2Name = params.p2Name ?? "bravo";
  const state = createMatch(
    p1Name,
    [...CHRONICLE_AI_DECKS.hard],
    p2Name,
    [...CHRONICLE_AI_DECKS.medium],
    () => 0.5,
    now - 60_000,
  );
  state.status = "complete";
  state.winner = params.winner;
  state.turnNumber = 3;
  store.set(`cc-freeplay:${params.matchId}`, {
    matchId: params.matchId,
    rulesVersion: CHRONICLE_RULES_VERSION,
    p1Name,
    p2Name,
    state,
    status: "done",
    createdAt: now - 60_000,
    updatedAt: now,
    participation: {
      startedAt: now - 60_000,
      p1Actions: params.qualified === false ? 0 : 3,
      p2Actions: params.qualified === false ? 0 : 3,
      endedBy: params.qualified === false ? "forfeit" : "play",
    },
  });
}

test("Free-Play authenticates and rejects malformed or unknown match ids", async () => {
  store.clear();
  assert.equal(
    (await call({ action: "state", matchId: MATCH_ID }, false)).statusCode,
    401,
  );
  assert.equal(
    (await call({ action: "state", matchId: "../../save:admin" })).statusCode,
    400,
  );
  assert.equal(
    (await call({ action: "state", matchId: MATCH_ID })).statusCode,
    404,
  );
});

test("a valid current selection is persisted atomically before PvP uses it", async () => {
  store.clear();
  const savedDeck = CHRONICLE_AI_DECKS.hard;
  const selectedDeck = CHRONICLE_AI_DECKS.medium;
  store.set("save:selector", {
    character: {
      name: "selector",
      tileCards: [...savedDeck, ...selectedDeck],
      cardClashDeck: [...savedDeck],
    },
  });

  assert.deepEqual(await resolveDeck("selector", selectedDeck), selectedDeck);
  const saved = store.get("save:selector") as {
    character: { cardClashDeck: string[] };
  };
  assert.deepEqual(saved.character.cardClashDeck, selectedDeck);
});

test("Free-Play loads each persisted server deck and ignores a client replacement", async () => {
  store.clear();
  const alphaDeck = CHRONICLE_AI_DECKS.hard;
  const bravoDeck = CHRONICLE_AI_DECKS.medium;
  installPlayer("alpha", alphaDeck);
  installPlayer("bravo", bravoDeck);
  store.set(PAIR_KEY, {
    matchId: MATCH_ID,
    p1Name: "alpha",
    p2Name: "bravo",
    createdAt: Date.now(),
  });

  const alphaJoin = await call({
    action: "join",
    matchId: MATCH_ID,
    playerName: "alpha",
    deck: unownedReplacement(alphaDeck),
  });
  assert.equal(alphaJoin.statusCode, 200);
  assert.ok((alphaJoin.body as { _saveVersion: number })._saveVersion > 0);
  const waiting = store.get(SESSION_KEY) as { p1Deck: string[] };
  assert.deepEqual(waiting.p1Deck, alphaDeck);

  const bravoJoin = await call({
    action: "join",
    matchId: MATCH_ID,
    playerName: "bravo",
    deck: unownedReplacement(bravoDeck),
  });
  assert.equal(bravoJoin.statusCode, 200);

  const active = store.get(SESSION_KEY) as {
    p1Deck: string[];
    p2Deck: string[];
    state: {
      p1: { hand: string[]; deck: string[] };
      p2: { hand: string[]; deck: string[] };
    };
  };
  assert.deepEqual(active.p1Deck, alphaDeck);
  assert.deepEqual(active.p2Deck, bravoDeck);
  assert.deepEqual(
    [...active.state.p1.hand, ...active.state.p1.deck].sort(),
    [...alphaDeck].sort(),
  );
  assert.deepEqual(
    [...active.state.p2.hand, ...active.state.p2.deck].sort(),
    [...bravoDeck].sort(),
  );

  const projection = (bravoJoin.body as {
    session: { p1: { hand?: string[] }; p2: { hand?: string[] } };
  }).session;
  assert.equal(projection.p1.hand, undefined, "opponent hand stays private");
  assert.ok(projection.p2.hand?.length, "viewer receives only their own hand");

  // Pairing is only a short join handoff. The immutable participant names in
  // the established two-hour session must keep authorizing legitimate moves.
  store.delete(PAIR_KEY);
  const resumed = await call({
    action: "state",
    matchId: MATCH_ID,
    playerName: "alpha",
  });
  assert.equal(resumed.statusCode, 200);

  const outsider = await call({
    action: "state",
    matchId: MATCH_ID,
    playerName: "outsider",
  });
  assert.equal(outsider.statusCode, 403);
});

test("an immediate Free-Play forfeit settles but grants no Legacy progress", async () => {
  store.clear();
  installPlayer("alpha", CHRONICLE_AI_DECKS.hard);
  installPlayer("bravo", CHRONICLE_AI_DECKS.medium);
  store.set(PAIR_KEY, { matchId: MATCH_ID, p1Name: "alpha", p2Name: "bravo", createdAt: Date.now() });
  await call({ action: "join", matchId: MATCH_ID, playerName: "alpha", deck: CHRONICLE_AI_DECKS.hard });
  await call({ action: "join", matchId: MATCH_ID, playerName: "bravo", deck: CHRONICLE_AI_DECKS.medium });

  const forfeited = await call({ action: "forfeit", matchId: MATCH_ID, playerName: "bravo" });
  assert.equal(forfeited.statusCode, 200);
  const session = store.get(SESSION_KEY) as { state: { winner: string }; legacyCredit: { status: string; reason: string } };
  assert.equal(session.state.winner, "p1");
  assert.deepEqual(session.legacyCredit, {
    receiptId: `card-pvp:${MATCH_ID}`,
    winnerName: "alpha",
    targetName: "bravo",
    status: "skipped",
    reason: "participation",
  });
  assert.equal(store.get("legacy:stats:alpha"), undefined);
});

test("a sub-threshold natural finish remains progression-neutral", async () => {
  store.clear();
  installTerminalMatch({ matchId: MATCH_ID, winner: "p1" });
  const session = store.get(SESSION_KEY) as {
    updatedAt: number;
    participation: { startedAt: number; p1Actions: number; p2Actions: number; endedBy: string };
  };
  session.participation.startedAt = session.updatedAt - 44_999;
  store.set(SESSION_KEY, session);

  assert.equal((await call({ action: "state", matchId: MATCH_ID, playerName: "alpha" })).statusCode, 200);
  assert.deepEqual(
    (store.get(SESSION_KEY) as { legacyCredit: { status: string; reason: string } }).legacyCredit,
    {
      receiptId: `card-pvp:${MATCH_ID}`,
      winnerName: "alpha",
      targetName: "bravo",
      status: "skipped",
      reason: "participation",
    },
  );
  assert.equal(store.get("legacy:stats:alpha"), undefined);
});

test("qualifying sealed play grants one exact-once Legacy Card Clash win", async () => {
  store.clear();
  installTerminalMatch({ matchId: MATCH_ID, winner: "p1" });

  assert.equal((await call({ action: "state", matchId: MATCH_ID, playerName: "alpha" })).statusCode, 200);
  const granted = store.get("legacy:stats:alpha") as {
    cardClashWins?: number;
    repeatKills?: Record<string, number>;
  };
  assert.equal(granted.cardClashWins, 1);
  assert.equal(granted.repeatKills?.bravo, 1, "the opponent account drives anti-farm decay");
  assert.equal((store.get(SESSION_KEY) as { legacyCredit: { status: string } }).legacyCredit.status, "done");

  await call({ action: "state", matchId: MATCH_ID, playerName: "alpha" });
  assert.equal((store.get("legacy:stats:alpha") as { cardClashWins?: number }).cardClashWins, 1);
});

test("same-account repeat wins decay to zero after four credited legs", async () => {
  store.clear();
  const matchIds = [
    "31111111-1111-4111-8111-111111111111",
    "41111111-1111-4111-8111-111111111111",
    "51111111-1111-4111-8111-111111111111",
    "61111111-1111-4111-8111-111111111111",
    "71111111-1111-4111-8111-111111111111",
  ];
  for (const matchId of matchIds) {
    installTerminalMatch({ matchId, winner: "p1" });
    assert.equal((await call({ action: "state", matchId, playerName: "alpha" })).statusCode, 200);
  }
  const stats = store.get("legacy:stats:alpha") as {
    cardClashWins?: number;
    repeatKills?: Record<string, number>;
  };
  assert.equal(stats.cardClashWins, 2.75, "weights are 1, 1, .5, .25, then 0");
  assert.equal(stats.repeatKills?.bravo, 5);
});

test("a reciprocal repeat is progression-neutral", async () => {
  store.clear();
  const reverseId = "22222222-2222-4222-8222-222222222222";
  installTerminalMatch({ matchId: MATCH_ID, winner: "p1" });
  await call({ action: "state", matchId: MATCH_ID, playerName: "alpha" });
  installTerminalMatch({ matchId: reverseId, winner: "p2" });

  await call({ action: "state", matchId: reverseId, playerName: "bravo" });
  assert.equal((store.get(`cc-freeplay:${reverseId}`) as { legacyCredit: { status: string; reason: string } }).legacyCredit.status, "skipped");
  assert.equal((store.get(`cc-freeplay:${reverseId}`) as { legacyCredit: { reason: string } }).legacyCredit.reason, "reciprocal");
  assert.equal((store.get("legacy:stats:bravo") as { cardClashWins?: number } | undefined)?.cardClashWins ?? 0, 0);
});

test("a failed Legacy delivery is repaired by polling and remains exact-once", async () => {
  store.clear();
  installTerminalMatch({ matchId: MATCH_ID, winner: "p1" });
  failLegacyWrites = 1;

  const terminalPoll = await call({ action: "state", matchId: MATCH_ID, playerName: "alpha" });
  assert.equal(terminalPoll.statusCode, 200);
  assert.equal((store.get(SESSION_KEY) as { legacyCredit: { status: string } }).legacyCredit.status, "pending");
  assert.equal(store.get("legacy:stats:alpha"), undefined);

  await call({ action: "state", matchId: MATCH_ID, playerName: "alpha" });
  assert.equal((store.get(SESSION_KEY) as { legacyCredit: { status: string } }).legacyCredit.status, "done");
  assert.equal((store.get("legacy:stats:alpha") as { cardClashWins?: number }).cardClashWins, 1);
  await call({ action: "state", matchId: MATCH_ID, playerName: "bravo" });
  assert.equal((store.get("legacy:stats:alpha") as { cardClashWins?: number }).cardClashWins, 1);
});

test("Free-Play winner tracking has no external marker-before-write seam", () => {
  const source = readFileSync(resolve("api/card-clash/match.ts"), "utf8");
  assert.match(source, /persistTerminalAndRepair/);
  assert.doesNotMatch(source, /legacy:cc-tracked/);
});
