import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NPC_CLANS, isNpcClanName, isNpcClanRecord, npcClanBareSlug, npcClanByName, npcClanOfMember } from './npc-clans.js';
import { NPC_CLAN_NAMES } from './npc-clan-names.js';
import { NPC_VILLAGE_ROSTER } from './npc-village-roster.js';
import { hasStaffImpersonationName, isCleanPlayerName, isCleanText, TEXT_LIMITS } from '../api/_text-moderation.js';

// Owner ruling 2026-11-10: three permanent Cinderhold clans of ten, every clan
// mixing ranks, a Commander founding each.

test('three clans of ten cover all thirty Cinderhold shinobi exactly once, each led by a Commander', () => {
    assert.equal(NPC_CLANS.length, 3);
    const all = NPC_CLANS.flatMap((clan) => clan.members);
    assert.equal(all.length, 30);
    assert.equal(new Set(all).size, 30);
    assert.deepEqual([...all].sort(), NPC_VILLAGE_ROSTER.map((npc) => npc.id).sort());
    const rank = (id: string) => NPC_VILLAGE_ROSTER.find((npc) => npc.id === id)!.rank;
    for (const clan of NPC_CLANS) {
        assert.equal(clan.members.length, 10, clan.name);
        assert.equal(clan.members[0], clan.founder, `${clan.name}: founder first`);
        assert.equal(rank(clan.founder), 'commander', `${clan.name}: a Commander founds it`);
        assert.equal(clan.members.filter((id) => rank(id) === 'commander').length, 1, `${clan.name}: one Commander`);
        for (const officer of clan.officers) {
            assert.ok(clan.members.includes(officer), `${clan.name}: officer ${officer} is a member`);
            assert.equal(rank(officer), 'elite', `${clan.name}: officers are its Elites`);
        }
        assert.deepEqual([...clan.officers].sort(), clan.members.filter((id) => rank(id) === 'elite').sort());
        for (const r of ['elite', 'jonin', 'chunin', 'genin'] as const) {
            assert.ok(clan.members.some((id) => rank(id) === r), `${clan.name} has a ${r}`);
        }
        // Commanders, Elites and Jonin never scale below level 15 (api/_npc-village-scaling.ts),
        // so every clan always has the four war-eligible members a clan war needs.
        assert.ok(clan.members.filter((id) => ['commander', 'elite', 'jonin'].includes(rank(id))).length >= 4, clan.name);
    }
});

test('the owner\'s clan leadership (2026-11-11): Kuroto, Renji and Virath found them, their Elites are the officers', () => {
    const leadership = NPC_CLANS.map((clan) => ({ name: clan.name, founder: clan.founder, officers: [...clan.officers] }));
    assert.deepEqual(leadership, [
        { name: 'Ashen Fang', founder: 'kuroto', officers: ['kat', 'raku'] },
        { name: 'Ember Ward', founder: 'renji', officers: ['nozomi', 'nyra'] },
        { name: 'Obsidian Veil', founder: 'virath', officers: ['roy'] },
    ]);
});

test('the clan names read like player clans and pass every name filter', () => {
    const names = NPC_CLANS.map((clan) => clan.name);
    assert.equal(new Set(names.map(npcClanBareSlug)).size, 3);
    // The client's tiny name list (shared/npc-clan-names.ts) is the same three.
    assert.deepEqual([...NPC_CLAN_NAMES], names);
    for (const name of names) assert.ok(isNpcClanName(name.toUpperCase()), `${name} is reserved in any spelling`);
    assert.equal(isNpcClanName('Ashen Fangs'), false);
    for (const name of names) {
        assert.ok(isCleanText(name), `${name} passes the clan-name moderation`);
        assert.ok(isCleanPlayerName(name), `${name} passes the name filter`);
        assert.equal(hasStaffImpersonationName(name), false, `${name} reads as no staff`);
        assert.ok(name.length <= TEXT_LIMITS.clanName, `${name} fits the clan-name limit`);
        assert.doesNotMatch(name, /npc|cinderhold|bot/i, 'nothing in the name marks it as the server\'s');
    }
});

test('a clan record is Cinderhold\'s only by name AND founder, so a same-named player clan stays a player clan', () => {
    assert.ok(isNpcClanName('Ashen Fang'));
    assert.ok(isNpcClanName('ashenfang'));
    assert.ok(isNpcClanName('ASHEN-FANG'));
    assert.equal(isNpcClanName('Ashen'), false);
    assert.equal(npcClanByName('ember ward')?.founder, 'renji');
    assert.ok(isNpcClanRecord({ name: 'Ashen Fang', founderName: ' KUROTO ' }));
    assert.equal(isNpcClanRecord({ name: 'Ashen Fang', founderName: 'someplayer' }), false);
    assert.equal(isNpcClanRecord({ name: 'Storm Clan', founderName: 'Kuroto' }), false);
    assert.equal(isNpcClanRecord(null), false);
    assert.equal(npcClanOfMember('RAKU')?.name, 'Ashen Fang');
    assert.equal(npcClanOfMember('someplayer'), undefined);
});
