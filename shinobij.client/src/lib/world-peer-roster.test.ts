import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldPeerRoster } from './world-peer-roster';
import type { PlayerRecord } from '../types/character';
const peer = (name: string, sector = 22) => ({ name, currentSector: sector, level: 40 } as PlayerRecord);
const camp = (name: string) => ({ name, level: 40, tile: 78, sleeping: true });

test('world terrain includes sleeping camps and canonicalizes live/self identities', () => {
    const rows = worldPeerRoster(22, 'My Ninja', [peer('myninja'), peer('shadowfox')],
        [peer('Shadow Fox')], [camp('shadowfox'), camp('Sleeper')]);
    assert.deepEqual(rows.map(p => p.name), ['Shadow Fox', 'Sleeper']);
    assert.equal(rows[0].sleeping, undefined);
    assert.equal(rows[1].sleeping, true);
    assert.equal(rows[1].tile, 78);
});

test('fresh camp replaces stale nearby presence; local players precede neighboring markers', () => {
    const rows = worldPeerRoster(22, 'viewer', [peer('Neighbor', 23), peer('Rest')], [], [camp('Rest')]);
    assert.equal(rows[0].name, 'Rest');
    assert.equal(rows[0].sleeping, true);
    assert.equal(rows[1].name, 'Neighbor');
    assert.equal(worldPeerRoster(22, 'viewer', [], [], Array.from({length: 100}, (_, i) => camp(`P${i}`))).length, 100);
});
