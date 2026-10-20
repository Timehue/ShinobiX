import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { generateHollowGateFloor } from './hollow-gate-generate';
import { validateHollowGateFloorManifest } from '../../../api/hollow-gate/_floor-manifest';
import { createHollowGateWanderers } from '../../../shared/hollow-gate-wanderers';

const random = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const distance = (a: number, b: number, w: number) => Math.abs(a % w - b % w) + Math.abs(Math.floor(a / w) - Math.floor(b / w));

test('new pacing keeps counts, reachable healing/targets and no battle adjacent to an elite across supported board sizes', () => {
    for (const [width, height] of [[15, 11], [17, 13], [25, 17], [31, 21]]) for (const floor of [1, 2, 3, 4, 5]) for (let seed = 1; seed <= 40; seed++) {
        const r = generateHollowGateFloor(floor, floor === 5, { width, height }, random(seed + floor * 1000));
        const battles = r.tiles.flatMap((t, i) => t.kind === 'battle' ? [i] : []);
        const elites = r.tiles.flatMap((t, i) => t.kind === 'elite' ? [i] : []);
        assert.equal(battles.length, [4, 5, 6, 7, 8][floor - 1]);
        assert.equal(elites.length, [1, 2, 2, 3, 3][floor - 1]);
        for (const b of battles) assert.ok(elites.every(e => distance(e, b, width) >= 2));
        const keeper = r.tiles.find(t => t.kind === 'npc')!;
        if (keeper.roomId != null) assert.ok(battles.every(b => r.tiles[b].roomId !== keeper.roomId));
        const validated = validateHollowGateFloorManifest({ floor, finalFloor: floor === 5, width, height, playerX: r.playerX, playerY: r.playerY, tiles: r.tiles });
        assert.equal(validated.ok, true, JSON.stringify({ floor, seed, width, height, validated }));
        if (!validated.ok) continue;
        // Manifest validation proves every open cell connected, including both healers.
        const npcs = createHollowGateWanderers(validated.manifest, `pacing-${seed}`);
        const medic = npcs.find(n => n.role === 'medic');
        assert.ok(medic); assert.equal(validated.manifest.walkable[medic.tile], '1');
        const hostile = npcs.filter(n => !['medic', 'wayfarer'].includes(n.role));
        assert.equal(new Set(hostile.map(n => n.origin)).size, hostile.length);
        assert.ok(hostile.every(n => battles.includes(n.origin)));
    }
});

test('legacy pacing exactly reproduces all five pre-change seeded boards, including rooms and fog', () => {
    const expected = [
        'b3e356eb92526694533888f1d851bedcd3067c5b027c2603b02ae2f2f2e16514',
        '8441984d27705b74bbd7df67082efc9443c70de285e7ff08fea9183678948515',
        '70925079734be4a8ad6c50379faa7655c76e1b8552891986087697bdd42eaac0',
        'a8f76e9da44f268c95f3e7078e6652294fb4cdf19c628b9b29e1d00d1a15e939',
        '37ed38c4176a81484413947d47c537d960d28a388a6a1aad55528964bed1efcf',
    ];
    for (const floor of [1, 2, 3, 4, 5]) {
        const r = generateHollowGateFloor(floor, floor === 5, undefined, random(23 + floor * 1000), true);
        assert.equal(createHash('sha256').update(JSON.stringify(r)).digest('hex'), expected[floor - 1]);
    }
});
