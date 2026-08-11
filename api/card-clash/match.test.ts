import { before, test } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { CHRONICLE_AI_DECKS } from "./_ai-engine.js";
import {
  CHRONICLE_CARD_CATALOG,
  CHRONICLE_STARTER_CORE_IDS,
} from "../../shared/chronicle-duel.js";

process.env.ADMIN_PASSWORD = "cc-match-test-admin";
process.env.SUPABASE_URL ??= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ??= "x";

const store = new Map<string, unknown>();
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
