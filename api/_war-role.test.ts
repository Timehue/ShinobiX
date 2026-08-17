import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { kv } from './_storage.js';
import {
    ROLE_KAGE,
    ROLE_ELDER,
    ROLE_ANBU,
    ROLE_VILLAGER,
    ROLE_MERC,
    sealedSectorWarRoleOf,
    sectorControlSwing,
    sectorWarRoleOf,
} from './_war-role.js';

async function withKvRecords<T>(records: Map<string, unknown>, run: () => Promise<T>): Promise<T> {
    const originalGet = kv.get;
    kv.get = async <V = unknown>(key: string) => (records.get(key) ?? null) as V | null;
    try {
        return await run();
    } finally {
        kv.get = originalGet;
    }
}

describe('war-role: weights mirror the village-war model', () => {
    it('Kage 30/50, Elder 20/20, ANBU 15/0, villager 5/0; a merc is a villager', () => {
        assert.deepEqual(ROLE_KAGE, { win: 30, loss: 50 });
        assert.deepEqual(ROLE_ELDER, { win: 20, loss: 20 });
        assert.deepEqual(ROLE_ANBU, { win: 15, loss: 0 });
        assert.deepEqual(ROLE_VILLAGER, { win: 5, loss: 0 });
        assert.deepEqual(ROLE_MERC, ROLE_VILLAGER);
    });
});

describe('war-role: sectorControlSwing = winner.win + loser.loss', () => {
    it('villager v villager = 5 (the small chip that makes a capture take a while)', () => {
        assert.equal(sectorControlSwing(ROLE_VILLAGER, ROLE_VILLAGER), 5);
    });
    it('a villager who fells a defending Kage swings 55 (5 + 50)', () => {
        assert.equal(sectorControlSwing(ROLE_VILLAGER, ROLE_KAGE), 55);
    });
    it('a Kage storming a villager swings 30 (30 + 0)', () => {
        assert.equal(sectorControlSwing(ROLE_KAGE, ROLE_VILLAGER), 30);
    });
    it('Kage v Kage = 80 (30 + 50)', () => {
        assert.equal(sectorControlSwing(ROLE_KAGE, ROLE_KAGE), 80);
    });
    it('applies the War-Academy multiplier and never drops below 1', () => {
        assert.equal(sectorControlSwing(ROLE_VILLAGER, ROLE_VILLAGER, 1.15), 6); // round(5 * 1.15)
        assert.equal(sectorControlSwing(ROLE_KAGE, ROLE_KAGE, 1.15), 92);        // round(80 * 1.15)
        assert.equal(sectorControlSwing(ROLE_VILLAGER, ROLE_VILLAGER, 0), 1);    // floored to >= 1
    });
});

