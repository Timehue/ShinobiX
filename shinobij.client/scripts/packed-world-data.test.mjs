import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { packedWorldData } from './packed-world-data.mjs';
import { sectorRuntimeData } from './sector-runtime-data.mjs';

const unpack = async source => (await import(`data:text/javascript;base64,${Buffer.from(packedWorldData(source)).toString('base64')}`)).default;

test('packed geometry retains every coordinate, collision cell, landmark and full cache hash', async () => {
    let saved = 0;
    for (const file of ['continuous-world-layout', 'sector-floor-layout-data']) {
        let source = readFileSync(new URL(`../../shared/${file}.json`, import.meta.url), 'utf8');
        if (file === 'sector-floor-layout-data') source = sectorRuntimeData(source);
        assert.deepEqual(await unpack(source), JSON.parse(source));
        saved += Buffer.byteLength(JSON.stringify(JSON.parse(source))) - Buffer.byteLength(packedWorldData(source));
    }
    assert(saved > 35000, `world data saves ${saved} bytes without changing the code budget`);
});

test('delivery preserves Unicode, escapes, overlapping runs and unknown future fields', async () => {
    for (const value of [{ text: '忍者 🌊 é \\ "\n'.repeat(600), futureField: [null, false, 1.2345678901234567] }, {}, { text: 'a'.repeat(10000) }]) {
        assert.deepEqual(await unpack(JSON.stringify(value)), value);
    }
});
