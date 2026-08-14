import assert from "node:assert/strict";
import test from "node:test";
import {
    launchTowerPartyWithLostResponseRetry,
    mutateTowerPartyWithLostResponseRetry,
    towerPlayerSlug,
    TowerPartyApiError,
    TowerTransportError,
    type TowerPartyEnvelope,
    type TowerPartyLaunchRequest,
    type TowerPartyMutationRequest,
    type TowerPartyStartResponse,
    type TowerPartyView,
    type TowerSession,
} from "./towers-api";
import { canStartTowerRoomPoll, isTowerRoomResponseCurrent, reconcileTowerRoomEnvelope } from "./tower-party-state";

test("client canonicalizes Tower player ownership exactly like server safeName", () => {
    assert.equal(towerPlayerSlug("  Hero Name!?  "), "heroname");
    assert.equal(towerPlayerSlug("ALLY_one-2"), "ally_one-2");
    assert.equal(towerPlayerSlug("A".repeat(40)), "a".repeat(32));
});

const party: TowerPartyView = {
    id: "tparty-0123456789abcdef0123456789abcdef",
    inviteCode: "ABCDEFGH",
    hostSlug: "hero",
    binding: { mode: "story", floor: 5 },
    status: "forming",
    members: [
        { slug: "hero", displayName: "Hero", joinedAt: 1, ready: true },
        { slug: "ally", displayName: "Ally", joinedAt: 2, ready: true },
    ],
    invitedSlugs: [],
    version: 7,
    createdAt: 1,
    updatedAt: 2,
    expiresAt: 99,
    sizeRequirements: { min: 2, max: 4, required: null },
    allReady: true,
    canLaunch: true,
    liveMemberCount: 2,
    aiMemberCount: 0,
    aiPolicy: { allowed: true, max: 1, profile: "story-recruit-v1", progressionEligible: false },
};

const envelope: TowerPartyEnvelope = { party, invitations: [], replayed: true };

test("ready-room mutations retry a lost response once with the same request ID", async () => {
    const requests: TowerPartyMutationRequest[] = [];
    const transport = async (request: TowerPartyMutationRequest) => {
        requests.push(request);
        if (requests.length === 1) throw new TowerTransportError("response lost");
        return envelope;
    };

    const result = await mutateTowerPartyWithLostResponseRetry("Hero", {
        action: "ready",
        partyId: party.id,
        expectedVersion: party.version,
    }, transport);

    assert.equal(result.replayed, true);
    assert.equal(requests.length, 2);
    assert.strictEqual(requests[0], requests[1]);
    assert.match(requests[0]?.requestId ?? "", /^[A-Za-z0-9_-]{8,80}$/);
    assert.equal(requests[0]?.expectedVersion, 7);
});

test("party launch retries preserve the body and never send legacy allies", async () => {
    const requests: TowerPartyLaunchRequest[] = [];
    const response: TowerPartyStartResponse = {
        runId: "tower-live",
        partyId: party.id,
        party: { ...party, status: "active" },
        session: { runId: "tower-live" } as TowerSession,
        chargedRyo: 0,
        replayed: true,
    };
    const transport = async (request: TowerPartyLaunchRequest) => {
        requests.push(request);
        if (requests.length === 1) throw new TowerTransportError("response lost");
        return response;
    };

    const result = await launchTowerPartyWithLostResponseRetry("Hero", party, undefined, transport);
    assert.equal(result.runId, "tower-live");
    assert.strictEqual(requests[0], requests[1]);
    assert.equal(requests[0]?.mode, "story");
    assert.equal(requests[0]?.floor, 5);
    assert.equal(requests[0]?.expectedVersion, 7);
    assert.equal("allies" in (requests[0] ?? {}), false);
});

test("409 party errors carry the authoritative room for UI reconciliation", () => {
    const error = new TowerPartyApiError("The party changed.", 409, "version-conflict", party, ["ally"]);
    assert.equal(error.status, 409);
    assert.equal(error.errorCode, "version-conflict");
    assert.strictEqual(error.party, party);
    assert.deepEqual(error.members, ["ally"]);
});

test("out-of-order ready-room responses never roll roster state backward", () => {
    const newest: TowerPartyEnvelope = {
        party: { ...party, version: 9, members: party.members.map(member => ({ ...member, ready: false })) },
        invitations: [],
    };
    const stale: TowerPartyEnvelope = {
        party: { ...party, version: 8 },
        invitations: [{
            partyId: "tparty-invitation",
            inviteCode: "BCDEFGHJ",
            hostSlug: "captain",
            binding: { mode: "story", floor: 6 },
            memberCount: 2,
            expiresAt: 200,
        }],
    };
    const reconciled = reconcileTowerRoomEnvelope(newest, stale);
    assert.strictEqual(reconciled.party, newest.party, "the newer roster/readiness projection must win");
    assert.deepEqual(reconciled.invitations, stale.invitations, "fresh invitation state still reconciles");

    const closed = reconcileTowerRoomEnvelope(newest, {
        ...stale,
        party: { ...stale.party!, status: "closed" },
    });
    assert.equal(closed.party, null, "an explicit closed room must not be retained by the version guard");

    const preserved = reconcileTowerRoomEnvelope(newest, stale, "preserve");
    assert.strictEqual(preserved.party, newest.party, "preserve mode keeps the current room while refreshing invitations");
    assert.deepEqual(preserved.invitations, stale.invitations);

    const dropped = reconcileTowerRoomEnvelope(newest, stale, "drop");
    assert.equal(dropped.party, null, "drop mode clears even a populated response after leaving");
    const authoritativeNull = reconcileTowerRoomEnvelope(newest, { party: null, invitations: [] });
    assert.equal(authoritativeNull.party, null, "a fresh null membership projection clears the room");
});

test("request epochs reject pre-create nulls and pre-leave room resurrection", () => {
    const pollStartedBeforeMutation = 4;
    const epochAfterCreateOrLeave = 5;
    assert.equal(isTowerRoomResponseCurrent(pollStartedBeforeMutation, epochAfterCreateOrLeave), false);
    assert.equal(isTowerRoomResponseCurrent(epochAfterCreateOrLeave, epochAfterCreateOrLeave), true);
    assert.equal(canStartTowerRoomPoll(true, false, true), false, "polls must not start on a mutation's epoch before its server commit");
    assert.equal(canStartTowerRoomPoll(true, false, false), true, "polling resumes after the mutation response is adopted");
});
