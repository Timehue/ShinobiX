import { before, test } from "node:test";
import assert from "node:assert/strict";

process.env.ADMIN_PASSWORD = "cc-queue-test-admin";
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
        ? { "x-admin-password": "cc-queue-test-admin" }
        : {}),
      "x-forwarded-for": "10.0.0.4",
    },
    socket: { remoteAddress: "10.0.0.4" },
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
let queue: Handler;

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
  kv.del = async (...keys: string[]) =>
    keys.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
  kv.delIfEqual = async (key: string, expected: string) => {
    if (store.get(key) !== expected) return false;
    store.delete(key);
    return true;
  };
  queue = (await import("./queue.js")).default as unknown as Handler;
});

async function call(body: unknown, authenticated = true) {
  const { res, out } = fakeRes();
  await queue(fakeReq(body, authenticated), res);
  return out;
}

test("Free-Play queue requires authentication and mints one shared participant pair", async () => {
  store.clear();
  assert.equal(
    (await call({ name: "alpha", action: "join" }, false)).statusCode,
    401,
  );
  assert.equal(
    (await call({ name: "alpha", action: "join" })).statusCode,
    200,
  );
  assert.equal(
    (await call({ name: "bravo", action: "join" })).statusCode,
    200,
  );

  const alphaPoll = await call({ name: "alpha", action: "poll" });
  assert.equal(alphaPoll.statusCode, 200);
  const alphaMatch = (alphaPoll.body as {
    match: { matchId: string; opponent: string; p1: boolean };
  }).match;
  assert.match(alphaMatch.matchId, /^[0-9a-f-]{36}$/i);
  assert.equal(alphaMatch.opponent, "bravo");
  assert.equal(alphaMatch.p1, true);

  const pair = store.get(`cc-pair:${alphaMatch.matchId}`) as {
    matchId: string;
    p1Name: string;
    p2Name: string;
    createdAt: number;
  };
  assert.equal(pair.matchId, alphaMatch.matchId);
  assert.equal(pair.p1Name, "alpha");
  assert.equal(pair.p2Name, "bravo");
  assert.ok(pair.createdAt > 0);

  const bravoPoll = await call({ name: "bravo", action: "poll" });
  const bravoMatch = (bravoPoll.body as {
    match: { matchId: string; opponent: string; p1: boolean };
  }).match;
  assert.equal(bravoMatch.matchId, alphaMatch.matchId);
  assert.equal(bravoMatch.opponent, "alpha");
  assert.equal(bravoMatch.p1, false);
});

test("leave removes an unmatched player immediately", async () => {
  store.clear();
  await call({ name: "alpha", action: "join" });

  const left = await call({ name: "alpha", action: "leave" });
  assert.equal(left.statusCode, 200);
  assert.deepEqual(left.body, {
    inQueue: false,
    queueSize: 0,
    match: null,
    reason: "left",
  });

  const poll = await call({ name: "alpha", action: "poll" });
  assert.equal((poll.body as { inQueue: boolean }).inQueue, false);
  assert.equal((poll.body as { reason: string }).reason, "not-queued");
});

test("leave racing a completed pairing cancels both durable handoffs", async () => {
  store.clear();
  await call({ name: "alpha", action: "join" });
  await call({ name: "bravo", action: "join" });
  const paired = await call({ name: "alpha", action: "poll" });
  const matchId = (paired.body as { match: { matchId: string } }).match.matchId;

  const canceled = await call({ name: "bravo", action: "leave" });
  assert.equal(canceled.statusCode, 200);
  assert.equal((canceled.body as { canceledMatchId?: string }).canceledMatchId, matchId);
  assert.equal(store.has(`card-clash:queue:match:alpha`), false);
  assert.equal(store.has(`card-clash:queue:match:bravo`), false);
  assert.equal(store.has(`cc-pair:${matchId}`), false);

  const alphaPoll = await call({ name: "alpha", action: "poll" });
  assert.equal((alphaPoll.body as { match: unknown }).match, null);
  assert.equal((alphaPoll.body as { reason: string }).reason, "not-queued");
});

test("poll reports an expired lease instead of pretending the player is still queued", async () => {
  store.clear();
  store.set("card-clash:queue", [{
    name: "alpha",
    level: 1,
    joinedAt: Date.now() - 61_000,
    lastSeen: Date.now() - 61_000,
  }]);

  const poll = await call({ name: "alpha", action: "poll" });
  assert.equal(poll.statusCode, 200);
  assert.deepEqual(poll.body, {
    inQueue: false,
    queueSize: 0,
    match: null,
    reason: "not-queued",
  });
});

test("concurrent opposite-side polls converge on one pair without orphaning either handoff", async () => {
  store.clear();
  await call({ name: "alpha", action: "join" });
  await call({ name: "bravo", action: "join" });

  const [alphaPoll, bravoPoll] = await Promise.all([
    call({ name: "alpha", action: "poll" }),
    call({ name: "bravo", action: "poll" }),
  ]);
  assert.equal(alphaPoll.statusCode, 200);
  assert.equal(bravoPoll.statusCode, 200);
  const alphaMatch = (alphaPoll.body as { match: { matchId: string } }).match;
  const bravoMatch = (bravoPoll.body as { match: { matchId: string } }).match;
  assert.equal(alphaMatch.matchId, bravoMatch.matchId);

  const pairKeys = [...store.keys()].filter((key) => key.startsWith("cc-pair:"));
  assert.deepEqual(pairKeys, [`cc-pair:${alphaMatch.matchId}`]);
  assert.equal(
    (store.get("card-clash:queue:match:alpha") as { matchId?: string })?.matchId,
    alphaMatch.matchId,
  );
  assert.equal(
    (store.get("card-clash:queue:match:bravo") as { matchId?: string })?.matchId,
    alphaMatch.matchId,
  );
  assert.deepEqual(store.get("card-clash:queue"), []);
});

test("pairing fails closed under a held storage lock and leaves the whole handoff untouched", async () => {
  store.clear();
  const queued = [
    { name: "alpha", level: 20, joinedAt: Date.now(), lastSeen: Date.now() },
    { name: "bravo", level: 20, joinedAt: Date.now(), lastSeen: Date.now() },
  ];
  store.set("card-clash:queue", queued);
  store.set("lock:card-clash:queue", "other-worker");

  const blocked = await call({ name: "alpha", action: "poll" });
  assert.equal(blocked.statusCode, 503);
  assert.match(String((blocked.body as { error?: string }).error), /busy/i);
  assert.deepEqual(store.get("card-clash:queue"), queued, "neither queued participant may be consumed");
  assert.equal(store.has("card-clash:queue:match:alpha"), false);
  assert.equal(store.has("card-clash:queue:match:bravo"), false);
  assert.deepEqual(
    [...store.keys()].filter((key) => key.startsWith("cc-pair:")),
    [],
    "no shared proof may exist without both handoffs",
  );

  store.delete("lock:card-clash:queue");
  const recovered = await call({ name: "alpha", action: "poll" });
  assert.equal(recovered.statusCode, 200);
  assert.ok((recovered.body as { match?: { matchId?: string } }).match?.matchId);
});
