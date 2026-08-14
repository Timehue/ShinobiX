import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _makeMemoryKv } from '../_storage.js';
import {
    TOWER_PARTY_MAX,
    TOWER_PARTY_LAUNCH_GRACE_MS,
    activeTowerPartyForPlayer,
    addGenericTowerAi,
    activateTowerPartyLaunch,
    closeTowerPartyRun,
    createTowerParty,
    declineTowerPartyInvitation,
    inviteTowerPartyMember,
    joinTowerParty,
    kickTowerPartyMember,
    leaveTowerParty,
    loadTowerParty,
    prepareTowerPartyLaunch,
    repairStaleTowerPartyLifecycle,
    removeGenericTowerAi,
    reopenTowerPartyLaunch,
    revokeTowerPartyInvitation,
    setTowerPartyReady,
    towerPartyInvitations,
    towerPartyInviteKey,
    towerPartyPlayerKey,
    towerPartyView,
    towerPartyAiMembers,
    towerPartyHumanMembers,
    type StoredTowerParty,
    type TowerPartyDeps,
} from './_party.js';
import { sessionKey, type TowerKv, type TowerLock } from './_tower-store.js';
import { battleLockKey, TOWER_BATTLE_LOCK_KIND, TOWER_BATTLE_LOCK_SCREEN } from './_battle-lease.js';
import { reserveTowerPartyEntry } from './_party-entry.js';

const NOW = 1_800_000_000_000;
const PARTY_ID = `tparty-${'a'.repeat(32)}`;
const CODE = 'ABCDEFGH';
const lock: TowerLock = async (_key, fn) => fn();

function keyedLock(): TowerLock {
    const tails = new Map<string, Promise<void>>();
    return async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
        const prior = tails.get(key) ?? Promise.resolve();
        let release: () => void = () => {};
        const hold = new Promise<void>(resolve => { release = resolve; });
        const tail = prior.then(() => hold);
        tails.set(key, tail);
        await prior;
        try {
            return await fn();
        } finally {
            release();
            if (tails.get(key) === tail) tails.delete(key);
        }
    };
}

function setup(now = NOW): TowerPartyDeps & { kv: TowerKv } {
    return {
        kv: _makeMemoryKv() as unknown as TowerKv,
        lock,
        now: () => now,
        id: () => PARTY_ID,
        inviteCode: () => CODE,
        seed: () => 314159,
    };
}

function request(n: number): string {
    return `party-request-${n.toString().padStart(4, '0')}`;
}

async function create(deps: TowerPartyDeps, mode: 'story' | 'spire' = 'story'): Promise<StoredTowerParty> {
    const created = await createTowerParty({
        hostSlug: 'host',
        displayName: 'Host',
        binding: mode === 'story' ? { mode, floor: 5 } : { mode, ascensionTier: 3 },
    }, deps);
    if (!created.ok) assert.fail(created.error);
    return created.party;
}

async function join(party: StoredTowerParty, actor: string, n: number, deps: TowerPartyDeps): Promise<StoredTowerParty> {
    const result = await joinTowerParty({
        partyId: party.id,
        actor,
        displayName: actor.toUpperCase(),
        requestId: request(n),
        expectedVersion: party.version,
        fingerprint: `join:${actor}`,
    }, deps);
    if (!result.ok) assert.fail(result.error);
    return result.party;
}

async function ready(party: StoredTowerParty, actor: string, n: number, deps: TowerPartyDeps): Promise<StoredTowerParty> {
    const result = await setTowerPartyReady({
        partyId: party.id,
        actor,
        ready: true,
        requestId: request(n),
        expectedVersion: party.version,
        fingerprint: `ready:${actor}`,
    }, deps);
    if (!result.ok) assert.fail(result.error);
    return result.party;
}

