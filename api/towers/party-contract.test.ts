import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { towerModeDisabled } from './_mode-control.js';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('Battle Towers party endpoint and launch contract', () => {
    it('authenticates polling/mutations and exposes the complete ready-room action surface', () => {
        const endpoint = source('api/towers/party.ts');
        assert.match(endpoint, /authedPlayerOrAdmin\(req, playerName\)/);
        assert.match(endpoint, /Cache-Control', 'private, no-store'/);
        for (const action of ['create', 'join', 'accept', 'decline', 'leave', 'ready', 'unready', 'invite', 'kick', 'revoke-invite', 'add-ai', 'remove-ai']) {
            assert.match(endpoint, new RegExp(`action === '${action}'`), action);
        }
        assert.match(endpoint, /expectedVersion/);
        assert.match(endpoint, /requestId/);
        assert.match(endpoint, /party: current \? towerPartyView\(current\) : null/);
        assert.match(endpoint, /invitations: await towerPartyInvitations\(player\)/);
        assert.match(source('api/towers/_party.ts'), /hostDisplayName:/);
    });

    it('requires an explicit optimistic version for every member mutation except open-code join', () => {
        const endpoint = source('api/towers/party.ts');
        assert.match(endpoint, /VERSION_REQUIRED_ACTIONS = new Set\(\['accept', 'decline', 'leave', 'ready', 'unready', 'invite', 'kick', 'revoke-invite', 'add-ai', 'remove-ai'\]\)/);
        assert.match(endpoint, /VERSION_REQUIRED_ACTIONS\.has\(action\) && !validSuppliedVersion/);
        assert.match(endpoint, /action === 'join' && hasSuppliedVersion && !validSuppliedVersion/);
        assert.match(endpoint, /errorCode: 'invalid-version'/);
        assert.match(endpoint, /validSuppliedVersion \? suppliedVersion : preview\.version/);
    });

    it('exposes a versioned host-only kick that cannot remove the host or mutate an active room', () => {
        const endpoint = source('api/towers/party.ts');
        const store = source('api/towers/_party.ts');
        assert.match(endpoint, /action === 'kick'/);
        assert.match(endpoint, /kickTowerPartyMember\(/);
        assert.match(store, /party\.hostSlug !== actor[\s\S]{0,180}host-required/);
        assert.match(store, /party\.status !== 'forming'[\s\S]{0,180}party-locked/);
        assert.match(store, /target === actor/);
        assert.match(store, /clearPlayerIndexWith\(kv, target, input\.partyId\)/);
        assert.match(store, /map\(resetMemberReadiness\)/);
    });

    it('lets the host revoke a targeted invitation and reconciles its polling projection', () => {
        const endpoint = source('api/towers/party.ts');
        const store = source('api/towers/_party.ts');
        assert.match(endpoint, /action === 'revoke-invite'/);
        assert.match(endpoint, /revokeTowerPartyInvitation\(/);
        assert.match(store, /Only the party host can revoke invitations/);
        assert.match(store, /invitedSlugs: party\.invitedSlugs\.filter\(slug => slug !== target\)/);
        assert.match(store, /reconcileInvitationIndex\(input\.partyId, target, deps\)/);
    });

    it('derives live members only from the bound party and rejects new borrowed-player AI assists', () => {
        const start = source('api/towers/start.ts');
        assert.match(start, /towerPartyHumanMembers\(authoritativeParty\)\.map\(member => member\.slug\)/);
        assert.match(start, /towerPartyAiMembers\(authoritativeParty\)/);
        assert.match(start, /errorCode: 'borrowed-allies-disabled'/);
        assert.match(start, /:\s*\[hostName\]/);
        assert.match(start, /ai: false/);
        assert.doesNotMatch(start, /legacyAllies|slug !== hostName,\s*\n\s*character:/);
        assert.match(start, /prepareTowerPartyLaunch\(/);
        assert.match(start, /towerPartyId = authoritativeParty\.id/);
        assert.match(start, /towerPartyLaunchRequestId = partyRequestId/);
        assert.match(start, /errorCode: 'member-ineligible'/);
        assert.match(start, /allowShortSpireParty: identity\.admin/);
        assert.ok(start.indexOf('prepareTowerPartyLaunch({') < start.indexOf('buildTowerEncounter({'));
        assert.ok(start.indexOf('reserveTowerPartyEntry({', start.indexOf('buildTowerEncounter({')) < start.indexOf('await writeSession(session)'));
    });

    it('requires an exact-four authoritative ready room for non-admin Spire progression', () => {
        const start = source('api/towers/start.ts');
        assert.match(start, /mode === 'spire' && !identity\.admin/);
        assert.match(start, /errorCode: 'party-required'/);
        assert.match(start, /requiredPartySize: MAX_PARTY_SIZE/);
        assert.ok(start.indexOf("errorCode: 'party-required'") < start.indexOf('bumpDailyStartCount(hostName)'));
    });

    it('publishes one idempotent party run, activates it, and compensates only a verified-absent publication', () => {
        const start = source('api/towers/start.ts');
        const existing = start.indexOf('const existing = disabledReplaySession ?? await readSession(runId)');
        const build = start.indexOf('const session = buildTowerEncounter');
        const publish = start.indexOf('await writeSession(session)');
        const verify = start.indexOf('published = await readSession(runId)', publish);
        const refund = start.indexOf('refundTowerPartyEntryReservation', verify);
        const activate = start.indexOf('activateTowerPartyLaunch', publish);
        assert.ok(existing > 0 && existing < build, 'retry reads the server-minted run before rebuilding');
        assert.ok(publish > build && verify > publish && refund > verify, 'refund follows conclusive absence verification');
        assert.ok(activate > publish, 'party becomes active only after durable session publication');
        assert.match(start, /publicationInconclusive/);
    });

    it('closes a terminal bound party and returns explicit settlement authority', () => {
        const settle = source('api/towers/settle.ts');
        assert.match(settle, /settled: authoritativeSession\.rewardSettlementState === 'settled'/);
        assert.match(settle, /closeTowerPartyRun\(towerPartyId, authoritativeSession\.runId\)/);
        assert.match(settle, /a\.ai\s*\? \{ paid: false, reason: 'unverified-assist' \}/);
        const terminal = settle.indexOf("if (session.status === 'done'");
        const stable = settle.indexOf("authoritativeSession.rewardSettlementState === 'settled'", terminal);
        const close = settle.indexOf('closeTowerPartyRun(', stable);
        assert.ok(terminal > 0 && stable > terminal && close > stable, 'pending settlement keeps room discovery intact');
    });

    it('uses the Tower-only launch stop without disabling recovery endpoints', () => {
        const previous = process.env.TOWER_MODE_DISABLED;
        try {
            delete process.env.TOWER_MODE_DISABLED;
            assert.equal(towerModeDisabled(), false);
            process.env.TOWER_MODE_DISABLED = '1';
            assert.equal(towerModeDisabled(), true);
        } finally {
            if (previous === undefined) delete process.env.TOWER_MODE_DISABLED;
            else process.env.TOWER_MODE_DISABLED = previous;
        }

        const start = source('api/towers/start.ts');
        const party = source('api/towers/party.ts');
        const state = source('api/towers/state.ts');
        const settle = source('api/towers/settle.ts');
        assert.match(start, /towerModeDisabled\(\)/);
        assert.match(party, /if \(action === 'create'\)[\s\S]*towerModeDisabled\(\)/);
        assert.doesNotMatch(state, /towerModeDisabled/);
        assert.doesNotMatch(settle, /towerModeDisabled/);
        assert.match(source('.env.example'), /TOWER_MODE_DISABLED=1/);
    });

    it('credits milestones as a server ledger and removes the unused item reward promise', () => {
        const catalog = source('api/towers/_floor-catalog.ts');
        const store = source('api/towers/_tower-store.ts');
        const ownership = source('api/save/_state-ownership.ts');
        assert.doesNotMatch(catalog, /firstClearReward[\s\S]{0,80}itemId/);
        assert.match(store, /battleTowerMilestones/);
        assert.match(ownership, /f\('battleTowerMilestones'.*server-payout-stamp/);
        assert.match(ownership, /not wearable titles/);
    });
});
