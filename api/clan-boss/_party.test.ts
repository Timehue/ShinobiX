import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { CLAN_BOSS_SOLO_FALLBACK_MS } from '../../shared/clan-boss-operation.js';
import { _makeMemoryKv } from '../_storage.js';
import {
    CLAN_BOSS_PARTY_REGISTRY_KEY,
    addPartyMember,
    canClaimPartyLeadership,
    createPartyRecord,
    indexPartyMembers,
    listRegisteredPartyIds,
    partyClanRegistryKey,
    partyKey,
    partyPlayerKey,
    partyView,
    queueParty,
    reconcileClanBossPartyRegistry,
    registerPartyRecord,
    removePartyMember,
    snapshotForPlayer,
    sweepClanBossPartyRegistry,
    type PartyPlayerContext,
} from './_party.js';

const NOW = 10_000;
function player(slug: string): PartyPlayerContext {
    return {
        slug,
        displayName: slug.toUpperCase(),
        clanName: 'The Testers',
        saveVersion: 3,
        character: {
            name: slug, clan: 'The Testers', level: 40, profession: 'healer',
            equippedJutsuIds: ['a', 'b'], inventory: ['kunai'], equipment: { hand: 'kunai', armor: '' },
        },
    };
}

function party() {
    return createPartyRecord({ id: `cbp-${'a'.repeat(32)}`, player: player('leader'), weekId: '2026-W32', bossId: 'oni-warlord', sectorId: 66, visibility: 'public', now: NOW });
}