describe('Battle Towers authoritative ready rooms', () => {
    it('adds ownerless novice AI to Story rooms without creating a player identity or reward member', async () => {
        const deps = setup();
        let party = await create(deps);
        party = await ready(party, 'host', 901, deps);
        const added = await addGenericTowerAi({
            partyId: party.id,
            actor: 'host',
            requestId: request(902),
            expectedVersion: party.version,
            fingerprint: 'add-ai:one',
        }, deps);
        assert.equal(added.ok, true);
        if (!added.ok) return;
        party = added.party;
        assert.equal(towerPartyHumanMembers(party).length, 1);
        assert.equal(towerPartyAiMembers(party).length, 1);
        assert.equal(towerPartyHumanMembers(party)[0]?.ready, false, 'a roster change makes the live host reconfirm');
        assert.deepEqual(towerPartyAiMembers(party)[0], {
            slug: 'tower-ai:1',
            displayName: 'Tower Recruit I (AI)',
            joinedAt: NOW,
            ready: true,
            ai: true,
            aiProfile: 'story-recruit-v1',
        });
        assert.equal(await deps.kv.get(towerPartyPlayerKey('tower-ai:1')), null, 'AI never receives an account party index');
        assert.equal(await activeTowerPartyForPlayer('tower-ai:1', deps), null, 'AI is never discoverable as a player');
        assert.deepEqual(towerPartyView(party).aiPolicy, {
            allowed: true,
            max: 1,
            profile: 'story-recruit-v1',
            progressionEligible: false,
        });
        const overCap = await addGenericTowerAi({
            partyId: party.id,
            actor: 'host',
            requestId: request(905),
            expectedVersion: party.version,
            fingerprint: 'add-ai:two',
        }, deps);
        assert.equal(overCap.ok, false);
        if (!overCap.ok) assert.equal(overCap.code, 'ai-cap', 'a weak helper must not become multi-slot scaling bait');

        party = await ready(party, 'host', 903, deps);
        assert.equal(towerPartyView(party).canLaunch, true, 'one live player plus one recruit meets Story minimum');
        const prepared = await prepareTowerPartyLaunch({
            partyId: party.id,
            hostSlug: 'host',
            requestId: request(904),
            expectedVersion: party.version,
            binding: { mode: 'story', floor: 5 },
            enforceStartCap: false,
        }, deps);
        assert.equal(prepared.ok, true);
    });

    it('keeps generic AI out of Spire and lets only the host remove its reserved non-account ID', async () => {
        const deps = setup();
        const spire = await create(deps, 'spire');
        const rejected = await addGenericTowerAi({
            partyId: spire.id,
            actor: 'host',
            requestId: request(910),
            expectedVersion: spire.version,
            fingerprint: 'spire-ai',
        }, deps);
        assert.equal(rejected.ok, false);
        if (!rejected.ok) assert.equal(rejected.code, 'ai-not-allowed');
        assert.deepEqual(towerPartyView(spire).aiPolicy, {
            allowed: false,
            max: 0,
            profile: 'story-recruit-v1',
            progressionEligible: false,
        });

        const storyDeps = setup();
        let story = await create(storyDeps);
        const added = await addGenericTowerAi({
            partyId: story.id, actor: 'host', requestId: request(911), expectedVersion: story.version, fingerprint: 'story-ai',
        }, storyDeps);
        assert.equal(added.ok, true);
        if (!added.ok) return;
        story = added.party;
        const nonHost = await removeGenericTowerAi({
            partyId: story.id, actor: 'alice', target: 'tower-ai:1', requestId: request(912), expectedVersion: story.version, fingerprint: 'remove-ai:alice',
        }, storyDeps);
        assert.equal(nonHost.ok, false);
        if (!nonHost.ok) assert.equal(nonHost.code, 'host-required');
        const removed = await removeGenericTowerAi({
            partyId: story.id, actor: 'host', target: 'tower-ai:1', requestId: request(913), expectedVersion: story.version, fingerprint: 'remove-ai:host',
        }, storyDeps);
        assert.equal(removed.ok, true);
        if (removed.ok) assert.equal(towerPartyAiMembers(removed.party).length, 0);
    });

    it('server-mints a fixed-TTL party/code and idempotently recovers host create', async () => {
        const deps = setup();
        const party = await create(deps);
        assert.equal(party.id, PARTY_ID);
        assert.equal(party.inviteCode, CODE);
        assert.equal(party.expiresAt - NOW, 2 * 60 * 60 * 1_000);
        assert.deepEqual(towerPartyView(party).sizeRequirements, { min: 2, max: 4, required: null });
        assert.equal(towerPartyView(party).canLaunch, false);

        const replay = await createTowerParty({ hostSlug: 'host', binding: { mode: 'story', floor: 5 } }, deps);
        assert.equal(replay.ok, true);
        if (replay.ok) assert.equal(replay.replayed, true);
    });

    it('joins by code, resets readiness on roster changes, caps four, and keeps one active-party index', async () => {
        const deps = setup();
        let party = await create(deps);
        party = await ready(party, 'host', 1, deps);
        party = await join(party, 'a', 2, deps);
        assert.ok(party.members.every(member => !member.ready));
        party = await join(party, 'b', 3, deps);
        party = await join(party, 'c', 4, deps);
        assert.equal(party.members.length, TOWER_PARTY_MAX);
        const full = await joinTowerParty({
            partyId: party.id, actor: 'd', requestId: request(5), expectedVersion: party.version, fingerprint: 'join:d',
        }, deps);
        assert.equal(full.ok, false);
        if (!full.ok) assert.equal(full.code, 'party-full');

        const otherDeps = { ...deps, id: () => `tparty-${'b'.repeat(32)}`, inviteCode: () => 'BCDEFGHJ' };
        const other = await createTowerParty({ hostSlug: 'other', binding: { mode: 'story', floor: 1 } }, otherDeps);
        assert.equal(other.ok, true);
        if (!other.ok) return;
        const competing = await joinTowerParty({
            partyId: other.party.id, actor: 'a', requestId: request(6), expectedVersion: other.party.version, fingerprint: 'join:a:other',
        }, otherDeps);
        assert.equal(competing.ok, false);
        if (!competing.ok) assert.equal(competing.code, 'already-in-party');
    });

    it('supports targeted invite accept/decline and invitation polling', async () => {
        const deps = setup();
        let party = await create(deps);
        const invited = await inviteTowerPartyMember({
            partyId: party.id, actor: 'host', target: 'alice', requestId: request(10), expectedVersion: party.version, fingerprint: 'invite:alice',
        }, deps);
        assert.equal(invited.ok, true);
        if (!invited.ok) return;
        party = invited.party;
        const incoming = (await towerPartyInvitations('alice', deps))[0];
        assert.equal(incoming?.partyId, party.id);
        assert.equal(incoming?.hostDisplayName, 'Host');

        const staleDecline = await declineTowerPartyInvitation({
            partyId: party.id, actor: 'alice', requestId: request(109), expectedVersion: party.version - 1, fingerprint: 'decline:alice:stale',
        }, deps);
        assert.equal(staleDecline.ok, false);
        assert.equal((await towerPartyInvitations('alice', deps))[0]?.partyId, party.id, 'a rejected decline cannot erase the invitation projection');

        const declined = await declineTowerPartyInvitation({
            partyId: party.id, actor: 'alice', requestId: request(11), expectedVersion: party.version, fingerprint: 'decline:alice',
        }, deps);
        assert.equal(declined.ok, true);
        if (!declined.ok) return;
        party = declined.party;
        assert.deepEqual(await towerPartyInvitations('alice', deps), []);

        const reinvited = await inviteTowerPartyMember({
            partyId: party.id, actor: 'host', target: 'alice', requestId: request(12), expectedVersion: party.version, fingerprint: 'invite:alice:2',
        }, deps);
        assert.equal(reinvited.ok, true);
        if (!reinvited.ok) return;
        const revoked = await revokeTowerPartyInvitation({
            partyId: party.id,
            actor: 'host',
            target: 'alice',
            requestId: request(121),
            expectedVersion: reinvited.party.version,
            fingerprint: 'revoke:alice',
        }, deps);
        assert.equal(revoked.ok, true);
        if (!revoked.ok) return;
        assert.deepEqual(await towerPartyInvitations('alice', deps), []);
        const invitedAgain = await inviteTowerPartyMember({
            partyId: party.id,
            actor: 'host',
            target: 'alice',
            requestId: request(122),
            expectedVersion: revoked.party.version,
            fingerprint: 'invite:alice:3',
        }, deps);
        assert.equal(invitedAgain.ok, true);
        if (!invitedAgain.ok) return;
        const accepted = await joinTowerParty({
            partyId: party.id,
            actor: 'alice',
            requestId: request(13),
            expectedVersion: invitedAgain.party.version,
            fingerprint: 'accept:alice',
            requireTargetedInvite: true,
        }, deps);
        assert.equal(accepted.ok, true);
        if (accepted.ok) assert.ok(accepted.party.members.some(member => member.slug === 'alice'));
        assert.deepEqual(await towerPartyInvitations('alice', deps), [], 'accept reconciles the targeted-invite projection');
    });

    it('converges the invite projection when an older decline response finishes after a newer reinvite', async () => {
        const deps = setup();
        const serial = keyedLock();
        let delayNextProjection = false;
        let projectionEntered: () => void = () => {};
        const entered = new Promise<void>(resolve => { projectionEntered = resolve; });
        let releaseProjection: () => void = () => {};
        const released = new Promise<void>(resolve => { releaseProjection = resolve; });
        deps.lock = async <T>(key: string, fn: () => Promise<T>, opts?: { failClosed?: boolean }) => {
            if (delayNextProjection && key === towerPartyInviteKey('alice')) {
                delayNextProjection = false;
                projectionEntered();
                await released;
            }
            return serial(key, fn, opts);
        };

        let party = await create(deps);
        const invited = await inviteTowerPartyMember({
            partyId: party.id,
            actor: 'host',
            target: 'alice',
            requestId: request(14),
            expectedVersion: party.version,
            fingerprint: 'invite:alice:race-1',
        }, deps);
        assert.equal(invited.ok, true);
        if (!invited.ok) return;
        party = invited.party;

        delayNextProjection = true;
        const staleCompletion = declineTowerPartyInvitation({
            partyId: party.id,
            actor: 'alice',
            requestId: request(15),
            expectedVersion: party.version,
            fingerprint: 'decline:alice:race',
        }, deps);
        await entered;
        const afterDecline = await loadTowerParty(party.id, deps);
        assert.ok(afterDecline && !afterDecline.invitedSlugs.includes('alice'));

        const reinvited = await inviteTowerPartyMember({
            partyId: party.id,
            actor: 'host',
            target: 'alice',
            requestId: request(16),
            expectedVersion: afterDecline!.version,
            fingerprint: 'invite:alice:race-2',
        }, deps);
        assert.equal(reinvited.ok, true);
        releaseProjection();
        assert.equal((await staleCompletion).ok, true);
        assert.equal((await towerPartyInvitations('alice', deps))[0]?.partyId, party.id);
    });

    it('uses mutation receipts before version checks and rejects request-ID reuse with another fingerprint', async () => {
        const deps = setup();
        const party = await create(deps);
        const first = await setTowerPartyReady({
            partyId: party.id, actor: 'host', ready: true, requestId: request(20), expectedVersion: party.version, fingerprint: 'ready:true',
        }, deps);
        assert.equal(first.ok, true);
        if (!first.ok) return;
        const replay = await setTowerPartyReady({
            partyId: party.id, actor: 'host', ready: true, requestId: request(20), expectedVersion: party.version, fingerprint: 'ready:true',
        }, deps);
        assert.equal(replay.ok, true);
        if (replay.ok) assert.equal(replay.replayed, true);
        const conflict = await setTowerPartyReady({
            partyId: party.id, actor: 'host', ready: false, requestId: request(20), expectedVersion: first.party.version, fingerprint: 'ready:false',
        }, deps);
        assert.equal(conflict.ok, false);
        if (!conflict.ok) assert.equal(conflict.code, 'request-conflict');

        const noOp = await declineTowerPartyInvitation({
            partyId: party.id,
            actor: 'alice',
            requestId: request(21),
            expectedVersion: first.party.version,
            fingerprint: 'decline:not-invited',
        }, deps);
        assert.equal(noOp.ok, true);
        if (!noOp.ok) return;
        assert.equal(noOp.replayed, false, 'first successful no-op still stamps its request receipt');
        const noOpConflict = await declineTowerPartyInvitation({
            partyId: party.id,
            actor: 'alice',
            requestId: request(21),
            expectedVersion: noOp.party.version,
            fingerprint: 'decline:reused-for-other-command',
        }, deps);
        assert.equal(noOpConflict.ok, false);
        if (!noOpConflict.ok) assert.equal(noOpConflict.code, 'request-conflict');
    });

    it('preserves an existing member index after a stale reconnect join', async () => {
        const deps = setup();
        let party = await create(deps);
        party = await join(party, 'alice', 25, deps);
        const staleVersion = party.version;
        party = await ready(party, 'host', 26, deps);
        const stale = await joinTowerParty({
            partyId: party.id,
            actor: 'alice',
            requestId: request(27),
            expectedVersion: staleVersion,
            fingerprint: 'join:alice:reconnect',
        }, deps);
        assert.equal(stale.ok, false);
        if (!stale.ok) assert.equal(stale.code, 'version-conflict');
        assert.equal((await activeTowerPartyForPlayer('alice', deps))?.id, party.id);
    });

    it('launches Story with two to four all-ready members and seals one idempotent active run', async () => {
        const deps = setup();
        let party = await create(deps);
        party = await join(party, 'alice', 30, deps);
        party = await ready(party, 'host', 31, deps);
        party = await ready(party, 'alice', 32, deps);
        assert.equal(towerPartyView(party).canLaunch, true);

        const launched = await prepareTowerPartyLaunch({
            partyId: party.id,
            hostSlug: 'host',
            requestId: request(33),
            expectedVersion: party.version,
            binding: { mode: 'story', floor: 5 },
            enforceStartCap: true,
        }, deps);
        assert.equal(launched.ok, true);
        if (!launched.ok) return;
        assert.equal(launched.party.status, 'launching');
        assert.equal(launched.party.launch?.seed, 314159);
        assert.equal(launched.party.launch?.startCount, 1);

        const retry = await prepareTowerPartyLaunch({
            partyId: party.id,
            hostSlug: 'host',
            requestId: request(33),
            expectedVersion: party.version,
            binding: { mode: 'story', floor: 5 },
            enforceStartCap: true,
        }, deps);
        assert.equal(retry.ok, true);
        if (!retry.ok) return;
        assert.equal(retry.replayed, true);
        assert.equal(retry.party.launch?.runId, launched.party.launch?.runId);

        const active = await activateTowerPartyLaunch(party.id, request(33), launched.party.launch!.runId, deps);
        assert.equal(active?.status, 'active');
        const second = await prepareTowerPartyLaunch({
            partyId: party.id, hostSlug: 'host', requestId: request(34), expectedVersion: active!.version,
            binding: { mode: 'story', floor: 5 }, enforceStartCap: true,
        }, deps);
        assert.equal(second.ok, false);
        if (!second.ok) assert.equal(second.code, 'party-active');
    });

    it('invalidates unjoined invitations as soon as launch leaves forming', async () => {
        const deps = setup();
        let party = await create(deps);
        const invited = await inviteTowerPartyMember({
            partyId: party.id, actor: 'host', target: 'eve', requestId: request(35),
            expectedVersion: party.version, fingerprint: 'invite:eve:privacy',
        }, deps);
        assert.equal(invited.ok, true);
        if (!invited.ok) return;
        party = await join(invited.party, 'alice', 36, deps);
        party = await ready(party, 'host', 37, deps);
        party = await ready(party, 'alice', 38, deps);
        assert.equal((await towerPartyInvitations('eve', deps)).length, 1);

        const launched = await prepareTowerPartyLaunch({
            partyId: party.id, hostSlug: 'host', requestId: request(39), expectedVersion: party.version,
            binding: { mode: 'story', floor: 5 }, enforceStartCap: false,
        }, deps);
        assert.equal(launched.ok, true);
        if (!launched.ok) return;
        assert.deepEqual(launched.party.invitedSlugs, []);
        assert.deepEqual(await towerPartyInvitations('eve', deps), []);
    });

    it('closes a confirmed-missing active run immediately and a stale prepared launch only after grace', async () => {
        let current = NOW;
        const deps = { ...setup(), now: () => current };
        let party = await create(deps);
        party = await join(party, 'alice', 391, deps);
        party = await ready(party, 'host', 392, deps);
        party = await ready(party, 'alice', 393, deps);
        const launched = await prepareTowerPartyLaunch({
            partyId: party.id, hostSlug: 'host', requestId: request(394), expectedVersion: party.version,
            binding: { mode: 'story', floor: 5 }, enforceStartCap: false,
        }, deps);
        assert.equal(launched.ok, true);
        if (!launched.ok) return;
        const runId = launched.party.launch!.runId;
        const originalCharacter = {
            name: 'Host',
            ryo: 5_000,
            dailyBattleDate: '2027-01-15',
            dailyBattleFloors: 3,
            battleTowerClearedFloors: [],
        };
        const reservation = reserveTowerPartyEntry({
            character: originalCharacter,
            partyId: party.id,
            runId,
            day: '2027-01-15',
            floorId: 5,
            now: current,
        });
        assert.equal(reservation.ok, true);
        if (!reservation.ok) return;
        assert.equal(reservation.charged, 1_500);
        await deps.kv.set('save:host', { _saveVersion: 1, character: reservation.character });
        const lease = {
            battleId: runId,
            kind: TOWER_BATTLE_LOCK_KIND,
            screen: TOWER_BATTLE_LOCK_SCREEN,
            startedAt: current,
            meta: { runId, partyId: party.id },
        };
        await deps.kv.set(battleLockKey('host'), lease);
        await deps.kv.set(battleLockKey('alice'), lease);

        assert.equal((await loadTowerParty(party.id, deps))?.status, 'launching');
        current += TOWER_PARTY_LAUNCH_GRACE_MS + 1;
        const repaired = await repairStaleTowerPartyLifecycle(party.id, deps);
        assert.equal(repaired?.status, 'closed');
        assert.equal(repaired?.launch?.state, 'failed');
        assert.equal(await deps.kv.get(towerPartyPlayerKey('host')), null);
        assert.equal(await deps.kv.get(towerPartyPlayerKey('alice')), null);
        assert.equal(await deps.kv.get(battleLockKey('host')), null);
        assert.equal(await deps.kv.get(battleLockKey('alice')), null);
        const refunded = await deps.kv.get<{ _saveVersion: number; character: typeof originalCharacter }>('save:host');
        assert.equal(refunded?.character.ryo, originalCharacter.ryo);
        assert.equal(refunded?.character.dailyBattleFloors, originalCharacter.dailyBattleFloors);
        const versionAfterRefund = refunded?._saveVersion;
        await repairStaleTowerPartyLifecycle(party.id, deps);
        assert.equal((await deps.kv.get<{ _saveVersion: number }>('save:host'))?._saveVersion, versionAfterRefund,
            'confirmed-missing compensation is idempotent');
    });

    it('keeps missing-session repair fail-closed on a storage read error', async () => {
        let current = NOW;
        const base = setup();
        let party = await create({ ...base, now: () => current });
        party = await join(party, 'alice', 395, { ...base, now: () => current });
        party = await ready(party, 'host', 396, { ...base, now: () => current });
        party = await ready(party, 'alice', 397, { ...base, now: () => current });
        const launched = await prepareTowerPartyLaunch({
            partyId: party.id, hostSlug: 'host', requestId: request(398), expectedVersion: party.version,
            binding: { mode: 'story', floor: 5 }, enforceStartCap: false,
        }, { ...base, now: () => current });
        assert.equal(launched.ok, true);
        if (!launched.ok) return;
        current += TOWER_PARTY_LAUNCH_GRACE_MS + 1;
        const failingKv: TowerKv = {
            ...base.kv,
            get: async <T>(key: string) => {
                if (key === sessionKey(launched.party.launch!.runId)) throw new Error('transient storage failure');
                return base.kv.get<T>(key);
            },
        };
        await assert.rejects(() => repairStaleTowerPartyLifecycle(party.id, { ...base, kv: failingKv, now: () => current }));
        assert.equal(await base.kv.get(towerPartyPlayerKey('host')), party.id);
        assert.equal((await base.kv.get<StoredTowerParty>(`tower-party:${party.id}`))?.status, 'launching');
    });

    it('reopens an unpublished launch and reuses the same run identity without consuming another daily start', async () => {
        const deps = setup();
        let party = await create(deps);
        party = await join(party, 'alice', 40, deps);
        party = await ready(party, 'host', 41, deps);
        party = await ready(party, 'alice', 42, deps);
        const first = await prepareTowerPartyLaunch({
            partyId: party.id, hostSlug: 'host', requestId: request(43), expectedVersion: party.version,
            binding: { mode: 'story', floor: 5 }, enforceStartCap: true,
        }, deps);
        assert.equal(first.ok, true);
        if (!first.ok) return;
        await reopenTowerPartyLaunch(party.id, request(43), deps);
        const retry = await prepareTowerPartyLaunch({
            partyId: party.id, hostSlug: 'host', requestId: request(43), expectedVersion: party.version,
            binding: { mode: 'story', floor: 5 }, enforceStartCap: true,
        }, deps);
        assert.equal(retry.ok, true);
        if (retry.ok) {
            assert.equal(retry.party.launch?.runId, first.party.launch?.runId);
            assert.equal(retry.party.launch?.startCount, 1);
        }
    });

    it('requires exactly four for authoritative Spire, while exposing the requirement to polling', async () => {
        const deps = setup();
        let party = await create(deps, 'spire');
        party = await join(party, 'alice', 50, deps);
        party = await ready(party, 'host', 51, deps);
        party = await ready(party, 'alice', 52, deps);
        const view = towerPartyView(party);
        assert.deepEqual(view.sizeRequirements, { min: 4, max: 4, required: 4 });
        assert.equal(view.canLaunch, false);
        const short = await prepareTowerPartyLaunch({
            partyId: party.id, hostSlug: 'host', requestId: request(53), expectedVersion: party.version,
            binding: { mode: 'spire', ascensionTier: 3 }, enforceStartCap: false,
        }, deps);
        assert.equal(short.ok, false);
        if (!short.ok) assert.equal(short.code, 'invalid-size');

        const adminOverride = await prepareTowerPartyLaunch({
            partyId: party.id, hostSlug: 'host', requestId: request(54), expectedVersion: party.version,
            binding: { mode: 'spire', ascensionTier: 3 }, enforceStartCap: false, allowShortSpireParty: true,
        }, deps);
        assert.equal(adminOverride.ok, true);
    });

    it('transfers host deterministically and clears every remaining ready flag on leave', async () => {
        const deps = setup();
        let party = await create(deps);
        party = await join(party, 'alice', 60, deps);
        party = await ready(party, 'host', 61, deps);
        party = await ready(party, 'alice', 62, deps);
        const left = await leaveTowerParty({
            partyId: party.id, actor: 'host', requestId: request(63), expectedVersion: party.version, fingerprint: 'leave:host',
        }, deps);
        assert.equal(left.ok, true);
        if (left.ok) {
            assert.equal(left.party.hostSlug, 'alice');
            assert.equal(left.party.members[0]?.ready, false);
        }
    });

    it('lets only the host kick another forming member, resets readiness, and releases the member index idempotently', async () => {
        const deps = setup();
        let party = await create(deps);
        party = await join(party, 'alice', 64, deps);
        party = await join(party, 'bob', 65, deps);
        party = await ready(party, 'host', 66, deps);
        party = await ready(party, 'alice', 67, deps);
        party = await ready(party, 'bob', 68, deps);

        const nonHost = await kickTowerPartyMember({
            partyId: party.id,
            actor: 'alice',
            target: 'bob',
            requestId: request(69),
            expectedVersion: party.version,
            fingerprint: 'kick:bob:non-host',
        }, deps);
        assert.equal(nonHost.ok, false);
        if (!nonHost.ok) assert.equal(nonHost.code, 'host-required');

        const self = await kickTowerPartyMember({
            partyId: party.id,
            actor: 'host',
            target: 'host',
            requestId: request(691),
            expectedVersion: party.version,
            fingerprint: 'kick:host',
        }, deps);
        assert.equal(self.ok, false);
        if (!self.ok) assert.equal(self.code, 'invalid-target');

        const command = {
            partyId: party.id,
            actor: 'host',
            target: 'alice',
            requestId: request(692),
            expectedVersion: party.version,
            fingerprint: 'kick:alice',
        };
        const kicked = await kickTowerPartyMember(command, deps);
        assert.equal(kicked.ok, true);
        if (!kicked.ok) return;
        assert.deepEqual(kicked.party.members.map(member => member.slug), ['host', 'bob']);
        assert.ok(kicked.party.members.every(member => !member.ready));
        assert.equal(await activeTowerPartyForPlayer('alice', deps), null);
        assert.equal((await activeTowerPartyForPlayer('host', deps))?.id, party.id);

        const retry = await kickTowerPartyMember(command, deps);
        assert.equal(retry.ok, true);
        if (retry.ok) assert.equal(retry.replayed, true);
    });

    it('closes only the bound terminal run, releases member indices, and cannot erase a newer index', async () => {
        const deps = setup();
        let party = await create(deps);
        party = await join(party, 'alice', 70, deps);
        party = await ready(party, 'host', 71, deps);
        party = await ready(party, 'alice', 72, deps);
        const launched = await prepareTowerPartyLaunch({
            partyId: party.id, hostSlug: 'host', requestId: request(73), expectedVersion: party.version,
            binding: { mode: 'story', floor: 5 }, enforceStartCap: false,
        }, deps);
        assert.equal(launched.ok, true);
        if (!launched.ok) return;
        const runId = launched.party.launch!.runId;
        await activateTowerPartyLaunch(party.id, request(73), runId, deps);
        // Active-room reads now reconcile against the durable run. Keep this
        // close-contract fixture live so the wrong-run assertion is not testing
        // the separate missing-session recovery path.
        await deps.kv.set(sessionKey(runId), { status: 'active' }, { ex: 60 });
        assert.equal(await closeTowerPartyRun(party.id, 'wrong-run', deps), null);
        assert.equal((await activeTowerPartyForPlayer('host', deps))?.id, party.id);

        const closed = await closeTowerPartyRun(party.id, runId, deps);
        assert.equal(closed?.status, 'closed');
        assert.equal(closed?.launch?.state, 'completed');
        assert.equal(await activeTowerPartyForPlayer('host', deps), null);
        assert.equal(await activeTowerPartyForPlayer('alice', deps), null);

        const newerId = `tparty-${'c'.repeat(32)}`;
        await deps.kv.set(towerPartyPlayerKey('host'), newerId, { ex: 60 });
        await closeTowerPartyRun(party.id, runId, deps);
        assert.equal(await deps.kv.get(towerPartyPlayerKey('host')), newerId);
    });
});
