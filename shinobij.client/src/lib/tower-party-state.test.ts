import assert from "node:assert/strict";
import test from "node:test";
import type { TowerPartyEnvelope } from "./towers-api";
import { reconcileTowerRoomEnvelope } from "./tower-party-state";

test("Tower room reconciliation treats an omitted invitations list as empty", () => {
    const malformed = { party: null } as unknown as TowerPartyEnvelope;

    const reconciled = reconcileTowerRoomEnvelope(malformed, malformed);

    assert.deepEqual(reconciled, { party: null, invitations: [] });
});

test("Tower room reconciliation does not retain stale invitations after a partial empty response", () => {
    const current = {
        party: null,
        invitations: [{
            partyId: "party-1",
            inviteCode: "ABCD12",
            hostSlug: "host",
            binding: { mode: "story", floor: 1 },
            memberCount: 1,
            expiresAt: Date.now() + 60_000,
        }],
    } as TowerPartyEnvelope;
    const incoming = { party: null } as unknown as TowerPartyEnvelope;

    const reconciled = reconcileTowerRoomEnvelope(current, incoming);

    assert.deepEqual(reconciled.invitations, []);
});

test("Tower room reconciliation preserves an unchanged normalized envelope by reference", () => {
    const current = { party: null, invitations: [] } as TowerPartyEnvelope;

    const reconciled = reconcileTowerRoomEnvelope(current, current);

    assert.strictEqual(reconciled, current);
});
