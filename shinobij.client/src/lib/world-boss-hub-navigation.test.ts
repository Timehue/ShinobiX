import assert from 'node:assert/strict';
import {test} from 'node:test';
import {worldBossEntryTab,worldBossTabStorageKey,stageWorldBossEventReturn,peekWorldBossEventReturn,clearWorldBossEventReturn} from './world-boss-hub-navigation';
test('Stand and Fight launches the weekly boss even after browsing the roaming boss tab',()=>{
    assert.equal(worldBossEntryTab('hollow-beast',true),'weekly');
    assert.equal(worldBossEntryTab('hollow-beast',false),'hollow-beast');
    assert.equal(worldBossEntryTab(null,false),'weekly');
    assert.equal(worldBossTabStorageKey('Rill'),worldBossTabStorageKey('rill'));
    assert.notEqual(worldBossTabStorageKey('Rill'),worldBossTabStorageKey('Other'));
});
test('a recovered raid returns to the roaming event without browser storage and cannot cross accounts',()=>{
    stageWorldBossEventReturn('Rill');
    const entry=peekWorldBossEventReturn('rill');
    assert.ok(entry);assert.equal(peekWorldBossEventReturn('Other'),null);
    assert.equal(worldBossEntryTab(null,false,!!entry),'hollow-beast');
    stageWorldBossEventReturn('Rill');
    clearWorldBossEventReturn(entry);
    assert.ok(peekWorldBossEventReturn('Rill'),'a stale mount cannot consume a newer return');
    clearWorldBossEventReturn(peekWorldBossEventReturn('Rill'));
    assert.equal(peekWorldBossEventReturn('Rill'),null);
});
