import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { CLAN_BOSS_SOLO_FALLBACK_MS } from '../../shared/clan-boss-operation.js';
import { addPartyMember, canClaimPartyLeadership, createPartyRecord, partyView, queueParty, removePartyMember, snapshotForPlayer, type PartyPlayerContext } from './_party.js';

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
});
