import assert from "node:assert/strict";
import test from "node:test";
import {
  CHRONICLE_FIXED_FALLBACK_DECK,
  TURN_TIMEOUT_MS,
  createMatch,
  projectMatchForViewer,
} from "../../../shared/chronicle-duel";
import {
  acceptChronicleResponse,
  beginChronicleRequest,
  chronicleNextStateRefreshMs,
  createChronicleRequestOrder,
} from "./chronicle-pvp-refresh";

test("PvP refresh never sleeps past a turn or response deadline", () => {
  const now = 10_000;
  const state = createMatch(
    "Akari",
    CHRONICLE_FIXED_FALLBACK_DECK,
    "Ren",
    CHRONICLE_FIXED_FALLBACK_DECK,
    () => 0,
    now,
  );
  let view = projectMatchForViewer(state, "p1");
  assert.equal(chronicleNextStateRefreshMs(view, false, now), 2_000);

  view = {
    ...view,
    turnStartedAt: now - TURN_TIMEOUT_MS + 450,
  };
  assert.equal(chronicleNextStateRefreshMs(view, false, now), 550);

  view = {
    ...view,
    responseWindow: {
      id: "response-test",
      trigger: "onAttackDeclared",
      responder: "p1",
      expiresAt: now + 250,
    },
  };
  assert.equal(chronicleNextStateRefreshMs(view, false, now), 350);
  assert.equal(
    chronicleNextStateRefreshMs(
      { ...view, status: "complete" },
      false,
      now,
    ),
    null,
  );
});

test("PvP request ordering rejects a slow response after a newer action", () => {
  const order = createChronicleRequestOrder();
  const slowPoll = beginChronicleRequest(order);
  const playerAction = beginChronicleRequest(order);

  assert.equal(acceptChronicleResponse(order, playerAction), true);
  assert.equal(acceptChronicleResponse(order, slowPoll), false);

  const recoveredPoll = beginChronicleRequest(order);
  assert.equal(acceptChronicleResponse(order, recoveredPoll), true);
});
