import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    hollowGateManifestNode,
    hollowGatePositionNodeId,
    validateHollowGateFloorManifest,
} from './_floor-manifest.js';

type Tile = { kind: string; terrain: string };

function floorTiles(floor: number, finalFloor: boolean): Tile[] {
    const width = 15;
    const height = 11;
    const tiles: Tile[] = Array.from({ length: width * height }, () => ({ kind: 'empty', terrain: 'room_floor' }));
    let index = 20;
    const place = (kind: string, count: number) => {
        for (let placed = 0; placed < count; placed += 1) {
            tiles[index] = { kind, terrain: 'room_floor' };
            index += 1;
        }
    };
    place('battle', 4 + Math.min(5, floor));
    place('elite', 1 + Math.floor(floor / 2));
    place('trap', 1);
    place('chest', 3);
    place('shard_vein', 1 + Math.floor(floor / 2));
    place('locked', 1);
    place('shrine', 1);
    place('story', 1);
    place('npc', 1);
    tiles[15 * 9 + 1] = { kind: 'exit', terrain: 'room_floor' };
    tiles[15 * 9 + 13] = { kind: finalFloor ? 'boss' : 'descend', terrain: 'room_floor' };
    return tiles;
}

function validate(floor: number, finalFloor: boolean, tiles = floorTiles(floor, finalFloor)) {
    return validateHollowGateFloorManifest({
        floor,
        finalFloor,
        width: 15,
        height: 11,
        playerX: 1,
        playerY: 1,
        tiles,
    });
}

test('valid non-final and final Hollow Gate manifests seal exact gameplay nodes', () => {
    for (const [floor, finalFloor] of [[1, false], [5, true]] as const) {
        const result = validate(floor, finalFloor);
        assert.equal(result.ok, true);
        if (!result.ok) continue;
        const targetIndex = 15 * 9 + 13;
        const targetId = `floor:${floor}:tile:${targetIndex}`;
        assert.equal(hollowGateManifestNode(result.manifest, targetId), finalFloor ? 'boss' : 'descend');
        assert.equal(hollowGatePositionNodeId(result.manifest, { x: 13, y: 9 }), targetId);
        assert.equal(hollowGatePositionNodeId(result.manifest, { x: 15, y: 9 }), '');
    }
});

test('floor manifest rejects client-authored reward and combat count inflation', () => {
    const extraChest = floorTiles(1, false);
    extraChest[100] = { kind: 'chest', terrain: 'room_floor' };
    assert.deepEqual(validate(1, false, extraChest), { ok: false, reason: 'too-many-chest' });

    const missingBattle = floorTiles(1, false);
    const battle = missingBattle.findIndex((tile) => tile.kind === 'battle');
    missingBattle[battle] = { kind: 'empty', terrain: 'room_floor' };
    assert.deepEqual(validate(1, false, missingBattle), { ok: false, reason: 'invalid-battle-count' });
});

test('floor manifest rejects disconnected walkable pockets and a nearby target', () => {
    const disconnected = floorTiles(1, false);
    const pocket = 15 * 5 + 7;
    for (const index of [pocket - 15, pocket + 15, pocket - 1, pocket + 1]) {
        disconnected[index] = { kind: 'wall', terrain: 'wall' };
    }
    assert.deepEqual(validate(1, false, disconnected), { ok: false, reason: 'disconnected-floor' });

    const nearby = floorTiles(1, false);
    const far = 15 * 9 + 13;
    nearby[far] = { kind: 'empty', terrain: 'room_floor' };
    nearby[1 * 15 + 3] = { kind: 'descend', terrain: 'room_floor' };
    assert.deepEqual(validate(1, false, nearby), { ok: false, reason: 'target-too-close' });
});

test('all Hollow Gate node consumers use the immutable run manifest', () => {
    const source = (...parts: string[]) => readFileSync(join(...parts), 'utf8');
    for (const file of ['step.ts', 'event.ts', 'combat-start.ts', 'descend.ts', 'settle.ts']) {
        const text = source('api', 'hollow-gate', file);
        assert.match(text, /floorManifests/, `${file} must read the sealed manifest`);
        assert.equal(text.includes('savedRun?.tiles'), false, `${file} must not trust saved browser tiles`);
    }
    const server = source('server.ts');
    const client = source('shinobij.client', 'src', 'lib', 'hollow-gate-event-api.ts');
    assert.match(server, /route\('\/hollow-gate\/floor-seal'/);
    assert.match(client, /\/api\/hollow-gate\/floor-seal/);
});
