import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'elapsed-vital-consumer-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;

let kv: typeof import('../_storage.js').kv;
let settleSaveRecordForRead: typeof import('../_elapsed-state.js').settleSaveRecordForRead;
let mutatePlayerSave: typeof import('./_mutate-player-save.js').mutatePlayerSave;
let applyBankTransfer: typeof import('../bank/_transfer.js').applyBankTransfer;
let startTraining: Handler;

const TEST_PREFIX = 'elapsedvitalconsumer';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function character(name: string): Json {
    return {
        name,
        level: 1,
        hp: 10,
        maxHp: 100,
        chakra: 20,
        maxChakra: 100,
        stamina: 0,
        maxStamina: 100,
        ryo: 100,
        bankRyo: 25,
        stats: { strength: 10, speed: 10, intelligence: 10, willpower: 10 },
        unspentStats: 0,
        totalStatsTrained: 0,
    };
}

function response() {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function postTraining(playerName: string) {
    const { out, res } = response();
    await startTraining({
        method: 'POST',
        body: { playerName, stat: 'strength', tierId: '15m' },
        query: {},
        headers: {
            'content-type': 'application/json',
            'x-admin-password': ADMIN_PASSWORD,
            'x-forwarded-for': '127.0.0.79',
        },
        socket: { remoteAddress: '127.0.0.79' },
    } as never, res);
    return out;
}

async function seedAndSettle(playerName: string, now: number) {
    const key = `save:${playerName}`;
    const record: Json = {
        _saveVersion: 1,
        _saveAt: now - 10_000,
        character: character(playerName),
    };
    await kv.set(key, record);
    return await settleSaveRecordForRead(playerName, record, { persist: true, now });
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ settleSaveRecordForRead } = await import('../_elapsed-state.js'));
    ({ mutatePlayerSave } = await import('./_mutate-player-save.js'));
    ({ applyBankTransfer } = await import('../bank/_transfer.js'));
    startTraining = (await import('../training/start.js')).default as unknown as Handler;
});

after(async () => {
    for (const key of await kv.keys(`*${TEST_PREFIX}*`)) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

describe('durable elapsed vitals across raw-save consumers', { concurrency: false }, () => {
    it('training start debits the stamina projected by the preceding owner settlement', async () => {
        const playerName = `${TEST_PREFIX}training`;
        const settled = await seedAndSettle(playerName, Date.now());
        const projected = settled.record.character as Json;
        assert.equal(projected.stamina, 10, 'the owner settlement projects ten stamina');

        const out = await postTraining(playerName);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal((out.body?.character as Json).stamina, 5,
            'the 15-minute training tier debits five from the projected stamina');

        const durable = await kv.get<Json>(`save:${playerName}`);
        assert.equal((durable?.character as Json).stamina, 5);
        assert.equal(durable?._saveVersion, 3,
            'owner settlement and training each publish one authoritative version');
    });

    it('a normal bank mutation preserves all vitals from the preceding owner settlement', async () => {
        const playerName = `${TEST_PREFIX}bank`;
        const settled = await seedAndSettle(playerName, Date.now());
        const projected = settled.record.character as Json;
        assert.deepEqual(
            { hp: projected.hp, chakra: projected.chakra, stamina: projected.stamina },
            { hp: 20, chakra: 30, stamina: 10 },
        );

        const out = await mutatePlayerSave(playerName, ({ character: current }) => {
            const transfer = applyBankTransfer(current, 'deposit', 25);
            if (!transfer.ok) return transfer;
            return {
                ok: true,
                character: transfer.character,
                value: { ryo: transfer.ryo, bankRyo: transfer.bankRyo },
            };
        });

        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.deepEqual(
            { hp: out.character.hp, chakra: out.character.chakra, stamina: out.character.stamina },
            { hp: 20, chakra: 30, stamina: 10 },
            'a bank-only mutation must carry the projected vitals forward',
        );
        assert.deepEqual(out.value, { ryo: 75, bankRyo: 50 });

        const durable = await kv.get<Json>(`save:${playerName}`);
        const durableCharacter = durable?.character as Json;
        assert.deepEqual(
            { hp: durableCharacter.hp, chakra: durableCharacter.chakra, stamina: durableCharacter.stamina },
            { hp: 20, chakra: 30, stamina: 10 },
        );
        assert.equal(durable?._saveVersion, 3);
    });
});
