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
import { dungeonCardMatchId } from "../dungeon/_encounter-proof.js";

process.env.ADMIN_PASSWORD = "cc-ai-test-admin";
process.env.SUPABASE_URL ??= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ??= "x";
process.env.ENABLE_LEGACY = "1";

const store = new Map<string, unknown>();
let failLegacyWrites = 0;
let failCardSessionWrites = 0;
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
    if (key.startsWith("legacy:stats:") && failLegacyWrites > 0) {
      failLegacyWrites -= 1;
      throw new Error("injected AI Legacy write outage");
    }
    if (key.startsWith("cc-ai:") && failCardSessionWrites > 0) {
      failCardSessionWrites -= 1;
      throw new Error("injected Chronicle session write outage");
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

function dungeonCharacter(name: string, token: string): Record<string, unknown> {
  return {
    name,
    ryo: 0,
    tileCards: CHRONICLE_FIXED_FALLBACK_DECK,
    cardClashDeck: CHRONICLE_FIXED_FALLBACK_DECK,
    activeDungeonRun: {
      token,
      combatAuthorityVersion: 1,
      wardenDefeated: true,
      wardenProofId: "wardenproof123",
    },
  };
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

test("immediate forfeit commits one durable zero-value receipt without economy or progression credit", async () => {
  store.clear();
  store.set("save:quit", {
    character: {
      name: "Quit",
      ryo: 17,
      cardClashWins: 3,
      cardClashLosses: 4,
      cardClashDraws: 2,
      tileCards: CHRONICLE_FIXED_FALLBACK_DECK,
    },
  });
  const started = await call(aiStart, {
    playerName: "quit",
    difficulty: "medium",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
  });
  const matchId = (started.body as { matchId: string }).matchId;
  const sessionKey = `cc-ai:${matchId}`;
  const activeSession = structuredClone(store.get(sessionKey));
  const first = await call(aiMove, { matchId, action: "forfeit" });
  assert.equal(first.statusCode, 200);
  assert.equal(
    (first.body as { reward: { result: string; ryo: number } }).reward.result,
    "opponent",
  );
  assert.equal(
    (first.body as { reward: { result: string; ryo: number; forfeited?: boolean } }).reward.ryo,
    0,
  );
  assert.equal(
    (first.body as { reward: { forfeited?: boolean } }).reward.forfeited,
    true,
  );
  const afterFirst = character("quit");
  assert.equal(afterFirst.ryo, 17);
  assert.equal(afterFirst.cardClashWins, 3);
  assert.equal(afterFirst.cardClashLosses, 4);
  assert.equal(afterFirst.cardClashDraws, 2);
  assert.equal(store.get("legacy:stats:quit"), undefined);
  assert.equal(
    (afterFirst.redeemedCardClashAiSessions as unknown[]).length,
    1,
    "the neutral surrender still needs a durable response-loss receipt",
  );
  const committedSave = structuredClone(store.get("save:quit"));

  // Model a process dying after the save receipt committed but before the
  // terminal session marker landed. Replaying the surrender must discover the
  // in-save receipt, repair the session, and leave the save byte-for-byte alone.
  store.set(sessionKey, activeSession);
  const crashRecovery = await call(aiMove, { matchId, action: "forfeit" });
  assert.equal(crashRecovery.statusCode, 200);
  assert.deepEqual(store.get("save:quit"), committedSave, "receipt recovery cannot version-bump the save");

  const replay = await call(aiMove, { matchId, action: "forfeit" });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(store.get("save:quit"), committedSave, "terminal replay cannot rewrite or progress the save");
  assert.equal(character("quit").ryo, 17, "terminal replay cannot pay");
});

test("lost terminal responses reconcile from action and state replays", async () => {
  store.clear();
  store.set("save:reconcile", {
    character: {
      name: "Reconcile",
      ryo: 0,
      tileCards: CHRONICLE_FIXED_FALLBACK_DECK,
    },
  });
  const started = await call(aiStart, {
    playerName: "reconcile",
    difficulty: "medium",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
  });
  const matchId = (started.body as { matchId: string }).matchId;

  // Treat this successful response as lost after the server committed it.
  const terminal = await call(aiMove, { matchId, action: "forfeit" });
  assert.equal(terminal.statusCode, 200);
  const authoritative = store.get("save:reconcile") as {
    character: Record<string, unknown>;
    _saveVersion: number;
  };

  const stateReplay = await call(aiMove, { matchId, action: "state" });
  assert.equal(stateReplay.statusCode, 200);
  assert.deepEqual(
    (stateReplay.body as { character: Record<string, unknown> }).character,
    authoritative.character,
  );
  assert.equal(
    (stateReplay.body as { _saveVersion: number })._saveVersion,
    authoritative._saveVersion,
  );

  const actionReplay = await call(aiMove, { matchId, action: "forfeit" });
  assert.equal(actionReplay.statusCode, 200);
  assert.deepEqual(
    (actionReplay.body as { character: Record<string, unknown> }).character,
    authoritative.character,
  );
  assert.equal(
    (actionReplay.body as { _saveVersion: number })._saveVersion,
    authoritative._saveVersion,
  );
  assert.equal(character("reconcile").ryo, 0, "reconciliation cannot turn a surrendered receipt into payment");
  assert.equal(
    (character("reconcile").redeemedCardClashAiSessions as unknown[]).length,
    1,
    "state/action replay uses the one committed neutral receipt",
  );
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

test("AI terminal Legacy credit repairs on a later state poll exactly once", async () => {
  store.clear();
  store.set("save:repair", {
    character: { name: "Repair", ryo: 0, tileCards: CHRONICLE_FIXED_FALLBACK_DECK },
  });
  const started = await call(aiStart, {
    playerName: "repair",
    difficulty: "medium",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
  });
  const matchId = (started.body as { matchId: string }).matchId;
  const key = `cc-ai:${matchId}`;
  const session = store.get(key) as {
    createdAt: number;
    state: { status: string; winner: string | null };
    status: string;
    winner?: string;
    settledAt?: number;
    settledReward?: { result: string; ryo: number; dailyBonus: boolean };
    legacyCredit?: { receiptId: string; status: string };
  };
  session.state.status = "complete";
  session.state.winner = "p1";
  session.status = "done";
  session.winner = "player";
  session.settledAt = session.createdAt + 20_000;
  session.settledReward = { result: "player", ryo: 0, dailyBonus: false };
  session.legacyCredit = { receiptId: `card-ai:${key}`, status: "pending" };
  store.set(key, session);
  failLegacyWrites = 1;

  assert.equal((await call(aiMove, { matchId, action: "state" })).statusCode, 503);
  assert.equal((store.get(key) as { legacyCredit: { status: string } }).legacyCredit.status, "pending");
  assert.equal(store.get("legacy:stats:repair"), undefined);

  await call(aiMove, { matchId, action: "state" });
  assert.equal((store.get(key) as { legacyCredit: { status: string } }).legacyCredit.status, "done");
  assert.equal((store.get("legacy:stats:repair") as { cardClashWins?: number }).cardClashWins, 1);
  await call(aiMove, { matchId, action: "state" });
  assert.equal((store.get("legacy:stats:repair") as { cardClashWins?: number }).cardClashWins, 1);
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

test("Dungeon Card starts bind one deterministic medium external session under concurrency", async () => {
  store.clear();
  failCardSessionWrites = 0;
  const token = "dungeonrun_card_001";
  store.set("save:dungeonstart", {
    _saveVersion: 4,
    character: dungeonCharacter("DungeonStart", token),
  });
  const request = {
    playerName: "dungeonstart",
    difficulty: "hard",
    externalStakes: false,
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
    dungeon: { token },
  };
  const [first, duplicate] = await Promise.all([
    call(aiStart, request),
    call(aiStart, request),
  ]);
  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  const expectedMatchId = dungeonCardMatchId("dungeonstart", token);
  assert.equal((first.body as { matchId: string }).matchId, expectedMatchId);
  assert.equal((duplicate.body as { matchId: string }).matchId, expectedMatchId);
  const session = store.get(`cc-ai:${expectedMatchId}`) as {
    difficulty: string;
    settlementMode: string;
    dungeonRunToken?: string;
    dungeonAuthorityVersion?: number;
  };
  assert.equal(session.difficulty, "medium", "Dungeon difficulty is server-owned");
  assert.equal(session.settlementMode, "external");
  assert.equal(session.dungeonRunToken, token);
  assert.equal(session.dungeonAuthorityVersion, 1);
  assert.equal(
    (store.get("save:dungeonstart") as { _saveVersion: number })._saveVersion,
    5,
    "the duplicate start validates read-only instead of rewriting the save",
  );
  assert.equal(
    [...store.keys()].filter((key) => key.startsWith("cc-ai:")).length,
    1,
  );
});

test("Dungeon Card replaces an unproved deterministic session after a rules upgrade", async () => {
  store.clear();
  const token = "dungeonrun_card_rules_01";
  store.set("save:dungeonrules", {
    _saveVersion: 2,
    character: dungeonCharacter("DungeonRules", token),
  });
  const request = {
    playerName: "dungeonrules",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
    dungeon: { token },
  };
  const started = await call(aiStart, request);
  assert.equal(started.statusCode, 200);
  const matchId = dungeonCardMatchId("dungeonrules", token);
  const key = `cc-ai:${matchId}`;
  const retired = structuredClone(store.get(key)) as {
    rulesVersion: number;
    state: { rulesVersion: number };
    createdAt: number;
  };
  retired.rulesVersion = CHRONICLE_RULES_VERSION - 1;
  retired.state.rulesVersion = CHRONICLE_RULES_VERSION - 1;
  const retiredCreatedAt = retired.createdAt;
  store.set(key, retired);

  const resumed = await call(aiStart, request);
  assert.equal(resumed.statusCode, 200);
  assert.equal(
    (resumed.body as { resumedWithCurrentRules?: boolean }).resumedWithCurrentRules,
    true,
  );
  const current = store.get(key) as {
    rulesVersion: number;
    state: { rulesVersion: number };
    createdAt: number;
    dungeonRunToken?: string;
  };
  assert.equal(current.rulesVersion, CHRONICLE_RULES_VERSION);
  assert.equal(current.state.rulesVersion, CHRONICLE_RULES_VERSION);
  assert.equal(current.dungeonRunToken, token);
  assert.ok(current.createdAt >= retiredCreatedAt);
  assert.equal(
    [...store.keys()].filter((candidate) => candidate.startsWith("cc-ai:")).length,
    1,
  );

  const actionable = await call(aiMove, { matchId, action: "state" });
  assert.equal(actionable.statusCode, 200, "the replacement no longer dead-ends on retired rules");
});

test("Dungeon Card preserves a committed terminal proof across a rules upgrade", async () => {
  store.clear();
  const token = "dungeonrun_card_rules_02";
  store.set("save:dungeonrulesdone", {
    _saveVersion: 7,
    character: dungeonCharacter("DungeonRulesDone", token),
  });
  const request = {
    playerName: "dungeonrulesdone",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
    dungeon: { token },
  };
  const started = await call(aiStart, request);
  assert.equal(started.statusCode, 200);
  const matchId = dungeonCardMatchId("dungeonrulesdone", token);
  const key = `cc-ai:${matchId}`;
  const terminal = structuredClone(store.get(key)) as {
    rulesVersion: number;
    state: { rulesVersion: number; status: string; winner: string | null };
    status: string;
    winner?: string;
    createdAt: number;
  };
  terminal.state.status = "complete";
  terminal.state.winner = "p1";
  terminal.status = "done";
  terminal.winner = "player";
  store.set(key, terminal);
  const committed = await call(aiMove, { matchId, action: "state" });
  assert.equal(committed.statusCode, 200);

  const retired = structuredClone(store.get(key)) as typeof terminal & { settledAt?: number };
  assert.ok(retired.settledAt);
  retired.rulesVersion = CHRONICLE_RULES_VERSION - 1;
  retired.state.rulesVersion = CHRONICLE_RULES_VERSION - 1;
  store.set(key, retired);
  const versionBefore = (store.get("save:dungeonrulesdone") as { _saveVersion: number })._saveVersion;

  const resumed = await call(aiStart, request);
  assert.equal(resumed.statusCode, 200);
  assert.notEqual(
    (resumed.body as { resumedWithCurrentRules?: boolean }).resumedWithCurrentRules,
    true,
  );
  const body = resumed.body as {
    character?: Record<string, unknown>;
    _saveVersion?: number;
  };
  assert.equal(
    (body.character?.activeDungeonRun as Record<string, unknown>)?.cardProofId,
    matchId,
  );
  assert.equal(body._saveVersion, versionBefore);
  assert.equal((store.get(key) as { rulesVersion: number }).rulesVersion, CHRONICLE_RULES_VERSION - 1);
  assert.equal(
    (store.get("save:dungeonrulesdone") as { _saveVersion: number })._saveVersion,
    versionBefore,
    "the authoritative terminal snapshot is returned without rewriting the save",
  );
});

test("Dungeon Card admission rejects malformed, stale, and pre-Warden requests", async () => {
  store.clear();
  const activeToken = "dungeonrun_card_002";
  store.set("save:dungeonreject", {
    character: {
      ...dungeonCharacter("DungeonReject", activeToken),
      activeDungeonRun: { token: activeToken },
    },
  });
  const malformed = await call(aiStart, {
    playerName: "dungeonreject",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
    dungeon: { token: "short" },
  });
  assert.equal(malformed.statusCode, 400);
  const noWarden = await call(aiStart, {
    playerName: "dungeonreject",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
    dungeon: { token: activeToken },
  });
  assert.equal(noWarden.statusCode, 409);

  store.set("save:dungeonreject", {
    character: dungeonCharacter("DungeonReject", activeToken),
  });
  const stale = await call(aiStart, {
    playerName: "dungeonreject",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
    dungeon: { token: "different_card_run_02" },
  });
  assert.equal(stale.statusCode, 409);

  store.set("save:dungeonreject", {
    character: dungeonCharacter("AnotherPlayer", activeToken),
  });
  const mismatchedSaveIdentity = await call(aiStart, {
    playerName: "dungeonreject",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
    dungeon: { token: activeToken },
  });
  assert.equal(mismatchedSaveIdentity.statusCode, 409);
  assert.equal(
    [...store.keys()].some((key) => key.startsWith("cc-ai:")),
    false,
  );
});

test("a Dungeon Chronicle win stamps the exact run once across concurrent state retries", async () => {
  store.clear();
  const token = "dungeonrun_card_003";
  store.set("save:dungeonwin", {
    _saveVersion: 10,
    character: dungeonCharacter("DungeonWin", token),
  });
  const started = await call(aiStart, {
    playerName: "dungeonwin",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
    dungeon: { token },
  });
  assert.equal(started.statusCode, 200);
  const matchId = (started.body as { matchId: string }).matchId;
  const key = `cc-ai:${matchId}`;
  const terminal = structuredClone(store.get(key)) as {
    state: { status: string; winner: string | null };
    status: string;
    winner?: string;
  };
  terminal.state.status = "complete";
  terminal.state.winner = "p1";
  terminal.status = "done";
  terminal.winner = "player";
  store.set(key, terminal);

  const [first, duplicate] = await Promise.all([
    call(aiMove, { matchId, action: "state" }),
    call(aiMove, { matchId, action: "state" }),
  ]);
  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  const saved = store.get("save:dungeonwin") as {
    _saveVersion: number;
    character: Record<string, unknown>;
  };
  const active = saved.character.activeDungeonRun as Record<string, unknown>;
  assert.equal(active.cardAuthorityVersion, 1);
  assert.equal(active.cardLastOutcome, "player");
  assert.equal(active.cardProofId, matchId);
  assert.equal(active.cardDefeated, true);
  assert.equal(saved._saveVersion, 12, "one deck write plus one terminal proof write");
  for (const response of [first, duplicate]) {
    const body = response.body as {
      character: Record<string, unknown>;
      _saveVersion: number;
    };
    assert.equal(
      (body.character.activeDungeonRun as Record<string, unknown>).cardProofId,
      matchId,
    );
    assert.equal(body._saveVersion, 12);
  }
});

test("Dungeon Card settlement repairs a lost session write without rewriting its proof", async () => {
  store.clear();
  const token = "dungeonrun_card_004";
  store.set("save:dungeonretry", {
    _saveVersion: 20,
    character: dungeonCharacter("DungeonRetry", token),
  });
  const started = await call(aiStart, {
    playerName: "dungeonretry",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
    dungeon: { token },
  });
  const matchId = (started.body as { matchId: string }).matchId;
  const key = `cc-ai:${matchId}`;
  const terminal = structuredClone(store.get(key)) as {
    state: { status: string; winner: string | null };
    status: string;
    winner?: string;
    settledAt?: number;
  };
  terminal.state.status = "complete";
  terminal.state.winner = "p1";
  terminal.status = "done";
  terminal.winner = "player";
  store.set(key, terminal);
  failCardSessionWrites = 1;

  const lost = await call(aiMove, { matchId, action: "state" });
  assert.equal(lost.statusCode, 500);
  const committed = structuredClone(store.get("save:dungeonretry"));
  const committedVersion = (committed as { _saveVersion: number })._saveVersion;
  assert.equal(
    ((committed as { character: Record<string, unknown> }).character.activeDungeonRun as Record<string, unknown>).cardProofId,
    matchId,
  );
  assert.equal((store.get(key) as { settledAt?: number }).settledAt, undefined);

  const repaired = await call(aiMove, { matchId, action: "state" });
  assert.equal(repaired.statusCode, 200);
  assert.equal(
    (store.get("save:dungeonretry") as { _saveVersion: number })._saveVersion,
    committedVersion,
    "idempotent proof replay must not version-bump the save",
  );
  assert.ok((store.get(key) as { settledAt?: number }).settledAt);
});

test("a replaced Dungeon run blocks terminal proof settlement", async () => {
  store.clear();
  const token = "dungeonrun_card_005";
  store.set("save:dungeonstale", {
    character: dungeonCharacter("DungeonStale", token),
  });
  const started = await call(aiStart, {
    playerName: "dungeonstale",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
    dungeon: { token },
  });
  const matchId = (started.body as { matchId: string }).matchId;
  const key = `cc-ai:${matchId}`;
  const terminal = structuredClone(store.get(key)) as {
    state: { status: string; winner: string | null };
    status: string;
    winner?: string;
  };
  terminal.state.status = "complete";
  terminal.state.winner = "p1";
  terminal.status = "done";
  terminal.winner = "player";
  store.set(key, terminal);
  const record = store.get("save:dungeonstale") as {
    character: Record<string, unknown>;
  };
  record.character.activeDungeonRun = {
    ...(record.character.activeDungeonRun as Record<string, unknown>),
    token: "replacement_card_run_5",
  };
  store.set("save:dungeonstale", record);

  const rejected = await call(aiMove, { matchId, action: "state" });
  assert.equal(rejected.statusCode, 409);
  assert.equal(
    (record.character.activeDungeonRun as Record<string, unknown>).cardProofId,
    undefined,
  );
  assert.equal((store.get(key) as { settledAt?: number }).settledAt, undefined);
});

test("bare external stakes and top-level Dungeon-looking fields cannot mint a run proof", async () => {
  store.clear();
  const token = "dungeonrun_card_006";
  store.set("save:dungeonbare", {
    _saveVersion: 30,
    character: dungeonCharacter("DungeonBare", token),
  });
  const started = await call(aiStart, {
    playerName: "dungeonbare",
    deck: CHRONICLE_FIXED_FALLBACK_DECK,
    externalStakes: true,
    dungeonRunToken: token,
  });
  assert.equal(started.statusCode, 200);
  const matchId = (started.body as { matchId: string }).matchId;
  assert.notEqual(matchId, dungeonCardMatchId("dungeonbare", token));
  const key = `cc-ai:${matchId}`;
  const terminal = structuredClone(store.get(key)) as {
    state: { status: string; winner: string | null };
    status: string;
    winner?: string;
    dungeonRunToken?: string;
  };
  assert.equal(terminal.dungeonRunToken, undefined);
  terminal.state.status = "complete";
  terminal.state.winner = "p1";
  terminal.status = "done";
  terminal.winner = "player";
  store.set(key, terminal);
  const versionBefore = (store.get("save:dungeonbare") as { _saveVersion: number })._saveVersion;

  const ended = await call(aiMove, { matchId, action: "state" });
  assert.equal(ended.statusCode, 200);
  const saved = store.get("save:dungeonbare") as {
    _saveVersion: number;
    character: Record<string, unknown>;
  };
  assert.equal(saved._saveVersion, versionBefore);
  assert.equal(
    (saved.character.activeDungeonRun as Record<string, unknown>).cardProofId,
    undefined,
  );
});
