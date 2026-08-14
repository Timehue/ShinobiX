import test from "node:test";
import assert from "node:assert/strict";
import { chronicleResponseAuthority } from "./chronicle-response-authority";

test("Chronicle authority drops unmounted and old-account responses before version adoption", () => {
  let versionCalls = 0;
  const onServerVersion = () => {
    versionCalls += 1;
    return true;
  };

  assert.equal(chronicleResponseAuthority({
    mounted: false,
    activePlayerName: "Ihara",
    originatingPlayerName: "Ihara",
    responsePlayerName: "Ihara",
    carriesAuthoritativeSnapshot: true,
    saveVersion: 8,
    onServerVersion,
  }), "discard");
  assert.equal(chronicleResponseAuthority({
    mounted: true,
    activePlayerName: "NewAccount",
    originatingPlayerName: "OldAccount",
    responsePlayerName: "OldAccount",
    carriesAuthoritativeSnapshot: true,
    saveVersion: 90,
    onServerVersion,
  }), "discard");
  assert.equal(chronicleResponseAuthority({
    mounted: true,
    activePlayerName: "Ihara",
    originatingPlayerName: "Ihara",
    responsePlayerName: "Impostor",
    carriesAuthoritativeSnapshot: true,
    saveVersion: 9,
    onServerVersion,
  }), "discard");
  assert.equal(versionCalls, 0);
});

test("Chronicle authority exposes stale terminal responses as session-only", () => {
  assert.equal(chronicleResponseAuthority({
    mounted: true,
    activePlayerName: "  IHARA ",
    originatingPlayerName: "ihara",
    responsePlayerName: "Ihara",
    carriesAuthoritativeSnapshot: true,
    saveVersion: 7,
    onServerVersion: () => false,
  }), "session-only");
});

test("Chronicle authority admits accepted snapshots and non-mutating projections", () => {
  let projectionVersionCalls = 0;
  assert.equal(chronicleResponseAuthority({
    mounted: true,
    activePlayerName: "Ihara",
    originatingPlayerName: "Ihara",
    carriesAuthoritativeSnapshot: false,
    onServerVersion: () => {
      projectionVersionCalls += 1;
      return false;
    },
  }), "session-only");
  assert.equal(projectionVersionCalls, 0);

  assert.equal(chronicleResponseAuthority({
    mounted: true,
    activePlayerName: "Ihara",
    originatingPlayerName: "Ihara",
    responsePlayerName: "Ihara",
    carriesAuthoritativeSnapshot: true,
    saveVersion: 10,
    onServerVersion: () => true,
  }), "authoritative");
});
