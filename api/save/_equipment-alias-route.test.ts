import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'equipment-alias-route-local-session-secret';

type Character = Record<string, unknown>;
type Save = { character: Character; _saveVersion: number; _saveAt: number; _regenAt: number };
type SaleHandler = typeof import('../inventory/sell.js').default;
let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./[name].js').default;
let saleHandlers: Array<[string, SaleHandler]>;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./[name].js')).default as unknown as typeof handler;
    ({ issuePlayerToken } = await import('../_auth.js'));
    saleHandlers = [
        ['inventory', (await import('../inventory/sell.js')).default as unknown as SaleHandler],
        ['shop', (await import('../shop/sell.js')).default as unknown as SaleHandler],
    ];
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function postSave(record: Save, character: Character): Promise<Save> {
    const name = String(character.name);
    const outcome: { status: number; body?: Record<string, unknown> } = { status: 200 };
    const res = {
        setHeader() { return res; },
        status(code: number) { outcome.status = code; return res; },
        json(body: Record<string, unknown>) { outcome.body = body; return res; },
        end() { return res; },
    };
    await handler({
        method: 'POST', query: { name },
        headers: { 'x-player-name': name, 'x-player-token': issuePlayerToken(name)! },
        socket: { remoteAddress: '127.0.0.85' },
        // JSON removes undefined alias keys exactly as the real autosave does.
        body: JSON.parse(JSON.stringify({ ...record, character, _baseSaveVersion: record._saveVersion })),
    } as never, res as never);
    assert.equal(outcome.status, 200, JSON.stringify(outcome.body));
    const stored = await kv.get<Save>(`save:${name}`);
    assert.ok(stored);
    assert.equal(stored._saveVersion, record._saveVersion + 1);
    return stored;
}

for (const flag of [undefined, '0', '1']) {
    test(`canonical UI sale consumes legacy equipped items through both handlers with strict ledger ${flag ?? 'unset'}`, async () => {
        const previousFlag = process.env.STRICT_RAW_SAVE_LEDGER;
        if (flag === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = flag;
        try {
            for (const [route, saleHandler] of saleHandlers) {
                for (const [alias, slot, id, value] of [
                    ['weapon', 'hand', 'rustfang-kunai', 112],
                    ['armor', 'body', 'shinobi-vest', 90],
                ] as const) {
                    const name = `aliassale${flag ?? 'unset'}${route}${alias}`;
                    await kv.set(`save:${name}`, {
                        _saveVersion: 1, _saveAt: Date.now(),
                        character: { name, level: 100, ryo: 0, stats: {}, inventory: [], itemStacks: [], equipment: { [alias]: id } },
                    });
                    try {
                        const outcome: { status: number; body?: Record<string, unknown> } = { status: 200 };
                        const res = {
                            setHeader() { return res; },
                            status(code: number) { outcome.status = code; return res; },
                            json(body: Record<string, unknown>) { outcome.body = body; return res; },
                            end() { return res; },
                        };
                        await saleHandler({
                            method: 'POST', query: {}, socket: { remoteAddress: '127.0.0.86' },
                            headers: { 'x-player-token': issuePlayerToken(name)! },
                            body: { playerName: name, itemId: id, source: 'equipped', equipmentSlot: slot, quantity: 1, qty: 1, requestId: 'canonicaluisale01' },
                        } as never, res as never);
                        assert.equal(outcome.status, 200, JSON.stringify(outcome.body));
                        const stored = await kv.get<Save>(`save:${name}`);
                        assert.ok(stored);
                        assert.deepEqual(stored.character.equipment, {});
                        assert.deepEqual(stored.character.inventory, []);
                        assert.equal(stored.character.ryo, value);
                        assert.equal(stored._saveVersion, 2);
                        assert.deepEqual(outcome.body?.character, stored.character);
                        assert.equal(outcome.body?._saveVersion, stored._saveVersion);
                    } finally { await kv.del(`save:${name}`); }
                }
            }
        } finally {
            if (previousFlag === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
            else process.env.STRICT_RAW_SAVE_LEDGER = previousFlag;
        }
    });

    test(`authenticated alias swap/unequip/re-equip persists both items with strict ledger ${flag ?? 'unset'}`, async () => {
        const previousFlag = process.env.STRICT_RAW_SAVE_LEDGER;
        const realNow = Date.now;
        let now = realNow();
        Date.now = () => now;
        if (flag === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = flag;
        try {
            for (const [alias, slot, oldId, newId] of [
                ['weapon', 'hand', 'rustfang-kunai', 'training-katana'],
                ['armor', 'body', 'shinobi-vest', 'reinforced-vest'],
            ]) {
                const name = `aliasswap${flag ?? 'unset'}${alias}`;
                let record: Save = {
                    _saveVersion: 1, _saveAt: now, _regenAt: now,
                    character: {
                        name, level: 100, ryo: 0, stats: {},
                        hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
                        inventory: [newId], itemStacks: [], equipment: { [alias]: oldId },
                    },
                };
                await kv.set(`save:${name}`, record);
                try {
                    // Inventory.equipItem returns the displaced piece and spreads
                    // the old equipment object before setting the canonical key.
                    record = await postSave(record, {
                        ...record.character, inventory: [oldId],
                        equipment: { ...(record.character.equipment as object), [slot]: newId },
                    });
                    assert.deepEqual(record.character.inventory, [oldId]);
                    assert.deepEqual(record.character.equipment, { [slot]: newId });
                    now += 4_000;
                    record = await postSave(record, {
                        ...record.character, inventory: [oldId, newId],
                        equipment: { [slot]: undefined, [alias]: undefined },
                    });
                    assert.deepEqual(record.character.inventory, [oldId, newId]);
                    assert.deepEqual(record.character.equipment, {});
                    now += 4_000;
                    record = await postSave(record, {
                        ...record.character, inventory: [newId], equipment: { [slot]: oldId },
                    });
                    assert.deepEqual(record.character.inventory, [newId]);
                    assert.deepEqual(record.character.equipment, { [slot]: oldId });
                } finally { await kv.del(`save:${name}`); }
            }
        } finally {
            Date.now = realNow;
            if (previousFlag === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
            else process.env.STRICT_RAW_SAVE_LEDGER = previousFlag;
        }
    });
}
