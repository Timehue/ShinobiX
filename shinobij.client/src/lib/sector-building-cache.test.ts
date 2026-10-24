import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBuildingView, type BuildingCache } from './sector-building-cache';
import { buildingDetailView } from '../../../api/sector/_building-view';
import { sectorBuilding } from '../../../shared/sector-buildings';
import { readBuildingProgress } from '../../../shared/sector-building-state';
import type { BuildingWorldView } from '../../../shared/sector-building-types';

const NOW=Date.parse('2026-10-23T12:00:00Z');
const empty:BuildingCache={player:'first',details:{},version:-1};
function view(saveVersion:number,revision:number,repairs:number):BuildingWorldView{
    const progress=readBuildingProgress({repairs},NOW);
    return{sector:38,serverNow:NOW,saveVersion,progress,buildings:[buildingDetailView(sectorBuilding('gorgewatch')!,{sectorBuildings:progress},{repairs,revision},NOW)]};
}
test('a late read cannot reopen a completed order or reverse the player save',()=>{
    const fresh=mergeBuildingView(empty,view(4,3,20),'first');
    const old=view(3,2,19);old.progress.active={id:'spent',buildingId:'gorgewatch',kind:'repair',startedAt:NOW,stepAt:NOW,step:2,day:'2026-10-23'};
    assert.equal(mergeBuildingView(fresh,old,'first'),fresh);
    assert.equal(fresh.progress?.active,undefined);assert.equal(fresh.progress?.repairs,20);
});
test('an older communal replica cannot reverse art while a newer personal projection still updates',()=>{
    const first=mergeBuildingView(empty,view(4,8,12),'first');
    const next=mergeBuildingView(first,view(5,7,4),'first');
    assert.equal(next.progress?.repairs,4);assert.equal(next.details.gorgewatch.shared.repairs,12);assert.equal(next.details.gorgewatch.shared.stage,2);
});
test('switching identities drops the previous player’s cached counters and save version',()=>{
    const first=mergeBuildingView(empty,view(200,8,12),'first'),nextView=view(1,1,1);
    nextView.buildings=[];
    const second=mergeBuildingView(first,nextView,'second');
    assert.equal(second.version,1);assert.equal(second.player,'second');assert.deepEqual(second.details,{});assert.equal(second.progress?.repairs,1);
});
