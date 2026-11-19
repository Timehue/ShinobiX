import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

/*
 * Who holds a sector's garrison is one decision shared by all three engines
 * (api/_sector-war-garrison-defender.ts). Choosing a defender was not enough:
 * the chosen one has to be able to FIELD what the engine seals, and a defender
 * who could not (a Pet garrison Hush whose pets were all on an expedition)
 * refused the whole assault for as long as the rotation kept landing on them.
 */

const VILLAGE = 'Frostfang Village';
const STATE_KEY = 'game:village-state:frostfangvillage';
const KAGE_KEY = 'village:kage:frostfang-village';

let kv: typeof import('./_storage.js').kv;
let defender: typeof import('./_sector-war-garrison-defender.js');
let hushLastDefKey: typeof import('./_hush-infiltration-store.js').hushLastDefKey;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    defender = await import('./_sector-war-garrison-defender.js');
    ({ hushLastDefKey } = await import('./_hush-infiltration-store.js'));
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function seedVillage(appointees: string[], kage = '') {
    for (const slug of [...appointees, ...(kage ? [kage] : [])]) {
        await kv.set(`save:${slug}`, { character: { name: slug, village: VILLAGE } });
    }
    await kv.set(STATE_KEY, { hushAppointees: appointees });
    if (kage) await kv.set(KAGE_KEY, { seatedKage: kage });
}

const lastDefended = async () => (await kv.get<Record<string, number>>(hushLastDefKey('frostfangvillage'))) ?? {};

describe('fieldGarrisonDefender', { concurrency: false }, () => {
    it('walks the rotation past a Hush who cannot field, and stamps only the one who defends', async () => {
        await seedVillage(['hushalpha', 'hushbravo']);
        const tried: string[] = [];
        const out = await defender.fieldGarrisonDefender(VILLAGE, async (slug) => {
            tried.push(slug);
            return slug === 'hushalpha' ? null : `team-of-${slug}`;
        });
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.deepEqual(tried, ['hushalpha', 'hushbravo'], 'rotation order: least recently defended, then slug');
        assert.deepEqual(out.defender, { slug: 'hushbravo', byKage: false });
        assert.equal(out.fielded, 'team-of-hushbravo');
        const stamps = await lastDefended();
        assert.ok(stamps.hushbravo > 0, 'the defender is stamped so the rotation moves past them');
        assert.equal(stamps.hushalpha, undefined, 'a refusal stamps nobody');
    });

    it('follows the same least-recently-defended order the pick always used', async () => {
        await seedVillage(['hushalpha', 'hushbravo']);
        await kv.set(hushLastDefKey('frostfangvillage'), { hushalpha: Date.now() });
        const tried: string[] = [];
        await defender.fieldGarrisonDefender(VILLAGE, async (slug) => { tried.push(slug); return slug; });
        assert.deepEqual(tried, ['hushbravo'], 'alpha defended last, so bravo goes first');
    });

    it('falls back to the seated Kage when no appointee can field', async () => {
        await seedVillage(['hushalpha'], 'thekage');
        const out = await defender.fieldGarrisonDefender(VILLAGE, async (slug) => (slug === 'thekage' ? 'kage-team' : null));
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.deepEqual(out.defender, { slug: 'thekage', byKage: true });
    });

    it('refuses only when nobody can field, and says which refusal it is', async () => {
        await seedVillage(['hushalpha'], 'thekage');
        const none = await defender.fieldGarrisonDefender(VILLAGE, async () => null);
        assert.deepEqual(none, { ok: false, reason: 'cannot-field' });

        const keys = await kv.keys('*');
        if (keys.length) await kv.del(...keys);
        const empty = await defender.fieldGarrisonDefender(VILLAGE, async () => 'anything');
        assert.deepEqual(empty, { ok: false, reason: 'no-defender' }, 'no Hush and no Kage: nobody to defend at all');
    });
});

describe('maskedGarrisonDefenderName', () => {
    it('names the defence, never the player, numbered by roster position', () => {
        const roster = ['hushalpha', 'hushbravo'];
        assert.equal(defender.maskedGarrisonDefenderName(VILLAGE, { slug: 'hushbravo', byKage: false }, roster), 'Frostfang Hush #2');
        assert.equal(defender.maskedGarrisonDefenderName(VILLAGE, { slug: 'thekage', byKage: true }, roster), 'The Frostfang Kage');
    });
});
