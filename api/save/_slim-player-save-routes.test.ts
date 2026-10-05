import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'slim-player-save-routes-secret';
process.env.ADMIN_PASSWORD = 'slim-player-save-routes-admin';
process.env.ENABLE_LEGACY = '0';

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let saveHandler: Handler;
let slimHandler: Handler;
let issueToken: typeof import('../_auth.js').issuePlayerToken;
let resetItemCatalog: () => void;
const PRIOR_FLAG = process.env.SLIM_PLAYER_SAVES;

const FORGED = 'named-weapon-1234abcd-12ab-34cd-56ef-1234567890ab';
const ADMIN_ARMOR = { id: 'admin-tidewall-plate', name: 'Tidewall Plate', slot: 'body', rarity: 'mythic', bonuses: { defense: 40 } };
const ADMIN_SCROLL = { id: 'admin-gale-scroll', name: 'Gale Scroll', slot: 'waist', rarity: 'epic', bonuses: { speed: 12 } };

before(async () => {
    ({ kv } = await import('../_storage.js'));
    saveHandler = (await import('./[name].js')).default as unknown as Handler;
    slimHandler = (await import('../admin/slim-player-saves.js')).default as unknown as Handler;
    issueToken = (await import('../_auth.js')).issuePlayerToken;
    resetItemCatalog = (await import('../_admin-item-catalog.js')).__resetAdminItemCatalogCache;
});

after(() => {
    if (PRIOR_FLAG === undefined) delete process.env.SLIM_PLAYER_SAVES;
    else process.env.SLIM_PLAYER_SAVES = PRIOR_FLAG;
});

function bloated(name: string) {
    return {
        _saveVersion: 4,
        character: {
            name, level: 1, xp: 0, experience: 0, ryo: 0, rank: 'Academy Student', rankTitle: 'Academy Student', village: '',
            stats: {}, inventory: [], itemStacks: [], pets: [], equipment: { hand: FORGED, body: ADMIN_ARMOR.id }, earnedTitles: [], serverTitles: [],
        },
        creatorItems: [ADMIN_ARMOR, ADMIN_SCROLL, { id: FORGED, name: 'Moonfang', slot: 'hand', rarity: 'legendary', weaponEp: 26 }],
        creatorJutsus: [{ id: 'frozen-copy', name: 'Frozen', power: 1 }],
        editablePets: [{ id: 'pet-copy' }],
        creatorAis: [{ id: 'ai-copy' }],
        creatorEvents: [{ id: 'event-copy' }],
        creatorCards: [{ id: 'card-copy' }],
    };
}

function respond() {
    const out = { status: 200, body: undefined as Record<string, any> | undefined };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.status = code; return res; },
        json: (value: Record<string, any>) => { out.body = value; return res; },
        end: () => res,
    };
    return { out, res };
}

async function autosave(name: string, body: Record<string, unknown>) {
    const { out, res } = respond();
    await saveHandler({
        method: 'POST', query: { name }, body,
        headers: { 'x-player-name': name, 'x-player-token': issueToken(name)!, 'content-type': 'application/json' },
        socket: { remoteAddress: '203.0.113.90' },
    } as never, res as never);
    return out;
}

async function slimAdmin(body: Record<string, unknown>) {
    const { out, res } = respond();
    await slimHandler({ method: 'POST', body, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '203.0.113.91' } } as never, res as never);
    return out;
}

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    resetItemCatalog();
    await kv.set('save:admin1', { character: { name: 'Admin 1' }, creatorItems: [ADMIN_ARMOR, ADMIN_SCROLL] });
});