// The seat is read from the AUTHORITATIVE `village:kage:<slug>` row. It used to be
// taken from the `game:village-state:<slug>` MIRROR, which only refreshes on a
// validated villageState write — so a genuinely seated Kage fought at VILLAGER
// weight (5, not 30) until some member's next save rehydrated it. Confirmed live
// on a real seated Kage before the fix. The two keys slug differently, which is
// what made the bug easy to miss: dashes here, punctuation stripped there.
describe('war-role: the Kage seat key', () => {
    it('hyphenates spaces, matching every other Kage power', () => {
        // api/village/_kage-settle.ts kageKey + world-state.ts isSeatedKageOf.
        const expected = 'village:kage:ashen-leaf-village';
        assert.equal(`village:kage:${'Ashen Leaf Village'.toLowerCase().replace(/\s+/g, '-')}`, expected);
    });

    it('is NOT the village-state slug, which strips punctuation entirely', () => {
        const seat = `village:kage:${'Ashen Leaf Village'.toLowerCase().replace(/\s+/g, '-')}`;
        const mirror = `game:village-state:${'Ashen Leaf Village'.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        assert.notEqual(seat, mirror);
        assert.equal(mirror, 'game:village-state:ashenleafvillage');
    });

    it('a Kage swing is worth 6x a villager, which is what the bug silently cost', () => {
        assert.equal(sectorControlSwing(ROLE_KAGE, ROLE_VILLAGER), 30);
        assert.equal(sectorControlSwing(ROLE_VILLAGER, ROLE_VILLAGER), 5);
    });
});

describe('war-role: sealed village authority', () => {
    it('does not let a post-battle Kage/ANBU appointment amplify sealed villager evidence', async () => {
        const createdAt = 1_800_000_000_000;
        const evidence = {
            version: 1 as const,
            sealedAt: createdAt,
            p1: { village: 'Leaf', role: { ...ROLE_VILLAGER } },
            p2: { village: 'Mist', role: { ...ROLE_VILLAGER } },
        };
        const appointedAfterBattle = new Map<string, unknown>([
            ['save:fighter', { character: { village: 'Leaf' } }],
            ['village:kage:leaf', { seatedKage: 'fighter' }],
            ['game:village-state:leaf', { anbuAppointees: ['fighter'] }],
        ]);
        assert.deepEqual(
            await withKvRecords(appointedAfterBattle, () => sectorWarRoleOf('fighter', 'Leaf')),
            ROLE_KAGE,
            'live authority changed after session creation',
        );
        assert.deepEqual(
            sealedSectorWarRoleOf(evidence, 'p1', 'Leaf', createdAt),
            ROLE_VILLAGER,
            'settlement consumes the immutable creation-time role instead',
        );
        assert.deepEqual(
            sealedSectorWarRoleOf({ ...evidence, sealedAt: createdAt + 1 }, 'p1', 'Leaf', createdAt),
            ROLE_VILLAGER,
            'misbound evidence fails closed',
        );
    });

    it('does not import Kage, ANBU, or clan-leader weight after a village switch', async () => {
        const roleCases: Array<{
            label: string;
            seat: Record<string, unknown>;
            villageState: Record<string, unknown>;
            character?: Record<string, unknown>;
        }> = [
            { label: 'seated Kage', seat: { seatedKage: 'switcher' }, villageState: {} },
            { label: 'appointed ANBU', seat: {}, villageState: { anbuAppointees: ['switcher'] } },
            { label: 'client-claimed clan leader', seat: {}, villageState: {}, character: { clan: 'Cloud Guard', clanFounder: true } },
        ];

        for (const { label, seat, villageState, character } of roleCases) {
            const records = new Map<string, unknown>([
                ['save:switcher', { character: { village: 'Mist', ...character } }],
                ['village:kage:mist', seat],
                ['game:village-state:mist', villageState],
            ]);
            const role = await withKvRecords(records, () => sectorWarRoleOf('switcher', 'Leaf'));
            assert.deepEqual(role, ROLE_VILLAGER, `${label} from Mist cannot affect a sealed Leaf battle`);
        }
    });

    it('retains authoritative role resolution when the current and sealed villages match', async () => {
        const kageRecords = new Map<string, unknown>([
            ['save:leader', { character: { village: 'Ashen Leaf Village' } }],
            ['village:kage:ashen-leaf-village', { seatedKage: 'leader' }],
            ['game:village-state:ashenleafvillage', {}],
        ]);
        assert.deepEqual(
            await withKvRecords(kageRecords, () => sectorWarRoleOf('leader', 'ashen leaf village')),
            ROLE_KAGE,
        );

        const anbuRecords = new Map<string, unknown>([
            ['save:operative', { character: { village: 'Mist' } }],
            ['village:kage:mist', {}],
            ['game:village-state:mist', { anbuAppointees: ['operative'] }],
        ]);
        assert.deepEqual(
            await withKvRecords(anbuRecords, () => sectorWarRoleOf('operative', 'Mist')),
            ROLE_ANBU,
        );

        const multiWordNames = new Map<string, unknown>([
            ['save:ladyraine', { character: { village: 'Mist' } }],
            ['save:hiddenblade', { character: { village: 'Mist' } }],
            ['village:kage:mist', { seatedKage: 'Lady Raine' }],
            ['game:village-state:mist', { anbuAppointees: ['Hidden Blade'] }],
        ]);
        assert.deepEqual(
            await withKvRecords(multiWordNames, () => sectorWarRoleOf('Lady Raine', 'Mist')),
            ROLE_KAGE,
        );
        assert.deepEqual(
            await withKvRecords(multiWordNames, () => sectorWarRoleOf('Hidden Blade', 'Mist')),
            ROLE_ANBU,
        );

    });

    it('ignores forged Kage, Elder, and ANBU titles', async () => {
        for (const storyTitle of ['Kage', 'Second Elder', 'ANBU Captain']) {
            const records = new Map<string, unknown>([
                ['save:forger', { character: { village: 'Mist', storyTitle, rankTitle: storyTitle } }],
                ['village:kage:mist', {}],
                ['game:village-state:mist', { anbuAppointees: [] }],
            ]);
            assert.deepEqual(
                await withKvRecords(records, () => sectorWarRoleOf('forger', 'Mist')),
                ROLE_VILLAGER,
                storyTitle,
            );
        }
    });

    it('does not trust self-promoted role overrides or a padded client-writable clan roster', async () => {
        const records = new Map<string, unknown>([
            ['save:selfpromoter', { character: { village: 'Mist', clan: 'Storm Clan', clanFounder: true } }],
            ['village:kage:mist', {}],
            ['game:village-state:mist', {}],
            ['save:clan-stormclan', {
                founderName: 'selfpromoter',
                roleOverrides: { selfpromoter: 'Clan Elder' },
                members: Array.from({ length: 20 }, (_, i) => ({ name: i ? `fake-${i}` : 'selfpromoter' })),
            }],
        ]);
        assert.deepEqual(
            await withKvRecords(records, () => sectorWarRoleOf('self promoter', 'Mist')),
            ROLE_VILLAGER,
        );
    });
});