describe('Clan Boss operation party transitions', () => {
    it('creates a truthful one-player forming party with no implicit readiness', () => {
        const value = party();
        assert.equal(value.members.length, 1);
        assert.equal(value.members[0]?.ready, false);
        assert.equal(partyView(value, NOW).canStart, false);
    });

    it('seals the real jutsu and equipment-slot counts at readiness', () => {
        const snapshot = snapshotForPlayer(player('leader'), NOW);
        assert.equal(snapshot.jutsuCount, 2);
        assert.equal(snapshot.combatItemCount, 1);
        assert.equal(snapshot.saveVersion, 3);
    });

    it('accepts up to four real members and invalidates every ready snapshot when membership changes', () => {
        let value = party();
        value.members[0] = { ...value.members[0]!, ready: true, snapshot: snapshotForPlayer(player('leader'), NOW) };
        for (const slug of ['b', 'c', 'd']) {
            const joined = addPartyMember(value, player(slug), NOW + 1);
            assert.equal(joined.ok, true);
            if (joined.ok) value = joined.party;
        }
        assert.equal(value.members.length, 4);
        assert.ok(value.members.every((member) => !member.ready));
        const full = addPartyMember(value, player('e'), NOW + 2);
        assert.equal(full.ok, false);
        if (!full.ok) assert.equal(full.code, 'party-full');
    });

    it('transfers leadership deterministically when the leader leaves', () => {
        let value = party();
        const joined = addPartyMember(value, player('b'), NOW + 1);
        assert.equal(joined.ok, true);
        if (joined.ok) value = joined.party;
        const removed = removePartyMember(value, 'leader', NOW + 2);
        assert.equal(removed.ok, true);
        if (removed.ok) assert.equal(removed.party.leaderSlug, 'b');
    });

    it('lets a real member recover leadership only after the leader is stale', () => {
        let value = party();
        const joined = addPartyMember(value, player('b'), NOW + 1);
        assert.equal(joined.ok, true);
        if (joined.ok) value = joined.party;
        assert.equal(canClaimPartyLeadership(value, 'b', NOW + 44_000), false);
        assert.equal(canClaimPartyLeadership(value, 'b', NOW + 46_000), true);
        assert.equal(canClaimPartyLeadership(value, 'outsider', NOW + 46_000), false);
    });

    it('queues only an all-ready leader-owned party and exposes solo fallback after the bounded wait', () => {
        let value = party();
        value.members[0] = { ...value.members[0]!, ready: true, snapshot: snapshotForPlayer(player('leader'), NOW) };
        const queued = queueParty(value, 'leader', NOW);
        assert.equal(queued.ok, true);
        if (!queued.ok) return;
        assert.equal(queued.party.fallbackAt, NOW + CLAN_BOSS_SOLO_FALLBACK_MS);
        assert.equal(partyView(queued.party, NOW + CLAN_BOSS_SOLO_FALLBACK_MS - 1).fallbackAvailable, false);
        assert.equal(partyView(queued.party, NOW + CLAN_BOSS_SOLO_FALLBACK_MS).fallbackAvailable, true);
    });

    it('paginates the durable party registry without a 500-party blind spot', async () => {
        const store = _makeMemoryKv();
        for (let index = 0; index < 503; index += 1) {
            const id = `cbp-${index.toString(16).padStart(32, '0')}`;
            await store.hset(CLAN_BOSS_PARTY_REGISTRY_KEY, { [id]: { clanRegistryKey: 'clan', createdAt: index, updatedAt: index, status: 'forming' } });
        }
        const first = await listRegisteredPartyIds({ store, limit: 500 });
        assert.equal(first.total, 503);
        assert.equal(first.ids.length, 500);
        assert.ok(first.nextCursor);
        const second = await listRegisteredPartyIds({ store, limit: 500, cursor: first.nextCursor });
        assert.equal(second.ids.length, 3);
        assert.equal(second.nextCursor, null);
        assert.equal(new Set([...first.ids, ...second.ids]).size, 503);
    });

    it('repairs live registry/index state and removes only stale registry references', async () => {
        const store = _makeMemoryKv();
        const live = party();
        const missingId = `cbp-${'b'.repeat(32)}`;
        await store.set(partyKey(live.id), live, { ex: 60 });
        await store.hset(CLAN_BOSS_PARTY_REGISTRY_KEY, {
            [live.id]: { clanRegistryKey: 'wrong-clan', createdAt: 0, updatedAt: 0, status: 'completed' },
            [missingId]: { clanRegistryKey: partyClanRegistryKey(live.clanName), createdAt: 0, updatedAt: 0, status: 'forming' },
        });
        await store.hset(partyClanRegistryKey(live.clanName), { [missingId]: { createdAt: 0 } });

        const swept = await reconcileClanBossPartyRegistry({ store, limit: 10 });
        assert.equal(swept.scanned, 2);
        assert.equal(swept.repaired, 1);
        assert.equal(swept.removed, 1);
        assert.equal(await store.get(partyPlayerKey('leader')), live.id);
        assert.deepEqual(await store.get(partyKey(live.id)), live);
        assert.equal(await store.get(partyKey(missingId)), null);
        assert.equal((await store.hgetall<Record<string, unknown>>(CLAN_BOSS_PARTY_REGISTRY_KEY))?.[missingId], undefined);
        assert.ok((await store.hgetall<Record<string, unknown>>(partyClanRegistryKey(live.clanName)))?.[live.id]);
    });

    it('never lets live index repair overwrite a newer party binding', async () => {
        const store = _makeMemoryKv();
        const stale = party();
        const newerPartyId = `cbp-${'d'.repeat(32)}`;
        await store.set(partyPlayerKey('leader'), newerPartyId, { ex: 60 });
        await indexPartyMembers(stale, store);
        assert.equal(await store.get(partyPlayerKey('leader')), newerPartyId);
    });

    it('releases member indices for terminal parties while retaining their TTL-owned record', async () => {
        const store = _makeMemoryKv();
        const terminal = { ...party(), status: 'completed' as const, updatedAt: NOW + 1 };
        await store.set(partyKey(terminal.id), terminal, { ex: 60 });
        await store.set(partyPlayerKey('leader'), terminal.id, { ex: 60 });
        await registerPartyRecord(terminal, store);
        const swept = await reconcileClanBossPartyRegistry({ store, limit: 10 });
        assert.equal(swept.terminalIndicesCleared, 1);
        assert.equal(await store.get(partyPlayerKey('leader')), null);
        assert.deepEqual(await store.get(partyKey(terminal.id)), terminal);
    });

    it('never lets stale terminal cleanup erase a newer party index', async () => {
        const store = _makeMemoryKv();
        const terminal = { ...party(), status: 'completed' as const, updatedAt: NOW + 1 };
        const newerPartyId = `cbp-${'c'.repeat(32)}`;
        await store.set(partyKey(terminal.id), terminal, { ex: 60 });
        await store.set(partyPlayerKey('leader'), newerPartyId, { ex: 60 });
        await registerPartyRecord(terminal, store);
        const swept = await reconcileClanBossPartyRegistry({ store, limit: 10 });
        assert.equal(swept.terminalIndicesCleared, 0);
        assert.equal(await store.get(partyPlayerKey('leader')), newerPartyId);
    });

    it('discovers authoritative live parties missed by a failed registry write', async () => {
        const store = _makeMemoryKv();
        const live = party();
        await store.set(partyKey(live.id), live, { ex: 60 });
        const swept = await sweepClanBossPartyRegistry(store);
        assert.equal(swept.discovered, 1);
        assert.ok((await store.hgetall<Record<string, unknown>>(CLAN_BOSS_PARTY_REGISTRY_KEY))?.[live.id]);
        assert.ok((await store.hgetall<Record<string, unknown>>(partyClanRegistryKey(live.clanName)))?.[live.id]);
    });
});