describe('autosave with SLIM_PLAYER_SAVES', () => {
    it('off (SLIM_PLAYER_SAVES=0, the kill switch): the stored row keeps its copies exactly as today', async () => {
        process.env.SLIM_PLAYER_SAVES = '0';
        await kv.set('save:slimoff', bloated('slimoff'));
        await kv.set('auth:slimoff', { salt: 's', hash: 'scrypt:16384:8:1:00' });
        const saved = await autosave('slimoff', { character: bloated('slimoff').character, _baseSaveVersion: 4 });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        const stored = await kv.get<Record<string, any>>('save:slimoff');
        assert.deepEqual(stored!.editablePets, [{ id: 'pet-copy' }]);
        assert.equal(stored!.creatorItems.length, 3);
        // The new client omits creatorJutsus from the body; the stored copy is
        // what PvP resolves, so it must survive untouched (zero PvP change).
        assert.deepEqual(stored!.creatorJutsus, [{ id: 'frozen-copy', name: 'Frozen', power: 1 }]);
        for (const field of ['creatorAis', 'creatorEvents', 'creatorCards']) assert.ok(field in stored!, `${field} kept while off`);
    });

    it('on (the default, unset): the stored row drops shared copies, keeps forged gear and the frozen jutsu copy', async () => {
        delete process.env.SLIM_PLAYER_SAVES;
        await kv.set('save:slimon', bloated('slimon'));
        await kv.set('auth:slimon', { salt: 's', hash: 'scrypt:16384:8:1:00' });
        const saved = await autosave('slimon', { character: bloated('slimon').character, _baseSaveVersion: 4 });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        const stored = await kv.get<Record<string, any>>('save:slimon');
        for (const field of ['editablePets', 'creatorAis', 'creatorEvents', 'creatorCards']) assert.equal(field in stored!, false, field);
        assert.deepEqual(stored!.creatorItems.map((item: { id: string }) => item.id), [ADMIN_ARMOR.id, ADMIN_SCROLL.id, FORGED], 'every item copy kept: admin, unheld admin and forged');
        assert.deepEqual(stored!.creatorJutsus, [{ id: 'frozen-copy', name: 'Frozen', power: 1 }]);
        assert.deepEqual(stored!.character.equipment, { hand: FORGED, body: ADMIN_ARMOR.id }, 'equipment untouched');
    });
});

describe('first-slim gate through a real autosave', () => {
    it('when the fight check cannot run, the save commits FULL and still succeeds', async (t) => {
        delete process.env.SLIM_PLAYER_SAVES;
        await kv.set('save:gatefull', bloated('gatefull'));
        await kv.set('auth:gatefull', { salt: 's', hash: 'scrypt:16384:8:1:00' });
        // The admin slots cannot be read, so the strict admin catalog never loads
        // and parity cannot be proven.
        const realMget = kv.mget.bind(kv);
        t.mock.method(kv, 'mget', async (...keys: string[]) => {
            if (keys.includes('save:admin1') || keys.includes('save:admin2')) throw new Error('database unavailable');
            return realMget(...keys);
        });
        const saved = await autosave('gatefull', { character: bloated('gatefull').character, _baseSaveVersion: 4 });
        assert.equal(saved.status, 200, `the player's save still succeeds: ${JSON.stringify(saved.body)}`);
        t.mock.restoreAll();
        const stored = await kv.get<Record<string, any>>('save:gatefull');
        for (const field of ['editablePets', 'creatorAis', 'creatorEvents', 'creatorCards']) assert.ok(field in stored!, `${field} kept: unproven slims never commit`);
    });
});

describe('/api/admin/slim-player-saves', () => {
    it('dry run reports what would change, proves parity, and writes nothing', async () => {
        delete process.env.SLIM_PLAYER_SAVES;
        await kv.set('save:dormant', bloated('dormant'));
        const before = await kv.get('save:dormant');
        const report = await slimAdmin({});
        assert.equal(report.status, 200, JSON.stringify(report.body));
        assert.equal(report.body?.dryRun, true);
        assert.equal(report.body?.slimmable, 1);
        assert.deepEqual(report.body?.parityFailures, []);
        assert.ok(report.body!.bytesAfter < report.body!.bytesBefore);
        assert.deepEqual(await kv.get('save:dormant'), before, 'a dry run never writes');
        assert.equal(report.body?.nextCursor, null);
    });

    it('refuses to write while the kill switch is on (SLIM_PLAYER_SAVES=0)', async () => {
        process.env.SLIM_PLAYER_SAVES = '0';
        const refused = await slimAdmin({ dryRun: false });
        assert.equal(refused.status, 409);
    });

    it('by default it slims dormant saves, keeps the version, and never touches admin slots', async () => {
        delete process.env.SLIM_PLAYER_SAVES;
        await kv.set('save:dormant', bloated('dormant'));
        const applied = await slimAdmin({ dryRun: false });
        assert.equal(applied.status, 200, JSON.stringify(applied.body));
        assert.equal(applied.body?.written, 1);
        const stored = await kv.get<Record<string, any>>('save:dormant');
        assert.equal('editablePets' in stored!, false);
        assert.deepEqual(stored!.creatorItems.map((item: { id: string }) => item.id), [ADMIN_ARMOR.id, ADMIN_SCROLL.id, FORGED], 'item copies are never slimmed');
        assert.equal(stored!._saveVersion, 4, 'nothing the player owns changed, so open clients are not forced to refetch');
        assert.deepEqual((await kv.get<Record<string, any>>('save:admin1'))!.creatorItems, [ADMIN_ARMOR, ADMIN_SCROLL]);
        const again = await slimAdmin({ dryRun: false });
        assert.equal(again.body?.written, 0, 'idempotent');
        assert.equal(again.body?.unchanged, 1);
    });
});
