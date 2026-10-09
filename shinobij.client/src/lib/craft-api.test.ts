import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forgeServer } from './craft-api';

test('exact-material crafts reuse their request identity after lost or malformed replies and release it after success', async () => {
    const original = globalThis.fetch;
    const sent: Array<{ requestId: string; materials: unknown; quantity: number }> = [];
    const materials = [{ 'gather-iron-sand': 2 }, { 'gather-heartwood-bark': 1 }, { 'gather-binding-fiber': 1 }];
    globalThis.fetch = async (_input, init) => {
        sent.push(JSON.parse(String(init?.body)));
        if (sent.length === 1) throw new TypeError('Response lost after settlement');
        if (sent.length === 2) return new Response('invalid json', { status: 200 });
        return new Response(JSON.stringify({ character: { name: 'exactretry' }, _saveVersion: 2 }), { status: 200 });
    };
    try {
        for (let attempt = 0; attempt < 4; attempt++) await forgeServer('exactretry', 'supply', 'thrown-shuriken', 1, materials);
        assert.equal(sent[0].requestId, sent[1].requestId);
        assert.equal(sent[1].requestId, sent[2].requestId);
        assert.notEqual(sent[2].requestId, sent[3].requestId, 'a later deliberate craft gets a fresh receipt');
        for (const body of sent) { assert.deepEqual(body.materials, materials); assert.equal(body.quantity, 1); }
    } finally { globalThis.fetch = original; }
});
