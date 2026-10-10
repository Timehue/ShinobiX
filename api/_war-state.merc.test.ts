import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MERC_HIRE_RECEIPTS_MAX, mercContextKey, normalizeVillageWarRecord } from './_war-state.js';

// The merc parts of the village war record (owner redesign 2026-10-08): bands
// bound to the war they were hired for, and the hire receipts the per-war
// allowances count.

const V = 'Frostfang Village';
const SECTOR_CTX = { kind: 'sector', contestId: '23:moonshadowvillage-vs-frostfangvillage', instance: 'g1.s100', sector: 23 };
const VILLAGE_CTX = { kind: 'village', warId: 'frostfangvillage-vs-moonshadowvillage', generation: 2 };

describe('normalizeVillageWarRecord — mercenary bands', () => {
    it('keeps a bound band with its id and war, and two bands of one tier and hirer side by side', () => {
        const r = normalizeVillageWarRecord(V, {
            mercLeases: [
                { tierId: 'merc-ronin', player: 'kage', expiresAt: 5_000, count: 3, id: 'mh_a-00000001', context: SECTOR_CTX },
                { tierId: 'merc-ronin', player: 'kage', expiresAt: 6_000, count: 2, id: 'mh_b-00000001', context: VILLAGE_CTX },
            ],
        } as never);
        assert.deepEqual(r.mercLeases, [
            { tierId: 'merc-ronin', player: 'kage', expiresAt: 5_000, count: 3, id: 'mh_a-00000001', context: SECTOR_CTX },
            { tierId: 'merc-ronin', player: 'kage', expiresAt: 6_000, count: 2, id: 'mh_b-00000001', context: VILLAGE_CTX },
        ]);
    });

    it('dedupes a bound band by id and a legacy band by (tier, hirer), exactly as before', () => {
        const r = normalizeVillageWarRecord(V, {
            mercLeases: [
                { tierId: 'merc-oni', player: 'kage', expiresAt: 5_000, count: 4 },
                { tierId: 'merc-oni', player: 'kage', expiresAt: 9_000, count: 1 },
                { tierId: 'merc-oni', player: 'kage', expiresAt: 5_000, count: 4, id: 'mh_same-0000001', context: SECTOR_CTX },
                { tierId: 'merc-oni', player: 'kage', expiresAt: 7_000, count: 2, id: 'mh_same-0000001', context: SECTOR_CTX },
            ],
        } as never);
        assert.equal(r.mercLeases.length, 2);
        assert.deepEqual(r.mercLeases[0], { tierId: 'merc-oni', player: 'kage', expiresAt: 5_000, count: 4 }, 'a legacy band carries no binding');
        assert.equal(r.mercLeases[1].id, 'mh_same-0000001');
        assert.equal(r.mercLeases[1].expiresAt, 5_000);
    });

    it('drops a band whose binding is damaged rather than let it fight anywhere', () => {
        const r = normalizeVillageWarRecord(V, {
            mercLeases: [
                { tierId: 'merc-ronin', player: 'kage', expiresAt: 5_000, count: 3, id: 'mh_no-context-01' },
                { tierId: 'merc-ronin', player: 'kage', expiresAt: 5_000, count: 3, context: SECTOR_CTX },
                { tierId: 'merc-ronin', player: 'kage', expiresAt: 5_000, count: 3, id: 'mh_bad-kind-0001', context: { kind: 'clan' } },
                { tierId: 'merc-ronin', player: 'kage', expiresAt: 5_000, count: 3, id: 'mh_bad-gen-00001', context: { kind: 'village', warId: 'w', generation: 0 } },
                { tierId: 'merc-ronin', player: 'kage', expiresAt: 5_000, count: 3, id: 'mh_ok-000000001', context: VILLAGE_CTX },
            ],
        } as never);
        assert.deepEqual(r.mercLeases.map((l) => l.id), ['mh_ok-000000001']);
    });

    it('keeps the stores skip flag on a bound band', () => {
        const r = normalizeVillageWarRecord(V, {
            mercLeases: [{ tierId: 'merc-ronin', player: 'kage', expiresAt: 5_000, count: 3, skipNextAutoDeploy: true, id: 'mh_skip-0000001', context: SECTOR_CTX }],
        } as never);
        assert.equal(r.mercLeases[0].skipNextAutoDeploy, true);
    });
});

describe('normalizeVillageWarRecord — hire receipts', () => {
    const receipt = (id: string, at: number) => ({
        id, context: mercContextKey(VILLAGE_CTX as never), seat: 'kage', player: 'kage', tierId: 'merc-ronin', cost: 60, at, expiresAt: at + 10, keepUntil: at + 100,
    });

    it('is absent until a hire writes one (the default record carries none)', () => {
        assert.equal(normalizeVillageWarRecord(V).mercHires, undefined);
        assert.equal(normalizeVillageWarRecord(V, { warResources: 10 } as never).mercHires, undefined);
    });

    it('keeps well-formed receipts, drops malformed and duplicate ones', () => {
        const r = normalizeVillageWarRecord(V, {
            mercHires: [
                receipt('mh_one-00000001', 100),
                { ...receipt('mh_one-00000001', 200) },
                { ...receipt('mh_no-seat-0001', 300), seat: '' },
                { ...receipt('mh_no-keep-0001', 300), keepUntil: 0 },
                'junk',
                receipt('mh_two-00000001', 400),
            ],
        } as never);
        assert.deepEqual(r.mercHires?.map((h) => h.id), ['mh_one-00000001', 'mh_two-00000001']);
        assert.deepEqual(r.mercHires?.[0], receipt('mh_one-00000001', 100));
    });

    it('is bounded, keeping the newest', () => {
        const many = Array.from({ length: MERC_HIRE_RECEIPTS_MAX + 5 }, (_, i) => receipt(`mh_r-${String(i).padStart(8, '0')}`, 1_000 + i));
        const r = normalizeVillageWarRecord(V, { mercHires: many } as never);
        assert.equal(r.mercHires?.length, MERC_HIRE_RECEIPTS_MAX);
        assert.equal(r.mercHires?.[0].id, 'mh_r-00000005');
    });
});

describe('mercContextKey', () => {
    it('names one war instance', () => {
        assert.equal(mercContextKey(VILLAGE_CTX as never), 'village:frostfangvillage-vs-moonshadowvillage:g2');
        assert.equal(mercContextKey(SECTOR_CTX as never), 'sector:23:moonshadowvillage-vs-frostfangvillage:g1.s100');
    });
});
