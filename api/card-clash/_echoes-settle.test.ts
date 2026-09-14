/* Echoes of War settlement integration: drives the REAL ai-start + ai-move
 * handlers over a fake KV, seals a campaign session, then forces terminal
 * states to prove the Chronicle Point payout is server-computed, single-pay,
 * and inert for losses, forfeits, and sub-minimum-duration wins. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import {
  CHRONICLE_FIXED_FALLBACK_DECK,
  CHRONICLE_RULES_VERSION,
} from "../../shared/chronicle-duel.js";
import { ECHOES_REWARDS, echoesEncounterById } from "./_echoes-catalog.js";

process.env.ADMIN_PASSWORD = "echoes-test-admin";
process.env.SUPABASE_URL ??= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ??= "x";
process.env.ENABLE_LEGACY = "1";

const store = new Map<string, unknown>();
const clone = (value: unknown) =>
  value === undefined || value === null ? null : structuredClone(value);
function fakeReq(body: unknown) {
  return {
    method: "POST",
    query: {},
    body,
    headers: {
      "x-admin-password": "echoes-test-admin",
      "x-forwarded-for": "10.0.0.9",
    },
    socket: { remoteAddress: "10.0.0.9" },
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
let echoesWitness: Handler;

before(async () => {
  const kv = (await import("../_storage.js")).kv as unknown as Record<string, unknown>;
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
  echoesWitness = (await import("./echoes-witness.js")).default as unknown as Handler;
});

async function call(handler: Handler, body: unknown) {
  const { res, out } = fakeRes();
  await handler(fakeReq(body), res);
  return out;
}

function seedPlayer(name: string, extra: Record<string, unknown> = {}) {
  store.set(`save:${name}`, {
    character: {
      name,
      ryo: 0,
      tileCards: [...CHRONICLE_FIXED_FALLBACK_DECK],
      cardClashDeck: [...CHRONICLE_FIXED_FALLBACK_DECK],
      ...extra,
    },
  });
}

function character(name: string): Record<string, unknown> {
  return (store.get(`save:${name}`) as { character: Record<string, unknown> }).character;
}

type StoredSession = {
  createdAt: number;
  echoes?: { encounterId: string };
  status: string;
  winner?: string;
  state: { status: string; winner?: string; p2: { name: string }; rulesVersion: number; events?: Array<Record<string, unknown>> };
};

async function startEchoes(playerName: string, encounterId: string): Promise<{ matchId: string; session: StoredSession }> {
  const started = await call(aiStart, { playerName, deck: [], echoes: { encounterId } });
  assert.equal(started.statusCode, 200, JSON.stringify(started.body));
  const matchId = (started.body as { matchId: string }).matchId;
  const session = store.get(`cc-ai:${matchId}`) as StoredSession;
  return { matchId, session };
}

function forceTerminal(matchId: string, winner: "p1" | "p2", options: { quick?: boolean } = {}) {
  const session = store.get(`cc-ai:${matchId}`) as StoredSession;
  session.state.status = "complete";
  session.state.winner = winner;
  // Sub-minimum-duration wins are suppressed; back-date normal ones.
  session.createdAt = options.quick ? Date.now() : Date.now() - 120_000;
  store.set(`cc-ai:${matchId}`, session);
}

test("ai-start seals the encounter: fixed opponent name, deck label, and session binding", async () => {
  store.clear();
  seedPlayer("echo");
  const { session, matchId } = await startEchoes("echo", "echoes-1-tovin");
  assert.equal(session.echoes?.encounterId, "echoes-1-tovin");
  assert.equal(session.state.p2.name, "Tovin");
  const projected = (await call(aiMove, { matchId, action: "state" })).body as {
    session: { aiDeckName: string; aiDifficulty: string };
  };
  assert.equal(projected.session.aiDeckName, "The Unrung Bell");
  assert.equal(projected.session.aiDifficulty, "easy");
});

test("an unknown encounter id is refused outright", async () => {
  store.clear();
  seedPlayer("echo");
  const started = await call(aiStart, { playerName: "echo", deck: [], echoes: { encounterId: "echoes-99-nobody" } });
  assert.equal(started.statusCode, 400);
});

test("an Echoes duel cannot also carry a Dungeon seal", async () => {
  store.clear();
  seedPlayer("echo");
  const started = await call(aiStart, {
    playerName: "echo",
    deck: [],
    echoes: { encounterId: "echoes-1-tovin" },
    dungeon: { token: "sometoken12345" },
  });
  assert.equal(started.statusCode, 400);
});

test("a first-clear win pays 50 Chronicle Points, records the clear, and never pays twice", async () => {
  store.clear();
  seedPlayer("echo");
  const { matchId } = await startEchoes("echo", "echoes-1-tovin");
  const session = store.get(`cc-ai:${matchId}`) as StoredSession;
  session.state.events = [{ id: "observed", kind: "trap-activated", turnNumber: 2, at: 1, actor: "p1", cardId: "chronicle-smoke-bomb" }];
  store.set(`cc-ai:${matchId}`, session);
  forceTerminal(matchId, "p1");
  const settled = await call(aiMove, { matchId, action: "state" });
  assert.equal(settled.statusCode, 200);
  const body = settled.body as {
    reward: { echoes?: { points: number; firstClear: boolean; balance: number; unlockedFloor: number | null; battleBeat: string } };
    character: Record<string, unknown>;
    _saveVersion: number;
  };
  assert.equal(body.reward.echoes?.points, ECHOES_REWARDS.repeatWin + ECHOES_REWARDS.firstClearBonus);
  assert.equal(body.reward.echoes?.firstClear, true);
  assert.equal(body.reward.echoes?.balance, 50);
  assert.equal(body.reward.echoes?.unlockedFloor, 2);
  assert.equal(body.reward.echoes?.battleBeat, "denied-attack");
  assert.equal(character("echo").chroniclePoints, 50);
  const record = character("echo").echoesOfWar as Record<string, { wins: number; firstClearBattleBeat?: string }>;
  assert.equal(record["echoes-1-tovin"].wins, 1);
  assert.equal(record["echoes-1-tovin"].firstClearBattleBeat, "denied-attack");

  // A duplicate settle request replays the recorded receipt without paying.
  const replay = await call(aiMove, { matchId, action: "state" });
  assert.equal(replay.statusCode, 200);
  const replayBody = replay.body as { reward: { echoes?: { points: number; battleBeat: string } } };
  assert.equal(replayBody.reward.echoes?.points, 50);
  assert.equal(replayBody.reward.echoes?.battleBeat, "denied-attack", "lost responses replay the sealed callback receipt");
  assert.equal(character("echo").chroniclePoints, 50, "no double pay");
  assert.equal((character("echo").echoesOfWar as Record<string, { wins: number }>)["echoes-1-tovin"].wins, 1);
});

test("the witness API seals an eligible answer and conflicting retries return the first", async () => {
  store.clear();
  seedPlayer("echo", { echoesOfWar: { "echoes-3-aya": { wins: 1, firstClearAt: 10 } } });
  const first = await call(echoesWitness, { playerName: "echo", eraId: "echoes-age-1", choiceId: "warnings-first" });
  assert.equal(first.statusCode, 200);
  assert.equal((first.body as { choiceId: string }).choiceId, "warnings-first");
  assert.deepEqual(character("echo").echoesWitnessChoices, { "echoes-age-1": "warnings-first" });

  const retry = await call(echoesWitness, { playerName: "echo", eraId: "echoes-age-1", choiceId: "names-first" });
  assert.equal(retry.statusCode, 200);
  assert.equal((retry.body as { choiceId: string; alreadySealed: boolean }).choiceId, "warnings-first");
  assert.equal((retry.body as { alreadySealed: boolean }).alreadySealed, true);
  assert.deepEqual(character("echo").echoesWitnessChoices, { "echoes-age-1": "warnings-first" });
});

test("a repeat win pays 15 and the boss first clear pays 100", async () => {
  store.clear();
  seedPlayer("echo", {
    chroniclePoints: 50,
    echoesOfWar: { "echoes-1-tovin": { wins: 1, firstClearAt: 111 } },
  });
  const { matchId } = await startEchoes("echo", "echoes-1-tovin");
  forceTerminal(matchId, "p1");
  const repeat = (await call(aiMove, { matchId, action: "state" })).body as {
    reward: { echoes?: { points: number; balance: number } };
  };
  assert.equal(repeat.reward.echoes?.points, ECHOES_REWARDS.repeatWin);
  assert.equal(character("echo").chroniclePoints, 65);

  // Boss floor (admin identity bypasses the floor gate, the payout does not care).
  const boss = await startEchoes("echo", "echoes-10-halden");
  forceTerminal(boss.matchId, "p1");
  const bossBody = (await call(aiMove, { matchId: boss.matchId, action: "state" })).body as {
    reward: { echoes?: { points: number; bossBonus: number; unlockedFloor: number | null } };
  };
  assert.equal(bossBody.reward.echoes?.points, 100);
  assert.equal(bossBody.reward.echoes?.bossBonus, ECHOES_REWARDS.bossFirstClearBonus);
  assert.equal(bossBody.reward.echoes?.unlockedFloor, null);
  assert.equal(character("echo").chroniclePoints, 165);
});

test("a loss settles with zero Chronicle Points and no progression", async () => {
  store.clear();
  seedPlayer("echo");
  const { matchId } = await startEchoes("echo", "echoes-1-tovin");
  forceTerminal(matchId, "p2");
  const settled = (await call(aiMove, { matchId, action: "state" })).body as {
    reward: { echoes?: unknown; result: string };
  };
  assert.equal(settled.reward.result, "opponent");
  assert.equal(settled.reward.echoes, undefined);
  assert.equal(character("echo").chroniclePoints ?? 0, 0);
  assert.equal(character("echo").echoesOfWar, undefined);
});

test("a forfeit settles as a zero-value receipt with no campaign credit", async () => {
  store.clear();
  seedPlayer("echo");
  const { matchId } = await startEchoes("echo", "echoes-1-tovin");
  const settled = (await call(aiMove, { matchId, action: "forfeit" })).body as {
    reward?: { echoes?: unknown; forfeited?: boolean };
  };
  assert.equal(settled.reward?.forfeited, true);
  assert.equal(settled.reward?.echoes, undefined);
  assert.equal(character("echo").chroniclePoints ?? 0, 0);
  assert.equal(character("echo").echoesOfWar, undefined);
});

test("a sub-minimum-duration win is suppressed: no points, no floor unlock", async () => {
  store.clear();
  seedPlayer("echo");
  const { matchId } = await startEchoes("echo", "echoes-1-tovin");
  forceTerminal(matchId, "p1", { quick: true });
  const settled = (await call(aiMove, { matchId, action: "state" })).body as {
    reward: { echoes?: unknown; result: string; ryo: number };
  };
  assert.equal(settled.reward.result, "player");
  assert.equal(settled.reward.echoes, undefined);
  assert.equal(character("echo").chroniclePoints ?? 0, 0);
  assert.equal(character("echo").echoesOfWar, undefined);
});

test("the encounter table is what pays, not anything client-shaped", () => {
  // The settle path reads session.echoes.encounterId (sealed at start) and the
  // server table. This asserts the table lookup used at settle time resolves
  // exactly the sealed id, so no request body field can influence amounts.
  const def = echoesEncounterById("echoes-10-halden");
  assert.ok(def?.isBoss);
  assert.equal(echoesEncounterById("echoes-10-halden-forged"), null);
});
