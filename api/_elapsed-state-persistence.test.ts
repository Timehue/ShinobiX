import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

let kv: typeof import('./_storage.js').kv;
let settleSaveRecordForRead: typeof import('./_elapsed-state.js').settleSaveRecordForRead;

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    ({ kv } = await import('./_storage.js'));
    ({ settleSaveRecordForRead } = await import('./_elapsed-state.js'));
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

test('owner read durably settles regenerated vitals for later authoritative mutations', async () => {
    const playerName = 'ElapsedVitalPersistence';
    const key = 'save:elapsedvitalpersistence';
    const now = 1_000_000;
    await kv.set(key, {
        _saveVersion: 7,
        _saveAt: now - 60_000,
        worldGeoV: 2,
        currentSector: 40,
        currentBiome: 'central',
        character: {
            name: playerName,
            hp: 0,
            maxHp: 100,
            chakra: 0,
            maxChakra: 100,
            stamina: 0,
            maxStamina: 100,
        },
    });

    try {
        const settled = await settleSaveRecordForRead(playerName, await kv.get<Record<string, unknown>>(key) as Record<string, unknown>, {
            persist: true,
            now,
        });
        const durable = await kv.get<Record<string, unknown>>(key);
        const projectedCharacter = settled.record.character as Record<string, unknown>;
        const durableCharacter = durable?.character as Record<string, unknown>;

        assert.ok(Number(projectedCharacter.stamina) > 0, 'owner read projects elapsed stamina');
        assert.equal(durableCharacter.stamina, projectedCharacter.stamina,
            'later lock-protected mutations must observe the same authoritative stamina');
        assert.equal(durableCharacter.hp, projectedCharacter.hp);
        assert.equal(durableCharacter.chakra, projectedCharacter.chakra);
        assert.equal(durable?._saveAt, settled.record._saveAt,
            'the durable record and owner response must share one save timestamp');
        assert.equal(durable?._saveVersion, 8, 'durable settlement returns a version clients can adopt');
        assert.equal(settled.record._saveVersion, 8);
    } finally {
        await kv.del(key);
    }
});
