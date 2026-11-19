import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
let kv: typeof import('./_storage.js').kv;
let fieldCampaignHush: typeof import('./_village-war-hush-defender.js').fieldCampaignHush;
let sealCampaignHushTeam: typeof import('./_village-war-hush-defender.js').sealCampaignHushTeam;
let sealCampaignHushCombat: typeof import('./_village-war-hush-defender.js').sealCampaignHushCombat;
const village = 'Frostfang Village';
before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ fieldCampaignHush, sealCampaignHushTeam, sealCampaignHushCombat } = await import('./_village-war-hush-defender.js'));
});
beforeEach(async () => { const keys = await kv.keys('*'); if (keys.length) await kv.del(...keys); });
async function seed(members: string[], kage = '') {
    for (const name of [...members, ...(kage ? [kage] : [])]) await kv.set(`save:${name}`, { character: { name, village } });
    await kv.set('game:village-state:frostfangvillage', { hushAppointees: members });
    if (kage) await kv.set('village:kage:frostfang-village', { seatedKage: kage });
}
describe('reusable village-war Hush copies', { concurrency: false }, () => {
    it('uses a fresh random candidate rather than the sector-war rotation', async () => {
        await seed(['alpha', 'bravo']);
        const rotation = { bravo: Date.now() };
        await kv.set('infil-hush-last:frostfangvillage', rotation);
        const selected = await fieldCampaignHush(village, async name => name, length => length - 1);
        assert.equal(selected.ok, true);
        if (selected.ok) assert.equal(selected.defender.slug, 'bravo');
        assert.deepEqual(await kv.get('infil-hush-last:frostfangvillage'), rotation);
    });
    it('can reuse the sole Hush repeatedly without consuming or cooldown-locking them', async () => {
        await seed(['alpha']);
        for (let assault = 0; assault < 5; assault++) {
            const selected = await fieldCampaignHush(village, async name => name);
            assert.equal(selected.ok, true);
            if (selected.ok) assert.equal(selected.defender.slug, 'alpha');
        }
        assert.equal(await kv.get('infil-hush-last:frostfangvillage'), null);
    });
    it('seals the current combat build for each assault while keeping an earlier copy unchanged', async () => {
        await seed(['alpha']);
        await kv.set('save:alpha', { character: { name: 'alpha', village, level: 40, maxHp: 3210, stats: { taijutsuOffense: 313 } } });
        const first = await sealCampaignHushCombat('alpha');
        await kv.set('save:alpha', { character: { name: 'alpha', village, level: 60, maxHp: 6540, stats: { taijutsuOffense: 678 } } });
        const second = await sealCampaignHushCombat('alpha');
        assert.equal(first?.character.level, 40); assert.equal(first?.character.maxHp, 3210);
        assert.equal((first?.character.stats as Record<string, number>).taijutsuOffense, 313);
        assert.equal(second?.character.level, 60); assert.equal(second?.character.maxHp, 6540);
        assert.equal((second?.character.stats as Record<string, number>).taijutsuOffense, 678);
    });
    it('tries another member when the randomly selected member cannot field that specialty', async () => {
        await seed(['alpha', 'bravo']); const tried: string[] = [];
        const selected = await fieldCampaignHush(village, async name => { tried.push(name); return name === 'bravo' ? null : name; }, length => length - 1);
        assert.equal(selected.ok, true); assert.deepEqual(tried, ['bravo', 'alpha']);
    });
    it('retains the seated Kage as a reusable reserve', async () => {
        await seed(['alpha'], 'kage');
        const selected = await fieldCampaignHush(village, async name => name === 'kage' ? name : null);
        assert.equal(selected.ok, true);
        if (selected.ok) assert.deepEqual(selected.defender, { slug: 'kage', byKage: true });
    });
    it('fails closed for missing village data rather than inventing a player build', async () => {
        assert.deepEqual(await fieldCampaignHush(village, async name => name), { ok: false, reason: 'no-defender' });
    });
    it('copies busy pets at their legal stat ceilings without touching their real activities', async () => {
        const save = { character: { name: 'alpha', village, level: 100, pets: [{ id: 'pet', rarity: 'legendary', hp: 100, attack: 100, defense: 100, speed: 100, expedition: { status: 'active' } }], petBreeding: { state: 'breeding', readyAt: Date.now() + 86_400_000, parentIds: ['pet'] } } };
        await kv.set('save:alpha', save);
        const team = await sealCampaignHushTeam('alpha');
        assert.equal(team?.length, 1); assert.equal(team?.[0].id, 'pet');
        assert.equal((team?.[0] as any).expedition, undefined);
        assert.deepEqual(await kv.get('save:alpha'), save);
    });
});
