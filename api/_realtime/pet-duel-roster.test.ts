import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { sealAuthoritativePetRoster } from './pet-duel-socket.js';

const lead = { id: 'lead', name: 'Authoritative Lead', level: 12 };
const reserve = { id: 'reserve', name: 'Authoritative Reserve', level: 11 };
const third = { id: 'third', name: 'Third Pet', level: 10 };
const busy = { id: 'busy', name: 'Busy Pet', level: 9, expedition: { endsAt: Date.now() + 60_000 } };
const character = {
    activePetId: lead.id,
    activePetId2v2: reserve.id,
    pets: [lead, reserve, third, busy],
};

describe('live pet-duel authoritative roster cardinality', () => {
    it('seals exactly one authoritative eligible pet for 1v1', () => {
        const sealed = sealAuthoritativePetRoster(character, [{ id: lead.id, level: 9999 }], '1v1');
        assert.equal(sealed?.length, 1);
        assert.equal(sealed?.[0], lead, 'client fields must be replaced by the server-owned pet');

        assert.equal(sealAuthoritativePetRoster(character, [], '1v1'), null);
        assert.equal(sealAuthoritativePetRoster(character, [{ id: lead.id }, { id: reserve.id }], '1v1'), null);
    });

    it('seals exactly two distinct authoritative eligible pets for 2v2', () => {
        const sealed = sealAuthoritativePetRoster(character, [{ id: lead.id }, { id: reserve.id }], '2v2');
        assert.deepEqual(sealed, [lead, reserve]);

        assert.equal(sealAuthoritativePetRoster(character, [{ id: lead.id }], '2v2'), null);
        assert.equal(sealAuthoritativePetRoster(character, [{ id: lead.id }, { id: reserve.id }, { id: third.id }], '2v2'), null);
        assert.equal(sealAuthoritativePetRoster(character, [{ id: lead.id }, { id: lead.id }], '2v2'), null);
        assert.equal(sealAuthoritativePetRoster(character, [{ id: lead.id }, { id: 'not-owned' }], '2v2'), null);
        assert.equal(sealAuthoritativePetRoster(character, [{ id: lead.id }, { id: busy.id }], '2v2'), null);
    });

    it('applies the same seal at challenge and both accept-time reseals without adding reward writes', () => {
        const source = readFileSync(join(process.cwd(), 'api', '_realtime', 'pet-duel-socket.ts'), 'utf8');
        assert.match(source, /loadAuthoritativePetRoster\(name, p\.pets, mode\)/);
        assert.match(source, /if \(!pets\?\.length\) return socket\.emit\('petduel:error'/);
        assert.match(source, /loadAuthoritativePetRoster\(pending\.p1\.name, pendingSeat\.p1\.pets, pending\.mode\)/);
        assert.match(source, /loadAuthoritativePetRoster\(name, p\.pets, pending\.mode\)/);
        assert.match(source, /if \(!challengerPets\?\.length\)/);
        assert.match(source, /if \(!defenderPets\?\.length\) return socket\.emit\('petduel:error'/);
        assert.doesNotMatch(source, /\bkv\.(?:set|del|incr|hset)\(/, 'live cinematic duels must remain no-reward/read-only for saves');
    });
});
