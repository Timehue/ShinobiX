import test from 'node:test';
import assert from 'node:assert/strict';
import { readRestoredRuins } from './_restored-ruins.js';
import { buildingSharedKey } from '../../shared/sector-buildings.js';

test('the public world snapshot lists only ruins standing restored, with their sector and end time',async()=>{
    const now=Date.parse('2026-11-07T12:00:00Z'),day=86_400_000;
    const rows:Record<string,unknown>={
        [buildingSharedKey('festival-welcome')]:{repairs:30,cycleRepairs:24,intactUntil:now+2*day,updatedAt:now},
        [buildingSharedKey('gorgewatch')]:{repairs:30,cycleRepairs:24,intactUntil:now-1,updatedAt:now-8*day},
        [buildingSharedKey('esplanade-record-house')]:{repairs:12,cycleRepairs:12,cycleAt:now},
        [buildingSharedKey('stronghold-2')]:{repairs:99,updatedAt:now},
    };
    const kv={get:async<T>(key:string)=>(rows[key]??null) as T|null};
    assert.deepEqual(await readRestoredRuins(kv,now),[{id:'festival-welcome',sector:52,intactUntil:now+2*day}]);
});
