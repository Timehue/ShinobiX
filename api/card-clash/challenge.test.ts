import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.SHINOBIX_QA_MEMORY_KV = "1";
process.env.SESSION_SECRET = "card-spar-challenge-test-secret-32-bytes";

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const ALICE = "sparalice";
const BOB = "sparbob";
let kv: typeof import("../_storage.js").kv;
let issuePlayerToken: typeof import("../_auth.js").issuePlayerToken;
let challenge: Handler;
let queue: Handler;

before(async () => {
  ({ kv } = await import("../_storage.js"));
  ({ issuePlayerToken } = await import("../_auth.js"));
  challenge = (await import("./challenge.js")).default as unknown as Handler;
  queue = (await import("./queue.js")).default as unknown as Handler;
});

beforeEach(async () => {
  const keys = await kv.keys("*");
  if (keys.length) await kv.del(...keys);
  await kv.set(`save:${ALICE}`, { character: { name: "Spar Alice", starterCardsClaimed: true } });
  await kv.set(`save:${BOB}`, { character: { name: "Spar Bob", starterCardsClaimed: true } });
});

after(async () => {
  const keys = await kv.keys("*");
  if (keys.length) await kv.del(...keys);
  delete process.env.SHINOBIX_QA_MEMORY_KV;
  delete process.env.SESSION_SECRET;
});

function response() {
  const out: Out = { statusCode: 200 };
  const res = {
    setHeader: () => res,
    status: (statusCode: number) => { out.statusCode = statusCode; return res; },
    json: (body: Record<string, unknown>) => { out.body = body; return res; },
    end: () => res,
  };
  return { out, res: res as never };
}

async function call(handler: Handler, name: string, body: Record<string, unknown>, authenticated = true): Promise<Out> {
  const { out, res } = response();
  await handler({
    method: "POST",
    body: { name, ...body },
    headers: authenticated ? { "x-player-name": name, "x-player-token": issuePlayerToken(name) ?? "" } : {},
    socket: { remoteAddress: "127.0.0.1" },
  } as never, res);
  return out;
}

test("accepted name-targeted spar is private, authenticated, and enters the normal card match flow", async () => {
  assert.equal((await call(challenge, ALICE, { action: "request", targetName: "Spar Bob" }, false)).statusCode, 401);

  await kv.set("card-clash:queue", [
    { name: ALICE, level: 20, joinedAt: Date.now(), lastSeen: Date.now() },
    { name: BOB, level: 21, joinedAt: Date.now(), lastSeen: Date.now() },
  ]);
  const requested = await call(challenge, ALICE, { action: "request", targetName: "Spar Bob" });
  assert.equal(requested.statusCode, 200, JSON.stringify(requested.body));
  const id = (requested.body?.challenge as { id?: string } | undefined)?.id;
  assert.match(id ?? "", /^[0-9a-f-]{36}$/i);

  const inbox = await call(challenge, BOB, { action: "inbox" });
  assert.equal(inbox.statusCode, 200);
  assert.deepEqual((inbox.body?.challenges as Array<Record<string, unknown>>).map(({ fromName }) => fromName), ["Spar Alice"]);

  const accepted = await call(challenge, BOB, { action: "respond", challengeId: id, decision: "accept" });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  const matchId = accepted.body?.matchId as string;
  assert.match(matchId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(await kv.get("card-clash:queue"), [], "accepted players are removed from random matchmaking");
  assert.ok(await kv.get(`cc-pair:${matchId}`));

  const aliceMatch = await call(queue, ALICE, { action: "poll" });
  const bobMatch = await call(queue, BOB, { action: "poll" });
  assert.equal((aliceMatch.body?.match as { matchId?: string })?.matchId, matchId);
  assert.equal((bobMatch.body?.match as { matchId?: string })?.matchId, matchId);
  assert.equal((await call(challenge, ALICE, { action: "status", challengeId: id })).body?.status, "accepted");
});
