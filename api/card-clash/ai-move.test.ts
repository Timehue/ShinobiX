import { test, before } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import {
  CHRONICLE_FIXED_FALLBACK_DECK,
  CHRONICLE_RULES_VERSION,
  CHRONICLE_STARTER_GRANT_IDS,
  countChronicleCards,
  deckLimitForCard,
} from "../../shared/chronicle-duel.js";

process.env.ADMIN_PASSWORD = "cc-ai-test-admin";
process.env.SUPABASE_URL ??= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ??= "x";

const store = new Map<string, unknown>();
const clone = (value: unknown) =>
  value === undefined || value === null ? null : structuredClone(value);
function fakeReq(body: unknown) {
  return {
    method: "POST",
    query: {},
    body,
    headers: {
      "x-admin-password": "cc-ai-test-admin",
      "x-forwarded-for": "10.0.0.2",
    },
    socket: { remoteAddress: "10.0.0.2" },
  } as never;
}
function fakeRes() {
  const out = { statusCode: 200, body: undefined as never };
  const res = {
    setHeader: () => res,
    status: (code: number) => {
      out.statusCode = code;
      return res;
    },
    json: (body: unknown) => {
      out.body = body as never;
      return res;
    },
    end: () => res,
  };
  return { res: res as never, out };
}
type Handler = (req: never, res: never) => Promise<unknown>;
let aiStart: Handler;
let aiMove: Handler;

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
  aiStart = (await import("./ai-start.js")).default as unknown as Handler;
  aiMove = (await import("./ai-move.js")).default as unknown as Handler;
});

async function call(handler: Handler, body: unknown) {
  const { res, out } = fakeRes();
  await handler(fakeReq(body), res);
  return out;
}
function character(name: string): Record<string, unknown> {
  return (store.get(`save:${name}`) as { character: Record<string, unknown> })
    .character;
}

test("AI start grants starter utility once and creates current rules state", async () => {
  store.clear();
  store.set("save:starter", {
    character: { name: "Starter", ryo: 0, tileCards: [] },
  });
  const started = await call(aiStart, {
    playerName: "starter",
    difficulty: "easy",
    deck: [],
  });
  assert.equal(started.statusCode, 200);
  const body = started.body as {
    _saveVersion: number;
    session: {
      rulesVersion: number;
      aiDifficulty: string;
      aiDeckName: string;
      p1: { handCount: number };
    };
  };
  assert.ok(body._saveVersion > 0);
  assert.equal(body.session.rulesVersion, CHRONICLE_RULES_VERSION);
  assert.equal(body.session.aiDifficulty, "easy");
  assert.equal(body.session.aiDeckName, "Academy Practice");
  assert.ok(body.session.p1.handCount >= 5 && body.session.p1.handCount <= 6);
  const owned = character("starter").tileCards as string[];
  assert.ok(owned.includes("chronicle-smoke-bomb"));
  assert.deepEqual(owned, CHRONICLE_STARTER_GRANT_IDS);
  assert.ok(new Set(owned).size < owned.length, "starter grant includes useful physical duplicates");
  for (const [id, copies] of countChronicleCards(owned))
    assert.ok(copies <= deckLimitForCard(id), `${id} starter copies must remain legal`);
});

test("forfeit settles the server-computed loss once", async () => {
  store.clear();
  store.set("save:quit", {
    character: {
      name: "Quit",
      ryo: 0,
      tileCards: CHRONICLE_FIXED_FALLBACK_DECK,
    },
  });
  const started = await call(aiStart, {
    playerName: "quit",
    difficulty: "medium",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
  });
  const matchId = (started.body as { matchId: string }).matchId;
  const first = await call(aiMove, { matchId, action: "forfeit" });
  assert.equal(first.statusCode, 200);
  assert.equal(
    (first.body as { reward: { result: string; ryo: number } }).reward.result,
    "opponent",
  );
  assert.equal(
    (first.body as { reward: { result: string; ryo: number } }).reward.ryo,
    5,
  );
  assert.equal(character("quit").ryo, 5);
  const replay = await call(aiMove, { matchId, action: "forfeit" });
  assert.equal(replay.statusCode, 200);
  assert.equal(character("quit").ryo, 5, "terminal replay cannot pay twice");
});

test("external encounter stakes never mint Card Hall rewards or counters", async () => {
  store.clear();
  store.set("save:seal", {
    character: {
      name: "Seal",
      ryo: 9,
      cardClashLosses: 2,
      tileCards: CHRONICLE_FIXED_FALLBACK_DECK,
    },
  });
  const started = await call(aiStart, {
    playerName: "seal",
    difficulty: "hard",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
    externalStakes: true,
  });
  const matchId = (started.body as { matchId: string }).matchId;
  const ended = await call(aiMove, { matchId, action: "forfeit" });
  assert.equal(ended.statusCode, 200);
  assert.equal((ended.body as { reward?: unknown }).reward, undefined);
  assert.equal(character("seal").ryo, 9);
  assert.equal(character("seal").cardClashLosses, 2);
});

test("unknown and retired action vocabulary is rejected", async () => {
  store.clear();
  store.set("save:rules", {
    character: {
      name: "Rules",
      ryo: 0,
      tileCards: CHRONICLE_FIXED_FALLBACK_DECK,
    },
  });
  const started = await call(aiStart, {
    playerName: "rules",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
  });
  const matchId = (started.body as { matchId: string }).matchId;
  assert.equal(
    (await call(aiMove, { matchId, action: "commit-turn" })).statusCode,
    400,
  );
  assert.equal(
    (await call(aiMove, { matchId, action: "play", locationIndex: 0 }))
      .statusCode,
    400,
  );
});
